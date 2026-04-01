#import "WNBlockWrapper.h"
#import "WNTypeConversion.h"
#import "WNBoxing.h"
#import "libffi/include/ffi.h"
#import <CoreGraphics/CoreGraphics.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>

#pragma mark - Block ABI structures

enum {
    WN_BLOCK_NEEDS_FREE       = (1 << 24),
    WN_BLOCK_HAS_COPY_DISPOSE = (1 << 25),
    WN_BLOCK_HAS_SIGNATURE    = (1 << 30)
};

struct WNSimulateBlock {
    void *isa;
    int flags;
    int reserved;
    void *invoke;
    struct WNSimulateBlockDescriptor *descriptor;
    void *wrapper;
};

struct WNSimulateBlockDescriptor {
    struct { unsigned long int reserved; unsigned long int size; };
    struct { void (*copy)(void *dst, const void *src); void (*dispose)(const void *); };
    struct { const char *signature; };
};

static void wn_block_copy_helper(struct WNSimulateBlock *dst, struct WNSimulateBlock *src) {
    CFRetain(dst->wrapper);
}

static void wn_block_dispose_helper(struct WNSimulateBlock *src) {
    CFRelease(src->wrapper);
}

#pragma mark - Type encoding parsing

static const char *wn_skip_one_type(const char *p) {
    if (!p || !*p) return p;
    while (*p == 'r' || *p == 'n' || *p == 'N' || *p == 'o' || *p == 'O' ||
           *p == 'R' || *p == 'V') {
        p++;
    }
    switch (*p) {
        case '@':
            p++;
            if (*p == '?') p++;
            if (*p == '"') { p++; while (*p && *p != '"') p++; if (*p == '"') p++; }
            break;
        case '^':
            p++;
            p = wn_skip_one_type(p);
            break;
        case '{': {
            p++;
            int d = 1;
            while (*p && d > 0) { if (*p == '{') d++; else if (*p == '}') d--; p++; }
            break;
        }
        case '(': {
            p++;
            int d = 1;
            while (*p && d > 0) { if (*p == '(') d++; else if (*p == ')') d--; p++; }
            break;
        }
        case '[':
            p++;
            while (*p && *p != ']') p++;
            if (*p == ']') p++;
            break;
        case 'b':
            p++;
            while (*p >= '0' && *p <= '9') p++;
            break;
        default:
            if (*p) p++;
            break;
    }
    while (*p >= '0' && *p <= '9') p++;
    return p;
}

static NSArray<NSString *> *wn_parse_block_arg_types(const char *enc,
                                                      NSString *__strong *outRetEnc) {
    if (!enc) { *outRetEnc = @"v"; return @[]; }
    const char *p = enc;
    const char *retStart = p;
    p = wn_skip_one_type(p);
    *outRetEnc = [[NSString alloc] initWithBytes:retStart
                                          length:(NSUInteger)(p - retStart)
                                        encoding:NSUTF8StringEncoding];
    if (*p == '@' && *(p + 1) == '?') p += 2;
    else if (*p == '@') p++;

    NSMutableArray *args = [NSMutableArray array];
    while (*p && *p != '\0') {
        const char *start = p;
        p = wn_skip_one_type(p);
        if (p > start) {
            [args addObject:[[NSString alloc] initWithBytes:start
                                                     length:(NSUInteger)(p - start)
                                                   encoding:NSUTF8StringEncoding]];
        }
    }
    return args;
}

#pragma mark - ffi_type helpers for struct types

static ffi_type wn_ffi_type_CGRect;
static ffi_type wn_ffi_type_CGPoint;
static ffi_type wn_ffi_type_CGSize;
static ffi_type wn_ffi_type_CGVector;
static ffi_type wn_ffi_type_NSRange;
static ffi_type wn_ffi_type_UIEdgeInsets;
static ffi_type wn_ffi_type_CGAffineTransform;

