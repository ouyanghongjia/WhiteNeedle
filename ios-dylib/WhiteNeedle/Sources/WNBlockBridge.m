#import "WNBlockBridge.h"
#import "WNBlockSignatureParser.h"
#import "WNBlockWrapper.h"
#import "WNBoxing.h"
#import "WNTypeConversion.h"
#import "WNObjCBridge.h"
#import <objc/runtime.h>
#import <CoreGraphics/CoreGraphics.h>

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

/// Full first type in a block encoding (e.g. `{CGRect=...}`), not just one character.
+ (NSString *)returnTypeSubstringFromBlockEncoding:(NSString *)typeEncoding {
    const char *enc = [typeEncoding UTF8String];
    if (!enc) return @"v";
    while (*enc == 'r' || *enc == 'n' || *enc == 'N' || *enc == 'o' || *enc == 'O' ||
           *enc == 'R' || *enc == 'V') {
        enc++;
    }
    const char *start = enc;
    const char *end = [self skipOneType:start];
    if (end <= start) return @"v";
    return [[NSString alloc] initWithBytes:start length:(NSUInteger)(end - start) encoding:NSUTF8StringEncoding];
}

static char wn_firstTypeChar(NSString *typeStr) {
    const char *enc = typeStr.length ? typeStr.UTF8String : "v";
    while (*enc == 'r' || *enc == 'n' || *enc == 'N' || *enc == 'o' || *enc == 'O' ||
           *enc == 'R' || *enc == 'V') {
        enc++;
    }
    return enc[0] ? enc[0] : 'v';
}

static CGRect wn_rectFromJSValue(JSValue *res, JSContext *ctx) {
    CGRect r = CGRectZero;
    [WNTypeConversion convertJSValue:res toTypeEncoding:@encode(CGRect) buffer:&r inContext:ctx];
    return r;
}

static CGPoint wn_pointFromJSValue(JSValue *res, JSContext *ctx) {
    CGPoint p = CGPointZero;
    [WNTypeConversion convertJSValue:res toTypeEncoding:@encode(CGPoint) buffer:&p inContext:ctx];
    return p;
}

static CGSize wn_sizeFromJSValue(JSValue *res, JSContext *ctx) {
    CGSize s = CGSizeZero;
    [WNTypeConversion convertJSValue:res toTypeEncoding:@encode(CGSize) buffer:&s inContext:ctx];
    return s;
}

/// Exactly one CGRect/CGPoint/CGSize parameter; all others must be `id` (`@`).
static BOOL wn_singleGeomParam(NSArray<NSString *> *argTypes,
                               NSString *eRect,
                               NSString *ePoint,
                               NSString *eSize,
                               NSUInteger *outIdx,
                               NSString *__strong *outGeom) {
    NSUInteger found = NSNotFound;
    NSString *g = nil;
    for (NSUInteger i = 0; i < argTypes.count; i++) {
        NSString *t = argTypes[i];
        if ([t isEqualToString:eRect] || [t isEqualToString:ePoint] || [t isEqualToString:eSize]) {
            if (found != NSNotFound) {
                return NO;
            }
            found = i;
            g = t;
        } else if (![t isEqualToString:@"@"]) {
            return NO;
        }
    }
    if (found == NSNotFound) {
        return NO;
    }
    *outIdx = found;
    *outGeom = g;
    return YES;
}

#pragma mark - $block() — Create ObjC block from JS function

