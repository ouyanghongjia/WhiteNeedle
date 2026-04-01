#import "WNHookEngine.h"
#import "WNObjCBridge.h"
#import "WNTypeConversion.h"
#import "WNBoxing.h"
#import <objc/runtime.h>
#import <objc/message.h>

static NSString *const kLogPrefix = @"[WhiteNeedle:Hook]";

#pragma mark - Hook entry (per method)

@interface WNHookEntry : NSObject
@property (nonatomic, strong) NSString *selectorKey;
@property (nonatomic, copy)   NSString *className;
@property (nonatomic, assign) Class targetClass;
@property (nonatomic, assign) SEL originalSelector;
@property (nonatomic, assign) SEL aliasSelector;
@property (nonatomic, assign) IMP originalIMP;
@property (nonatomic, copy)   NSString *typeEncoding;
@property (nonatomic, strong) NSMethodSignature *methodSignature;
@property (nonatomic, strong) JSManagedValue *onEnter;
@property (nonatomic, strong) JSManagedValue *onLeave;
@property (nonatomic, strong) JSManagedValue *replacement;
@property (nonatomic, assign) BOOL isClassMethod;
@property (nonatomic, assign) BOOL paused;
@property (nonatomic, assign) NSUInteger hitCount;
@property (nonatomic, assign) NSTimeInterval lastHitTime;
@end

@implementation WNHookEntry
@end

#pragma mark - Per-class hook state

@interface WNClassHookState : NSObject
@property (nonatomic, assign) Class targetClass;
@property (nonatomic, assign) IMP origForwardInvocation;
@property (nonatomic, assign) IMP origMethodSignatureForSelector;
@property (nonatomic, strong) NSMutableDictionary<NSString *, WNHookEntry *> *selectorMap;
@end

@implementation WNClassHookState
- (instancetype)init {
    self = [super init];
    if (self) _selectorMap = [NSMutableDictionary dictionary];
    return self;
}
@end

#pragma mark - WNHookEngine

static NSMutableDictionary<NSString *, WNHookEntry *> *g_hooks = nil;
static NSMutableDictionary<NSString *, WNClassHookState *> *g_classStates = nil;
static JSContext *g_hookContext = nil;
static NSMutableSet<NSString *> *g_reentrancyGuard = nil;

@implementation WNHookEngine

+ (void)initialize {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        g_hooks = [NSMutableDictionary dictionary];
        g_classStates = [NSMutableDictionary dictionary];
        g_reentrancyGuard = [NSMutableSet set];
    });
}

+ (void)registerInContext:(JSContext *)context {
    g_hookContext = context;

    JSValue *interceptor = [JSValue valueWithNewObjectInContext:context];

    interceptor[@"attach"] = ^(NSString *selectorKey, JSValue *callbacks) {
        [WNHookEngine attachHook:selectorKey callbacks:callbacks inContext:[JSContext currentContext]];
    };

    interceptor[@"replace"] = ^(NSString *selectorKey, JSValue *replacementFn) {
        [WNHookEngine replaceMethod:selectorKey replacement:replacementFn inContext:[JSContext currentContext]];
    };

    interceptor[@"detach"] = ^(NSString *selectorKey) {
        [WNHookEngine detachHook:selectorKey];
    };

    interceptor[@"detachAll"] = ^{
        [WNHookEngine detachAll];
    };

    interceptor[@"list"] = ^NSArray<NSString *> *{
        return [WNHookEngine activeHooks];
    };

    interceptor[@"listDetailed"] = ^NSArray<NSDictionary *> *{
        return [WNHookEngine activeHooksDetailed];
    };

    interceptor[@"pause"] = ^BOOL(NSString *selectorKey) {
        return [WNHookEngine pauseHook:selectorKey];
    };

    interceptor[@"resume"] = ^BOOL(NSString *selectorKey) {
        return [WNHookEngine resumeHook:selectorKey];
    };

    context[@"Interceptor"] = interceptor;
    NSLog(@"%@ Hook engine v2 registered (NSInvocation-based)", kLogPrefix);
}