static ffi_type *wn_cgrect_elements[5];
static ffi_type *wn_cgpoint_elements[3];
static ffi_type *wn_cgsize_elements[3];
static ffi_type *wn_cgvector_elements[3];
static ffi_type *wn_nsrange_elements[3];
static ffi_type *wn_uiedgeinsets_elements[5];
static ffi_type *wn_cgaffinetransform_elements[7];

static void wn_init_struct_ffi_types(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        ffi_type *dbl = &ffi_type_double;
        ffi_type *ulong = &ffi_type_uint64;

        wn_cgpoint_elements[0] = dbl;
        wn_cgpoint_elements[1] = dbl;
        wn_cgpoint_elements[2] = NULL;
        wn_ffi_type_CGPoint = (ffi_type){ .size = 0, .alignment = 0,
            .type = FFI_TYPE_STRUCT, .elements = wn_cgpoint_elements };

        wn_cgsize_elements[0] = dbl;
        wn_cgsize_elements[1] = dbl;
        wn_cgsize_elements[2] = NULL;
        wn_ffi_type_CGSize = (ffi_type){ .size = 0, .alignment = 0,
            .type = FFI_TYPE_STRUCT, .elements = wn_cgsize_elements };

        wn_cgrect_elements[0] = dbl;
        wn_cgrect_elements[1] = dbl;
        wn_cgrect_elements[2] = dbl;
        wn_cgrect_elements[3] = dbl;
        wn_cgrect_elements[4] = NULL;
        wn_ffi_type_CGRect = (ffi_type){ .size = 0, .alignment = 0,
            .type = FFI_TYPE_STRUCT, .elements = wn_cgrect_elements };

        wn_cgvector_elements[0] = dbl;
        wn_cgvector_elements[1] = dbl;
        wn_cgvector_elements[2] = NULL;
        wn_ffi_type_CGVector = (ffi_type){ .size = 0, .alignment = 0,
            .type = FFI_TYPE_STRUCT, .elements = wn_cgvector_elements };

        wn_nsrange_elements[0] = ulong;
        wn_nsrange_elements[1] = ulong;
        wn_nsrange_elements[2] = NULL;
        wn_ffi_type_NSRange = (ffi_type){ .size = 0, .alignment = 0,
            .type = FFI_TYPE_STRUCT, .elements = wn_nsrange_elements };

        wn_uiedgeinsets_elements[0] = dbl;
        wn_uiedgeinsets_elements[1] = dbl;
        wn_uiedgeinsets_elements[2] = dbl;
        wn_uiedgeinsets_elements[3] = dbl;
        wn_uiedgeinsets_elements[4] = NULL;
        wn_ffi_type_UIEdgeInsets = (ffi_type){ .size = 0, .alignment = 0,
            .type = FFI_TYPE_STRUCT, .elements = wn_uiedgeinsets_elements };

        wn_cgaffinetransform_elements[0] = dbl;
        wn_cgaffinetransform_elements[1] = dbl;
        wn_cgaffinetransform_elements[2] = dbl;
        wn_cgaffinetransform_elements[3] = dbl;
        wn_cgaffinetransform_elements[4] = dbl;
        wn_cgaffinetransform_elements[5] = dbl;
        wn_cgaffinetransform_elements[6] = NULL;
        wn_ffi_type_CGAffineTransform = (ffi_type){ .size = 0, .alignment = 0,
            .type = FFI_TYPE_STRUCT, .elements = wn_cgaffinetransform_elements };
    });
}

