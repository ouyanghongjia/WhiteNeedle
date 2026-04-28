#import "WNObjCBridge.h"
#import "WNBoxing.h"
#import "WNTypeConversion.h"
#import "WNBlockSignatureParser.h"
#import "WNHeapScanner.h"
#import "WNObjCProxy.h"
#import <objc/runtime.h>
#import <objc/message.h>
#import <malloc/malloc.h>
#import <mach/mach.h>
#import <mach/vm_map.h>
#import <pthread/pthread.h>
#import <stdatomic.h>
#if __has_feature(ptrauth_calls)
#import <ptrauth.h>
#endif

static NSString *const kLogPrefix = @"[WhiteNeedle:ObjC]";
// Remove the old line:
// static _Thread_local dispatch_queue_t _wnInvokeTargetQueue = NULL;

static pthread_key_t _wnQueueKey;
static atomic_int _wnInvokeMainHopCounter = 0;
static void _wnQueueDestructor(void *queue) {
    if (queue) {
        // Transfer ownership back so release occurs
        (void)(__bridge_transfer dispatch_queue_t)queue;
    }
}
static void _wnInitQueueKey(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        pthread_key_create(&_wnQueueKey, _wnQueueDestructor);
    });
}

void WNSetInvokeTargetQueue(dispatch_queue_t queue) {
    _wnInitQueueKey();
    // Remove old value (if any) — will be released by destructor when thread exits,
    // but if we overwrite, we need to release the old one now.
    void *old = pthread_getspecific(_wnQueueKey);
    if (old) {
        // Transfer ownership back to release it
        (void)(__bridge_transfer dispatch_queue_t)old;
    }
    if (queue) {
        // Transfer ownership to the key (retain)
        pthread_setspecific(_wnQueueKey, (__bridge_retained void *)queue);
    } else {
        pthread_setspecific(_wnQueueKey, NULL);
    }
}

dispatch_queue_t WNGetInvokeTargetQueue(void) {
    _wnInitQueueKey();
    void *ptr = pthread_getspecific(_wnQueueKey);
    if (ptr) {
        // No transfer, just bridge (no retain/release)
        return (__bridge dispatch_queue_t)ptr;
    }
    return NULL;
}

BOOL WNIsInvokeMainThreadHopActive(void) {
    return atomic_load(&_wnInvokeMainHopCounter) > 0;
}

/// When TLS names a target queue, ObjC work (invoke / KVC) must run *on* that queue, not "whenever
/// the pointer matches" — the old `WNGetInvokeTargetQueue() == queue` was always true at call sites
/// and skipped dispatch entirely, so UI ran on the JS thread.
static BOOL WNShouldDispatchToTargetQueue(dispatch_queue_t targetQueue) {
    if (!targetQueue) {
        return NO; // no preferred queue: run on current thread (e.g. legacy)
    }
    if (targetQueue == dispatch_get_main_queue()) {
        // TLS can hold `main` while the JS thread is executing; still must hop to the main thread.
        return ![NSThread isMainThread];
    }
    // Global / custom queues: do not use pointer identity with TLS — that also skipped all hops.
    // `dispatch_sync` to a global queue runs the block on a pool thread; avoid only serial self-sync
    // if you later set a per-queue specific (not used here).
    return YES;
}

/// UIKit/CoreAnimation objects must be touched on main thread even when invoke target queue is
/// temporarily cleared (e.g. `dispatch.none` used for JS run-loop pumping).
static BOOL WNObjectRequiresMainThread(id target) {
    if (!target) return NO;

    static Class UIViewCls = Nil;
    static Class UIViewControllerCls = Nil;
    static Class CALayerCls = Nil;
    static Class UIGestureRecognizerCls = Nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        UIViewCls = NSClassFromString(@"UIView");
        UIViewControllerCls = NSClassFromString(@"UIViewController");
        CALayerCls = NSClassFromString(@"CALayer");
        UIGestureRecognizerCls = NSClassFromString(@"UIGestureRecognizer");
    });

    if (UIViewCls && [target isKindOfClass:UIViewCls]) return YES;
    if (UIViewControllerCls && [target isKindOfClass:UIViewControllerCls]) return YES;
    if (CALayerCls && [target isKindOfClass:CALayerCls]) return YES;
    if (UIGestureRecognizerCls && [target isKindOfClass:UIGestureRecognizerCls]) return YES;
    return NO;
}

