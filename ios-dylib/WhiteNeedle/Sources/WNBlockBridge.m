#import "WNBlockBridge.h"
#import "WNBoxing.h"
#import "WNTypeConversion.h"
#import "WNObjCBridge.h"
#import <objc/runtime.h>

static NSString *const kLogPrefix = @"[WhiteNeedle:Block]";

#pragma mark - Block internal layout (ARM64 ABI)

// Matches the internal layout of ObjC blocks.
// See: https://clang.llvm.org/docs/Block-ABI-Apple.html
struct WNBlockLayout {
    void *isa;
    int flags;
    int reserved;
    void (*invoke)(void *, ...);
    void *descriptor;
};

static const char *wn_blockTypeEncoding(id block) {
    if (!block) return NULL;
    struct WNBlockLayout *layout = (__bridge struct WNBlockLayout *)block;

    // BLOCK_HAS_SIGNATURE = 1 << 30
    if (!(layout->flags & (1 << 30))) return NULL;

    const uint8_t *desc = (const uint8_t *)layout->descriptor;
    if (!desc) return NULL;
    size_t offset = 2 * sizeof(unsigned long); // skip reserved + size

    // BLOCK_HAS_COPY_DISPOSE = 1 << 25 → two extra function pointers
    if (layout->flags & (1 << 25)) {
        offset += 2 * sizeof(void *);
    }

    return *(const char **)(desc + offset);
}

@implementation WNBlockBridge

#pragma mark - Block template creation

// On ARM64, all integer/pointer types are passed in X registers (8 bytes each).
// We use void* for universal compatibility with id, BOOL, int, long, NSInteger, etc.
// Double/float arguments use D registers and need separate templates.

// Helper: convert a single raw arg to JSValue based on type encoding
static JSValue *rawArgToJSValue(const char *type, void *raw, JSContext *ctx) {
    char t = type[0];
    // Skip qualifiers
    while (t == 'r' || t == 'n' || t == 'N' || t == 'o' || t == 'O' || t == 'R' || t == 'V') {
        type++;
        t = type[0];
    }

    switch (t) {
        case '@': {
            id obj = (__bridge id)raw;
            if (!obj) return [JSValue valueWithNullInContext:ctx];
            return [WNTypeConversion objcObjectToJSValue:obj inContext:ctx];
        }
        case 'B': return [JSValue valueWithBool:(BOOL)(uintptr_t)raw inContext:ctx];
        case 'c': return [JSValue valueWithInt32:(int)(char)(uintptr_t)raw inContext:ctx];
        case 'C': return [JSValue valueWithUInt32:(unsigned int)(unsigned char)(uintptr_t)raw inContext:ctx];
        case 'i': return [JSValue valueWithInt32:(int)(uintptr_t)raw inContext:ctx];
        case 'I': return [JSValue valueWithUInt32:(unsigned int)(uintptr_t)raw inContext:ctx];
        case 's': return [JSValue valueWithInt32:(int)(short)(uintptr_t)raw inContext:ctx];
        case 'S': return [JSValue valueWithUInt32:(unsigned int)(unsigned short)(uintptr_t)raw inContext:ctx];
        case 'l': return [JSValue valueWithInt32:(int)(long)(uintptr_t)raw inContext:ctx];
        case 'L': return [JSValue valueWithUInt32:(unsigned int)(unsigned long)(uintptr_t)raw inContext:ctx];
        case 'q': return [JSValue valueWithDouble:(double)(long long)(uintptr_t)raw inContext:ctx];
        case 'Q': return [JSValue valueWithDouble:(double)(unsigned long long)(uintptr_t)raw inContext:ctx];
        case '#': {
            Class cls = (__bridge Class)raw;
            if (!cls) return [JSValue valueWithNullInContext:ctx];
            return [JSValue valueWithObject:NSStringFromClass(cls) inContext:ctx];
        }
        case ':': {
            SEL sel = (SEL)raw;
            if (!sel) return [JSValue valueWithNullInContext:ctx];
            return [JSValue valueWithObject:NSStringFromSelector(sel) inContext:ctx];
        }
        case '^': {
            WNBoxing *box = [WNBoxing boxPointer:raw];
            return [JSValue valueWithObject:box inContext:ctx];
        }
        default:
            return [JSValue valueWithNullInContext:ctx];
    }
}