static NSDictionary<NSString *, NSValue *> *wn_struct_ffi_map(void) {
    wn_init_struct_ffi_types();
    static NSDictionary *map;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        NSString *eRect   = [NSString stringWithUTF8String:@encode(CGRect)];
        NSString *ePoint  = [NSString stringWithUTF8String:@encode(CGPoint)];
        NSString *eSize   = [NSString stringWithUTF8String:@encode(CGSize)];
        NSString *eVector = [NSString stringWithUTF8String:@encode(CGVector)];
        NSString *eRange  = [NSString stringWithUTF8String:@encode(NSRange)];
        NSString *eInsets = [NSString stringWithUTF8String:@encode(UIEdgeInsets)];
        NSString *eAffine = [NSString stringWithUTF8String:@encode(CGAffineTransform)];

        map = @{
            eRect   : [NSValue valueWithPointer:&wn_ffi_type_CGRect],
            ePoint  : [NSValue valueWithPointer:&wn_ffi_type_CGPoint],
            eSize   : [NSValue valueWithPointer:&wn_ffi_type_CGSize],
            eVector : [NSValue valueWithPointer:&wn_ffi_type_CGVector],
            eRange  : [NSValue valueWithPointer:&wn_ffi_type_NSRange],
            eInsets : [NSValue valueWithPointer:&wn_ffi_type_UIEdgeInsets],
            eAffine : [NSValue valueWithPointer:&wn_ffi_type_CGAffineTransform],
        };
    });
    return map;
}

static ffi_type *wn_ffi_type_for_encoding(NSString *enc) {
    if (!enc.length) return &ffi_type_void;
    const char *c = enc.UTF8String;

    while (*c == 'r' || *c == 'n' || *c == 'N' || *c == 'o' || *c == 'O' ||
           *c == 'R' || *c == 'V') {
        c++;
    }

    switch (c[0]) {
        case 'v': return &ffi_type_void;
        case 'c': return &ffi_type_schar;
        case 'C': return &ffi_type_uchar;
        case 's': return &ffi_type_sshort;
        case 'S': return &ffi_type_ushort;
        case 'i': return &ffi_type_sint;
        case 'I': return &ffi_type_uint;
        case 'l': return &ffi_type_slong;
        case 'L': return &ffi_type_ulong;
        case 'q': return &ffi_type_sint64;
        case 'Q': return &ffi_type_uint64;
        case 'f': return &ffi_type_float;
        case 'd': return &ffi_type_double;
        case 'B': return &ffi_type_uint8;
        case '^': return &ffi_type_pointer;
        case '@': return &ffi_type_pointer;
        case '#': return &ffi_type_pointer;
        case ':': return &ffi_type_pointer;
        case '{': {
            NSValue *v = wn_struct_ffi_map()[enc];
            if (v) return (ffi_type *)[v pointerValue];
            NSLog(@"[WhiteNeedle:Block] Unsupported struct encoding: %@", enc);
            return NULL;
        }
        default:
            NSLog(@"[WhiteNeedle:Block] Unknown type encoding: %@", enc);
            return &ffi_type_pointer;
    }
}

static size_t wn_size_for_encoding(NSString *enc) {
    ffi_type *t = wn_ffi_type_for_encoding(enc);
    if (!t) return 0;
    if (t->type == FFI_TYPE_STRUCT && t->size == 0) {
        ffi_cif tmp;
        ffi_prep_cif(&tmp, FFI_DEFAULT_ABI, 0, t, NULL);
    }
    return t->size;
}

#pragma mark - Generic ffi interpreter

static void WNBlockInterpreter(ffi_cif *cif, void *ret, void **args, void *userdata) {
    WNBlockWrapper *wrapper = (__bridge WNBlockWrapper *)userdata;
    JSValue *fn = wrapper.jsFunction;
    JSContext *ctx = fn.context;
    NSArray<NSString *> *argEncodings = wrapper.argEncodings;

    NSMutableArray *params = [[NSMutableArray alloc] initWithCapacity:argEncodings.count];

    for (NSUInteger i = 0; i < argEncodings.count; i++) {
        NSString *enc = argEncodings[i];
        void *argPtr = args[i + 1]; // +1 to skip block self

        JSValue *jsArg = [WNTypeConversion convertToJSValue:argPtr
                                               typeEncoding:enc.UTF8String
                                                  inContext:ctx];
        [params addObject:jsArg ?: [JSValue valueWithNullInContext:ctx]];
    }

    JSValue *jsResult = [fn callWithArguments:params];

    NSString *retEnc = wrapper.returnEncoding;
    const char *rc = retEnc.UTF8String;
    while (*rc == 'r' || *rc == 'n' || *rc == 'N' || *rc == 'o' || *rc == 'O' ||
           *rc == 'R' || *rc == 'V') {
        rc++;
    }

    if (rc[0] == 'v') return;

    [WNTypeConversion convertJSValue:jsResult
                      toTypeEncoding:rc
                              buffer:ret
                           inContext:ctx];
}

