#import "WNNativeBridge.h"
#import "fishhook.h"
#import "WNBoxing.h"
#import <dlfcn.h>
#import <mach-o/dyld.h>
#import <objc/runtime.h>

static NSString *const kLogPrefix = @"[WNNativeBridge]";

#pragma mark - C Hook Registry

@interface WNCHookEntry : NSObject
@property (nonatomic, copy) NSString *symbol;
@property (nonatomic, assign) void *originalPtr;
@property (nonatomic, assign) BOOL active;
@end

@implementation WNCHookEntry
@end

static NSMutableDictionary<NSString *, WNCHookEntry *> *g_cHooks;

#pragma mark - Struct Definition Registry

@interface WNStructDef : NSObject
@property (nonatomic, copy) NSString *name;
@property (nonatomic, strong) NSArray<NSDictionary *> *fields;
@property (nonatomic, assign) NSUInteger totalSize;
@end

@implementation WNStructDef

- (instancetype)initWithName:(NSString *)name fields:(NSArray<NSDictionary *> *)fields {
    self = [super init];
    if (self) {
        _name = name;
        _fields = fields;
        _totalSize = 0;
        for (NSDictionary *field in fields) {
            _totalSize += [self sizeForType:field[@"type"]];
        }
    }
    return self;
}

- (NSUInteger)sizeForType:(NSString *)type {
    if ([type isEqualToString:@"int8"] || [type isEqualToString:@"uint8"] || [type isEqualToString:@"bool"]) return 1;
    if ([type isEqualToString:@"int16"] || [type isEqualToString:@"uint16"]) return 2;
    if ([type isEqualToString:@"int32"] || [type isEqualToString:@"uint32"] || [type isEqualToString:@"float"]) return 4;
    if ([type isEqualToString:@"int64"] || [type isEqualToString:@"uint64"] || [type isEqualToString:@"double"] || [type isEqualToString:@"pointer"]) return 8;
    return 0;
}

- (NSUInteger)offsetForFieldIndex:(NSUInteger)index {
    NSUInteger offset = 0;
    for (NSUInteger i = 0; i < index && i < self.fields.count; i++) {
        offset += [self sizeForType:self.fields[i][@"type"]];
    }
    return offset;
}

@end

static NSMutableDictionary<NSString *, WNStructDef *> *g_structDefs;

#pragma mark - Implementation

@implementation WNNativeBridge

+ (void)initialize {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        g_cHooks = [NSMutableDictionary new];
        g_structDefs = [NSMutableDictionary new];
    });
}

+ (void)registerInContext:(JSContext *)context {
    [self registerStructAPI:context];
    [self registerPointerAPI:context];
    [self registerModuleAPI:context];
    [self registerCHookAPI:context];
    NSLog(@"%@ APIs registered", kLogPrefix);
}

#pragma mark - $struct() API

+ (void)registerStructAPI:(JSContext *)context {
    // $struct(name, [{name: 'x', type: 'float'}, {name: 'y', type: 'float'}])
    context[@"$struct"] = ^JSValue *(NSString *name, JSValue *fieldsJS) {
        JSContext *ctx = [JSContext currentContext];
        if (!name || !fieldsJS || [fieldsJS isUndefined]) {
            return [JSValue valueWithUndefinedInContext:ctx];
        }

        NSArray *fieldsArray = [fieldsJS toArray];
        NSMutableArray<NSDictionary *> *fields = [NSMutableArray new];
        for (NSDictionary *f in fieldsArray) {
            NSString *fname = f[@"name"];
            NSString *ftype = f[@"type"];
            if (fname && ftype) {
                [fields addObject:@{@"name": fname, @"type": ftype}];
            }
        }

        WNStructDef *def = [[WNStructDef alloc] initWithName:name fields:fields];
        g_structDefs[name] = def;

        JSValue *constructor = [JSValue valueWithObject:^JSValue *(JSValue *initValues) {
            return [WNNativeBridge createStructInstance:def withValues:initValues inContext:[JSContext currentContext]];
        } inContext:ctx];

        constructor[@"size"] = @(def.totalSize);
        constructor[@"fields"] = fieldsArray;
        return constructor;
    };
}

