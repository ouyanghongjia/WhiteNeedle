#import "WNHookEngine.h"
#import "WNObjCBridge.h"
#import "WNTypeConversion.h"
#import "WNBoxing.h"
#import "libffi/include/ffi.h"
#import <objc/runtime.h>
#import <objc/message.h>

static NSString *const kLogPrefix = @"[WhiteNeedle:Hook]";

#pragma mark - FFI struct type definitions

static ffi_type *wn_hk_elems_CGPoint[]  = { &ffi_type_double, &ffi_type_double, NULL };
static ffi_type  wn_hk_type_CGPoint     = { 0, 0, FFI_TYPE_STRUCT, wn_hk_elems_CGPoint };

static ffi_type *wn_hk_elems_CGSize[]   = { &ffi_type_double, &ffi_type_double, NULL };
static ffi_type  wn_hk_type_CGSize      = { 0, 0, FFI_TYPE_STRUCT, wn_hk_elems_CGSize };

static ffi_type *wn_hk_elems_CGRect[]   = { &wn_hk_type_CGPoint, &wn_hk_type_CGSize, NULL };
static ffi_type  wn_hk_type_CGRect      = { 0, 0, FFI_TYPE_STRUCT, wn_hk_elems_CGRect };

static ffi_type *wn_hk_elems_UIEdge[]   = { &ffi_type_double, &ffi_type_double, &ffi_type_double, &ffi_type_double, NULL };
static ffi_type  wn_hk_type_UIEdge      = { 0, 0, FFI_TYPE_STRUCT, wn_hk_elems_UIEdge };

static ffi_type *wn_hk_elems_NSRange[]  = { &ffi_type_uint64, &ffi_type_uint64, NULL };
static ffi_type  wn_hk_type_NSRange     = { 0, 0, FFI_TYPE_STRUCT, wn_hk_elems_NSRange };

static ffi_type *wn_hk_elems_CGAffine[] = { &ffi_type_double, &ffi_type_double, &ffi_type_double,
                                             &ffi_type_double, &ffi_type_double, &ffi_type_double, NULL };
static ffi_type  wn_hk_type_CGAffine    = { 0, 0, FFI_TYPE_STRUCT, wn_hk_elems_CGAffine };

static ffi_type *wn_hk_ffi_type(const char *enc) {
    while (*enc == 'r' || *enc == 'n' || *enc == 'N' || *enc == 'o' ||
           *enc == 'O' || *enc == 'R' || *enc == 'V') enc++;
    switch (*enc) {
        case 'v': return &ffi_type_void;
        case 'c': return &ffi_type_sint8;
        case 'C': return &ffi_type_uint8;
        case 's': return &ffi_type_sint16;
        case 'S': return &ffi_type_uint16;
        case 'i': return &ffi_type_sint32;
        case 'I': return &ffi_type_uint32;
        case 'l': return &ffi_type_sint32;
        case 'L': return &ffi_type_uint32;
        case 'q': return &ffi_type_sint64;
        case 'Q': return &ffi_type_uint64;
        case 'f': return &ffi_type_float;
        case 'd': return &ffi_type_double;
        case 'D': return &ffi_type_longdouble;
        case 'B': return &ffi_type_uint8;
        case '*': return &ffi_type_pointer;
        case '@': return &ffi_type_pointer;
        case '^': return &ffi_type_pointer;
        case '#': return &ffi_type_pointer;
        case ':': return &ffi_type_pointer;
        case '?': return &ffi_type_pointer;
        case '{': {
            if (strncmp(enc, "{CGRect", 7) == 0)             return &wn_hk_type_CGRect;
            if (strncmp(enc, "{CGPoint", 8) == 0)            return &wn_hk_type_CGPoint;
            if (strncmp(enc, "{CGSize", 7) == 0)             return &wn_hk_type_CGSize;
            if (strncmp(enc, "{UIEdgeInsets", 13) == 0)      return &wn_hk_type_UIEdge;
            if (strncmp(enc, "{_NSRange", 9) == 0 ||
                strncmp(enc, "{NSRange", 8) == 0)            return &wn_hk_type_NSRange;
            if (strncmp(enc, "{CGAffineTransform", 18) == 0) return &wn_hk_type_CGAffine;
            NSLog(@"%@ Unsupported struct ffi type: %s", kLogPrefix, enc);
            return NULL;
        }
        default: return &ffi_type_pointer;
    }
}

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
@property (nonatomic, strong) JSValue *onEnter;
@property (nonatomic, strong) JSValue *onLeave;
@property (nonatomic, strong) JSValue *replacement;
@property (nonatomic, assign) BOOL isClassMethod;
@property (nonatomic, assign) BOOL paused;
@property (nonatomic, assign) NSUInteger hitCount;
@property (nonatomic, assign) NSTimeInterval lastHitTime;
@property (nonatomic, assign) ffi_cif     *hookCif;
@property (nonatomic, assign) ffi_closure *hookClosure;
@property (nonatomic, assign) ffi_type   **hookArgTypes;
@property (nonatomic, assign) IMP          hookIMP;
@end

