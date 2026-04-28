#import "WNJSEngine.h"
#import "WNObjCBridge.h"
#import "WNHookEngine.h"
#import "WNBlockBridge.h"
#import "WNNativeBridge.h"
#import "WNModuleLoader.h"
#import "WNDebugSupport.h"
#import "WNCookieBridge.h"
#import "WNUserDefaultsBridge.h"
#import "WNFileSystemBridge.h"
#import "WNPerformanceBridge.h"
#import "WNUIDebugBridge.h"
#import "WNSQLiteBridge.h"
#import "WNLeakDetector.h"
#if WN_ENABLE_REFGRAPH
#import "WNRefGraphDetector.h"
#endif
#import <objc/runtime.h>
#import <CoreFoundation/CoreFoundation.h>
#import <stdatomic.h>

static NSString *const kWNLogPrefix = @"[WhiteNeedle:JS]";

static _Atomic int s_wnJSThreadExternalWaitCount = 0;

#pragma mark - Timer handle for setTimeout/setInterval

@interface WNTimerHandle : NSObject
@property (nonatomic, strong) NSTimer *timer;
@property (nonatomic, assign) NSUInteger timerId;
@end

@implementation WNTimerHandle
@end

#pragma mark - WNJSEngine

@interface WNJSEngine ()
@property (nonatomic, strong) JSContext *context;
@property (nonatomic, strong) JSVirtualMachine *vm;
@property (nonatomic, strong) NSMutableDictionary<NSString *, JSValue *> *loadedScripts;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, WNTimerHandle *> *timers;
@property (nonatomic, assign) NSUInteger nextTimerId;
@property (nonatomic, assign) BOOL isReady;
@property (nonatomic, strong) NSHashTable<id<WNJSEngineDelegate>> *observers;
@property (nonatomic, strong, nullable) NSThread *jsThread;
@property (nonatomic, strong, nullable) NSPort *jsKeepAlivePort;
@property (nonatomic, assign) BOOL jsThreadReady;
/// Captured on the JS thread in `jsThreadMain` for CFRunLoopWakeUp from other threads.
@property (atomic, assign) CFRunLoopRef jsRunLoopRef;
/// Signaled from `jsThreadMain` when the run loop and invoke defaults are ready (replaces busy-wait in -ensureJSThread).
@property (nonatomic, strong) dispatch_semaphore_t jsThreadStartSemaphore;
@end

@implementation WNJSEngine

+ (instancetype)sharedEngine {
    static WNJSEngine *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[WNJSEngine alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _loadedScripts = [NSMutableDictionary dictionary];
        _timers = [NSMutableDictionary dictionary];
        _nextTimerId = 1;
        _isReady = NO;
        _observers = [NSHashTable weakObjectsHashTable];
        _jsThreadReady = NO;
    }
    return self;
}

- (void)addObserver:(id<WNJSEngineDelegate>)observer {
    @synchronized (self.observers) {
        [self.observers addObject:observer];
    }
}

- (void)removeObserver:(id<WNJSEngineDelegate>)observer {
    @synchronized (self.observers) {
        [self.observers removeObject:observer];
    }
}

#pragma mark - Lifecycle