+ (NSArray<NSString *> *)activeHooks {
    return [g_hooks allKeys];
}

+ (NSArray<NSDictionary *> *)activeHooksDetailed {
    NSMutableArray *result = [NSMutableArray array];
    [g_hooks enumerateKeysAndObjectsUsingBlock:^(NSString *key, WNHookEntry *entry, BOOL *stop) {
        [result addObject:@{
            @"selector": key,
            @"className": entry.className ?: @"",
            @"isClassMethod": @(entry.isClassMethod),
            @"paused": @(entry.paused),
            @"hitCount": @(entry.hitCount),
            @"lastHitTime": @(entry.lastHitTime),
            @"hasOnEnter": @(entry.onEnter != nil),
            @"hasOnLeave": @(entry.onLeave != nil),
            @"hasReplacement": @(entry.replacement != nil),
        }];
    }];
    return result;
}

+ (BOOL)pauseHook:(NSString *)selectorKey {
    WNHookEntry *entry = g_hooks[selectorKey];
    if (!entry) return NO;
    entry.paused = YES;
    return YES;
}

+ (BOOL)resumeHook:(NSString *)selectorKey {
    WNHookEntry *entry = g_hooks[selectorKey];
    if (!entry) return NO;
    entry.paused = NO;
    return YES;
}

#pragma mark - Parse selector key

+ (BOOL)parseSelectorKey:(NSString *)key
               className:(NSString *__autoreleasing *)outClass
            selectorName:(NSString *__autoreleasing *)outSelector
           isClassMethod:(BOOL *)outIsClass {
    if (key.length < 5) return NO;
    unichar sign = [key characterAtIndex:0];
    *outIsClass = (sign == '+');

    NSRange bracketOpen = [key rangeOfString:@"["];
    NSRange bracketClose = [key rangeOfString:@"]"];
    if (bracketOpen.location == NSNotFound || bracketClose.location == NSNotFound) return NO;

    NSString *inner = [key substringWithRange:NSMakeRange(bracketOpen.location + 1,
                                                          bracketClose.location - bracketOpen.location - 1)];
    NSRange spaceRange = [inner rangeOfString:@" "];
    if (spaceRange.location == NSNotFound) return NO;

    *outClass = [inner substringToIndex:spaceRange.location];
    *outSelector = [inner substringFromIndex:spaceRange.location + 1];
    return YES;
}

#pragma mark - Interceptor.attach()