@implementation WNHookEntry
- (void)dealloc {
    if (_hookClosure)  { ffi_closure_free(_hookClosure); _hookClosure = NULL; }
    if (_hookArgTypes) { free(_hookArgTypes); _hookArgTypes = NULL; }
    if (_hookCif)      { free(_hookCif); _hookCif = NULL; }
}
@end

#pragma mark - WNHookEngine

static NSMutableDictionary<NSString *, WNHookEntry *> *g_hooks = nil;
static JSContext *g_hookContext = nil;
static NSMutableSet<NSString *> *g_reentrancyGuard = nil;
static _Thread_local int g_forwardingDepth = 0;

@class WNHookEngine;
@interface WNHookEngine (ForwardDecl)
+ (void)handleHookedInvocation:(NSInvocation *)invocation
                          entry:(WNHookEntry *)entry
                         target:(id)target;
@end

#pragma mark - FFI closure callback (replaces _objc_msgForward entirely)

static void WNHookClosureCallback(ffi_cif *cif, void *ret, void **args, void *userdata) {
    WNHookEntry *entry = (__bridge WNHookEntry *)userdata;
    __unsafe_unretained id self_ = *(__unsafe_unretained id *)args[0];

    if (g_forwardingDepth > 0) {
        ffi_call(cif, (void (*)(void))entry.originalIMP, ret, args);
        return;
    }

    g_forwardingDepth++;
    @try {
        NSMethodSignature *sig = entry.methodSignature;
        NSInvocation *invocation = [NSInvocation invocationWithMethodSignature:sig];
        [invocation setTarget:self_];
        [invocation setSelector:entry.originalSelector];

        for (NSUInteger i = 2; i < sig.numberOfArguments; i++) {
            [invocation setArgument:args[i] atIndex:i];
        }
        [invocation retainArguments];

        [WNHookEngine handleHookedInvocation:invocation entry:entry target:self_];

        const char *retEnc = sig.methodReturnType;
        if (retEnc && retEnc[0] != 'v') {
            NSUInteger retLen = sig.methodReturnLength;
            if (retLen > 0) {
                [invocation getReturnValue:ret];
            }
        }
    } @catch (NSException *exception) {
        NSLog(@"%@ Exception in hook callback for %@: %@", kLogPrefix, entry.selectorKey, exception);
        ffi_call(cif, (void (*)(void))entry.originalIMP, ret, args);
    } @finally {
        g_forwardingDepth--;
    }
}

@implementation WNHookEngine

+ (void)initialize {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        g_hooks = [NSMutableDictionary dictionary];
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
    NSLog(@"%@ Hook engine v3 registered (ffi-closure based)", kLogPrefix);
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

#pragma mark - Create ffi closure IMP for a hook entry

+ (BOOL)buildClosureForEntry:(WNHookEntry *)entry {
    NSMethodSignature *sig = entry.methodSignature;
    NSUInteger nargs = sig.numberOfArguments;

    ffi_type *retType = wn_hk_ffi_type(sig.methodReturnType);
    if (!retType) {
        NSLog(@"%@ Cannot resolve return ffi type for %@", kLogPrefix, entry.selectorKey);
        return NO;
    }

    ffi_type **argTypes = calloc(nargs, sizeof(ffi_type *));
    for (NSUInteger i = 0; i < nargs; i++) {
        argTypes[i] = wn_hk_ffi_type([sig getArgumentTypeAtIndex:i]);
        if (!argTypes[i]) {
            NSLog(@"%@ Cannot resolve arg %lu ffi type for %@", kLogPrefix, (unsigned long)i, entry.selectorKey);
            free(argTypes);
            return NO;
        }
    }

    ffi_cif *cif = calloc(1, sizeof(ffi_cif));
    if (ffi_prep_cif(cif, FFI_DEFAULT_ABI, (unsigned int)nargs, retType, argTypes) != FFI_OK) {
        NSLog(@"%@ ffi_prep_cif failed for %@", kLogPrefix, entry.selectorKey);
        free(cif);
        free(argTypes);
        return NO;
    }

    void *closureIMP = NULL;
    ffi_closure *closure = ffi_closure_alloc(sizeof(ffi_closure), &closureIMP);
    if (!closure) {
        NSLog(@"%@ ffi_closure_alloc failed for %@", kLogPrefix, entry.selectorKey);
        free(cif);
        free(argTypes);
        return NO;
    }

    if (ffi_prep_closure_loc(closure, cif, WNHookClosureCallback,
                             (__bridge void *)entry, closureIMP) != FFI_OK) {
        NSLog(@"%@ ffi_prep_closure_loc failed for %@", kLogPrefix, entry.selectorKey);
        ffi_closure_free(closure);
        free(cif);
        free(argTypes);
        return NO;
    }

    entry.hookCif      = cif;
    entry.hookClosure  = closure;
    entry.hookArgTypes = argTypes;
    entry.hookIMP      = (IMP)closureIMP;
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
        entry.onEnter = onEnter;
    }
    if (onLeave && ![onLeave isUndefined]) {
        entry.onLeave = onLeave;
    }

    if (![self buildClosureForEntry:entry]) {
        NSLog(@"%@ Failed to create ffi closure, hook aborted: %@", kLogPrefix, selectorKey);
        return;
    }

    g_hooks[selectorKey] = entry;
    method_setImplementation(method, entry.hookIMP);

    NSLog(@"%@ Hooked: %@ (ffi-closure, re-entrance safe)", kLogPrefix, selectorKey);
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
    entry.replacement = replacementFn;

    if (![self buildClosureForEntry:entry]) {
        NSLog(@"%@ Failed to create ffi closure, replace aborted: %@", kLogPrefix, selectorKey);
        return;
    }

    g_hooks[selectorKey] = entry;
    method_setImplementation(method, entry.hookIMP);

    NSLog(@"%@ Replaced: %@ (ffi-closure, re-entrance safe)", kLogPrefix, selectorKey);
}