- (void)setup {
    @synchronized (self) {
        if (self.isReady) return;
        // JVM/JSContext must be created and all registerInContext: calls must run on the same
        // thread that evaluateScript: uses (dedicated JS execution thread).
        [self ensureJSThread];
        [self performOnJSThread:^{
            if (self.isReady) return;

            self.vm = [[JSVirtualMachine alloc] init];
            self.context = [[JSContext alloc] initWithVirtualMachine:self.vm];

            [self registerConsoleAPI];
            [self registerTimerAPI];
            [self registerUtilityAPI];
            [self installExceptionHandler];
            [WNObjCBridge registerInContext:self.context];
            [WNHookEngine registerInContext:self.context];
            [WNBlockBridge registerInContext:self.context];
            [WNNativeBridge registerInContext:self.context];
            [WNModuleLoader registerInContext:self.context];
            [WNDebugSupport enableInspectorForContext:self.context];
            [WNDebugSupport registerInContext:self.context];
            [WNCookieBridge registerInContext:self.context];
            [WNUserDefaultsBridge registerInContext:self.context];
            [WNFileSystemBridge registerInContext:self.context];
            [WNPerformanceBridge registerInContext:self.context];
            [WNUIDebugBridge registerInContext:self.context];
            [WNSQLiteBridge registerInContext:self.context];
            [WNLeakDetector registerInContext:self.context];
#if WN_ENABLE_REFGRAPH
            [WNRefGraphDetector registerInContext:self.context];
#endif

            self.isReady = YES;
            NSLog(@"%@ Engine initialized (JavaScriptCore)", kWNLogPrefix);
        } waitUntilDone:YES];
    }
}

- (void)teardown {
    @synchronized (self) {
        if (self.timers.count > 0) {
            void (^invalidateTimers)(void) = ^{
                for (WNTimerHandle *handle in self.timers.allValues) {
                    [handle.timer invalidate];
                }
                [self.timers removeAllObjects];
            };
            if ([NSThread isMainThread]) {
                invalidateTimers();
            } else {
                dispatch_sync(dispatch_get_main_queue(), invalidateTimers);
            }
        }

        if (self.isReady) {
            [self ensureJSThread];
            [self performOnJSThread:^{
                [self.loadedScripts removeAllObjects];
                self.context = nil;
                self.vm = nil;
                self.isReady = NO;
            } waitUntilDone:YES];
        } else {
            [self.loadedScripts removeAllObjects];
        }

        [self stopJSThread];
    }
    NSLog(@"%@ Engine torn down", kWNLogPrefix);
}

- (void)resetContext {
    NSLog(@"%@ Resetting JSContext...", kWNLogPrefix);
    [WNPerformanceBridge stopFpsMonitor];
    [WNHookEngine detachAll];
    [WNModuleLoader clearAllCache];
    [WNModuleLoader resetSearchPaths];
    [self teardown];
    [self setup];
    NSLog(@"%@ JSContext reset complete", kWNLogPrefix);
}

#pragma mark - JS execution thread

- (void)ensureJSThread {
    if (self.jsThread && !self.jsThread.isFinished) {
        return;
    }

    self.jsThreadReady = NO;
    self.jsThreadStartSemaphore = dispatch_semaphore_create(0);
    self.jsThread = [[NSThread alloc] initWithTarget:self selector:@selector(jsThreadMain) object:nil];
    self.jsThread.name = @"WhiteNeedle.JSExecution";
    [self.jsThread start];

    dispatch_semaphore_wait(self.jsThreadStartSemaphore, DISPATCH_TIME_FOREVER);
}

- (void)stopJSThread {
    NSThread *thread = self.jsThread;
    if (!thread) return;

    [self performSelector:@selector(stopJSThreadRunLoop)
                 onThread:thread
               withObject:nil
            waitUntilDone:NO];
    [thread cancel];
    self.jsThread = nil;
    self.jsKeepAlivePort = nil;
    self.jsThreadReady = NO;
}

- (void)jsThreadMain {
    @autoreleasepool {
        self.jsRunLoopRef = CFRunLoopGetCurrent();
        self.jsKeepAlivePort = [NSMachPort port];
        [[NSRunLoop currentRunLoop] addPort:self.jsKeepAlivePort forMode:NSDefaultRunLoopMode];
        WNSetInvokeTargetQueue(dispatch_get_main_queue());
        self.jsThreadReady = YES;
        if (self.jsThreadStartSemaphore) {
            dispatch_semaphore_signal(self.jsThreadStartSemaphore);
        }

        while (![[NSThread currentThread] isCancelled]) {
            @autoreleasepool {
                [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate distantFuture]];
            }
        }

        WNSetInvokeTargetQueue(NULL);
        self.jsRunLoopRef = NULL;
    }
}