#pragma mark - Parse block type encoding into argument types

// Block type encoding: return_type block_self(=@?) arg1 arg2 ...
// We need to extract individual argument types after "@?"
+ (NSArray<NSString *> *)parseBlockArgTypes:(NSString *)typeEncoding {
    const char *enc = [typeEncoding UTF8String];
    if (!enc) return @[];

    NSMutableArray *argTypes = [NSMutableArray array];
    const char *p = enc;

    // Skip return type
    p = [self skipOneType:p];
    // Skip "@?" (the block itself)
    if (*p == '@' && *(p + 1) == '?') {
        p += 2;
    } else if (*p == '@') {
        p++;
    }

    // Parse remaining argument types
    while (*p && *p != '\0') {
        const char *start = p;
        p = [self skipOneType:p];
        if (p > start) {
            NSString *argType = [[NSString alloc] initWithBytes:start
                                                         length:(p - start)
                                                       encoding:NSUTF8StringEncoding];
            [argTypes addObject:argType];
        }
    }

    return argTypes;
}

+ (const char *)skipOneType:(const char *)p {
    if (!p || !*p) return p;

    // Skip qualifiers
    while (*p == 'r' || *p == 'n' || *p == 'N' || *p == 'o' || *p == 'O' ||
           *p == 'R' || *p == 'V') {
        p++;
    }

    switch (*p) {
        case '@':
            p++;
            if (*p == '?') p++; // block type @?
            if (*p == '"') {    // @"ClassName"
                p++;
                while (*p && *p != '"') p++;
                if (*p == '"') p++;
            }
            break;
        case '^':
            p++;
            p = [self skipOneType:p]; // skip pointed-to type
            break;
        case '{': {
            p++;
            int depth = 1;
            while (*p && depth > 0) {
                if (*p == '{') depth++;
                else if (*p == '}') depth--;
                p++;
            }
            break;
        }
        case '(':  {
            p++;
            int depth = 1;
            while (*p && depth > 0) {
                if (*p == '(') depth++;
                else if (*p == ')') depth--;
                p++;
            }
            break;
        }
        case '[': {
            p++;
            while (*p && *p != ']') p++;
            if (*p == ']') p++;
            break;
        }
        case 'b': // bit field: bN
            p++;
            while (*p >= '0' && *p <= '9') p++;
            break;
        default:
            if (*p) p++;
            break;
    }

    // Skip embedded numbers (stack offsets in method type strings)
    while (*p >= '0' && *p <= '9') p++;

    return p;
}

+ (char)returnTypeFromEncoding:(NSString *)typeEncoding {
    const char *enc = [typeEncoding UTF8String];
    if (!enc) return 'v';

    // Skip qualifiers
    while (*enc == 'r' || *enc == 'n' || *enc == 'N' || *enc == 'o' || *enc == 'O' ||
           *enc == 'R' || *enc == 'V') {
        enc++;
    }
    return *enc;
}

#pragma mark - $block() — Create ObjC block from JS function