#pragma mark - Handle hooked invocation (core logic — unchanged from v2)

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

    BOOL isReentrant;
    @synchronized (g_reentrancyGuard) {
        isReentrant = [g_reentrancyGuard containsObject:guardKey];
    }

    if (isReentrant) {
        [invocation setSelector:entry.aliasSelector];
        [invocation invoke];
        [invocation setSelector:entry.originalSelector];
        return;
    }

    @synchronized (g_reentrancyGuard) {
        [g_reentrancyGuard addObject:guardKey];
    }

    BOOL aliasInvoked = NO;

    @try {
    NSMethodSignature *sig = entry.methodSignature;
    JSContext *ctx = g_hookContext;
    if (!ctx) {
        [invocation setSelector:entry.aliasSelector];
        [invocation invoke];
        aliasInvoked = YES;
        [invocation setSelector:entry.originalSelector];
        return;
    }

    NSMutableArray<JSValue *> *jsArgs = [NSMutableArray array];
    for (NSUInteger i = 2; i < sig.numberOfArguments; i++) {
        const char *argType = [sig getArgumentTypeAtIndex:i];
        const char *clean = argType;
        while (*clean == 'r' || *clean == 'n' || *clean == 'N' ||
               *clean == 'o' || *clean == 'O' || *clean == 'R' || *clean == 'V') {
            clean++;
        }

        NSUInteger argSize = 0;
        NSGetSizeAndAlignment(argType, &argSize, NULL);
        void *buf = calloc(1, argSize);
        [invocation getArgument:buf atIndex:i];

        JSValue *jsArg;
        if (clean[0] == '@' && clean[1] != '?') {
            __unsafe_unretained id obj = (__bridge id)(*(void **)buf);
            jsArg = obj ? [WNObjCBridge createInstanceProxy:obj inContext:ctx]
                        : [JSValue valueWithNullInContext:ctx];
        } else {
            jsArg = [WNTypeConversion convertToJSValue:buf typeEncoding:argType inContext:ctx];
        }
        [jsArgs addObject:jsArg ?: [JSValue valueWithNullInContext:ctx]];
        free(buf);
    }

    if (entry.replacement) {
        JSValue *replaceFn = entry.replacement;
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

            aliasInvoked = YES;
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
        return;
    }

    JSValue *onEnterFn = entry.onEnter;
    if (onEnterFn && ![onEnterFn isUndefined]) {
        JSValue *selfProxy = [WNObjCBridge createInstanceProxy:target inContext:ctx];
        JSValue *selStr = [JSValue valueWithObject:NSStringFromSelector(entry.originalSelector) inContext:ctx];
        JSValue *argsArray = [JSValue valueWithObject:jsArgs inContext:ctx];
        [onEnterFn callWithArguments:@[selfProxy, selStr, argsArray]];
    }

    [invocation setSelector:entry.aliasSelector];
    [invocation invoke];
    aliasInvoked = YES;
    [invocation setSelector:entry.originalSelector];

    JSValue *onLeaveFn = entry.onLeave;
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

        if (newRetval && ![newRetval isUndefined] && retType[0] != 'v') {
            [WNTypeConversion setInvocationReturnValue:invocation fromJSValue:newRetval inContext:ctx];
        }
    }

    } @catch (NSException *exception) {
        NSLog(@"%@ Exception in handleHookedInvocation for %@: %@ reason: %@",
              kLogPrefix, entry.selectorKey, exception.name, exception.reason);
        if (!aliasInvoked) {
            @try {
                [invocation setSelector:entry.aliasSelector];
                [invocation invoke];
                [invocation setSelector:entry.originalSelector];
            } @catch (NSException *innerException) {
                NSLog(@"%@ Failed to call original after exception: %@", kLogPrefix, innerException);
            }
        }
    } @finally {
        @synchronized (g_reentrancyGuard) {
            [g_reentrancyGuard removeObject:guardKey];
        }
    }
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