- (void)stopJSThreadRunLoop {
    CFRunLoopStop(CFRunLoopGetCurrent());
}

- (void)executeBlock:(dispatch_block_t)block {
    if (block) block();
}

- (id)performOnJSThreadSyncValue:(id (^)(void))block {
    if (!block) return nil;
    __block id result = nil;
    [self performOnJSThread:^{
        result = block();
    } waitUntilDone:YES];
    return result;
}

- (void)performOnJSThread:(dispatch_block_t)block waitUntilDone:(BOOL)waitUntilDone {
    if (!block) return;
    [self ensureJSThread];

    if ([NSThread currentThread] == self.jsThread) {
        block();
        return;
    }

    BOOL isExternalWaiter = (waitUntilDone && [NSThread currentThread] != self.jsThread);
    if (isExternalWaiter) {
        atomic_fetch_add_explicit(&s_wnJSThreadExternalWaitCount, 1, memory_order_relaxed);
    }
    @try {
        [self performSelector:@selector(executeBlock:)
                     onThread:self.jsThread
                   withObject:[block copy]
                waitUntilDone:waitUntilDone];
    } @finally {
        if (isExternalWaiter) {
            atomic_fetch_sub_explicit(&s_wnJSThreadExternalWaitCount, 1, memory_order_relaxed);
        }
    }
}

- (BOOL)isOnJSThread {
    return [NSThread currentThread] == self.jsThread;
}

- (void)wakeJSThread {
    CFRunLoopRef rl = self.jsRunLoopRef;
    if (rl) {
        CFRunLoopWakeUp(rl);
    }
}

#pragma mark - Script management

- (BOOL)loadScript:(NSString *)code name:(NSString *)name {
    if (!self.isReady) {
        NSLog(@"%@ Engine not ready, cannot load script: %@", kWNLogPrefix, name);
        return NO;
    }

    __block BOOL ok = NO;
    [self performOnJSThread:^{
        [self unloadScript:name];

        // Re-evaluating the same script in one JSContext leaves top-level `class` / `let` / `const`
        // bindings in the global environment; a second run causes "Can't create duplicate variable".
        // Run user scripts inside an IIFE so each load gets a fresh function scope. Optional
        // bootstrap (bundled as bootstrap.js) is left unwrapped so it can intentionally populate globals.
        NSString *codeToEval = code;
        if (![name isEqualToString:@"bootstrap.js"]) {
            codeToEval = [NSString stringWithFormat:@"(function(){\n%@\n})();", code];
        }

        WNSetInvokeTargetQueue(dispatch_get_main_queue());
        JSValue *result = [self.context evaluateScript:codeToEval withSourceURL:[NSURL URLWithString:name]];
        if (!result) {
            NSLog(@"%@ Failed to evaluate script: %@", kWNLogPrefix, name);
            return;
        }

        self.loadedScripts[name] = result;
        NSLog(@"%@ Script loaded: %@", kWNLogPrefix, name);
        ok = YES;
    } waitUntilDone:YES];
    return ok;
}

- (void)unloadScript:(NSString *)name {
    [self performOnJSThread:^{
        if (self.loadedScripts[name]) {
            [self.loadedScripts removeObjectForKey:name];
            NSLog(@"%@ Script unloaded: %@", kWNLogPrefix, name);
        }
    } waitUntilDone:YES];
}

- (JSValue *)evaluateScript:(NSString *)code {
    if (!self.isReady) return nil;
    return [self performOnJSThreadSyncValue:^id{
        WNSetInvokeTargetQueue(dispatch_get_main_queue());
        return [self.context evaluateScript:code];
    }];
}

- (NSArray<NSString *> *)loadedScriptNames {
    return [self performOnJSThreadSyncValue:^id{
        return [self.loadedScripts allKeys];
    }] ?: @[];
}