+ (nullable id)blockFromJSFunction:(JSValue *)fn typeEncoding:(NSString *)typeEncoding {
    if (!fn || [fn isUndefined] || [fn isNull]) return nil;

    NSArray<NSString *> *argTypes = [self parseBlockArgTypes:typeEncoding];
    char retType = [self returnTypeFromEncoding:typeEncoding];
    NSUInteger argCount = argTypes.count;
    BOOL hasDoubleArg = NO;

    for (NSString *at in argTypes) {
        char t = [at UTF8String][0];
        if (t == 'd' || t == 'f') { hasDoubleArg = YES; break; }
    }

    // Determine which template to use
    if (hasDoubleArg) {
        return [self createDoubleArgBlock:fn argTypes:argTypes retType:retType];
    }

    // All-integer/pointer arguments: use void* templates
    switch (argCount) {
        case 0: return [self createPBlock0:fn retType:retType];
        case 1: return [self createPBlock1:fn argType:argTypes[0] retType:retType];
        case 2: return [self createPBlock2:fn argTypes:argTypes retType:retType];
        case 3: return [self createPBlock3:fn argTypes:argTypes retType:retType];
        case 4: return [self createPBlock4:fn argTypes:argTypes retType:retType];
        case 5: return [self createPBlock5:fn argTypes:argTypes retType:retType];
        case 6: return [self createPBlock6:fn argTypes:argTypes retType:retType];
        default:
            NSLog(@"%@ Unsupported block arity: %lu", kLogPrefix, (unsigned long)argCount);
            return nil;
    }
}

// Helper: convert block result from JSValue to void* for return
static void *jsValueToRawReturn(JSValue *result, char retType) {
    switch (retType) {
        case '@': {
            id obj = [WNTypeConversion jsValueToObjCObject:result];
            return (__bridge_retained void *)obj;
        }
        case 'B': return (void *)(uintptr_t)[result toBool];
        case 'i': return (void *)(uintptr_t)(int)[result toInt32];
        case 'I': return (void *)(uintptr_t)(unsigned int)[result toUInt32];
        case 'q': return (void *)(uintptr_t)(long long)[result toDouble];
        case 'Q': return (void *)(uintptr_t)(unsigned long long)[result toDouble];
        default: return NULL;
    }
}

#pragma mark - Block templates: 0-6 pointer args

+ (id)createPBlock0:(JSValue *)fn retType:(char)retType {
    if (retType == 'v') {
        return [^{
            [fn callWithArguments:@[]];
        } copy];
    }
    return [^void *(void) {
        JSValue *result = [fn callWithArguments:@[]];
        return jsValueToRawReturn(result, retType);
    } copy];
}

+ (id)createPBlock1:(JSValue *)fn argType:(NSString *)argType retType:(char)retType {
    const char *at = [argType UTF8String];
    if (retType == 'v') {
        return [^(void *a0) {
            JSContext *ctx = fn.context;
            JSValue *js0 = rawArgToJSValue(at, a0, ctx);
            [fn callWithArguments:@[js0]];
        } copy];
    }
    return [^void *(void *a0) {
        JSContext *ctx = fn.context;
        JSValue *js0 = rawArgToJSValue(at, a0, ctx);
        JSValue *result = [fn callWithArguments:@[js0]];
        return jsValueToRawReturn(result, retType);
    } copy];
}

+ (id)createPBlock2:(JSValue *)fn argTypes:(NSArray<NSString *> *)argTypes retType:(char)retType {
    const char *at0 = [argTypes[0] UTF8String];
    const char *at1 = [argTypes[1] UTF8String];
    if (retType == 'v') {
        return [^(void *a0, void *a1) {
            JSContext *ctx = fn.context;
            [fn callWithArguments:@[rawArgToJSValue(at0, a0, ctx),
                                    rawArgToJSValue(at1, a1, ctx)]];
        } copy];
    }
    return [^void *(void *a0, void *a1) {
        JSContext *ctx = fn.context;
        JSValue *result = [fn callWithArguments:@[rawArgToJSValue(at0, a0, ctx),
                                                  rawArgToJSValue(at1, a1, ctx)]];
        return jsValueToRawReturn(result, retType);
    } copy];
}

