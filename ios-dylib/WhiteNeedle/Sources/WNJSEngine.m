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
#import "WNLeakDetector.h"
#if WN_ENABLE_REFGRAPH
#import "WNRefGraphDetector.h"
#endif
#import <objc/runtime.h>

static NSString *const kWNLogPrefix = @"[WhiteNeedle:JS]";

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
    [WNLeakDetector registerInContext:self.context];
#if WN_ENABLE_REFGRAPH
    [WNRefGraphDetector registerInContext:self.context];
#endif

    self.isReady = YES;
    NSLog(@"%@ Engine initialized (JavaScriptCore)", kWNLogPrefix);
}

- (void)teardown {
    for (WNTimerHandle *handle in self.timers.allValues) {
        [handle.timer invalidate];
    }
    [self.timers removeAllObjects];
    [self.loadedScripts removeAllObjects];

    self.context = nil;
    self.vm = nil;
    self.isReady = NO;
    NSLog(@"%@ Engine torn down", kWNLogPrefix);
}

#pragma mark - Script management

- (BOOL)loadScript:(NSString *)code name:(NSString *)name {
    if (!self.isReady) {
        NSLog(@"%@ Engine not ready, cannot load script: %@", kWNLogPrefix, name);
        return NO;
    }

    [self unloadScript:name];

    JSValue *result = [self.context evaluateScript:code withSourceURL:[NSURL URLWithString:name]];
    if (!result) {
        NSLog(@"%@ Failed to evaluate script: %@", kWNLogPrefix, name);
        return NO;
    }

    self.loadedScripts[name] = result;
    NSLog(@"%@ Script loaded: %@", kWNLogPrefix, name);
    return YES;
}

- (void)unloadScript:(NSString *)name {
    if (self.loadedScripts[name]) {
        [self.loadedScripts removeObjectForKey:name];
        NSLog(@"%@ Script unloaded: %@", kWNLogPrefix, name);
    }
}

- (JSValue *)evaluateScript:(NSString *)code {
    if (!self.isReady) return nil;
    return [self.context evaluateScript:code];
}

- (NSArray<NSString *> *)loadedScriptNames {
    return [self.loadedScripts allKeys];
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
        JSValue *fn = managedCallback.value;
        if (fn && ![fn isUndefined]) {
            [fn callWithArguments:@[]];
        }
        if (!repeats) {
            [strongSelf.context.virtualMachine removeManagedReference:managedCallback withOwner:strongSelf];
            [strongSelf.timers removeObjectForKey:@(timerId)];
        }
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

    [self registerDispatchAPI];
}

#pragma mark - Dispatch API (main thread scheduling)

- (void)registerDispatchAPI {
    JSValue *dispatchObj = [JSValue valueWithNewObjectInContext:self.context];

    // dispatch.main(fn) — synchronous: block until fn completes on main thread, return result
    dispatchObj[@"main"] = ^JSValue *(JSValue *fn) {
        if (!fn || [fn isUndefined] || [fn isNull]) {
            return [JSValue valueWithUndefinedInContext:[JSContext currentContext]];
        }

        JSContext *ctx = [JSContext currentContext];

        if ([NSThread isMainThread]) {
            return [fn callWithArguments:@[]];
        }

        __block JSValue *result = nil;
        dispatch_sync(dispatch_get_main_queue(), ^{
            result = [fn callWithArguments:@[]];
        });
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
            JSValue *callback = managed.value;
            if (callback && ![callback isUndefined]) {
                [callback callWithArguments:@[]];
            }
            if (eng) {
                [eng.context.virtualMachine removeManagedReference:managed withOwner:eng];
            }
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
            JSValue *callback = managed.value;
            if (callback && ![callback isUndefined]) {
                [callback callWithArguments:@[]];
            }
            if (eng) {
                [eng.context.virtualMachine removeManagedReference:managed withOwner:eng];
            }
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