#pragma mark - Console API

- (void)registerConsoleAPI {
    __weak typeof(self) weakSelf = self;

    JSValue *consoleObj = [JSValue valueWithNewObjectInContext:self.context];

    consoleObj[@"log"] = ^{
        [weakSelf handleConsoleWithLevel:@"log" arguments:[JSContext currentArguments]];
    };
    consoleObj[@"warn"] = ^{
        [weakSelf handleConsoleWithLevel:@"warn" arguments:[JSContext currentArguments]];
    };
    consoleObj[@"error"] = ^{
        [weakSelf handleConsoleWithLevel:@"error" arguments:[JSContext currentArguments]];
    };
    consoleObj[@"info"] = ^{
        [weakSelf handleConsoleWithLevel:@"info" arguments:[JSContext currentArguments]];
    };
    consoleObj[@"debug"] = ^{
        [weakSelf handleConsoleWithLevel:@"debug" arguments:[JSContext currentArguments]];
    };

    self.context[@"console"] = consoleObj;
}

- (void)handleConsoleWithLevel:(NSString *)level arguments:(NSArray<JSValue *> *)args {
    NSMutableArray *parts = [NSMutableArray array];
    for (JSValue *arg in args) {
        [parts addObject:[self stringifyJSValue:arg]];
    }
    NSString *message = [parts componentsJoinedByString:@" "];
    NSLog(@"%@ [%@] %@", kWNLogPrefix, level, message);

    if ([self.delegate respondsToSelector:@selector(jsEngine:didReceiveConsoleMessage:level:)]) {
        [self.delegate jsEngine:self didReceiveConsoleMessage:message level:level];
    }

    NSArray *snapshot;
    @synchronized (self.observers) {
        snapshot = self.observers.allObjects;
    }
    for (id<WNJSEngineDelegate> obs in snapshot) {
        if (obs != self.delegate && [obs respondsToSelector:@selector(jsEngine:didReceiveConsoleMessage:level:)]) {
            [obs jsEngine:self didReceiveConsoleMessage:message level:level];
        }
    }
}

- (NSString *)stringifyJSValue:(JSValue *)value {
    if ([value isUndefined]) return @"undefined";
    if ([value isNull]) return @"null";
    if ([value isBoolean]) return [value toBool] ? @"true" : @"false";
    if ([value isNumber]) return [[value toNumber] stringValue];
    if ([value isString]) return [value toString];

    if ([value isObject]) {
        JSValue *toStringFn = value[@"toString"];
        if (toStringFn && [toStringFn isObject] && ![[toStringFn toString] isEqualToString:@"function toString() { [native code] }"]) {
            JSValue *str = [toStringFn callWithArguments:@[]];
            if (str && ![str isUndefined]) return [str toString];
        }

        JSValue *jsonFn = [self.context evaluateScript:@"(function(o){try{return JSON.stringify(o,null,2)}catch(e){return String(o)}})"];
        JSValue *result = [jsonFn callWithArguments:@[value]];
        return [result toString];
    }

    return [value toString];
}

#pragma mark - Timer API (setTimeout / setInterval / clearTimeout / clearInterval)

- (void)registerTimerAPI {
    __weak typeof(self) weakSelf = self;

    self.context[@"setTimeout"] = ^JSValue *(JSValue *callback, JSValue *delayMs) {
        return [weakSelf scheduleTimer:callback delay:delayMs repeats:NO];
    };

    self.context[@"setInterval"] = ^JSValue *(JSValue *callback, JSValue *delayMs) {
        return [weakSelf scheduleTimer:callback delay:delayMs repeats:YES];
    };

    self.context[@"clearTimeout"] = ^(JSValue *timerId) {
        [weakSelf cancelTimer:timerId];
    };

    self.context[@"clearInterval"] = ^(JSValue *timerId) {
        [weakSelf cancelTimer:timerId];
    };
}