+ (JSValue *)createStructInstance:(WNStructDef *)def withValues:(JSValue *)initValues inContext:(JSContext *)ctx {
    void *buffer = calloc(1, def.totalSize);
    if (!buffer) {
        return [JSValue valueWithUndefinedInContext:ctx];
    }

    if (initValues && ![initValues isUndefined] && ![initValues isNull]) {
        for (NSUInteger i = 0; i < def.fields.count; i++) {
            NSDictionary *field = def.fields[i];
            NSString *fname = field[@"name"];
            JSValue *val = initValues[fname];
            if (val && ![val isUndefined]) {
                NSUInteger offset = [def offsetForFieldIndex:i];
                [self writeValue:val type:field[@"type"] toBuffer:(uint8_t *)buffer + offset];
            }
        }
    }

    WNBoxing *box = [WNBoxing boxPointer:buffer];

    JSValue *instance = [JSValue valueWithNewObjectInContext:ctx];
    instance[@"_ptr"] = [JSValue valueWithObject:box inContext:ctx];
    instance[@"_structName"] = def.name;
    instance[@"_size"] = @(def.totalSize);

    for (NSUInteger i = 0; i < def.fields.count; i++) {
        NSDictionary *field = def.fields[i];
        NSString *fname = field[@"name"];
        NSString *ftype = field[@"type"];
        NSUInteger offset = [def offsetForFieldIndex:i];

        instance[fname] = [self readValueOfType:ftype fromBuffer:(uint8_t *)buffer + offset inContext:ctx];
    }

    instance[@"toPointer"] = ^JSValue *() {
        return [JSValue valueWithObject:box inContext:[JSContext currentContext]];
    };

    __block void *capturedBuffer = buffer;
    __block WNStructDef *capturedDef = def;
    instance[@"update"] = ^JSValue *(JSValue *newValues) {
        JSContext *c = [JSContext currentContext];
        JSValue *self2 = [c globalObject][@"this"];
        (void)self2;
        for (NSUInteger i = 0; i < capturedDef.fields.count; i++) {
            NSDictionary *f = capturedDef.fields[i];
            NSString *fn = f[@"name"];
            JSValue *v = newValues[fn];
            if (v && ![v isUndefined]) {
                NSUInteger off = [capturedDef offsetForFieldIndex:i];
                [WNNativeBridge writeValue:v type:f[@"type"] toBuffer:(uint8_t *)capturedBuffer + off];
            }
        }
        return [JSValue valueWithUndefinedInContext:c];
    };

    return instance;
}

+ (void)writeValue:(JSValue *)value type:(NSString *)type toBuffer:(uint8_t *)buf {
    if ([type isEqualToString:@"int8"]) {
        int8_t v = (int8_t)[value toInt32];
        memcpy(buf, &v, sizeof(v));
    } else if ([type isEqualToString:@"uint8"] || [type isEqualToString:@"bool"]) {
        uint8_t v = (uint8_t)[value toUInt32];
        memcpy(buf, &v, sizeof(v));
    } else if ([type isEqualToString:@"int16"]) {
        int16_t v = (int16_t)[value toInt32];
        memcpy(buf, &v, sizeof(v));
    } else if ([type isEqualToString:@"uint16"]) {
        uint16_t v = (uint16_t)[value toUInt32];
        memcpy(buf, &v, sizeof(v));
    } else if ([type isEqualToString:@"int32"]) {
        int32_t v = [value toInt32];
        memcpy(buf, &v, sizeof(v));
    } else if ([type isEqualToString:@"uint32"]) {
        uint32_t v = [value toUInt32];
        memcpy(buf, &v, sizeof(v));
    } else if ([type isEqualToString:@"int64"]) {
        int64_t v = (int64_t)[value toDouble];
        memcpy(buf, &v, sizeof(v));
    } else if ([type isEqualToString:@"uint64"]) {
        uint64_t v = (uint64_t)[value toDouble];
        memcpy(buf, &v, sizeof(v));
    } else if ([type isEqualToString:@"float"]) {
        float v = (float)[value toDouble];
        memcpy(buf, &v, sizeof(v));
    } else if ([type isEqualToString:@"double"]) {
        double v = [value toDouble];
        memcpy(buf, &v, sizeof(v));
    } else if ([type isEqualToString:@"pointer"]) {
        uintptr_t v = (uintptr_t)[value toDouble];
        memcpy(buf, &v, sizeof(v));
    }
}