+ (void)attachHook:(NSString *)selectorKey
         callbacks:(JSValue *)callbacks
         inContext:(JSContext *)context {
    NSString *className, *selectorName;
    BOOL isClassMethod;
    if (![self parseSelectorKey:selectorKey className:&className selectorName:&selectorName isClassMethod:&isClassMethod]) {
        NSLog(@"%@ Invalid selector format: %@ (use \"-[Class method:]\")", kLogPrefix, selectorKey);
        return;
    }

    Class cls = NSClassFromString(className);
    if (!cls) {
        NSLog(@"%@ Class not found: %@", kLogPrefix, className);
        return;
    }

    SEL sel = NSSelectorFromString(selectorName);
    Class targetCls = isClassMethod ? object_getClass(cls) : cls;

    Method method = class_getInstanceMethod(targetCls, sel);
    if (!method) {
        NSLog(@"%@ Method not found: %@", kLogPrefix, selectorKey);
        return;
    }

    if (g_hooks[selectorKey]) {
        [self detachHook:selectorKey];
    }

    const char *typeEncoding = method_getTypeEncoding(method);
    NSMethodSignature *sig = [NSMethodSignature signatureWithObjCTypes:typeEncoding];
    IMP originalIMP = method_getImplementation(method);

    NSString *aliasName = [NSString stringWithFormat:@"WNORIGINAL_%@_%@",
                           className, selectorName];
    aliasName = [aliasName stringByReplacingOccurrencesOfString:@":" withString:@"_"];
    SEL aliasSel = NSSelectorFromString(aliasName);
    class_addMethod(targetCls, aliasSel, originalIMP, typeEncoding);

    WNHookEntry *entry = [[WNHookEntry alloc] init];
    entry.selectorKey = selectorKey;
    entry.targetClass = targetCls;
    entry.originalSelector = sel;
    entry.aliasSelector = aliasSel;
    entry.originalIMP = originalIMP;
    entry.typeEncoding = @(typeEncoding);
    entry.methodSignature = sig;
    entry.isClassMethod = isClassMethod;
    entry.className = className;

    JSValue *onEnter = callbacks[@"onEnter"];
    JSValue *onLeave = callbacks[@"onLeave"];

    if (onEnter && ![onEnter isUndefined]) {
        entry.onEnter = [JSManagedValue managedValueWithValue:onEnter];
        [context.virtualMachine addManagedReference:entry.onEnter withOwner:entry];
    }
    if (onLeave && ![onLeave isUndefined]) {
        entry.onLeave = [JSManagedValue managedValueWithValue:onLeave];
        [context.virtualMachine addManagedReference:entry.onLeave withOwner:entry];
    }

    g_hooks[selectorKey] = entry;
    [self ensureClassHooked:targetCls];
    [self registerEntry:entry forClass:targetCls];

    method_setImplementation(method, _objc_msgForward);

    NSLog(@"%@ Hooked: %@ (full args via NSInvocation)", kLogPrefix, selectorKey);
}

#pragma mark - Interceptor.replace()

+ (void)replaceMethod:(NSString *)selectorKey
           replacement:(JSValue *)replacementFn
             inContext:(JSContext *)context {
    NSString *className, *selectorName;
    BOOL isClassMethod;
    if (![self parseSelectorKey:selectorKey className:&className selectorName:&selectorName isClassMethod:&isClassMethod]) {
        NSLog(@"%@ Invalid selector format: %@", kLogPrefix, selectorKey);
        return;
    }

    Class cls = NSClassFromString(className);
    if (!cls) {
        NSLog(@"%@ Class not found: %@", kLogPrefix, className);
        return;
    }

    SEL sel = NSSelectorFromString(selectorName);
    Class targetCls = isClassMethod ? object_getClass(cls) : cls;

    Method method = class_getInstanceMethod(targetCls, sel);
    if (!method) {
        NSLog(@"%@ Method not found: %@", kLogPrefix, selectorKey);
        return;
    }

    if (g_hooks[selectorKey]) {
        [self detachHook:selectorKey];
    }

    const char *typeEncoding = method_getTypeEncoding(method);
    NSMethodSignature *sig = [NSMethodSignature signatureWithObjCTypes:typeEncoding];
    IMP originalIMP = method_getImplementation(method);

    NSString *aliasName = [NSString stringWithFormat:@"WNORIGINAL_%@_%@",
                           className, selectorName];
    aliasName = [aliasName stringByReplacingOccurrencesOfString:@":" withString:@"_"];
    SEL aliasSel = NSSelectorFromString(aliasName);
    class_addMethod(targetCls, aliasSel, originalIMP, typeEncoding);

    WNHookEntry *entry = [[WNHookEntry alloc] init];
    entry.selectorKey = selectorKey;
    entry.targetClass = targetCls;
    entry.originalSelector = sel;
    entry.aliasSelector = aliasSel;
    entry.originalIMP = originalIMP;
    entry.typeEncoding = @(typeEncoding);
    entry.methodSignature = sig;
    entry.isClassMethod = isClassMethod;
    entry.className = className;
    entry.replacement = [JSManagedValue managedValueWithValue:replacementFn];
    [context.virtualMachine addManagedReference:entry.replacement withOwner:entry];

    g_hooks[selectorKey] = entry;
    [self ensureClassHooked:targetCls];
    [self registerEntry:entry forClass:targetCls];

    method_setImplementation(method, _objc_msgForward);

    NSLog(@"%@ Replaced: %@ (full args via NSInvocation)", kLogPrefix, selectorKey);
}