+ (id)createPBlock3:(JSValue *)fn argTypes:(NSArray<NSString *> *)argTypes retType:(char)retType {
    const char *at0 = [argTypes[0] UTF8String];
    const char *at1 = [argTypes[1] UTF8String];
    const char *at2 = [argTypes[2] UTF8String];
    if (retType == 'v') {
        return [^(void *a0, void *a1, void *a2) {
            JSContext *ctx = fn.context;
            [fn callWithArguments:@[rawArgToJSValue(at0, a0, ctx),
                                    rawArgToJSValue(at1, a1, ctx),
                                    rawArgToJSValue(at2, a2, ctx)]];
        } copy];
    }
    return [^void *(void *a0, void *a1, void *a2) {
        JSContext *ctx = fn.context;
        JSValue *result = [fn callWithArguments:@[rawArgToJSValue(at0, a0, ctx),
                                                  rawArgToJSValue(at1, a1, ctx),
                                                  rawArgToJSValue(at2, a2, ctx)]];
        return jsValueToRawReturn(result, retType);
    } copy];
}

+ (id)createPBlock4:(JSValue *)fn argTypes:(NSArray<NSString *> *)argTypes retType:(char)retType {
    const char *at0 = [argTypes[0] UTF8String];
    const char *at1 = [argTypes[1] UTF8String];
    const char *at2 = [argTypes[2] UTF8String];
    const char *at3 = [argTypes[3] UTF8String];
    if (retType == 'v') {
        return [^(void *a0, void *a1, void *a2, void *a3) {
            JSContext *ctx = fn.context;
            [fn callWithArguments:@[rawArgToJSValue(at0, a0, ctx),
                                    rawArgToJSValue(at1, a1, ctx),
                                    rawArgToJSValue(at2, a2, ctx),
                                    rawArgToJSValue(at3, a3, ctx)]];
        } copy];
    }
    return [^void *(void *a0, void *a1, void *a2, void *a3) {
        JSContext *ctx = fn.context;
        JSValue *result = [fn callWithArguments:@[rawArgToJSValue(at0, a0, ctx),
                                                  rawArgToJSValue(at1, a1, ctx),
                                                  rawArgToJSValue(at2, a2, ctx),
                                                  rawArgToJSValue(at3, a3, ctx)]];
        return jsValueToRawReturn(result, retType);
    } copy];
}

+ (id)createPBlock5:(JSValue *)fn argTypes:(NSArray<NSString *> *)argTypes retType:(char)retType {
    const char *at0 = [argTypes[0] UTF8String];
    const char *at1 = [argTypes[1] UTF8String];
    const char *at2 = [argTypes[2] UTF8String];
    const char *at3 = [argTypes[3] UTF8String];
    const char *at4 = [argTypes[4] UTF8String];
    if (retType == 'v') {
        return [^(void *a0, void *a1, void *a2, void *a3, void *a4) {
            JSContext *ctx = fn.context;
            [fn callWithArguments:@[rawArgToJSValue(at0, a0, ctx),
                                    rawArgToJSValue(at1, a1, ctx),
                                    rawArgToJSValue(at2, a2, ctx),
                                    rawArgToJSValue(at3, a3, ctx),
                                    rawArgToJSValue(at4, a4, ctx)]];
        } copy];
    }
    return [^void *(void *a0, void *a1, void *a2, void *a3, void *a4) {
        JSContext *ctx = fn.context;
        JSValue *result = [fn callWithArguments:@[rawArgToJSValue(at0, a0, ctx),
                                                  rawArgToJSValue(at1, a1, ctx),
                                                  rawArgToJSValue(at2, a2, ctx),
                                                  rawArgToJSValue(at3, a3, ctx),
                                                  rawArgToJSValue(at4, a4, ctx)]];
        return jsValueToRawReturn(result, retType);
    } copy];
}