+ (JSValue *)readValueOfType:(NSString *)type fromBuffer:(const uint8_t *)buf inContext:(JSContext *)ctx {
    if ([type isEqualToString:@"int8"]) {
        int8_t v; memcpy(&v, buf, sizeof(v));
        return [JSValue valueWithInt32:v inContext:ctx];
    } else if ([type isEqualToString:@"uint8"] || [type isEqualToString:@"bool"]) {
        uint8_t v; memcpy(&v, buf, sizeof(v));
        return [JSValue valueWithUInt32:v inContext:ctx];
    } else if ([type isEqualToString:@"int16"]) {
        int16_t v; memcpy(&v, buf, sizeof(v));
        return [JSValue valueWithInt32:v inContext:ctx];
    } else if ([type isEqualToString:@"uint16"]) {
        uint16_t v; memcpy(&v, buf, sizeof(v));
        return [JSValue valueWithUInt32:v inContext:ctx];
    } else if ([type isEqualToString:@"int32"]) {
        int32_t v; memcpy(&v, buf, sizeof(v));
        return [JSValue valueWithInt32:v inContext:ctx];
    } else if ([type isEqualToString:@"uint32"]) {
        uint32_t v; memcpy(&v, buf, sizeof(v));
        return [JSValue valueWithUInt32:v inContext:ctx];
    } else if ([type isEqualToString:@"int64"]) {
        int64_t v; memcpy(&v, buf, sizeof(v));
        return [JSValue valueWithDouble:(double)v inContext:ctx];
    } else if ([type isEqualToString:@"uint64"]) {
        uint64_t v; memcpy(&v, buf, sizeof(v));
        return [JSValue valueWithDouble:(double)v inContext:ctx];
    } else if ([type isEqualToString:@"float"]) {
        float v; memcpy(&v, buf, sizeof(v));
        return [JSValue valueWithDouble:v inContext:ctx];
    } else if ([type isEqualToString:@"double"]) {
        double v; memcpy(&v, buf, sizeof(v));
        return [JSValue valueWithDouble:v inContext:ctx];
    } else if ([type isEqualToString:@"pointer"]) {
        uintptr_t v; memcpy(&v, buf, sizeof(v));
        return [JSValue valueWithDouble:(double)v inContext:ctx];
    }
    return [JSValue valueWithUndefinedInContext:ctx];
}

#pragma mark - $pointer() API