- (JSValue *)scheduleTimer:(JSValue *)callback delay:(JSValue *)delayMs repeats:(BOOL)repeats {
    NSUInteger timerId = self.nextTimerId++;
    NSTimeInterval interval = MAX([delayMs toDouble] / 1000.0, 0.001);

    JSManagedValue *managedCallback = [JSManagedValue managedValueWithValue:callback];
    [self.context.virtualMachine addManagedReference:managedCallback withOwner:self];

    __weak typeof(self) weakSelf = self;
    NSTimer *timer = [NSTimer timerWithTimeInterval:interval repeats:repeats block:^(NSTimer *t) {
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf) return;

        // Never touch JSManagedValue/JSValue on main thread: it takes JSLock and can deadlock
        // with JS thread -> dispatch_sync(main) invoke paths.
        [strongSelf performOnJSThread:^{
            JSValue *fn = managedCallback.value;
            if (fn && ![fn isUndefined]) {
                [fn callWithArguments:@[]];
            }
            if (!repeats) {
                [strongSelf.context.virtualMachine removeManagedReference:managedCallback withOwner:strongSelf];
                [strongSelf.timers removeObjectForKey:@(timerId)];
            }
        } waitUntilDone:NO];
        [strongSelf wakeJSThread];
    }];

    WNTimerHandle *handle = [[WNTimerHandle alloc] init];
    handle.timer = timer;
    handle.timerId = timerId;
    self.timers[@(timerId)] = handle;

    [[NSRunLoop mainRunLoop] addTimer:timer forMode:NSRunLoopCommonModes];

    return [JSValue valueWithInt32:(int32_t)timerId inContext:self.context];
}

- (void)cancelTimer:(JSValue *)timerId {
    NSNumber *key = @([timerId toInt32]);
    WNTimerHandle *handle = self.timers[key];
    if (handle) {
        [handle.timer invalidate];
        [self.timers removeObjectForKey:key];
    }
}

#pragma mark - Utility API

- (void)registerUtilityAPI {
    self.context[@"__wnVersion"] = @"2.0.0";
    self.context[@"__wnEngine"] = @"JavaScriptCore";

    self.context[@"__wnLog"] = ^(NSString *msg) {
        NSLog(@"%@ %@", kWNLogPrefix, msg);
    };

    JSValue *processObj = [JSValue valueWithNewObjectInContext:self.context];
    processObj[@"platform"] = @"ios";
    processObj[@"arch"] = @"arm64";
    self.context[@"Process"] = processObj;

    JSValue *rpcObj = [JSValue valueWithNewObjectInContext:self.context];
    rpcObj[@"exports"] = [JSValue valueWithNewObjectInContext:self.context];
    self.context[@"rpc"] = rpcObj;

    // __wnRunLoopSleep(ms) — Pump current thread run loop without going through ObjC bridge invoke.
    // This avoids temporary invoke-target-queue overrides (e.g. dispatch.none) leaking into nested
    // callbacks while still letting the JS thread process queued tasks.
    self.context[@"__wnRunLoopSleep"] = ^(JSValue *msVal) {
        double ms = [msVal toDouble];
        if (ms < 0) ms = 0;
        NSDate *endDate = [NSDate dateWithTimeIntervalSinceNow:(ms / 1000.0)];
        while ([endDate timeIntervalSinceNow] > 0) {
            [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:endDate];
        }
    };

    [self registerDispatchAPI];
}

#pragma mark - Dispatch API (main thread scheduling)