+ (id)createPBlock6:(JSValue *)fn argTypes:(NSArray<NSString *> *)argTypes retType:(char)retType {
    const char *at0 = [argTypes[0] UTF8String];
    const char *at1 = [argTypes[1] UTF8String];
    const char *at2 = [argTypes[2] UTF8String];
    const char *at3 = [argTypes[3] UTF8String];
    const char *at4 = [argTypes[4] UTF8String];
    const char *at5 = [argTypes[5] UTF8String];
    if (retType == 'v') {
        return [^(void *a0, void *a1, void *a2, void *a3, void *a4, void *a5) {
            JSContext *ctx = fn.context;
            [fn callWithArguments:@[rawArgToJSValue(at0, a0, ctx),
                                    rawArgToJSValue(at1, a1, ctx),
                                    rawArgToJSValue(at2, a2, ctx),
                                    rawArgToJSValue(at3, a3, ctx),
                                    rawArgToJSValue(at4, a4, ctx),
                                    rawArgToJSValue(at5, a5, ctx)]];
        } copy];
    }
    return [^void *(void *a0, void *a1, void *a2, void *a3, void *a4, void *a5) {
        JSContext *ctx = fn.context;
        JSValue *result = [fn callWithArguments:@[rawArgToJSValue(at0, a0, ctx),
                                                  rawArgToJSValue(at1, a1, ctx),
                                                  rawArgToJSValue(at2, a2, ctx),
                                                  rawArgToJSValue(at3, a3, ctx),
                                                  rawArgToJSValue(at4, a4, ctx),
                                                  rawArgToJSValue(at5, a5, ctx)]];
        return jsValueToRawReturn(result, retType);
    } copy];
}

#pragma mark - Block templates with double arguments

+ (nullable id)createDoubleArgBlock:(JSValue *)fn
                           argTypes:(NSArray<NSString *> *)argTypes
                            retType:(char)retType {
    NSUInteger count = argTypes.count;

    // Common patterns: void(^)(double), void(^)(id, double), void(^)(double, id)
    if (count == 1) {
        char t0 = [argTypes[0] UTF8String][0];
        if (t0 == 'd') {
            if (retType == 'v') {
                return [^(double a0) {
                    [fn callWithArguments:@[@(a0)]];
                } copy];
            }
            return [^double(double a0) {
                JSValue *r = [fn callWithArguments:@[@(a0)]];
                return [r toDouble];
            } copy];
        }
        if (t0 == 'f') {
            if (retType == 'v') {
                return [^(float a0) {
                    [fn callWithArguments:@[@(a0)]];
                } copy];
            }
            return [^float(float a0) {
                JSValue *r = [fn callWithArguments:@[@(a0)]];
                return (float)[r toDouble];
            } copy];
        }
    }

    if (count == 2) {
        char t0 = [argTypes[0] UTF8String][0];
        char t1 = [argTypes[1] UTF8String][0];
        const char *at0 = [argTypes[0] UTF8String];
        const char *at1 = [argTypes[1] UTF8String];

        BOOL d0 = (t0 == 'd' || t0 == 'f');
        BOOL d1 = (t1 == 'd' || t1 == 'f');

        if (!d0 && d1 && retType == 'v') {
            // void(^)(ptr, double)
            return [^(void *a0, double a1) {
                JSContext *ctx = fn.context;
                [fn callWithArguments:@[rawArgToJSValue(at0, a0, ctx), @(a1)]];
            } copy];
        }
        if (d0 && !d1 && retType == 'v') {
            // void(^)(double, ptr)
            return [^(double a0, void *a1) {
                JSContext *ctx = fn.context;
                [fn callWithArguments:@[@(a0), rawArgToJSValue(at1, a1, ctx)]];
            } copy];
        }
        if (d0 && d1 && retType == 'v') {
            // void(^)(double, double)
            return [^(double a0, double a1) {
                [fn callWithArguments:@[@(a0), @(a1)]];
            } copy];
        }
    }

    NSLog(@"%@ Unsupported block signature with double args. argTypes=%@, retType=%c",
          kLogPrefix, argTypes, retType);
    return nil;
}

#pragma mark - $callBlock() — Invoke ObjC block from JS using NSInvocation