+ (void)registerPointerAPI:(JSContext *)context {
    JSValue *ptrNS = [JSValue valueWithNewObjectInContext:context];

    // $pointer.read(address, type, count?)
    ptrNS[@"read"] = ^JSValue *(JSValue *addrJS, NSString *type, JSValue *countJS) {
        JSContext *ctx = [JSContext currentContext];
        uintptr_t addr = (uintptr_t)[addrJS toDouble];
        if (addr == 0) {
            return [JSValue valueWithUndefinedInContext:ctx];
        }

        int count = 1;
        if (countJS && ![countJS isUndefined]) {
            count = [countJS toInt32];
        }

        if ([type isEqualToString:@"utf8"]) {
            const char *str = (const char *)addr;
            return [JSValue valueWithObject:@(str) inContext:ctx];
        }

        if ([type isEqualToString:@"bytes"]) {
            NSData *data = [NSData dataWithBytes:(void *)addr length:count];
            NSMutableArray *arr = [NSMutableArray arrayWithCapacity:count];
            const uint8_t *bytes = data.bytes;
            for (int i = 0; i < count; i++) {
                [arr addObject:@(bytes[i])];
            }
            return [JSValue valueWithObject:arr inContext:ctx];
        }

        if (count == 1) {
            return [WNNativeBridge readValueOfType:type fromBuffer:(const uint8_t *)addr inContext:ctx];
        }

        WNStructDef *tempDef = [[WNStructDef alloc] initWithName:@"_temp" fields:@[@{@"name": @"v", @"type": type}]];
        NSUInteger elemSize = [tempDef sizeForType:type];
        NSMutableArray *results = [NSMutableArray arrayWithCapacity:count];
        for (int i = 0; i < count; i++) {
            JSValue *val = [WNNativeBridge readValueOfType:type fromBuffer:(const uint8_t *)(addr + i * elemSize) inContext:ctx];
            [results addObject:val];
        }
        return [JSValue valueWithObject:results inContext:ctx];
    };

    // $pointer.write(address, type, value)
    ptrNS[@"write"] = ^(JSValue *addrJS, NSString *type, JSValue *value) {
        uintptr_t addr = (uintptr_t)[addrJS toDouble];
        if (addr == 0) return;

        if ([type isEqualToString:@"utf8"]) {
            NSString *str = [value toString];
            const char *cstr = [str UTF8String];
            size_t len = strlen(cstr) + 1;
            memcpy((void *)addr, cstr, len);
            return;
        }

        [WNNativeBridge writeValue:value type:type toBuffer:(uint8_t *)addr];
    };

    // $pointer.alloc(size)
    ptrNS[@"alloc"] = ^JSValue *(int size) {
        void *ptr = calloc(1, size);
        WNBoxing *box = [WNBoxing boxPointer:ptr];
        JSContext *ctx = [JSContext currentContext];
        JSValue *result = [JSValue valueWithNewObjectInContext:ctx];
        result[@"address"] = [JSValue valueWithDouble:(double)(uintptr_t)ptr inContext:ctx];
        result[@"_box"] = [JSValue valueWithObject:box inContext:ctx];
        result[@"size"] = @(size);
        return result;
    };

    // $pointer.free(address)
    ptrNS[@"free"] = ^(JSValue *addrJS) {
        uintptr_t addr = (uintptr_t)[addrJS toDouble];
        if (addr != 0) {
            free((void *)addr);
        }
    };

    context[@"$pointer"] = ptrNS;
}

#pragma mark - Module API (dlsym, dlopen)

+ (void)registerModuleAPI:(JSContext *)context {
    JSValue *moduleNS = [JSValue valueWithNewObjectInContext:context];

    // Module.findExportByName(moduleName, symbolName)
    moduleNS[@"findExportByName"] = ^JSValue *(JSValue *moduleJS, NSString *symbolName) {
        JSContext *ctx = [JSContext currentContext];
        const char *moduleName = NULL;
        if (moduleJS && ![moduleJS isNull] && ![moduleJS isUndefined]) {
            moduleName = [[moduleJS toString] UTF8String];
        }

        void *handle = dlopen(moduleName, RTLD_NOLOAD);
        if (!handle) {
            handle = RTLD_DEFAULT;
        }

        void *sym = dlsym(handle, [symbolName UTF8String]);
        if (!sym) {
            return [JSValue valueWithUndefinedInContext:ctx];
        }

        return [JSValue valueWithDouble:(double)(uintptr_t)sym inContext:ctx];
    };

    // Module.enumerateExports(moduleName)
    moduleNS[@"enumerateExports"] = ^JSValue *(NSString *moduleName) {
        JSContext *ctx = [JSContext currentContext];
        NSMutableArray *exports = [NSMutableArray new];

        uint32_t count = _dyld_image_count();
        for (uint32_t i = 0; i < count; i++) {
            const char *name = _dyld_get_image_name(i);
            if (!name) continue;
            NSString *imgName = @(name);
            if (moduleName && ![imgName hasSuffix:moduleName] &&
                ![imgName containsString:moduleName]) {
                continue;
            }
            [exports addObject:@{
                @"path": imgName,
                @"index": @(i),
            }];
            break;
        }

        return [JSValue valueWithObject:exports inContext:ctx];
    };

    // Module.enumerateModules()
    moduleNS[@"enumerateModules"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        NSMutableArray *modules = [NSMutableArray new];
        uint32_t count = _dyld_image_count();
        for (uint32_t i = 0; i < count; i++) {
            const char *name = _dyld_get_image_name(i);
            if (!name) continue;
            intptr_t slide = _dyld_get_image_vmaddr_slide(i);
            const struct mach_header *header = _dyld_get_image_header(i);
            [modules addObject:@{
                @"name": @(name),
                @"base": [NSString stringWithFormat:@"0x%lx", (uintptr_t)header],
                @"slide": @(slide),
            }];
        }
        return [JSValue valueWithObject:modules inContext:ctx];
    };

    context[@"Module"] = moduleNS;
}