#pragma mark - WNBlockWrapper

@interface WNBlockWrapper () {
    ffi_cif *_cifPtr;
    ffi_type **_ffiArgTypes;
    ffi_closure *_closure;
    BOOL _generated;
    void *_blockPtr;
    struct WNSimulateBlockDescriptor *_descriptor;
}
@end

@implementation WNBlockWrapper

- (instancetype)initWithTypeEncoding:(NSString *)typeEncoding
                    callbackFunction:(JSValue *)jsFunction {
    self = [super init];
    if (self) {
        _jsFunction = jsFunction;
        _typeEncoding = [typeEncoding copy];
        _generated = NO;

        NSString *retEnc = nil;
        NSArray<NSString *> *argEncs = wn_parse_block_arg_types(typeEncoding.UTF8String, &retEnc);
        _returnEncoding = retEnc;
        _argEncodings = argEncs;
    }
    return self;
}

- (nullable void *)blockPtr {
    if (_generated) return _blockPtr;
    _generated = YES;

    wn_init_struct_ffi_types();

    ffi_type *returnType = wn_ffi_type_for_encoding(_returnEncoding);
    if (!returnType) return NULL;

    NSUInteger ffiArgCount = _argEncodings.count + 1; // +1 for block self (id)

    _cifPtr = calloc(1, sizeof(ffi_cif));
    _ffiArgTypes = calloc(ffiArgCount, sizeof(ffi_type *));

    _ffiArgTypes[0] = &ffi_type_pointer; // block self
    for (NSUInteger i = 0; i < _argEncodings.count; i++) {
        ffi_type *t = wn_ffi_type_for_encoding(_argEncodings[i]);
        if (!t) {
            NSLog(@"[WhiteNeedle:Block] Cannot resolve ffi_type for arg %lu: %@",
                  (unsigned long)i, _argEncodings[i]);
            return NULL;
        }
        _ffiArgTypes[i + 1] = t;
    }

    void *blockImp = NULL;
    _closure = ffi_closure_alloc(sizeof(ffi_closure), &blockImp);
    if (!_closure) return NULL;

    if (ffi_prep_cif(_cifPtr, FFI_DEFAULT_ABI, (unsigned int)ffiArgCount,
                     returnType, _ffiArgTypes) != FFI_OK) {
        ffi_closure_free(_closure);
        _closure = NULL;
        return NULL;
    }

    if (ffi_prep_closure_loc(_closure, _cifPtr, WNBlockInterpreter,
                             (__bridge void *)self, blockImp) != FFI_OK) {
        ffi_closure_free(_closure);
        _closure = NULL;
        return NULL;
    }

    struct WNSimulateBlockDescriptor desc = {
        0,
        sizeof(struct WNSimulateBlock),
        (void (*)(void *, const void *))wn_block_copy_helper,
        (void (*)(const void *))wn_block_dispose_helper,
        [_typeEncoding cStringUsingEncoding:NSASCIIStringEncoding]
    };

    _descriptor = malloc(sizeof(struct WNSimulateBlockDescriptor));
    memcpy(_descriptor, &desc, sizeof(struct WNSimulateBlockDescriptor));

    struct WNSimulateBlock simulateBlock = {
        &_NSConcreteStackBlock,
        (WN_BLOCK_HAS_COPY_DISPOSE | WN_BLOCK_HAS_SIGNATURE),
        0,
        blockImp,
        _descriptor,
        (__bridge void *)self
    };

    _blockPtr = Block_copy(&simulateBlock);
    return _blockPtr;
}

- (void)dealloc {
    if (_blockPtr) {
        Block_release(_blockPtr);
    }
    if (_closure) {
        ffi_closure_free(_closure);
    }
    free(_ffiArgTypes);
    free(_cifPtr);
    free(_descriptor);
}

@end