+ (nullable id)blockFromJSFunction:(JSValue *)fn typeEncoding:(NSString *)typeEncoding {
    if (!fn || [fn isUndefined] || [fn isNull]) return nil;

    WNBlockWrapper *wrapper = [[WNBlockWrapper alloc] initWithTypeEncoding:typeEncoding
                                                         callbackFunction:fn];
    void *ptr = [wrapper blockPtr];
    if (!ptr) {
        NSLog(@"%@ Failed to create block via ffi for encoding: %@", kLogPrefix, typeEncoding);
        return nil;
    }

    id block = (__bridge id)ptr;
    objc_setAssociatedObject(block, "WNBlockWrapper", wrapper, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    return block;
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

+ (nullable id)createStructArgBlock:(JSValue *)fn
                           argTypes:(NSArray<NSString *> *)argTypes
                 fullReturnEncoding:(NSString *)fullReturnEncoding {
    NSString *eRect = [NSString stringWithUTF8String:@encode(CGRect)];
    NSString *ePoint = [NSString stringWithUTF8String:@encode(CGPoint)];
    NSString *eSize = [NSString stringWithUTF8String:@encode(CGSize)];
    NSUInteger geomIdx = NSNotFound;
    NSString *geomEnc = nil;
    if (!wn_singleGeomParam(argTypes, eRect, ePoint, eSize, &geomIdx, &geomEnc)) {
        NSLog(@"%@ Struct-arg $block: need exactly one CGRect/CGPoint/CGSize and only id for other parameters (argTypes=%@)",
              kLogPrefix, argTypes);
        return nil;
    }

    NSUInteger n = argTypes.count;
    if (n < 1 || n > 4) {
        NSLog(@"%@ Struct-arg $block: unsupported arity %lu (supported 1–4 with one geometry struct)", kLogPrefix, (unsigned long)n);
        return nil;
    }

    char r0 = wn_firstTypeChar(fullReturnEncoding);
    BOOL retStructOk = [fullReturnEncoding isEqualToString:geomEnc];
    if (r0 == '{' && !retStructOk) {
        NSLog(@"%@ Struct-arg $block: return struct must match the struct parameter encoding", kLogPrefix);
        return nil;
    }

#define WN_2_CALL_RECT(O_, R_)                                                                               \
    JSContext *ctx = fn.context;                                                                           \
    JSValue *j0 = rawArgToJSValue("@", (__bridge void *)(O_), ctx);                                       \
    JSValue *j1 = [WNTypeConversion convertToJSValue:&(R_) typeEncoding:eRect.UTF8String inContext:ctx];   \
    JSValue *res = [fn callWithArguments:@[j0, j1]];

#define WN_2_CALL_RECT_FIRST(R_, O_)                                                                       \
    JSContext *ctx = fn.context;                                                                         \
    JSValue *j0 = [WNTypeConversion convertToJSValue:&(R_) typeEncoding:eRect.UTF8String inContext:ctx]; \
    JSValue *j1 = rawArgToJSValue("@", (__bridge void *)(O_), ctx);                                      \
    JSValue *res = [fn callWithArguments:@[j0, j1]];

#define WN_2_CALL_PT(O_, P_)                                                                               \
    JSContext *ctx = fn.context;                                                                         \
    JSValue *j0 = rawArgToJSValue("@", (__bridge void *)(O_), ctx);                                      \
    JSValue *j1 = [WNTypeConversion convertToJSValue:&(P_) typeEncoding:ePoint.UTF8String inContext:ctx];   \
    JSValue *res = [fn callWithArguments:@[j0, j1]];

#define WN_2_CALL_PT_FIRST(P_, O_)                                                                       \
    JSContext *ctx = fn.context;                                                                       \
    JSValue *j0 = [WNTypeConversion convertToJSValue:&(P_) typeEncoding:ePoint.UTF8String inContext:ctx]; \
    JSValue *j1 = rawArgToJSValue("@", (__bridge void *)(O_), ctx);                                     \
    JSValue *res = [fn callWithArguments:@[j0, j1]];

#define WN_2_CALL_SZ(O_, S_)                                                                            \
    JSContext *ctx = fn.context;                                                                        \
    JSValue *j0 = rawArgToJSValue("@", (__bridge void *)(O_), ctx);                                    \
    JSValue *j1 = [WNTypeConversion convertToJSValue:&(S_) typeEncoding:eSize.UTF8String inContext:ctx]; \
    JSValue *res = [fn callWithArguments:@[j0, j1]];

#define WN_2_CALL_SZ_FIRST(S_, O_)                                                                       \
    JSContext *ctx = fn.context;                                                                       \
    JSValue *j0 = [WNTypeConversion convertToJSValue:&(S_) typeEncoding:eSize.UTF8String inContext:ctx]; \
    JSValue *j1 = rawArgToJSValue("@", (__bridge void *)(O_), ctx);                                    \
    JSValue *res = [fn callWithArguments:@[j0, j1]];

    if (n == 1 && geomIdx == 0) {
        if ([geomEnc isEqualToString:eRect]) {
            if (r0 == 'v') {
                return [^(CGRect r) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:ctx];
                    [fn callWithArguments:@[js]];
                } copy];
            }
            if (r0 == '@') {
                return [^id(CGRect r) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:ctx];
                    JSValue *out = [fn callWithArguments:@[js]];
                    return [WNTypeConversion jsValueToObjCObject:out];
                } copy];
            }
            if (r0 == 'B') {
                return [^BOOL(CGRect r) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:ctx];
                    return [[fn callWithArguments:@[js]] toBool];
                } copy];
            }
            if (r0 == 'i') {
                return [^int(CGRect r) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:ctx];
                    return (int)[[fn callWithArguments:@[js]] toInt32];
                } copy];
            }
            if (r0 == 'I') {
                return [^unsigned int(CGRect r) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:ctx];
                    return (unsigned int)[[fn callWithArguments:@[js]] toUInt32];
                } copy];
            }
            if (r0 == 'q') {
                return [^long long(CGRect r) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:ctx];
                    return (long long)[[fn callWithArguments:@[js]] toDouble];
                } copy];
            }
            if (r0 == 'Q') {
                return [^unsigned long long(CGRect r) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:ctx];
                    return (unsigned long long)[[fn callWithArguments:@[js]] toDouble];
                } copy];
            }
            if (r0 == 'd') {
                return [^double(CGRect r) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:ctx];
                    return [[fn callWithArguments:@[js]] toDouble];
                } copy];
            }
            if (r0 == 'f') {
                return [^float(CGRect r) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:ctx];
                    return (float)[[fn callWithArguments:@[js]] toDouble];
                } copy];
            }
            if (retStructOk) {
                return [^CGRect(CGRect r) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:ctx];
                    return wn_rectFromJSValue([fn callWithArguments:@[js]], ctx);
                } copy];
            }
        } else if ([geomEnc isEqualToString:ePoint]) {
            if (r0 == 'v') {
                return [^(CGPoint p) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:ctx];
                    [fn callWithArguments:@[js]];
                } copy];
            }
            if (r0 == '@') {
                return [^id(CGPoint p) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:ctx];
                    return [WNTypeConversion jsValueToObjCObject:[fn callWithArguments:@[js]]];
                } copy];
            }
            if (r0 == 'B') {
                return [^BOOL(CGPoint p) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:ctx];
                    return [[fn callWithArguments:@[js]] toBool];
                } copy];
            }
            if (r0 == 'i') {
                return [^int(CGPoint p) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:ctx];
                    return (int)[[fn callWithArguments:@[js]] toInt32];
                } copy];
            }
            if (r0 == 'I') {
                return [^unsigned int(CGPoint p) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:ctx];
                    return (unsigned int)[[fn callWithArguments:@[js]] toUInt32];
                } copy];
            }
            if (r0 == 'q') {
                return [^long long(CGPoint p) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:ctx];
                    return (long long)[[fn callWithArguments:@[js]] toDouble];
                } copy];
            }
            if (r0 == 'Q') {
                return [^unsigned long long(CGPoint p) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:ctx];
                    return (unsigned long long)[[fn callWithArguments:@[js]] toDouble];
                } copy];
            }
            if (r0 == 'd') {
                return [^double(CGPoint p) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:ctx];
                    return [[fn callWithArguments:@[js]] toDouble];
                } copy];
            }
            if (r0 == 'f') {
                return [^float(CGPoint p) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:ctx];
                    return (float)[[fn callWithArguments:@[js]] toDouble];
                } copy];
            }
            if (retStructOk) {
                return [^CGPoint(CGPoint p) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:ctx];
                    return wn_pointFromJSValue([fn callWithArguments:@[js]], ctx);
                } copy];
            }
        } else if ([geomEnc isEqualToString:eSize]) {
            if (r0 == 'v') {
                return [^(CGSize s) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:ctx];
                    [fn callWithArguments:@[js]];
                } copy];
            }
            if (r0 == '@') {
                return [^id(CGSize s) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:ctx];
                    return [WNTypeConversion jsValueToObjCObject:[fn callWithArguments:@[js]]];
                } copy];
            }
            if (r0 == 'B') {
                return [^BOOL(CGSize s) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:ctx];
                    return [[fn callWithArguments:@[js]] toBool];
                } copy];
            }
            if (r0 == 'i') {
                return [^int(CGSize s) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:ctx];
                    return (int)[[fn callWithArguments:@[js]] toInt32];
                } copy];
            }
            if (r0 == 'I') {
                return [^unsigned int(CGSize s) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:ctx];
                    return (unsigned int)[[fn callWithArguments:@[js]] toUInt32];
                } copy];
            }
            if (r0 == 'q') {
                return [^long long(CGSize s) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:ctx];
                    return (long long)[[fn callWithArguments:@[js]] toDouble];
                } copy];
            }
            if (r0 == 'Q') {
                return [^unsigned long long(CGSize s) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:ctx];
                    return (unsigned long long)[[fn callWithArguments:@[js]] toDouble];
                } copy];
            }
            if (r0 == 'd') {
                return [^double(CGSize s) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:ctx];
                    return [[fn callWithArguments:@[js]] toDouble];
                } copy];
            }
            if (r0 == 'f') {
                return [^float(CGSize s) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:ctx];
                    return (float)[[fn callWithArguments:@[js]] toDouble];
                } copy];
            }
            if (retStructOk) {
                return [^CGSize(CGSize s) {
                    JSContext *ctx = fn.context;
                    JSValue *js = [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:ctx];
                    return wn_sizeFromJSValue([fn callWithArguments:@[js]], ctx);
                } copy];
            }
        }
    }

    if (n == 2) {
        if ([geomEnc isEqualToString:eRect]) {
            if (geomIdx == 1) {
                if (r0 == 'v') {
                    return [^(id o, CGRect r) {
                        WN_2_CALL_RECT(o, r);
                        (void)res;
                    } copy];
                }
                if (r0 == '@') {
                    return [^id(id o, CGRect r) {
                        WN_2_CALL_RECT(o, r);
                        return [WNTypeConversion jsValueToObjCObject:res];
                    } copy];
                }
                if (r0 == 'B') {
                    return [^BOOL(id o, CGRect r) {
                        WN_2_CALL_RECT(o, r);
                        return [res toBool];
                    } copy];
                }
                if (r0 == 'i') {
                    return [^int(id o, CGRect r) {
                        WN_2_CALL_RECT(o, r);
                        return (int)[res toInt32];
                    } copy];
                }
                if (r0 == 'I') {
                    return [^unsigned int(id o, CGRect r) {
                        WN_2_CALL_RECT(o, r);
                        return (unsigned int)[res toUInt32];
                    } copy];
                }
                if (r0 == 'q') {
                    return [^long long(id o, CGRect r) {
                        WN_2_CALL_RECT(o, r);
                        return (long long)[res toDouble];
                    } copy];
                }
                if (r0 == 'Q') {
                    return [^unsigned long long(id o, CGRect r) {
                        WN_2_CALL_RECT(o, r);
                        return (unsigned long long)[res toDouble];
                    } copy];
                }
                if (r0 == 'd') {
                    return [^double(id o, CGRect r) {
                        WN_2_CALL_RECT(o, r);
                        return [res toDouble];
                    } copy];
                }
                if (r0 == 'f') {
                    return [^float(id o, CGRect r) {
                        WN_2_CALL_RECT(o, r);
                        return (float)[res toDouble];
                    } copy];
                }
                if (retStructOk) {
                    return [^CGRect(id o, CGRect r) {
                        WN_2_CALL_RECT(o, r);
                        return wn_rectFromJSValue(res, ctx);
                    } copy];
                }
            } else if (geomIdx == 0) {
                if (r0 == 'v') {
                    return [^(CGRect r, id o) {
                        WN_2_CALL_RECT_FIRST(r, o);
                        (void)res;
                    } copy];
                }
                if (r0 == '@') {
                    return [^id(CGRect r, id o) {
                        WN_2_CALL_RECT_FIRST(r, o);
                        return [WNTypeConversion jsValueToObjCObject:res];
                    } copy];
                }
                if (r0 == 'B') {
                    return [^BOOL(CGRect r, id o) {
                        WN_2_CALL_RECT_FIRST(r, o);
                        return [res toBool];
                    } copy];
                }
                if (r0 == 'i') {
                    return [^int(CGRect r, id o) {
                        WN_2_CALL_RECT_FIRST(r, o);
                        return (int)[res toInt32];
                    } copy];
                }
                if (r0 == 'I') {
                    return [^unsigned int(CGRect r, id o) {
                        WN_2_CALL_RECT_FIRST(r, o);
                        return (unsigned int)[res toUInt32];
                    } copy];
                }
                if (r0 == 'q') {
                    return [^long long(CGRect r, id o) {
                        WN_2_CALL_RECT_FIRST(r, o);
                        return (long long)[res toDouble];
                    } copy];
                }
                if (r0 == 'Q') {
                    return [^unsigned long long(CGRect r, id o) {
                        WN_2_CALL_RECT_FIRST(r, o);
                        return (unsigned long long)[res toDouble];
                    } copy];
                }
                if (r0 == 'd') {
                    return [^double(CGRect r, id o) {
                        WN_2_CALL_RECT_FIRST(r, o);
                        return [res toDouble];
                    } copy];
                }
                if (r0 == 'f') {
                    return [^float(CGRect r, id o) {
                        WN_2_CALL_RECT_FIRST(r, o);
                        return (float)[res toDouble];
                    } copy];
                }
                if (retStructOk) {
                    return [^CGRect(CGRect r, id o) {
                        WN_2_CALL_RECT_FIRST(r, o);
                        return wn_rectFromJSValue(res, ctx);
                    } copy];
                }
            }
        } else if ([geomEnc isEqualToString:ePoint]) {
            if (geomIdx == 1) {
                if (r0 == 'v') {
                    return [^(id o, CGPoint p) {
                        WN_2_CALL_PT(o, p);
                        (void)res;
                    } copy];
                }
                if (r0 == '@') {
                    return [^id(id o, CGPoint p) {
                        WN_2_CALL_PT(o, p);
                        return [WNTypeConversion jsValueToObjCObject:res];
                    } copy];
                }
                if (r0 == 'B') {
                    return [^BOOL(id o, CGPoint p) {
                        WN_2_CALL_PT(o, p);
                        return [res toBool];
                    } copy];
                }
                if (r0 == 'i') {
                    return [^int(id o, CGPoint p) {
                        WN_2_CALL_PT(o, p);
                        return (int)[res toInt32];
                    } copy];
                }
                if (r0 == 'I') {
                    return [^unsigned int(id o, CGPoint p) {
                        WN_2_CALL_PT(o, p);
                        return (unsigned int)[res toUInt32];
                    } copy];
                }
                if (r0 == 'q') {
                    return [^long long(id o, CGPoint p) {
                        WN_2_CALL_PT(o, p);
                        return (long long)[res toDouble];
                    } copy];
                }
                if (r0 == 'Q') {
                    return [^unsigned long long(id o, CGPoint p) {
                        WN_2_CALL_PT(o, p);
                        return (unsigned long long)[res toDouble];
                    } copy];
                }
                if (r0 == 'd') {
                    return [^double(id o, CGPoint p) {
                        WN_2_CALL_PT(o, p);
                        return [res toDouble];
                    } copy];
                }
                if (r0 == 'f') {
                    return [^float(id o, CGPoint p) {
                        WN_2_CALL_PT(o, p);
                        return (float)[res toDouble];
                    } copy];
                }
                if (retStructOk) {
                    return [^CGPoint(id o, CGPoint p) {
                        WN_2_CALL_PT(o, p);
                        return wn_pointFromJSValue(res, ctx);
                    } copy];
                }
            } else if (geomIdx == 0) {
                if (r0 == 'v') {
                    return [^(CGPoint p, id o) {
                        WN_2_CALL_PT_FIRST(p, o);
                        (void)res;
                    } copy];
                }
                if (r0 == '@') {
                    return [^id(CGPoint p, id o) {
                        WN_2_CALL_PT_FIRST(p, o);
                        return [WNTypeConversion jsValueToObjCObject:res];
                    } copy];
                }
                if (r0 == 'B') {
                    return [^BOOL(CGPoint p, id o) {
                        WN_2_CALL_PT_FIRST(p, o);
                        return [res toBool];
                    } copy];
                }
                if (r0 == 'i') {
                    return [^int(CGPoint p, id o) {
                        WN_2_CALL_PT_FIRST(p, o);
                        return (int)[res toInt32];
                    } copy];
                }
                if (r0 == 'I') {
                    return [^unsigned int(CGPoint p, id o) {
                        WN_2_CALL_PT_FIRST(p, o);
                        return (unsigned int)[res toUInt32];
                    } copy];
                }
                if (r0 == 'q') {
                    return [^long long(CGPoint p, id o) {
                        WN_2_CALL_PT_FIRST(p, o);
                        return (long long)[res toDouble];
                    } copy];
                }
                if (r0 == 'Q') {
                    return [^unsigned long long(CGPoint p, id o) {
                        WN_2_CALL_PT_FIRST(p, o);
                        return (unsigned long long)[res toDouble];
                    } copy];
                }
                if (r0 == 'd') {
                    return [^double(CGPoint p, id o) {
                        WN_2_CALL_PT_FIRST(p, o);
                        return [res toDouble];
                    } copy];
                }
                if (r0 == 'f') {
                    return [^float(CGPoint p, id o) {
                        WN_2_CALL_PT_FIRST(p, o);
                        return (float)[res toDouble];
                    } copy];
                }
                if (retStructOk) {
                    return [^CGPoint(CGPoint p, id o) {
                        WN_2_CALL_PT_FIRST(p, o);
                        return wn_pointFromJSValue(res, ctx);
                    } copy];
                }
            }
        } else if ([geomEnc isEqualToString:eSize]) {
            if (geomIdx == 1) {
                if (r0 == 'v') {
                    return [^(id o, CGSize s) {
                        WN_2_CALL_SZ(o, s);
                        (void)res;
                    } copy];
                }
                if (r0 == '@') {
                    return [^id(id o, CGSize s) {
                        WN_2_CALL_SZ(o, s);
                        return [WNTypeConversion jsValueToObjCObject:res];
                    } copy];
                }
                if (r0 == 'B') {
                    return [^BOOL(id o, CGSize s) {
                        WN_2_CALL_SZ(o, s);
                        return [res toBool];
                    } copy];
                }
                if (r0 == 'i') {
                    return [^int(id o, CGSize s) {
                        WN_2_CALL_SZ(o, s);
                        return (int)[res toInt32];
                    } copy];
                }
                if (r0 == 'I') {
                    return [^unsigned int(id o, CGSize s) {
                        WN_2_CALL_SZ(o, s);
                        return (unsigned int)[res toUInt32];
                    } copy];
                }
                if (r0 == 'q') {
                    return [^long long(id o, CGSize s) {
                        WN_2_CALL_SZ(o, s);
                        return (long long)[res toDouble];
                    } copy];
                }
                if (r0 == 'Q') {
                    return [^unsigned long long(id o, CGSize s) {
                        WN_2_CALL_SZ(o, s);
                        return (unsigned long long)[res toDouble];
                    } copy];
                }
                if (r0 == 'd') {
                    return [^double(id o, CGSize s) {
                        WN_2_CALL_SZ(o, s);
                        return [res toDouble];
                    } copy];
                }
                if (r0 == 'f') {
                    return [^float(id o, CGSize s) {
                        WN_2_CALL_SZ(o, s);
                        return (float)[res toDouble];
                    } copy];
                }
                if (retStructOk) {
                    return [^CGSize(id o, CGSize s) {
                        WN_2_CALL_SZ(o, s);
                        return wn_sizeFromJSValue(res, ctx);
                    } copy];
                }
            } else if (geomIdx == 0) {
                if (r0 == 'v') {
                    return [^(CGSize s, id o) {
                        WN_2_CALL_SZ_FIRST(s, o);
                        (void)res;
                    } copy];
                }
                if (r0 == '@') {
                    return [^id(CGSize s, id o) {
                        WN_2_CALL_SZ_FIRST(s, o);
                        return [WNTypeConversion jsValueToObjCObject:res];
                    } copy];
                }
                if (r0 == 'B') {
                    return [^BOOL(CGSize s, id o) {
                        WN_2_CALL_SZ_FIRST(s, o);
                        return [res toBool];
                    } copy];
                }
                if (r0 == 'i') {
                    return [^int(CGSize s, id o) {
                        WN_2_CALL_SZ_FIRST(s, o);
                        return (int)[res toInt32];
                    } copy];
                }
                if (r0 == 'I') {
                    return [^unsigned int(CGSize s, id o) {
                        WN_2_CALL_SZ_FIRST(s, o);
                        return (unsigned int)[res toUInt32];
                    } copy];
                }
                if (r0 == 'q') {
                    return [^long long(CGSize s, id o) {
                        WN_2_CALL_SZ_FIRST(s, o);
                        return (long long)[res toDouble];
                    } copy];
                }
                if (r0 == 'Q') {
                    return [^unsigned long long(CGSize s, id o) {
                        WN_2_CALL_SZ_FIRST(s, o);
                        return (unsigned long long)[res toDouble];
                    } copy];
                }
                if (r0 == 'd') {
                    return [^double(CGSize s, id o) {
                        WN_2_CALL_SZ_FIRST(s, o);
                        return [res toDouble];
                    } copy];
                }
                if (r0 == 'f') {
                    return [^float(CGSize s, id o) {
                        WN_2_CALL_SZ_FIRST(s, o);
                        return (float)[res toDouble];
                    } copy];
                }
                if (retStructOk) {
                    return [^CGSize(CGSize s, id o) {
                        WN_2_CALL_SZ_FIRST(s, o);
                        return wn_sizeFromJSValue(res, ctx);
                    } copy];
                }
            }
        }
    }

    /* n == 3 || n == 4: only void / id return; one geometry at geomIdx, rest id */
    if (n == 3) {
        if (r0 != 'v' && r0 != '@') {
            NSLog(@"%@ Struct-arg $block arity 3: only void or id return is supported", kLogPrefix);
            return nil;
        }
        if ([geomEnc isEqualToString:eRect]) {
            if (geomIdx == 0) {
                if (r0 == 'v') {
                    return [^(CGRect r, id a, id b) {
                        JSContext *c = fn.context;
                        [fn callWithArguments:@[[WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:c],
                                                rawArgToJSValue("@", (__bridge void *)a, c),
                                                rawArgToJSValue("@", (__bridge void *)b, c)]];
                    } copy];
                }
                return [^id(CGRect r, id a, id b) {
                    JSContext *c = fn.context;
                    JSValue *out = [fn callWithArguments:@[[WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:c],
                                                             rawArgToJSValue("@", (__bridge void *)a, c),
                                                             rawArgToJSValue("@", (__bridge void *)b, c)]];
                    return [WNTypeConversion jsValueToObjCObject:out];
                } copy];
            }
            if (geomIdx == 1) {
                if (r0 == 'v') {
                    return [^(id a, CGRect r, id b) {
                        JSContext *c = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, c),
                                                [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:c],
                                                rawArgToJSValue("@", (__bridge void *)b, c)]];
                    } copy];
                }
                return [^id(id a, CGRect r, id b) {
                    JSContext *c = fn.context;
                    JSValue *out = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, c),
                                                             [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:c],
                                                             rawArgToJSValue("@", (__bridge void *)b, c)]];
                    return [WNTypeConversion jsValueToObjCObject:out];
                } copy];
            }
            if (geomIdx == 2) {
                if (r0 == 'v') {
                    return [^(id a, id b, CGRect r) {
                        JSContext *c = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, c),
                                                rawArgToJSValue("@", (__bridge void *)b, c),
                                                [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:c]]];
                    } copy];
                }
                return [^id(id a, id b, CGRect r) {
                    JSContext *c = fn.context;
                    JSValue *out = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, c),
                                                             rawArgToJSValue("@", (__bridge void *)b, c),
                                                             [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:c]]];
                    return [WNTypeConversion jsValueToObjCObject:out];
                } copy];
            }
        } else if ([geomEnc isEqualToString:ePoint]) {
            if (geomIdx == 0) {
                if (r0 == 'v') {
                    return [^(CGPoint p, id a, id b) {
                        JSContext *c = fn.context;
                        [fn callWithArguments:@[[WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:c],
                                                rawArgToJSValue("@", (__bridge void *)a, c),
                                                rawArgToJSValue("@", (__bridge void *)b, c)]];
                    } copy];
                }
                return [^id(CGPoint p, id a, id b) {
                    JSContext *c = fn.context;
                    JSValue *o = [fn callWithArguments:@[[WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:c],
                                                          rawArgToJSValue("@", (__bridge void *)a, c),
                                                          rawArgToJSValue("@", (__bridge void *)b, c)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 1) {
                if (r0 == 'v') {
                    return [^(id a, CGPoint p, id b) {
                        JSContext *c = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, c),
                                                [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:c],
                                                rawArgToJSValue("@", (__bridge void *)b, c)]];
                    } copy];
                }
                return [^id(id a, CGPoint p, id b) {
                    JSContext *c = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, c),
                                                          [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:c],
                                                          rawArgToJSValue("@", (__bridge void *)b, c)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 2) {
                if (r0 == 'v') {
                    return [^(id a, id b, CGPoint p) {
                        JSContext *c = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, c),
                                                rawArgToJSValue("@", (__bridge void *)b, c),
                                                [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:c]]];
                    } copy];
                }
                return [^id(id a, id b, CGPoint p) {
                    JSContext *c = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, c),
                                                          rawArgToJSValue("@", (__bridge void *)b, c),
                                                          [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:c]]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
        } else if ([geomEnc isEqualToString:eSize]) {
            if (geomIdx == 0) {
                if (r0 == 'v') {
                    return [^(CGSize s, id a, id b) {
                        JSContext *c = fn.context;
                        [fn callWithArguments:@[[WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:c],
                                                rawArgToJSValue("@", (__bridge void *)a, c),
                                                rawArgToJSValue("@", (__bridge void *)b, c)]];
                    } copy];
                }
                return [^id(CGSize s, id a, id b) {
                    JSContext *c = fn.context;
                    JSValue *o = [fn callWithArguments:@[[WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:c],
                                                          rawArgToJSValue("@", (__bridge void *)a, c),
                                                          rawArgToJSValue("@", (__bridge void *)b, c)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 1) {
                if (r0 == 'v') {
                    return [^(id a, CGSize s, id b) {
                        JSContext *c = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, c),
                                                [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:c],
                                                rawArgToJSValue("@", (__bridge void *)b, c)]];
                    } copy];
                }
                return [^id(id a, CGSize s, id b) {
                    JSContext *c = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, c),
                                                          [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:c],
                                                          rawArgToJSValue("@", (__bridge void *)b, c)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 2) {
                if (r0 == 'v') {
                    return [^(id a, id b, CGSize s) {
                        JSContext *c = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, c),
                                                rawArgToJSValue("@", (__bridge void *)b, c),
                                                [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:c]]];
                    } copy];
                }
                return [^id(id a, id b, CGSize s) {
                    JSContext *c = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, c),
                                                          rawArgToJSValue("@", (__bridge void *)b, c),
                                                          [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:c]]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
        }
    }

    if (n == 4) {
        if (r0 != 'v' && r0 != '@') {
            NSLog(@"%@ Struct-arg $block arity 4: only void or id return is supported", kLogPrefix);
            return nil;
        }
        if ([geomEnc isEqualToString:eRect]) {
            if (geomIdx == 0) {
                if (r0 == 'v') {
                    return [^(CGRect r, id a, id b, id c) {
                        JSContext *x = fn.context;
                        [fn callWithArguments:@[[WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:x],
                                                rawArgToJSValue("@", (__bridge void *)a, x),
                                                rawArgToJSValue("@", (__bridge void *)b, x),
                                                rawArgToJSValue("@", (__bridge void *)c, x)]];
                    } copy];
                }
                return [^id(CGRect r, id a, id b, id c) {
                    JSContext *x = fn.context;
                    JSValue *o = [fn callWithArguments:@[[WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:x],
                                                          rawArgToJSValue("@", (__bridge void *)a, x),
                                                          rawArgToJSValue("@", (__bridge void *)b, x),
                                                          rawArgToJSValue("@", (__bridge void *)c, x)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 1) {
                if (r0 == 'v') {
                    return [^(id a, CGRect r, id b, id c) {
                        JSContext *x = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:x],
                                                rawArgToJSValue("@", (__bridge void *)b, x),
                                                rawArgToJSValue("@", (__bridge void *)c, x)]];
                    } copy];
                }
                return [^id(id a, CGRect r, id b, id c) {
                    JSContext *x = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                          [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:x],
                                                          rawArgToJSValue("@", (__bridge void *)b, x),
                                                          rawArgToJSValue("@", (__bridge void *)c, x)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 2) {
                if (r0 == 'v') {
                    return [^(id a, id b, CGRect r, id c) {
                        JSContext *x = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                rawArgToJSValue("@", (__bridge void *)b, x),
                                                [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:x],
                                                rawArgToJSValue("@", (__bridge void *)c, x)]];
                    } copy];
                }
                return [^id(id a, id b, CGRect r, id c) {
                    JSContext *x = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                          rawArgToJSValue("@", (__bridge void *)b, x),
                                                          [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:x],
                                                          rawArgToJSValue("@", (__bridge void *)c, x)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 3) {
                if (r0 == 'v') {
                    return [^(id a, id b, id c, CGRect r) {
                        JSContext *x = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                rawArgToJSValue("@", (__bridge void *)b, x),
                                                rawArgToJSValue("@", (__bridge void *)c, x),
                                                [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:x]]];
                    } copy];
                }
                return [^id(id a, id b, id c, CGRect r) {
                    JSContext *x = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                          rawArgToJSValue("@", (__bridge void *)b, x),
                                                          rawArgToJSValue("@", (__bridge void *)c, x),
                                                          [WNTypeConversion convertToJSValue:&r typeEncoding:eRect.UTF8String inContext:x]]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
        } else if ([geomEnc isEqualToString:ePoint]) {
            if (geomIdx == 0) {
                if (r0 == 'v') {
                    return [^(CGPoint p, id a, id b, id c) {
                        JSContext *x = fn.context;
                        [fn callWithArguments:@[[WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:x],
                                                rawArgToJSValue("@", (__bridge void *)a, x),
                                                rawArgToJSValue("@", (__bridge void *)b, x),
                                                rawArgToJSValue("@", (__bridge void *)c, x)]];
                    } copy];
                }
                return [^id(CGPoint p, id a, id b, id c) {
                    JSContext *x = fn.context;
                    JSValue *o = [fn callWithArguments:@[[WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:x],
                                                          rawArgToJSValue("@", (__bridge void *)a, x),
                                                          rawArgToJSValue("@", (__bridge void *)b, x),
                                                          rawArgToJSValue("@", (__bridge void *)c, x)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 1) {
                if (r0 == 'v') {
                    return [^(id a, CGPoint p, id b, id c) {
                        JSContext *x = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:x],
                                                rawArgToJSValue("@", (__bridge void *)b, x),
                                                rawArgToJSValue("@", (__bridge void *)c, x)]];
                    } copy];
                }
                return [^id(id a, CGPoint p, id b, id c) {
                    JSContext *x = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                          [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:x],
                                                          rawArgToJSValue("@", (__bridge void *)b, x),
                                                          rawArgToJSValue("@", (__bridge void *)c, x)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 2) {
                if (r0 == 'v') {
                    return [^(id a, id b, CGPoint p, id c) {
                        JSContext *x = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                rawArgToJSValue("@", (__bridge void *)b, x),
                                                [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:x],
                                                rawArgToJSValue("@", (__bridge void *)c, x)]];
                    } copy];
                }
                return [^id(id a, id b, CGPoint p, id c) {
                    JSContext *x = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                          rawArgToJSValue("@", (__bridge void *)b, x),
                                                          [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:x],
                                                          rawArgToJSValue("@", (__bridge void *)c, x)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 3) {
                if (r0 == 'v') {
                    return [^(id a, id b, id c, CGPoint p) {
                        JSContext *x = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                rawArgToJSValue("@", (__bridge void *)b, x),
                                                rawArgToJSValue("@", (__bridge void *)c, x),
                                                [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:x]]];
                    } copy];
                }
                return [^id(id a, id b, id c, CGPoint p) {
                    JSContext *x = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                          rawArgToJSValue("@", (__bridge void *)b, x),
                                                          rawArgToJSValue("@", (__bridge void *)c, x),
                                                          [WNTypeConversion convertToJSValue:&p typeEncoding:ePoint.UTF8String inContext:x]]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
        } else if ([geomEnc isEqualToString:eSize]) {
            if (geomIdx == 0) {
                if (r0 == 'v') {
                    return [^(CGSize s, id a, id b, id c) {
                        JSContext *x = fn.context;
                        [fn callWithArguments:@[[WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:x],
                                                rawArgToJSValue("@", (__bridge void *)a, x),
                                                rawArgToJSValue("@", (__bridge void *)b, x),
                                                rawArgToJSValue("@", (__bridge void *)c, x)]];
                    } copy];
                }
                return [^id(CGSize s, id a, id b, id c) {
                    JSContext *x = fn.context;
                    JSValue *o = [fn callWithArguments:@[[WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:x],
                                                          rawArgToJSValue("@", (__bridge void *)a, x),
                                                          rawArgToJSValue("@", (__bridge void *)b, x),
                                                          rawArgToJSValue("@", (__bridge void *)c, x)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 1) {
                if (r0 == 'v') {
                    return [^(id a, CGSize s, id b, id c) {
                        JSContext *x = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:x],
                                                rawArgToJSValue("@", (__bridge void *)b, x),
                                                rawArgToJSValue("@", (__bridge void *)c, x)]];
                    } copy];
                }
                return [^id(id a, CGSize s, id b, id c) {
                    JSContext *x = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                          [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:x],
                                                          rawArgToJSValue("@", (__bridge void *)b, x),
                                                          rawArgToJSValue("@", (__bridge void *)c, x)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 2) {
                if (r0 == 'v') {
                    return [^(id a, id b, CGSize s, id c) {
                        JSContext *x = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                rawArgToJSValue("@", (__bridge void *)b, x),
                                                [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:x],
                                                rawArgToJSValue("@", (__bridge void *)c, x)]];
                    } copy];
                }
                return [^id(id a, id b, CGSize s, id c) {
                    JSContext *x = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                          rawArgToJSValue("@", (__bridge void *)b, x),
                                                          [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:x],
                                                          rawArgToJSValue("@", (__bridge void *)c, x)]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
            if (geomIdx == 3) {
                if (r0 == 'v') {
                    return [^(id a, id b, id c, CGSize s) {
                        JSContext *x = fn.context;
                        [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                rawArgToJSValue("@", (__bridge void *)b, x),
                                                rawArgToJSValue("@", (__bridge void *)c, x),
                                                [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:x]]];
                    } copy];
                }
                return [^id(id a, id b, id c, CGSize s) {
                    JSContext *x = fn.context;
                    JSValue *o = [fn callWithArguments:@[rawArgToJSValue("@", (__bridge void *)a, x),
                                                          rawArgToJSValue("@", (__bridge void *)b, x),
                                                          rawArgToJSValue("@", (__bridge void *)c, x),
                                                          [WNTypeConversion convertToJSValue:&s typeEncoding:eSize.UTF8String inContext:x]]];
                    return [WNTypeConversion jsValueToObjCObject:o];
                } copy];
            }
        }
    }

#undef WN_2_CALL_RECT
#undef WN_2_CALL_RECT_FIRST
#undef WN_2_CALL_PT
#undef WN_2_CALL_PT_FIRST
#undef WN_2_CALL_SZ
#undef WN_2_CALL_SZ_FIRST

    NSLog(@"%@ Unsupported struct block signature / return from JS: argTypes=%@ return=%@", kLogPrefix, argTypes, fullReturnEncoding);
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
        @try {
            sig = [NSMethodSignature signatureWithObjCTypes:[typeEncoding UTF8String]];
        } @catch (NSException *e) {
            // Provided encoding is invalid — fall through to auto-detect
        }
    }

    if (!sig) {
        const char *blockEnc = wn_blockTypeEncoding(block);
        if (blockEnc) {
            @try {
                sig = [NSMethodSignature signatureWithObjCTypes:blockEnc];
            } @catch (NSException *e) {
                // block encoding also invalid
            }
        }
    }

    if (!sig) {
        @try {
            sig = [NSMethodSignature signatureWithObjCTypes:"v@?"];
        } @catch (NSException *e) {
            // last resort fallback
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
    // $blockSig(sig) — ObjC-style signature → type encoding; $block accepts either form
    context[@"$blockSig"] = ^JSValue *(NSString *signature) {
        JSContext *ctx = [JSContext currentContext];
        NSError *err = nil;
        NSString *enc = [WNBlockSignatureParser typeEncodingFromSignature:signature error:&err];
        if (!enc) {
            if (err) {
                NSLog(@"%@ $blockSig: %@", kLogPrefix, err.localizedDescription);
            }
            return [JSValue valueWithNullInContext:ctx];
        }
        return [JSValue valueWithObject:enc inContext:ctx];
    };

    // $block(fn, typeEncoding) — create ObjC block from JS function
    context[@"$block"] = ^JSValue *(JSValue *fn, NSString *typeEncoding) {
        NSString *enc = typeEncoding;
        if ([typeEncoding rangeOfString:@"(^)"].location != NSNotFound) {
            NSError *err = nil;
            NSString *parsed = [WNBlockSignatureParser typeEncodingFromSignature:typeEncoding error:&err];
            if (parsed) {
                enc = parsed;
            } else {
                NSLog(@"%@ $block: invalid signature DSL: %@", kLogPrefix, err.localizedDescription ?: @"");
                return [JSValue valueWithNullInContext:[JSContext currentContext]];
            }
        }
        id block = [WNBlockBridge blockFromJSFunction:fn typeEncoding:enc];
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

        NSString *enc = typeEncoding;
        if ([typeEncoding rangeOfString:@"(^)"].location != NSNotFound) {
            NSError *err = nil;
            NSString *parsed = [WNBlockSignatureParser typeEncodingFromSignature:typeEncoding error:&err];
            if (parsed) {
                enc = parsed;
            } else {
                NSLog(@"%@ $callBlock: invalid signature DSL: %@", kLogPrefix, err.localizedDescription ?: @"");
                return [JSValue valueWithNullInContext:ctx];
            }
        }

        return [WNBlockBridge callBlock:block
                               withArgs:callArgs
                           typeEncoding:enc
                              inContext:ctx];
    };

    NSLog(@"%@ Block bridge registered ($block, $blockSig, $callBlock)", kLogPrefix);
}

@end