#pragma mark - C Function Hook (fishhook)

+ (void)registerCHookAPI:(JSContext *)context {
    JSValue *interceptorNS = context[@"Interceptor"];
    if (!interceptorNS || [interceptorNS isUndefined]) {
        interceptorNS = [JSValue valueWithNewObjectInContext:context];
        context[@"Interceptor"] = interceptorNS;
    }

    // Interceptor.rebindSymbol(symbolName) — returns original address
    // For C functions, since we can't create trampolines, we provide a mechanism
    // to rebind the GOT entry and return the saved original pointer.
    interceptorNS[@"rebindSymbol"] = ^JSValue *(NSString *symbolName) {
        JSContext *ctx = [JSContext currentContext];

        if (g_cHooks[symbolName]) {
            WNCHookEntry *existing = g_cHooks[symbolName];
            return [JSValue valueWithDouble:(double)(uintptr_t)existing.originalPtr inContext:ctx];
        }

        void *origPtr = dlsym(RTLD_DEFAULT, [symbolName UTF8String]);
        if (!origPtr) {
            NSLog(@"%@ Symbol not found: %@", kLogPrefix, symbolName);
            return [JSValue valueWithUndefinedInContext:ctx];
        }

        WNCHookEntry *entry = [WNCHookEntry new];
        entry.symbol = symbolName;
        entry.originalPtr = origPtr;
        entry.active = YES;
        g_cHooks[symbolName] = entry;

        NSLog(@"%@ Symbol resolved: %@ = %p", kLogPrefix, symbolName, origPtr);
        return [JSValue valueWithDouble:(double)(uintptr_t)origPtr inContext:ctx];
    };

    // Interceptor.hookCFunction(symbolName, replacementAddress)
    // Low-level: rebinds a C symbol to a replacement function pointer.
    // The replacement must be a compiled function pointer (from another library).
    interceptorNS[@"hookCFunction"] = ^JSValue *(NSString *symbolName, JSValue *replacementAddrJS) {
        JSContext *ctx = [JSContext currentContext];

        void *replacement = (void *)(uintptr_t)[replacementAddrJS toDouble];
        if (!replacement) {
            return [JSValue valueWithBool:NO inContext:ctx];
        }

        void *original = NULL;
        struct rebinding rb = {
            .name = [symbolName UTF8String],
            .replacement = replacement,
            .replaced = &original
        };

        int result = rebind_symbols((struct rebinding[]){rb}, 1);
        if (result != 0) {
            NSLog(@"%@ rebind_symbols failed for %@", kLogPrefix, symbolName);
            return [JSValue valueWithBool:NO inContext:ctx];
        }

        WNCHookEntry *entry = [WNCHookEntry new];
        entry.symbol = symbolName;
        entry.originalPtr = original;
        entry.active = YES;
        g_cHooks[symbolName] = entry;

        NSLog(@"%@ Hooked C function: %@ (original=%p)", kLogPrefix, symbolName, original);

        JSValue *resultObj = [JSValue valueWithNewObjectInContext:ctx];
        resultObj[@"success"] = @YES;
        resultObj[@"original"] = [JSValue valueWithDouble:(double)(uintptr_t)original inContext:ctx];
        return resultObj;
    };
}

#pragma mark - Active Hooks

+ (NSArray<NSString *> *)activeCHooks {
    NSMutableArray *result = [NSMutableArray new];
    [g_cHooks enumerateKeysAndObjectsUsingBlock:^(NSString *key, WNCHookEntry *entry, BOOL *stop) {
        if (entry.active) {
            [result addObject:[NSString stringWithFormat:@"C:%@ (orig=%p)", key, entry.originalPtr]];
        }
    }];
    return result;
}

@end