/// Best-effort checks before treating `addr` as an ObjC object pointer (no objc_msgSend / object_getClass).
/// - Pointer-aligned, lies in a VM region with VM_PROT_READ
/// - `vm_read_overwrite` can copy a minimal object header (isa)
/// - Prefer `malloc_size > 0` (typical heap-allocated NSObject subclasses)
/// - Otherwise require stripped isa to point into another readable region (covers some non-heap objects)
/// Cannot guarantee a real NSObject; garbage that passes these checks may still crash when invoked.
static BOOL WNObjCPointerPassesBasicSafetyChecks(uintptr_t addr) {
    if (addr == 0) return NO;
    if (addr % sizeof(void *) != 0) return NO;

    vm_address_t regionAddr = (vm_address_t)addr;
    vm_size_t regionSize = 0;
    vm_region_basic_info_data_64_t regionInfo;
    mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
    mach_port_t objName = MACH_PORT_NULL;
    kern_return_t kr = vm_region_64(mach_task_self(), &regionAddr, &regionSize, VM_REGION_BASIC_INFO_64,
                                    (vm_region_info_t)&regionInfo, &count, &objName);
    if (kr != KERN_SUCCESS) return NO;
    if (!(regionInfo.protection & VM_PROT_READ)) return NO;

    vm_address_t userAddr = (vm_address_t)addr;
    if (userAddr < regionAddr || userAddr >= regionAddr + regionSize) return NO;

    uint8_t header[2 * sizeof(void *)];
    vm_size_t readOut = 0;
    kr = vm_read_overwrite(mach_task_self(), (vm_address_t)addr, sizeof(header), (vm_address_t)header, &readOut);
    if (kr != KERN_SUCCESS) return NO;

    uintptr_t isa = *(uintptr_t *)header;
    if (isa == 0) return NO;

    size_t mz = malloc_size((void *)addr);
    if (mz >= sizeof(void *)) return YES;

    uintptr_t clsGuess = isa;
#if __has_feature(ptrauth_calls)
    /* ObjC isa on arm64e is typically signed with a process-dependent data key. */
    clsGuess = (uintptr_t)ptrauth_strip((void *)isa, ptrauth_key_process_dependent_data);
#else
    clsGuess = isa & (uintptr_t)0xfffffffffffffff8ULL;
#endif
    if (clsGuess == 0) return NO;
    if (clsGuess % sizeof(void *) != 0) return NO;

    vm_address_t r2 = (vm_address_t)clsGuess;
    vm_size_t sz2 = 0;
    vm_region_basic_info_data_64_t info2;
    count = VM_REGION_BASIC_INFO_COUNT_64;
    objName = MACH_PORT_NULL;
    kr = vm_region_64(mach_task_self(), &r2, &sz2, VM_REGION_BASIC_INFO_64, (vm_region_info_t)&info2, &count, &objName);
    if (kr != KERN_SUCCESS) return NO;
    if (!(info2.protection & VM_PROT_READ)) return NO;
    if ((vm_address_t)clsGuess < r2 || (vm_address_t)clsGuess >= r2 + sz2) return NO;

    uint8_t word[sizeof(void *)];
    readOut = 0;
    kr = vm_read_overwrite(mach_task_self(), (vm_address_t)clsGuess, sizeof(word), (vm_address_t)word, &readOut);
    return (kr == KERN_SUCCESS);
}