#pragma mark - Class-level forwardInvocation: / methodSignatureForSelector: swizzle

+ (void)ensureClassHooked:(Class)cls {
    NSString *classKey = NSStringFromClass(cls);
    if (g_classStates[classKey]) return;

    WNClassHookState *state = [[WNClassHookState alloc] init];
    state.targetClass = cls;

    // Swizzle methodSignatureForSelector:
    // NOTE: class_replaceMethod returns NULL when the method is inherited (not
    // overridden by cls).  We must capture the current IMP *before* replacing
    // so we can still call through to the original (possibly inherited) version.
    SEL sigSel = @selector(methodSignatureForSelector:);
    Method sigMethod = class_getInstanceMethod(cls, sigSel);
    IMP origSigIMP = sigMethod ? method_getImplementation(sigMethod) : NULL;

    class_replaceMethod(
        cls, sigSel,
        imp_implementationWithBlock(^NSMethodSignature *(id _self, SEL selector) {
            WNHookEntry *entry = [WNHookEngine findEntryForClass:object_getClass(_self) selector:selector];
            if (entry) {
                return entry.methodSignature;
            }
            WNClassHookState *st = g_classStates[NSStringFromClass(cls)];
            if (st && st.origMethodSignatureForSelector) {
                return ((NSMethodSignature *(*)(id, SEL, SEL))st.origMethodSignatureForSelector)(_self, sigSel, selector);
            }
            return nil;
        }),
        method_getTypeEncoding(sigMethod ?: class_getInstanceMethod([NSObject class], sigSel))
    );
    state.origMethodSignatureForSelector = origSigIMP;

    // Swizzle forwardInvocation:
    SEL fwdSel = @selector(forwardInvocation:);
    Method fwdMethod = class_getInstanceMethod(cls, fwdSel);
    IMP origFwdIMP = fwdMethod ? method_getImplementation(fwdMethod) : NULL;

    class_replaceMethod(
        cls, fwdSel,
        imp_implementationWithBlock(^(id _self, NSInvocation *invocation) {
            SEL selector = invocation.selector;
            WNHookEntry *entry = [WNHookEngine findEntryForClass:object_getClass(_self) selector:selector];

            if (entry) {
                [WNHookEngine handleHookedInvocation:invocation entry:entry target:_self];
                return;
            }
            WNClassHookState *st = g_classStates[NSStringFromClass(cls)];
            if (st && st.origForwardInvocation) {
                ((void (*)(id, SEL, NSInvocation *))st.origForwardInvocation)(_self, fwdSel, invocation);
            } else {
                [_self doesNotRecognizeSelector:selector];
            }
        }),
        method_getTypeEncoding(fwdMethod ?: class_getInstanceMethod([NSObject class], fwdSel))
    );
    state.origForwardInvocation = origFwdIMP;

    g_classStates[classKey] = state;
    NSLog(@"%@ Class hooked for forwarding: %@", kLogPrefix, classKey);
}

+ (void)registerEntry:(WNHookEntry *)entry forClass:(Class)cls {
    NSString *classKey = NSStringFromClass(cls);
    WNClassHookState *state = g_classStates[classKey];
    if (state) {
        NSString *selKey = NSStringFromSelector(entry.originalSelector);
        state.selectorMap[selKey] = entry;
    }
}

+ (void)unregisterEntry:(WNHookEntry *)entry forClass:(Class)cls {
    NSString *classKey = NSStringFromClass(cls);
    WNClassHookState *state = g_classStates[classKey];
    if (state) {
        NSString *selKey = NSStringFromSelector(entry.originalSelector);
        [state.selectorMap removeObjectForKey:selKey];
    }
}

#pragma mark - Lookup

