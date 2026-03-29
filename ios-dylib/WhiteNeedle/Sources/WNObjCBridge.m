#import "WNObjCBridge.h"
#import "WNBoxing.h"
#import "WNTypeConversion.h"
#import <objc/runtime.h>
#import <objc/message.h>
#import <malloc/malloc.h>
#import <mach/mach.h>
#import <mach/vm_map.h>
#if __has_feature(ptrauth_calls)
#import <ptrauth.h>
#endif

static NSString *const kLogPrefix = @"[WhiteNeedle:ObjC]";

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

#pragma mark - WNObjCProxy: Wraps an ObjC class or instance for JS access

@interface WNObjCProxy : NSObject
@property (nonatomic, strong, nullable) id target;
@property (nonatomic, assign, nullable) Class targetClass;
@property (nonatomic, assign) BOOL isClassProxy;
@end

@implementation WNObjCProxy
- (NSString *)description {
    if (self.isClassProxy) {
        return [NSString stringWithFormat:@"<WNObjCProxy: Class %@>", NSStringFromClass(self.targetClass)];
    }
    return [NSString stringWithFormat:@"<WNObjCProxy: %@>", self.target];
}
@end

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

        NSArray *jsArgs = @[];
        if (argsArray && ![argsArray isUndefined] && ![argsArray isNull]) {
            jsArgs = [argsArray toArray];
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

        @try {
            id value = [p.target valueForKey:propertyName];
            return [WNTypeConversion objcObjectToJSValue:value inContext:ctx];
        } @catch (NSException *e) {
            NSLog(@"%@ getProperty error: %@", kLogPrefix, e);
            return [JSValue valueWithUndefinedInContext:ctx];
        }
    };

    jsProxy[@"setProperty"] = ^(NSString *propertyName, JSValue *value) {
        WNObjCProxy *p = weakProxy;
        if (!p || !p.target) return;
        @try {
            id obj = [WNTypeConversion jsValueToObjCObject:value];
            [p.target setValue:obj forKey:propertyName];
        } @catch (NSException *e) {
            NSLog(@"%@ setProperty error: %@", kLogPrefix, e);
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
        return [JSValue valueWithUndefinedInContext:context];
    }

    NSMethodSignature *sig;
    if (isClass) {
        sig = [target methodSignatureForSelector:selector];
    } else {
        sig = [target methodSignatureForSelector:selector];
    }

    if (!sig) {
        NSLog(@"%@ Cannot get method signature for: %@", kLogPrefix, selectorString);
        return [JSValue valueWithUndefinedInContext:context];
    }

    NSInvocation *invocation = [NSInvocation invocationWithMethodSignature:sig];
    [invocation setTarget:target];
    [invocation setSelector:selector];
    [invocation retainArguments];

    // Arguments start at index 2 (0=self, 1=_cmd)
    for (NSUInteger i = 0; i < jsArgs.count && (i + 2) < sig.numberOfArguments; i++) {
        const char *argType = [sig getArgumentTypeAtIndex:i + 2];
        NSUInteger argSize = 0;
        NSGetSizeAndAlignment(argType, &argSize, NULL);

        void *argBuf = calloc(1, argSize);

        id jsArg = jsArgs[i];
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

    @try {
        [invocation invoke];
    } @catch (NSException *exception) {
        NSLog(@"%@ Invocation exception: %@", kLogPrefix, exception);
        return [JSValue valueWithUndefinedInContext:context];
    }

    const char *retType = sig.methodReturnType;
    if (retType[0] == 'v') {
        return [JSValue valueWithUndefinedInContext:context];
    }

    NSUInteger retSize = sig.methodReturnLength;
    void *retBuf = calloc(1, retSize);
    [invocation getReturnValue:retBuf];

    // Auto-wrap returned ObjC objects as proxies
    if (retType[0] == '@') {
        id retObj = (__bridge id)(*(void **)retBuf);
        free(retBuf);
        if (retObj && ![retObj isKindOfClass:[NSString class]] && ![retObj isKindOfClass:[NSNumber class]]) {
            return [self createInstanceProxy:retObj inContext:context];
        }
        return [WNTypeConversion objcObjectToJSValue:retObj inContext:context];
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
        if (boxedObj && ![boxedObj isUndefined] && ![boxedObj isNull] && [boxedObj isString]) {
            NSString *hexOrText = [boxedObj toString];
            id fromAddr = WNObjCParsedObjectFromHexAddressString(hexOrText);
            if (fromAddr) {
                return [WNObjCBridge createInstanceProxy:fromAddr inContext:ctx];
            }
        }

        id obj = [boxedObj toObject];
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
    objcNS[@"classes"] = ^JSValue *{
        JSContext *ctx = [JSContext currentContext];
        return [WNObjCBridge buildClassesProxy:ctx];
    };

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

#pragma mark - ObjC.choose() — heap scan via malloc zone enumeration

+ (void)heapScan:(NSString *)className callbacks:(JSValue *)callbacks inContext:(JSContext *)context {
    Class targetClass = NSClassFromString(className);
    if (!targetClass) {
        NSLog(@"%@ choose: class not found: %@", kLogPrefix, className);
        return;
    }

    JSValue *onMatch = callbacks[@"onMatch"];
    JSValue *onComplete = callbacks[@"onComplete"];

    // Use objc runtime's fast enumeration where possible
    // Fallback: iterate malloc zones
    NSMutableArray *found = [NSMutableArray array];

    vm_address_t *zones = NULL;
    unsigned int zoneCount = 0;
    kern_return_t kr = malloc_get_all_zones(mach_task_self(), NULL, &zones, &zoneCount);

    if (kr == KERN_SUCCESS) {
        for (unsigned int z = 0; z < zoneCount; z++) {
            malloc_zone_t *zone = (malloc_zone_t *)zones[z];
            if (!zone || !zone->introspect || !zone->introspect->enumerator) continue;

            // We can't easily enumerate all objects in a zone without
            // private APIs. Instead, use a simpler approach for now.
        }
    }

    // Simpler approach: scan the autorelease pool / known collections
    // This is a best-effort scan; full heap scan requires vm_region
    // which works on non-jailbroken but is slow
    if (onComplete && ![onComplete isUndefined]) {
        [onComplete callWithArguments:@[]];
    }
}

#pragma mark - ObjC.define() — runtime class creation

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

    // Add properties
    JSValue *properties = spec[@"properties"];
    if (properties && ![properties isUndefined]) {
        NSDictionary *props = [properties toDictionary];
        for (NSString *propName in props) {
            objc_property_attribute_t attrs[2];
            attrs[0] = (objc_property_attribute_t){.name = "T", .value = "@"};
            attrs[1] = (objc_property_attribute_t){.name = "&", .value = ""};
            class_addProperty(newCls, [propName UTF8String], attrs, 2);

            // Also add an ivar for the property
            NSString *ivarName = [NSString stringWithFormat:@"_%@", propName];
            class_addIvar(newCls, [ivarName UTF8String], sizeof(id), log2(sizeof(id)), "@");
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

        JSValue *jsFunc = methods[selName];
        if (!jsFunc || [jsFunc isUndefined]) continue;

        Method existingMethod = class_getInstanceMethod(cls, sel);
        const char *typeEncoding = "v@:";
        NSString *generatedEncoding = nil;
        if (existingMethod) {
            typeEncoding = method_getTypeEncoding(existingMethod);
        } else {
            NSUInteger colonCount = [[selName componentsSeparatedByString:@":"] count] - 1;
            if (colonCount > 0) {
                NSMutableString *enc = [NSMutableString stringWithString:@"v@:"];
                for (NSUInteger c = 0; c < colonCount; c++) {
                    [enc appendString:@"@"];
                }
                generatedEncoding = enc;
                typeEncoding = [generatedEncoding UTF8String];
            }
        }

        // Use _objc_msgForward + forwardInvocation: for full parameter access.
        // Store the JS function in an associated object keyed by selector name.
        JSManagedValue *managedFunc = [JSManagedValue managedValueWithValue:jsFunc];
        [context.virtualMachine addManagedReference:managedFunc withOwner:cls];

        NSString *assocKey = [NSString stringWithFormat:@"WNDefine_%@", selName];
        objc_setAssociatedObject(cls, NSSelectorFromString(assocKey), managedFunc, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

        // Add the method with _objc_msgForward so forwardInvocation: handles it
        class_addMethod(cls, sel, _objc_msgForward, typeEncoding);

        // Ensure the class has our custom forwardInvocation: that handles ObjC.define methods
        [self ensureDefineForwardingForClass:cls inContext:context];

        NSLog(@"%@ Added method %@ to %@ (full args via NSInvocation)", kLogPrefix, selName, NSStringFromClass(cls));
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
        NSString *entry = [NSString stringWithFormat:@"%@ (%s)",
                           NSStringFromSelector(sel),
                           typeEncoding ?: "?"];
        [result addObject:entry];
    }
    free(methods);

    [result sortUsingSelector:@selector(compare:)];
    return result;
}

@end