+ (nullable JSValue *)callBlock:(id)block
                       withArgs:(NSArray<JSValue *> *)args
                   typeEncoding:(nullable NSString *)typeEncoding
                      inContext:(JSContext *)context {
    if (!block) return [JSValue valueWithNullInContext:context];

    NSMethodSignature *sig = nil;

    if (typeEncoding && typeEncoding.length > 0) {
        sig = [NSMethodSignature signatureWithObjCTypes:[typeEncoding UTF8String]];
    }

    // Try to get signature from block itself
    if (!sig) {
        @try {
            sig = [NSMethodSignature signatureWithObjCTypes:"v@?"];
        } @catch (NSException *e) {
            // fallback
        }
    }

    if (!sig) {
        NSLog(@"%@ Cannot determine block signature", kLogPrefix);
        return [JSValue valueWithNullInContext:context];
    }

    NSInvocation *invocation = [NSInvocation invocationWithMethodSignature:sig];
    [invocation setTarget:block];
    [invocation retainArguments];

    // Arguments: index 0 = block (self), visible args start at index 1
    for (NSUInteger i = 0; i < args.count && (i + 1) < sig.numberOfArguments; i++) {
        const char *argType = [sig getArgumentTypeAtIndex:i + 1];
        NSUInteger argSize = 0;
        NSGetSizeAndAlignment(argType, &argSize, NULL);

        void *argBuf = calloc(1, argSize);
        [WNTypeConversion convertJSValue:args[i] toTypeEncoding:argType buffer:argBuf inContext:context];
        [invocation setArgument:argBuf atIndex:i + 1];
        free(argBuf);
    }

    @try {
        [invocation invoke];
    } @catch (NSException *e) {
        NSLog(@"%@ Block invocation exception: %@", kLogPrefix, e);
        return [JSValue valueWithNullInContext:context];
    }

    const char *retType = sig.methodReturnType;
    if (retType[0] == 'v') {
        return [JSValue valueWithUndefinedInContext:context];
    }

    NSUInteger retSize = sig.methodReturnLength;
    void *retBuf = calloc(1, retSize);
    [invocation getReturnValue:retBuf];
    JSValue *result = [WNTypeConversion convertToJSValue:retBuf typeEncoding:retType inContext:context];
    free(retBuf);

    return result;
}

#pragma mark - Register JS APIs

+ (void)registerInContext:(JSContext *)context {
    // $block(fn, typeEncoding) — create ObjC block from JS function
    context[@"$block"] = ^JSValue *(JSValue *fn, NSString *typeEncoding) {
        id block = [WNBlockBridge blockFromJSFunction:fn typeEncoding:typeEncoding];
        if (!block) {
            NSLog(@"%@ Failed to create block for encoding: %@", kLogPrefix, typeEncoding);
            return [JSValue valueWithNullInContext:[JSContext currentContext]];
        }
        WNBoxing *box = [WNBoxing boxObject:block];
        return [JSValue valueWithObject:box inContext:[JSContext currentContext]];
    };

    // $callBlock(block, typeEncoding, arg1, arg2, ...)
    context[@"$callBlock"] = ^JSValue *(JSValue *blockVal, NSString *typeEncoding) {
        JSContext *ctx = [JSContext currentContext];
        NSArray<JSValue *> *allArgs = [JSContext currentArguments];
        NSMutableArray<JSValue *> *callArgs = [NSMutableArray array];

        // Skip first two arguments (blockVal and typeEncoding)
        for (NSUInteger i = 2; i < allArgs.count; i++) {
            [callArgs addObject:allArgs[i]];
        }

        id block = nil;
        id rawObj = [blockVal toObject];
        if ([rawObj isKindOfClass:[WNBoxing class]]) {
            block = [(WNBoxing *)rawObj unbox];
        } else {
            block = rawObj;
        }

        return [WNBlockBridge callBlock:block
                               withArgs:callArgs
                           typeEncoding:typeEncoding
                              inContext:ctx];
    };

    NSLog(@"%@ Block bridge registered ($block, $callBlock)", kLogPrefix);
}

@end