+ (nullable WNHookEntry *)findEntryForClass:(Class)cls selector:(SEL)selector {
    NSString *selName = NSStringFromSelector(selector);

    Class current = cls;
    while (current) {
        NSString *classKey = NSStringFromClass(current);
        WNClassHookState *state = g_classStates[classKey];
        if (state) {
            WNHookEntry *entry = state.selectorMap[selName];
            if (entry) return entry;
        }
        current = class_getSuperclass(current);
    }
    return nil;
}

#pragma mark - Handle hooked invocation (core logic)

+ (void)handleHookedInvocation:(NSInvocation *)invocation
                          entry:(WNHookEntry *)entry
                         target:(id)target {
    entry.hitCount++;
    entry.lastHitTime = [[NSDate date] timeIntervalSince1970];

    NSString *guardKey = entry.selectorKey;

    if (entry.paused) {
        [invocation setSelector:entry.aliasSelector];
        [invocation invoke];
        [invocation setSelector:entry.originalSelector];
        return;
    }

    BOOL isReentrant = [g_reentrancyGuard containsObject:guardKey];

    if (isReentrant) {
        // Reentrant call — skip JS callbacks, just call the original
        [invocation setSelector:entry.aliasSelector];
        [invocation invoke];
        [invocation setSelector:entry.originalSelector];
        return;
    }

    [g_reentrancyGuard addObject:guardKey];

    NSMethodSignature *sig = entry.methodSignature;
    JSContext *ctx = g_hookContext;
    if (!ctx) {
        [g_reentrancyGuard removeObject:guardKey];
        [invocation setSelector:entry.aliasSelector];
        [invocation invoke];
        [invocation setSelector:entry.originalSelector];
        return;
    }

    // Extract all arguments (skip index 0=self, 1=_cmd)
    NSMutableArray<JSValue *> *jsArgs = [NSMutableArray array];
    for (NSUInteger i = 2; i < sig.numberOfArguments; i++) {
        const char *argType = [sig getArgumentTypeAtIndex:i];
        NSUInteger argSize = 0;
        NSGetSizeAndAlignment(argType, &argSize, NULL);

        void *buf = calloc(1, argSize);
        [invocation getArgument:buf atIndex:i];
        JSValue *jsArg = [WNTypeConversion convertToJSValue:buf typeEncoding:argType inContext:ctx];
        [jsArgs addObject:jsArg ?: [JSValue valueWithNullInContext:ctx]];
        free(buf);
    }

    if (entry.replacement) {
        JSValue *replaceFn = entry.replacement.value;
        if (replaceFn && ![replaceFn isUndefined]) {
            JSValue *selfProxy = [WNObjCBridge createInstanceProxy:target inContext:ctx];
            JSValue *argsArray = [JSValue valueWithObject:jsArgs inContext:ctx];

            __block BOOL originalCalled = NO;
            __block JSValue *originalResult = nil;

            JSValue *originalFn = [JSValue valueWithObject:^JSValue *(JSValue *overrideArgs) {
                originalCalled = YES;

                if (overrideArgs && ![overrideArgs isUndefined] && ![overrideArgs isNull]) {
                    NSUInteger argCount = [[overrideArgs[@"length"] toNumber] unsignedIntegerValue];
                    for (NSUInteger i = 0; i < argCount && (i + 2) < sig.numberOfArguments; i++) {
                        const char *argType = [sig getArgumentTypeAtIndex:i + 2];
                        NSUInteger argSize = 0;
                        NSGetSizeAndAlignment(argType, &argSize, NULL);
                        void *buf = calloc(1, argSize);
                        JSValue *jsVal = [overrideArgs valueAtIndex:i];
                        [WNTypeConversion convertJSValue:jsVal toTypeEncoding:argType buffer:buf inContext:ctx];
                        [invocation setArgument:buf atIndex:i + 2];
                        free(buf);
                    }
                }

                [invocation setSelector:entry.aliasSelector];
                [invocation invoke];
                [invocation setSelector:entry.originalSelector];

                const char *retType = sig.methodReturnType;
                if (retType[0] == 'v') {
                    return [JSValue valueWithUndefinedInContext:ctx];
                }
                NSUInteger retSize = sig.methodReturnLength;
                void *retBuf = calloc(1, retSize);
                [invocation getReturnValue:retBuf];
                JSValue *ret = [WNTypeConversion convertToJSValue:retBuf typeEncoding:retType inContext:ctx];
                free(retBuf);
                originalResult = ret;
                return ret;
            } inContext:ctx];

            JSValue *result = [replaceFn callWithArguments:@[selfProxy, argsArray, originalFn]];

            const char *retType = sig.methodReturnType;
            if (retType[0] != 'v') {
                if (result && ![result isUndefined]) {
                    [WNTypeConversion setInvocationReturnValue:invocation fromJSValue:result inContext:ctx];
                } else if (originalCalled && originalResult && ![originalResult isUndefined]) {
                    [WNTypeConversion setInvocationReturnValue:invocation fromJSValue:originalResult inContext:ctx];
                }
            }
        }
        [g_reentrancyGuard removeObject:guardKey];
        return;
    }

    // Attach mode: onEnter → original → onLeave

    // onEnter(self, sel, args)
    JSValue *onEnterFn = entry.onEnter ? entry.onEnter.value : nil;
    if (onEnterFn && ![onEnterFn isUndefined]) {
        JSValue *selfProxy = [WNObjCBridge createInstanceProxy:target inContext:ctx];
        JSValue *selStr = [JSValue valueWithObject:NSStringFromSelector(entry.originalSelector) inContext:ctx];
        JSValue *argsArray = [JSValue valueWithObject:jsArgs inContext:ctx];
        [onEnterFn callWithArguments:@[selfProxy, selStr, argsArray]];
    }

    // Call original via alias selector
    [invocation setSelector:entry.aliasSelector];
    [invocation invoke];
    [invocation setSelector:entry.originalSelector];

    // onLeave(retval) → can return modified value
    JSValue *onLeaveFn = entry.onLeave ? entry.onLeave.value : nil;
    if (onLeaveFn && ![onLeaveFn isUndefined]) {
        const char *retType = sig.methodReturnType;
        JSValue *retval = [JSValue valueWithUndefinedInContext:ctx];

        if (retType[0] != 'v') {
            NSUInteger retSize = sig.methodReturnLength;
            void *retBuf = calloc(1, retSize);
            [invocation getReturnValue:retBuf];
            retval = [WNTypeConversion convertToJSValue:retBuf typeEncoding:retType inContext:ctx];
            free(retBuf);
        }

        JSValue *newRetval = [onLeaveFn callWithArguments:@[retval]];

        // If onLeave returns non-undefined, use as new return value
        if (newRetval && ![newRetval isUndefined] && retType[0] != 'v') {
            [WNTypeConversion setInvocationReturnValue:invocation fromJSValue:newRetval inContext:ctx];
        }
    }

    [g_reentrancyGuard removeObject:guardKey];
}

#pragma mark - Detach

+ (void)detachHook:(NSString *)selectorKey {
    WNHookEntry *entry = g_hooks[selectorKey];
    if (!entry) {
        NSLog(@"%@ No hook found for: %@", kLogPrefix, selectorKey);
        return;
    }

    Method method = class_getInstanceMethod(entry.targetClass, entry.originalSelector);
    if (method && entry.originalIMP) {
        method_setImplementation(method, entry.originalIMP);
    }

    [self unregisterEntry:entry forClass:entry.targetClass];
    [g_hooks removeObjectForKey:selectorKey];
    NSLog(@"%@ Detached: %@", kLogPrefix, selectorKey);
}

+ (void)detachAll {
    NSArray *keys = [g_hooks allKeys];
    for (NSString *key in keys) {
        [self detachHook:key];
    }
    NSLog(@"%@ All hooks detached (%lu)", kLogPrefix, (unsigned long)keys.count);
}

@end