/// Parse a pointer literal (`%p` / `0x...`, e.g. from debug tools) into a live `id`.
/// Applies `WNObjCPointerPassesBasicSafetyChecks` to reduce crash risk; returns nil when checks fail.
static id WNObjCParsedObjectFromHexAddressString(NSString *addrStr) {
    if (addrStr.length == 0) return nil;
    NSString *trimmed = [addrStr stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (trimmed.length == 0) return nil;

    unsigned long long addr = 0;
    NSScanner *scanner = [NSScanner scannerWithString:trimmed];
    if ([trimmed hasPrefix:@"0x"] || [trimmed hasPrefix:@"0X"]) {
        if (trimmed.length < 3) return nil;
        [scanner setScanLocation:2];
    }
    if (![scanner scanHexLongLong:&addr]) return nil;
    NSCharacterSet *ws = [NSCharacterSet whitespaceAndNewlineCharacterSet];
    [scanner scanCharactersFromSet:ws intoString:NULL];
    if (![scanner isAtEnd]) return nil;
    if (addr == 0) return nil;

    uintptr_t p = (uintptr_t)addr;
    if (!WNObjCPointerPassesBasicSafetyChecks(p)) return nil;
    return (__bridge id)(void *)p;
}

#pragma mark - WNObjCBridge

@implementation WNObjCBridge

+ (void)registerInContext:(JSContext *)context {
    [self registerObjCNamespaceInContext:context];
    NSLog(@"%@ ObjC bridge registered", kLogPrefix);
}

+ (JSValue *)createProxyForClassName:(NSString *)className inContext:(JSContext *)context {
    Class cls = NSClassFromString(className);
    if (!cls) {
        NSLog(@"%@ Class not found: %@", kLogPrefix, className);
        return [JSValue valueWithNullInContext:context];
    }

    WNObjCProxy *proxy = [[WNObjCProxy alloc] init];
    proxy.targetClass = cls;
    proxy.target = (id)cls;
    proxy.isClassProxy = YES;

    JSValue *jsProxy = [JSValue valueWithObject:proxy inContext:context];
    [self attachInvokeMethod:jsProxy context:context proxy:proxy];
    jsProxy[@"__wnNativeRef__"] = [JSValue valueWithObject:proxy inContext:context];
    return jsProxy;
}

+ (JSValue *)createInstanceProxy:(id)obj inContext:(JSContext *)context {
    if (!obj) return [JSValue valueWithNullInContext:context];

    WNObjCProxy *proxy = [[WNObjCProxy alloc] init];
    proxy.target = obj;
    proxy.targetClass = [obj class];
    proxy.isClassProxy = NO;

    JSValue *jsProxy = [JSValue valueWithObject:proxy inContext:context];
    [self attachInvokeMethod:jsProxy context:context proxy:proxy];
    jsProxy[@"__wnNativeRef__"] = [JSValue valueWithObject:proxy inContext:context];
    return jsProxy;
}

+ (void)attachInvokeMethod:(JSValue *)jsProxy context:(JSContext *)context proxy:(WNObjCProxy *)proxy {
    __weak WNObjCProxy *weakProxy = proxy;

    jsProxy[@"invoke"] = ^JSValue *(NSString *selectorString, JSValue *argsArray) {
        WNObjCProxy *p = weakProxy;
        if (!p || !p.target) {
            return [JSValue valueWithNullInContext:[JSContext currentContext]];
        }
        JSContext *ctx = [JSContext currentContext];

        NSMutableArray *jsArgs = [NSMutableArray array];
        if (argsArray && ![argsArray isUndefined] && ![argsArray isNull]) {
            uint32_t len = [[argsArray[@"length"] toNumber] unsignedIntValue];
            for (uint32_t i = 0; i < len; i++) {
                JSValue *elem = [argsArray valueAtIndex:i];
                id obj = [elem toObject];

                if (obj && ![obj isKindOfClass:[WNObjCProxy class]] && ![obj isKindOfClass:[WNBoxing class]]) {
                    JSValue *nativeRef = elem[@"__wnNativeRef__"];
                    if (nativeRef && ![nativeRef isUndefined] && ![nativeRef isNull]) {
                        id ref = [nativeRef toObject];
                        if ([ref isKindOfClass:[WNObjCProxy class]] || [ref isKindOfClass:[WNBoxing class]]) {
                            obj = ref;
                        }
                    }
                }

                [jsArgs addObject:obj ?: [NSNull null]];
            }
        }

        return [WNObjCBridge invokeSelector:selectorString
                                   onTarget:p.target
                                    isClass:p.isClassProxy
                                   withArgs:jsArgs
                                  inContext:ctx];
    };

    jsProxy[@"getProperty"] = ^JSValue *(NSString *propertyName) {
        WNObjCProxy *p = weakProxy;
        if (!p || !p.target) return [JSValue valueWithNullInContext:[JSContext currentContext]];
        JSContext *ctx = [JSContext currentContext];
        dispatch_queue_t targetQueue = WNGetInvokeTargetQueue();
        if (!targetQueue && ![NSThread isMainThread] && WNObjectRequiresMainThread(p.target)) {
            NSLog(@"%@ Main-thread enforced for getProperty %@ on %@ (invoke target queue is nil)",
                  kLogPrefix, propertyName, NSStringFromClass([p.target class]));
            targetQueue = dispatch_get_main_queue();
        }

        BOOL shouldDispatch = WNShouldDispatchToTargetQueue(targetQueue);
        __block id value = nil;
        __block NSException *capturedException = nil;

        void (^getValueBlock)(void) = ^{
            @try {
                value = [p.target valueForKey:propertyName];
            } @catch (NSException *e) {
                capturedException = e;
            }
        };

        if (shouldDispatch) {
            BOOL mainHop = (targetQueue == dispatch_get_main_queue());
            if (mainHop) atomic_fetch_add(&_wnInvokeMainHopCounter, 1);
            dispatch_sync(targetQueue, getValueBlock);
            if (mainHop) atomic_fetch_sub(&_wnInvokeMainHopCounter, 1);
        } else {
            getValueBlock();
        }

        if (capturedException) {
            NSLog(@"%@ getProperty error: %@", kLogPrefix, capturedException);
            NSString *msg = [NSString stringWithFormat:@"%@: %@", capturedException.name, capturedException.reason ?: @""];
            ctx.exception = [JSValue valueWithNewErrorFromMessage:msg inContext:ctx];
            return [JSValue valueWithUndefinedInContext:ctx];
        }

        @try {
            return [WNTypeConversion objcObjectToJSValue:value inContext:ctx];
        } @catch (NSException *e) {
            NSLog(@"%@ getProperty error: %@", kLogPrefix, e);
            NSString *msg = [NSString stringWithFormat:@"%@: %@", e.name, e.reason ?: @""];
            ctx.exception = [JSValue valueWithNewErrorFromMessage:msg inContext:ctx];
            return [JSValue valueWithUndefinedInContext:ctx];
        }
    };

    jsProxy[@"setProperty"] = ^(NSString *propertyName, JSValue *value) {
        WNObjCProxy *p = weakProxy;
        if (!p || !p.target) return;
        JSContext *setCtx = [JSContext currentContext];
        dispatch_queue_t targetQueue = WNGetInvokeTargetQueue();
        if (!targetQueue && ![NSThread isMainThread] && WNObjectRequiresMainThread(p.target)) {
            NSLog(@"%@ Main-thread enforced for setProperty %@ on %@ (invoke target queue is nil)",
                  kLogPrefix, propertyName, NSStringFromClass([p.target class]));
            targetQueue = dispatch_get_main_queue();
        }
        BOOL shouldDispatch = WNShouldDispatchToTargetQueue(targetQueue);
        @try {
            id obj = [WNTypeConversion jsValueToObjCObject:value];
            __block NSException *capturedException = nil;
            void (^setValueBlock)(void) = ^{
                @try {
                    [p.target setValue:obj forKey:propertyName];
                } @catch (NSException *e) {
                    capturedException = e;
                }
            };
            if (shouldDispatch) {
                BOOL mainHop = (targetQueue == dispatch_get_main_queue());
                if (mainHop) atomic_fetch_add(&_wnInvokeMainHopCounter, 1);
                dispatch_sync(targetQueue, setValueBlock);
                if (mainHop) atomic_fetch_sub(&_wnInvokeMainHopCounter, 1);
            } else {
                setValueBlock();
            }
            if (capturedException) {
                @throw capturedException;
            }
        } @catch (NSException *e) {
            NSLog(@"%@ setProperty error: %@", kLogPrefix, e);
            NSString *msg = [NSString stringWithFormat:@"%@: %@", e.name, e.reason ?: @""];
            setCtx.exception = [JSValue valueWithNewErrorFromMessage:msg inContext:setCtx];
        }
    };

    jsProxy[@"className"] = ^NSString *{
        WNObjCProxy *p = weakProxy;
        if (!p) return @"nil";
        return NSStringFromClass(p.targetClass);
    };

    jsProxy[@"respondsToSelector"] = ^BOOL(NSString *sel) {
        WNObjCProxy *p = weakProxy;
        if (!p || !p.target) return NO;
        return [p.target respondsToSelector:NSSelectorFromString(sel)];
    };

    jsProxy[@"getMethods"] = ^NSArray<NSString *> *{
        WNObjCProxy *p = weakProxy;
        if (!p) return @[];
        return [WNObjCBridge methodsForClass:p.targetClass isInstance:!p.isClassProxy];
    };

    jsProxy[@"superclass"] = ^JSValue *{
        WNObjCProxy *p = weakProxy;
        if (!p) return [JSValue valueWithNullInContext:[JSContext currentContext]];
        Class super_ = class_getSuperclass(p.targetClass);
        if (!super_) return [JSValue valueWithNullInContext:[JSContext currentContext]];
        return [JSValue valueWithObject:NSStringFromClass(super_) inContext:[JSContext currentContext]];
    };

    jsProxy[@"toString"] = ^NSString *{
        WNObjCProxy *p = weakProxy;
        if (!p || !p.target) return @"<WNProxy: nil>";
        if (p.isClassProxy) {
            return [NSString stringWithFormat:@"<WNProxy: Class %@>", NSStringFromClass(p.targetClass)];
        }
        return [NSString stringWithFormat:@"<%@: %p>", NSStringFromClass(p.targetClass), p.target];
    };

    jsProxy[@"toJSON"] = ^NSDictionary *{
        WNObjCProxy *p = weakProxy;
        if (!p || !p.target) return @{@"$type": @"ObjCProxy", @"class": @"nil"};
        NSString *cls = NSStringFromClass(p.targetClass);
        NSString *addr = [NSString stringWithFormat:@"%p", p.target];
        return @{@"$type": @"ObjCProxy", @"class": cls, @"address": addr};
    };
}

#pragma mark - NSInvocation dynamic dispatch

+ (JSValue *)invokeSelector:(NSString *)selectorString
                   onTarget:(id)target
                    isClass:(BOOL)isClass
                   withArgs:(NSArray *)jsArgs
                  inContext:(JSContext *)context {
    SEL selector = NSSelectorFromString(selectorString);

    if (![target respondsToSelector:selector]) {
        NSLog(@"%@ Selector not found: %@ on %@", kLogPrefix, selectorString, target);
        NSString *msg = [NSString stringWithFormat:@"Selector not found: %@ on %@", selectorString, target];
        context.exception = [JSValue valueWithNewErrorFromMessage:msg inContext:context];
        return [JSValue valueWithUndefinedInContext:context];
    }
    
    NSMethodSignature *sig = [target methodSignatureForSelector:selector];

    if (!sig) {
        NSLog(@"%@ Cannot get method signature for: %@", kLogPrefix, selectorString);
        NSString *msg = [NSString stringWithFormat:@"Cannot get method signature for: %@", selectorString];
        context.exception = [JSValue valueWithNewErrorFromMessage:msg inContext:context];
        return [JSValue valueWithUndefinedInContext:context];
    }

    NSInvocation *invocation = [NSInvocation invocationWithMethodSignature:sig];
    [invocation setTarget:target];
    [invocation setSelector:selector];
    [invocation retainArguments];
    
    for (NSUInteger i = 0; i < jsArgs.count && (i + 2) < sig.numberOfArguments; i++) {
        const char *argType = [sig getArgumentTypeAtIndex:i + 2];
        NSUInteger argSize = 0;
        NSGetSizeAndAlignment(argType, &argSize, NULL);

        void *argBuf = calloc(1, argSize);

        id jsArg = jsArgs[i];

        // When the method expects a struct and JS passed NSValue (via
        // WNObjCProxy or WNBoxing), delegate to WNTypeConversion which
        // knows how to extract raw struct bytes from the NSValue.
        if (argType[0] == '{' && ([jsArg isKindOfClass:[WNObjCProxy class]] ||
                                   [jsArg isKindOfClass:[WNBoxing class]])) {
            JSValue *jsValue = [JSValue valueWithObject:jsArg inContext:context];
            [WNTypeConversion convertJSValue:jsValue toTypeEncoding:argType buffer:argBuf inContext:context];
            [invocation setArgument:argBuf atIndex:i + 2];
            free(argBuf);
            continue;
        }

        if ([jsArg isKindOfClass:[WNBoxing class]]) {
            WNBoxing *box = (WNBoxing *)jsArg;
            if (box.isPointer) {
                *(void **)argBuf = [box unboxPointer];
            } else {
                id unboxed = [box unbox];
                *(void **)argBuf = (__bridge void *)unboxed;
            }
            [invocation setArgument:argBuf atIndex:i + 2];
            free(argBuf);
            continue;
        }

        if ([jsArg isKindOfClass:[WNObjCProxy class]]) {
            id target = [(WNObjCProxy *)jsArg target];
            *(void **)argBuf = (__bridge void *)target;
            [invocation setArgument:argBuf atIndex:i + 2];
            free(argBuf);
            continue;
        }

        JSValue *jsValue;
        if ([jsArg isKindOfClass:[JSValue class]]) {
            jsValue = (JSValue *)jsArg;
        } else {
            jsValue = [JSValue valueWithObject:jsArg inContext:context];
        }

        [WNTypeConversion convertJSValue:jsValue toTypeEncoding:argType buffer:argBuf inContext:context];
        [invocation setArgument:argBuf atIndex:i + 2];
        free(argBuf);
    }

    const char *retType = sig.methodReturnType;
    NSUInteger retSize = sig.methodReturnLength;
    void *retBuf = (retType[0] == 'v' || retSize == 0) ? NULL : calloc(1, retSize);
    dispatch_queue_t targetQueue = WNGetInvokeTargetQueue();
    if (!targetQueue && ![NSThread isMainThread] && !isClass && WNObjectRequiresMainThread(target)) {
        NSLog(@"%@ Main-thread enforced for invoke %@ on %@ (invoke target queue is nil)",
              kLogPrefix, selectorString, NSStringFromClass([target class]));
        targetQueue = dispatch_get_main_queue();
    }
    BOOL shouldDispatch = WNShouldDispatchToTargetQueue(targetQueue);
    __block NSException *capturedException = nil;

    void (^invokeBlock)(void) = ^{
        @try {
            [invocation invoke];
            if (retBuf) {
                [invocation getReturnValue:retBuf];
            }
        } @catch (NSException *exception) {
            capturedException = exception;
        }
    };

    if (shouldDispatch) {
        BOOL mainHop = (targetQueue == dispatch_get_main_queue());
        if (mainHop) atomic_fetch_add(&_wnInvokeMainHopCounter, 1);
        dispatch_sync(targetQueue, invokeBlock);
        if (mainHop) atomic_fetch_sub(&_wnInvokeMainHopCounter, 1);
    } else {
        invokeBlock();
    }

    if (capturedException) {
        NSLog(@"%@ Invocation exception for %@: %@ — %@", kLogPrefix, selectorString, capturedException.name, capturedException.reason);
        NSString *msg = [NSString stringWithFormat:@"%@: %@", capturedException.name, capturedException.reason ?: @""];
        context.exception = [JSValue valueWithNewErrorFromMessage:msg inContext:context];
        if (retBuf) free(retBuf);
        return [JSValue valueWithUndefinedInContext:context];
    }

    if (retType[0] == 'v') {
        if (retBuf) free(retBuf);
        return [JSValue valueWithUndefinedInContext:context];
    }

    if (!retBuf) {
        return [JSValue valueWithUndefinedInContext:context];
    }

    // Auto-wrap returned ObjC objects as proxies
    if (retType[0] == '@') {
        id retObj = (__bridge id)(*(void **)retBuf);
        free(retBuf);
        if (retObj && ![retObj isKindOfClass:[NSString class]] && ![retObj isKindOfClass:[NSNumber class]]) {
            return [self createInstanceProxy:retObj inContext:context];
        }
        return [WNTypeConversion objcObjectToJSValue:retObj inContext:context];
    }

    // Class is also an ObjC object — wrap it as a proxy so it supports invoke()
    if (retType[0] == '#') {
        Class cls = (__bridge Class)(*(void **)retBuf);
        free(retBuf);
        if (!cls) return [JSValue valueWithNullInContext:context];
        return [self createInstanceProxy:(id)cls inContext:context];
    }

    JSValue *result = [WNTypeConversion convertToJSValue:retBuf typeEncoding:retType inContext:context];
    free(retBuf);
    return result;
}

#pragma mark - ObjC namespace (Frida-compatible)

+ (void)registerObjCNamespaceInContext:(JSContext *)context {
    JSValue *objcNS = [JSValue valueWithNewObjectInContext:context];

    objcNS[@"available"] = @YES;

    // ObjC.use(className) → class proxy with .invoke()
    objcNS[@"use"] = ^JSValue *(NSString *className) {
        JSContext *ctx = [JSContext currentContext];
        return [WNObjCBridge createProxyForClassName:className inContext:ctx];
    };

    // ObjC.instance(boxedObj) → instance proxy
    // Also accepts a hex address string (debug `address` fields, `%p` logs, etc.) for quick proxying.
    objcNS[@"instance"] = ^JSValue *(JSValue *boxedObj) {
        JSContext *ctx = [JSContext currentContext];
        if (!boxedObj || [boxedObj isUndefined] || [boxedObj isNull]) {
            return [JSValue valueWithNullInContext:ctx];
        }
        if ([boxedObj isString]) {
            NSString *hexOrText = [boxedObj toString];
            id fromAddr = WNObjCParsedObjectFromHexAddressString(hexOrText);
            if (fromAddr) {
                return [WNObjCBridge createInstanceProxy:fromAddr inContext:ctx];
            }
        }

        id obj = [boxedObj toObject];
        if (!obj || [obj isKindOfClass:[NSNull class]]) {
            return [JSValue valueWithNullInContext:ctx];
        }
        if ([obj isKindOfClass:[WNBoxing class]]) {
            obj = [(WNBoxing *)obj unbox];
        }
        if ([obj isKindOfClass:[WNObjCProxy class]]) {
            return boxedObj;
        }
        return [WNObjCBridge createInstanceProxy:obj inContext:ctx];
    };

    // ObjC.define(spec) → runtime class creation
    objcNS[@"define"] = ^JSValue *(JSValue *spec) {
        JSContext *ctx = [JSContext currentContext];
        return [WNObjCBridge defineClass:spec inContext:ctx];
    };

    // ObjC.delegate(spec) → protocol delegate builder
    objcNS[@"delegate"] = ^JSValue *(JSValue *spec) {
        JSContext *ctx = [JSContext currentContext];
        return [WNObjCBridge buildDelegate:spec inContext:ctx];
    };

    // ObjC.classes — lazy proxy that resolves class names
    objcNS[@"classes"] = [WNObjCBridge buildClassesProxy:context];

    // ObjC.enumerateLoadedClasses(callbacks)
    objcNS[@"enumerateLoadedClasses"] = ^(JSValue *callbacks) {
        JSContext *ctx = [JSContext currentContext];
        [WNObjCBridge enumerateClasses:callbacks inContext:ctx];
    };

    // ObjC.choose(className, callbacks) — heap scan
    objcNS[@"choose"] = ^(NSString *className, JSValue *callbacks) {
        JSContext *ctx = [JSContext currentContext];
        [WNObjCBridge heapScan:className callbacks:callbacks inContext:ctx];
    };

    // ObjC.getClassNames(filter?)
    objcNS[@"getClassNames"] = ^NSArray<NSString *> *(JSValue *filterVal) {
        NSString *filter = nil;
        if (filterVal && ![filterVal isUndefined] && ![filterVal isNull]) {
            filter = [filterVal toString];
        }
        return [WNObjCBridge allClassNames:filter];
    };

    context[@"ObjC"] = objcNS;
}

+ (JSValue *)buildClassesProxy:(JSContext *)context {
    NSArray *classNames = [self allClassNames:nil];
    JSValue *dict = [JSValue valueWithNewObjectInContext:context];
    for (NSString *name in classNames) {
        dict[name] = name;
    }
    return dict;
}

+ (NSArray<NSString *> *)allClassNames:(nullable NSString *)filter {
    unsigned int count = 0;
    Class *classes = objc_copyClassList(&count);
    NSMutableArray *result = [NSMutableArray arrayWithCapacity:count];

    for (unsigned int i = 0; i < count; i++) {
        NSString *name = NSStringFromClass(classes[i]);
        if (filter && filter.length > 0) {
            if ([name rangeOfString:filter options:NSCaseInsensitiveSearch].location == NSNotFound) {
                continue;
            }
        }
        [result addObject:name];
    }
    free(classes);

    [result sortUsingSelector:@selector(compare:)];
    return result;
}

+ (void)enumerateClasses:(JSValue *)callbacks inContext:(JSContext *)context {
    JSValue *onMatch = callbacks[@"onMatch"];
    JSValue *onComplete = callbacks[@"onComplete"];

    unsigned int count = 0;
    Class *classes = objc_copyClassList(&count);

    for (unsigned int i = 0; i < count; i++) {
        NSString *name = NSStringFromClass(classes[i]);
        if (onMatch && ![onMatch isUndefined]) {
            [onMatch callWithArguments:@[name]];
        }
    }
    free(classes);

    if (onComplete && ![onComplete isUndefined]) {
        [onComplete callWithArguments:@[]];
    }
}

#pragma mark - ObjC.choose() — heap scan via WNHeapScanner

+ (void)heapScan:(NSString *)className callbacks:(JSValue *)callbacks inContext:(JSContext *)context {
    Class targetClass = NSClassFromString(className);
    if (!targetClass) {
        NSLog(@"%@ choose: class not found: %@", kLogPrefix, className);
        return;
    }

    JSValue *onMatch = callbacks[@"onMatch"];
    JSValue *onComplete = callbacks[@"onComplete"];

    NSArray<NSDictionary *> *instances = [WNHeapScanner findInstancesOfClass:targetClass
                                                            includeSubclasses:YES
                                                                     maxCount:10000];

    for (NSDictionary *entry in instances) {
        if (onMatch && ![onMatch isUndefined]) {
            NSString *addrHex = entry[@"address"];
            unsigned long long addrVal = 0;
            [[NSScanner scannerWithString:addrHex] scanHexLongLong:&addrVal];
            if (addrVal == 0) continue;

            id obj = (__bridge id)(void *)(uintptr_t)addrVal;
            @try {
                JSValue *proxy = [WNObjCBridge createInstanceProxy:obj inContext:context];
                JSValue *action = [onMatch callWithArguments:@[proxy]];
                if (action && [action isString] && [[action toString] isEqualToString:@"stop"]) {
                    break;
                }
            } @catch (NSException *e) {
                NSLog(@"%@ choose: onMatch exception for %@: %@", kLogPrefix, addrHex, e);
            }
        }
    }

    if (onComplete && ![onComplete isUndefined]) {
        [onComplete callWithArguments:@[]];
    }
}

#pragma mark - ObjC.define() — runtime class creation

/// Convert a human-readable type string to an ObjC type encoding.
/// Reuses WNBlockSignatureParser.keywordEncodings for primitives/structs.
/// Handles ObjC class names ("NSString *" → @"NSString"), "Block" → @?, defaults to @.
+ (NSString *)encodingForPropertyType:(NSString *)typeStr {
    if (!typeStr || typeStr.length == 0) return @"@";

    NSString *trimmed = [typeStr stringByTrimmingCharactersInSet:
                         [NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (trimmed.length == 0) return @"@";

    // "Block" shorthand
    if ([trimmed isEqualToString:@"Block"]) return @"@?";

    // Check keywordEncodings table (int, CGRect, double, etc.)
    NSDictionary *table = [WNBlockSignatureParser keywordEncodings];
    NSString *enc = table[trimmed];
    if (enc) return enc;

    // "NSString *", "UIView *" etc. → @"NSString", @"UIView"
    if ([trimmed hasSuffix:@"*"]) {
        NSString *cls = [[trimmed substringToIndex:trimmed.length - 1]
                         stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
        if (cls.length > 0) {
            return [NSString stringWithFormat:@"@\"%@\"", cls];
        }
    }

    // Bare class name without * (e.g. "NSString") — treat as ObjC object
    if (NSClassFromString(trimmed)) {
        return [NSString stringWithFormat:@"@\"%@\"", trimmed];
    }

    return @"@";
}

+ (JSValue *)defineClass:(JSValue *)spec inContext:(JSContext *)context {
    NSString *className = [spec[@"name"] toString];
    NSString *superName = @"NSObject";
    if (spec[@"super"] && ![spec[@"super"] isUndefined]) {
        superName = [spec[@"super"] toString];
    }

    Class superCls = NSClassFromString(superName);
    if (!superCls) {
        NSLog(@"%@ ObjC.define: superclass not found: %@", kLogPrefix, superName);
        return [JSValue valueWithNullInContext:context];
    }

    // Check if class already exists
    Class existingCls = NSClassFromString(className);
    if (existingCls) {
        NSLog(@"%@ ObjC.define: class already exists: %@, adding methods", kLogPrefix, className);
        [self addMethodsFromSpec:spec toClass:existingCls inContext:context];
        return [self createProxyForClassName:className inContext:context];
    }

    Class newCls = objc_allocateClassPair(superCls, [className UTF8String], 0);
    if (!newCls) {
        NSLog(@"%@ ObjC.define: failed to create class: %@", kLogPrefix, className);
        return [JSValue valueWithNullInContext:context];
    }

    // Add protocols
    JSValue *protocols = spec[@"protocols"];
    if (protocols && ![protocols isUndefined]) {
        NSArray *protoNames = [protocols toArray];
        for (NSString *protoName in protoNames) {
            Protocol *proto = NSProtocolFromString(protoName);
            if (proto) {
                class_addProtocol(newCls, proto);
            }
        }
    }

    // Add properties — value can be a readable type string like "int", "CGRect", "NSString *"
    JSValue *properties = spec[@"properties"];
    if (properties && ![properties isUndefined]) {
        NSDictionary *props = [properties toDictionary];
        for (NSString *propName in props) {
            NSString *typeStr = [props[propName] isKindOfClass:[NSString class]] ? props[propName] : nil;
            NSString *enc = [self encodingForPropertyType:typeStr];

            objc_property_attribute_t attrs[2];
            attrs[0] = (objc_property_attribute_t){.name = "T", .value = enc.UTF8String};
            BOOL isObj = [enc hasPrefix:@"@"];
            attrs[1] = (objc_property_attribute_t){.name = isObj ? "&" : "", .value = ""};
            class_addProperty(newCls, [propName UTF8String], attrs, isObj ? 2 : 1);

            NSString *ivarName = [NSString stringWithFormat:@"_%@", propName];
            NSUInteger ivarSize = 0, ivarAlign = 0;
            NSGetSizeAndAlignment(enc.UTF8String, &ivarSize, &ivarAlign);
            class_addIvar(newCls, [ivarName UTF8String], ivarSize,
                          ivarAlign ? (uint8_t)log2(ivarAlign) : 0, enc.UTF8String);
        }
    }

    objc_registerClassPair(newCls);

    [self addMethodsFromSpec:spec toClass:newCls inContext:context];

    NSLog(@"%@ ObjC.define: class created: %@ (super: %@)", kLogPrefix, className, superName);
    return [self createProxyForClassName:className inContext:context];
}

+ (void)addMethodsFromSpec:(JSValue *)spec toClass:(Class)cls inContext:(JSContext *)context {
    JSValue *methods = spec[@"methods"];
    if (!methods || [methods isUndefined]) return;

    NSDictionary *methodDict = [methods toDictionary];
    for (NSString *selName in methodDict) {
        SEL sel = NSSelectorFromString(selName);

        JSValue *entry = methods[selName];
        if (!entry || [entry isUndefined]) continue;

        // Required format: { type: "int (NSString *)", func: function(self, args){} }
        JSValue *typeVal = entry[@"type"];
        JSValue *funcVal = entry[@"func"];
        if (!typeVal || [typeVal isUndefined] || !funcVal || [funcVal isUndefined]) {
            NSLog(@"%@ ObjC.define method %@: expected { type: \"...\", func: function(){} } object", kLogPrefix, selName);
            continue;
        }

        JSValue *jsFunc = funcVal;
        NSString *typeSig = [typeVal toString];
        NSError *parseErr = nil;
        NSString *encoding = [WNBlockSignatureParser methodTypeEncodingFromSignature:typeSig error:&parseErr];
        if (!encoding) {
            NSLog(@"%@ ObjC.define method %@: failed to parse type \"%@\": %@",
                  kLogPrefix, selName, typeSig, parseErr.localizedDescription);
            continue;
        }

        const char *typeEncoding = [encoding UTF8String];

        JSManagedValue *managedFunc = [JSManagedValue managedValueWithValue:jsFunc];
        [context.virtualMachine addManagedReference:managedFunc withOwner:cls];

        NSString *assocKey = [NSString stringWithFormat:@"WNDefine_%@", selName];
        objc_setAssociatedObject(cls, NSSelectorFromString(assocKey), managedFunc, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

        class_addMethod(cls, sel, _objc_msgForward, typeEncoding);

        [self ensureDefineForwardingForClass:cls inContext:context];

        NSLog(@"%@ Added method %@ to %@ (encoding: %s)", kLogPrefix, selName, NSStringFromClass(cls), typeEncoding);
    }
}

+ (void)ensureDefineForwardingForClass:(Class)cls inContext:(JSContext *)context {
    static const char kInstalledKey;
    if (objc_getAssociatedObject(cls, &kInstalledKey)) return;
    objc_setAssociatedObject(cls, &kInstalledKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

    SEL sigSel = @selector(methodSignatureForSelector:);
    IMP origSigIMP = class_replaceMethod(
        cls, sigSel,
        imp_implementationWithBlock(^NSMethodSignature *(id _self, SEL selector) {
            NSString *assocKey = [NSString stringWithFormat:@"WNDefine_%@", NSStringFromSelector(selector)];
            JSManagedValue *fn = objc_getAssociatedObject([_self class], NSSelectorFromString(assocKey));
            if (fn) {
                Method m = class_getInstanceMethod([_self class], selector);
                if (m) {
                    return [NSMethodSignature signatureWithObjCTypes:method_getTypeEncoding(m)];
                }
                return [NSMethodSignature signatureWithObjCTypes:"v@:"];
            }
            // Call super
            struct objc_super sup = { _self, class_getSuperclass([_self class]) };
            return ((NSMethodSignature *(*)(struct objc_super *, SEL, SEL))objc_msgSendSuper)(&sup, sigSel, selector);
        }),
        method_getTypeEncoding(class_getInstanceMethod(cls, sigSel) ?: class_getInstanceMethod([NSObject class], sigSel))
    );

    SEL fwdSel = @selector(forwardInvocation:);
    IMP origFwdIMP = class_replaceMethod(
        cls, fwdSel,
        imp_implementationWithBlock(^(id _self, NSInvocation *invocation) {
            SEL selector = invocation.selector;
            NSString *assocKey = [NSString stringWithFormat:@"WNDefine_%@", NSStringFromSelector(selector)];
            JSManagedValue *managedFn = objc_getAssociatedObject([_self class], NSSelectorFromString(assocKey));

            if (managedFn) {
                JSValue *fn = managedFn.value;
                if (fn && ![fn isUndefined]) {
                    JSContext *ctx = fn.context;
                    NSMethodSignature *sig = invocation.methodSignature;

                    JSValue *selfProxy = [WNObjCBridge createInstanceProxy:_self inContext:ctx];
                    NSMutableArray<JSValue *> *jsArgs = [NSMutableArray array];
                    for (NSUInteger i = 2; i < sig.numberOfArguments; i++) {
                        JSValue *arg = [WNTypeConversion convertInvocationArgument:invocation atIndex:i inContext:ctx];
                        [jsArgs addObject:arg ?: [JSValue valueWithNullInContext:ctx]];
                    }

                    JSValue *argsArray = [JSValue valueWithObject:jsArgs inContext:ctx];
                    JSValue *result = [fn callWithArguments:@[selfProxy, argsArray]];

                    const char *retType = sig.methodReturnType;
                    if (retType[0] != 'v' && result && ![result isUndefined]) {
                        [WNTypeConversion setInvocationReturnValue:invocation fromJSValue:result inContext:ctx];
                    }
                }
                return;
            }

            // Not an ObjC.define method — forward to super
            struct objc_super sup = { _self, class_getSuperclass([_self class]) };
            ((void (*)(struct objc_super *, SEL, NSInvocation *))objc_msgSendSuper)(&sup, fwdSel, invocation);
        }),
        method_getTypeEncoding(class_getInstanceMethod(cls, fwdSel) ?: class_getInstanceMethod([NSObject class], fwdSel))
    );
}

#pragma mark - ObjC.delegate() — protocol delegate builder

+ (JSValue *)buildDelegate:(JSValue *)spec inContext:(JSContext *)context {
    // Generate a unique delegate class name
    static int delegateCount = 0;
    NSString *className = [NSString stringWithFormat:@"WNDelegate_%d", ++delegateCount];

    JSValue *protocols = spec[@"protocols"];
    NSArray *protoNames = [protocols toArray];

    // Build an ObjC.define spec
    JSValue *defineSpec = [JSValue valueWithNewObjectInContext:context];
    defineSpec[@"name"] = className;
    defineSpec[@"super"] = @"NSObject";
    defineSpec[@"protocols"] = protocols;
    defineSpec[@"methods"] = spec[@"methods"];

    JSValue *proxy = [self defineClass:defineSpec inContext:context];
    if (!proxy || [proxy isNull]) return proxy;

    // Instantiate the delegate
    return [self invokeSelector:@"new" onTarget:NSClassFromString(className) isClass:YES withArgs:@[] inContext:context];
}

#pragma mark - Helper: method enumeration

+ (NSArray<NSString *> *)methodsForClass:(Class)cls isInstance:(BOOL)isInstance {
    NSMutableArray *result = [NSMutableArray array];
    Class targetCls = isInstance ? cls : object_getClass(cls);

    unsigned int count = 0;
    Method *methods = class_copyMethodList(targetCls, &count);
    for (unsigned int i = 0; i < count; i++) {
        SEL sel = method_getName(methods[i]);
        const char *typeEncoding = method_getTypeEncoding(methods[i]);
        NSString *readable = typeEncoding
            ? [WNTypeConversion humanReadableMethodSignature:typeEncoding]
            : @"?";
        NSString *entry = [NSString stringWithFormat:@"%@ %@",
                           NSStringFromSelector(sel), readable];
        [result addObject:entry];
    }
    free(methods);

    [result sortUsingSelector:@selector(compare:)];
    return result;
}

@end