- (void)registerDispatchAPI {
    JSValue *dispatchObj = [JSValue valueWithNewObjectInContext:self.context];

    // dispatch.main(fn) — keep JS on JS thread; route ObjC invoke/KVC to main queue
    dispatchObj[@"main"] = ^JSValue *(JSValue *fn) {
        if (!fn || [fn isUndefined] || [fn isNull]) {
            return [JSValue valueWithUndefinedInContext:[JSContext currentContext]];
        }

        JSContext *ctx = [JSContext currentContext];
        dispatch_queue_t previousQueue = WNGetInvokeTargetQueue();
        WNSetInvokeTargetQueue(dispatch_get_main_queue());
        JSValue *result = nil;
        @try {
            result = [fn callWithArguments:@[]];
        } @finally {
            WNSetInvokeTargetQueue(previousQueue);
        }
        return result ?: [JSValue valueWithUndefinedInContext:ctx];
    };

    // dispatch.global(fn) — keep JS on JS thread; route ObjC invoke/KVC to global queue
    dispatchObj[@"global"] = ^JSValue *(JSValue *fn) {
        if (!fn || [fn isUndefined] || [fn isNull]) {
            return [JSValue valueWithUndefinedInContext:[JSContext currentContext]];
        }
        JSContext *ctx = [JSContext currentContext];
        dispatch_queue_t previousQueue = WNGetInvokeTargetQueue();
        WNSetInvokeTargetQueue(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0));
        JSValue *result = nil;
        @try {
            result = [fn callWithArguments:@[]];
        } @finally {
            WNSetInvokeTargetQueue(previousQueue);
        }
        return result ?: [JSValue valueWithUndefinedInContext:ctx];
    };

    // dispatch.none(fn) — execute fn on JS thread without forcing ObjC invoke to a target queue
    dispatchObj[@"none"] = ^JSValue *(JSValue *fn) {
        if (!fn || [fn isUndefined] || [fn isNull]) {
            return [JSValue valueWithUndefinedInContext:[JSContext currentContext]];
        }
        JSContext *ctx = [JSContext currentContext];
        dispatch_queue_t previousQueue = WNGetInvokeTargetQueue();
        WNSetInvokeTargetQueue(NULL);
        JSValue *result = nil;
        @try {
            result = [fn callWithArguments:@[]];
        } @finally {
            WNSetInvokeTargetQueue(previousQueue);
        }
        return result ?: [JSValue valueWithUndefinedInContext:ctx];
    };

    // dispatch.mainAsync(fn) — asynchronous: schedule fn on main thread, return immediately
    __weak typeof(self) weakSelf = self;
    dispatchObj[@"mainAsync"] = ^(JSValue *fn) {
        if (!fn || [fn isUndefined] || [fn isNull]) return;

        JSManagedValue *managed = [JSManagedValue managedValueWithValue:fn];
        WNJSEngine *engine = weakSelf;
        if (!engine) return;
        [engine.context.virtualMachine addManagedReference:managed withOwner:engine];

        dispatch_async(dispatch_get_main_queue(), ^{
            WNJSEngine *eng = weakSelf;
            if (!eng) return;
            [eng performOnJSThread:^{
                JSValue *callback = managed.value;
                if (callback && ![callback isUndefined]) {
                    dispatch_queue_t previousQueue = WNGetInvokeTargetQueue();
                    WNSetInvokeTargetQueue(dispatch_get_main_queue());
                    @try {
                        [callback callWithArguments:@[]];
                    } @finally {
                        WNSetInvokeTargetQueue(previousQueue);
                    }
                }
                [eng.context.virtualMachine removeManagedReference:managed withOwner:eng];
            } waitUntilDone:NO];
            [eng wakeJSThread];
        });
    };

    // dispatch.after(delayMs, fn) — schedule fn on main thread after delay
    dispatchObj[@"after"] = ^(JSValue *delayMs, JSValue *fn) {
        if (!fn || [fn isUndefined] || [fn isNull]) return;
        double ms = [delayMs toDouble];
        if (ms < 0) ms = 0;

        JSManagedValue *managed = [JSManagedValue managedValueWithValue:fn];
        WNJSEngine *engine = weakSelf;
        if (!engine) return;
        [engine.context.virtualMachine addManagedReference:managed withOwner:engine];

        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(ms * NSEC_PER_MSEC)),
                       dispatch_get_main_queue(), ^{
            WNJSEngine *eng = weakSelf;
            if (!eng) return;
            [eng performOnJSThread:^{
                JSValue *callback = managed.value;
                if (callback && ![callback isUndefined]) {
                    dispatch_queue_t previousQueue = WNGetInvokeTargetQueue();
                    WNSetInvokeTargetQueue(dispatch_get_main_queue());
                    @try {
                        [callback callWithArguments:@[]];
                    } @finally {
                        WNSetInvokeTargetQueue(previousQueue);
                    }
                }
                [eng.context.virtualMachine removeManagedReference:managed withOwner:eng];
            } waitUntilDone:NO];
            [eng wakeJSThread];
        });
    };

    // dispatch.isMainThread() — check if currently on main thread
    dispatchObj[@"isMainThread"] = ^BOOL {
        return [NSThread isMainThread];
    };

    self.context[@"dispatch"] = dispatchObj;
}

#pragma mark - Exception handler

- (void)installExceptionHandler {
    __weak typeof(self) weakSelf = self;
    __block BOOL isHandling = NO;
    self.context.exceptionHandler = ^(JSContext *ctx, JSValue *exception) {
        if (isHandling) return;
        isHandling = YES;

        NSString *desc = nil;
        @try {
            desc = [exception toString];
        } @catch (NSException *e) {
            desc = [exception isObject] ? @"<exception object>" : @"<unknown error>";
        }

        NSString *line = nil;
        NSString *column = nil;
        @try {
            JSValue *lineVal = exception[@"line"];
            JSValue *colVal  = exception[@"column"];
            if (lineVal && ![lineVal isUndefined]) line = [lineVal toString];
            if (colVal  && ![colVal  isUndefined]) column = [colVal  toString];
        } @catch (NSException *e) { /* ignore */ }

        NSString *errorMsg = [NSString stringWithFormat:@"%@ (line %@, column %@)",
                              desc ?: @"<unknown error>",
                              line ?: @"?",
                              column ?: @"?"];
        NSLog(@"%@ EXCEPTION: %@", kWNLogPrefix, errorMsg);

        __strong typeof(weakSelf) strongSelf = weakSelf;
        if ([strongSelf.delegate respondsToSelector:@selector(jsEngine:didReceiveScriptError:)]) {
            [strongSelf.delegate jsEngine:strongSelf didReceiveScriptError:errorMsg];
        }

        NSArray *snapshot;
        @synchronized (strongSelf.observers) {
            snapshot = strongSelf.observers.allObjects;
        }
        for (id<WNJSEngineDelegate> obs in snapshot) {
            if (obs != strongSelf.delegate && [obs respondsToSelector:@selector(jsEngine:didReceiveScriptError:)]) {
                [obs jsEngine:strongSelf didReceiveScriptError:errorMsg];
            }
        }

        isHandling = NO;
    };
}

@end

#pragma mark - Cross-thread main helper (H1 / audit)

BOOL WNIsExternalThreadWaitingOnJSThread(void) {
    return atomic_load(&s_wnJSThreadExternalWaitCount) > 0;
}

BOOL WNShouldAvoidSynchronousMainFromJSThread(void) {
    WNJSEngine *eng = [WNJSEngine sharedEngine];
    if (!eng) return NO;
    if (![eng isOnJSThread]) return NO;
    return WNIsExternalThreadWaitingOnJSThread() || WNIsInvokeMainThreadHopActive();
}

void WNRunOnMainFromAnyThread(void (^block)(void)) {
    if (!block) return;
    if ([NSThread isMainThread]) {
        block();
        return;
    }
    WNJSEngine *eng = [WNJSEngine sharedEngine];
    if (eng && WNShouldAvoidSynchronousMainFromJSThread()) {
        dispatch_async(dispatch_get_main_queue(), ^{
            block();
            [eng wakeJSThread];
        });
        return;
    }
    dispatch_sync(dispatch_get_main_queue(), block);
}
