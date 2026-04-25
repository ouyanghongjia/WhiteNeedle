#import "WNTypeConversion.h"
#import "WNBoxing.h"
#import "WNBlockBridge.h"
#import "WNBlockSignatureParser.h"
#import "WNObjCProxy.h"
#import <UIKit/UIKit.h>
#import <objc/runtime.h>

@implementation WNTypeConversion

+ (void)convertJSValue:(JSValue *)value
         toTypeEncoding:(const char *)typeEncoding
                 buffer:(void *)buffer
              inContext:(JSContext *)context {
    if (!typeEncoding || !buffer) return;

    char type = typeEncoding[0];

    // Skip qualifiers (const, in, out, inout, etc.)
    while (type == 'r' || type == 'n' || type == 'N' || type == 'o' || type == 'O' ||
           type == 'R' || type == 'V') {
        typeEncoding++;
        type = typeEncoding[0];
    }

    switch (type) {
        case 'c': { // char / BOOL (32-bit)
            *(char *)buffer = (char)[value toInt32];
            break;
        }
        case 'C': { // unsigned char
            *(unsigned char *)buffer = (unsigned char)[value toUInt32];
            break;
        }
        case 's': { // short
            *(short *)buffer = (short)[value toInt32];
            break;
        }
        case 'S': { // unsigned short
            *(unsigned short *)buffer = (unsigned short)[value toUInt32];
            break;
        }
        case 'i': { // int
            *(int *)buffer = [value toInt32];
            break;
        }
        case 'I': { // unsigned int
            *(unsigned int *)buffer = [value toUInt32];
            break;
        }
        case 'l': { // long (32-bit)
            *(long *)buffer = (long)[value toInt32];
            break;
        }
        case 'L': { // unsigned long
            *(unsigned long *)buffer = (unsigned long)[value toUInt32];
            break;
        }
        case 'q': { // long long
            *(long long *)buffer = (long long)[value toDouble];
            break;
        }
        case 'Q': { // unsigned long long
            *(unsigned long long *)buffer = (unsigned long long)[value toDouble];
            break;
        }
        case 'f': { // float
            *(float *)buffer = (float)[value toDouble];
            break;
        }
        case 'd': { // double
            *(double *)buffer = [value toDouble];
            break;
        }
        case 'B': { // C++ bool / BOOL (64-bit)
            *(BOOL *)buffer = [value toBool];
            break;
        }
        case '*': { // char * (C string)
            NSString *str = [value toString];
            *(const char **)buffer = [str UTF8String];
            break;
        }
        case '@': {
            // Check if this is a block type (@?)
            if (typeEncoding[1] == '?') {
                // Block type: if JSValue is a function, wrap as ObjC block
                if ([value isObject]) {
                    id rawObj = [value toObject];
                    if ([rawObj isKindOfClass:[WNBoxing class]]) {
                        id unboxed = [(WNBoxing *)rawObj unbox];
                        *(void **)buffer = (__bridge void *)unboxed;
                        break;
                    }
                }
                // Fallthrough: treat as regular object
            }
            id obj = [self jsValueToObjCObject:value];
            *(void **)buffer = (__bridge void *)obj;
            break;
        }
        case '#': { // Class
            NSString *className = [value toString];
            Class cls = NSClassFromString(className);
            *(void **)buffer = (__bridge void *)cls;
            break;
        }
        case ':': { // SEL
            NSString *selName = [value toString];
            SEL sel = NSSelectorFromString(selName);
            *(SEL *)buffer = sel;
            break;
        }
        case '^': { // pointer
            if ([value isObject]) {
                id obj = [value toObject];
                if ([obj isKindOfClass:[WNBoxing class]]) {
                    *(void **)buffer = [(WNBoxing *)obj unboxPointer];
                    break;
                }
            }
            *(void **)buffer = NULL;
            break;
        }
        case 'v': { // void
            break;
        }
        case '{': { // struct
            [self convertJSValue:value toStruct:typeEncoding buffer:buffer inContext:context];
            break;
        }
        default: {
            NSLog(@"[WhiteNeedle:TypeConv] Unsupported type encoding: %s", typeEncoding);
            break;
        }
    }
}

+ (JSValue *)convertToJSValue:(const void *)buffer
                 typeEncoding:(const char *)typeEncoding
                    inContext:(JSContext *)context {
    if (!typeEncoding || !buffer) return [JSValue valueWithUndefinedInContext:context];

    char type = typeEncoding[0];
    while (type == 'r' || type == 'n' || type == 'N' || type == 'o' || type == 'O' ||
           type == 'R' || type == 'V') {
        typeEncoding++;
        type = typeEncoding[0];
    }

    switch (type) {
        case 'c': return [JSValue valueWithInt32:*(char *)buffer inContext:context];
        case 'C': return [JSValue valueWithUInt32:*(unsigned char *)buffer inContext:context];
        case 's': return [JSValue valueWithInt32:*(short *)buffer inContext:context];
        case 'S': return [JSValue valueWithUInt32:*(unsigned short *)buffer inContext:context];
        case 'i': return [JSValue valueWithInt32:*(int *)buffer inContext:context];
        case 'I': return [JSValue valueWithUInt32:*(unsigned int *)buffer inContext:context];
        case 'l': return [JSValue valueWithInt32:*(int *)buffer inContext:context];
        case 'L': return [JSValue valueWithUInt32:*(unsigned int *)buffer inContext:context];
        case 'q': return [JSValue valueWithDouble:(double)(*(long long *)buffer) inContext:context];
        case 'Q': return [JSValue valueWithDouble:(double)(*(unsigned long long *)buffer) inContext:context];
        case 'f': return [JSValue valueWithDouble:*(float *)buffer inContext:context];
        case 'd': return [JSValue valueWithDouble:*(double *)buffer inContext:context];
        case 'B': return [JSValue valueWithBool:*(BOOL *)buffer inContext:context];
        case '*': {
            const char *cstr = *(const char **)buffer;
            if (!cstr) return [JSValue valueWithNullInContext:context];
            return [JSValue valueWithObject:@(cstr) inContext:context];
        }
        case '@': {
            id obj = (__bridge id)(*(void **)buffer);
            if (!obj) return [JSValue valueWithNullInContext:context];
            // Check if the object is a block (responds to "copy" and has block isa)
            if (typeEncoding[1] == '?') {
                // Wrap block for JS invocation
                WNBoxing *box = [WNBoxing boxObject:obj];
                return [JSValue valueWithObject:box inContext:context];
            }
            return [self objcObjectToJSValue:obj inContext:context];
        }
        case '#': {
            Class cls = (__bridge Class)(*(void **)buffer);
            if (!cls) return [JSValue valueWithNullInContext:context];
            return [JSValue valueWithObject:NSStringFromClass(cls) inContext:context];
        }
        case ':': {
            SEL sel = *(SEL *)buffer;
            if (!sel) return [JSValue valueWithNullInContext:context];
            return [JSValue valueWithObject:NSStringFromSelector(sel) inContext:context];
        }
        case '^': {
            void *ptr = *(void **)buffer;
            WNBoxing *box = [WNBoxing boxPointer:ptr];
            return [JSValue valueWithObject:box inContext:context];
        }
        case 'v': return [JSValue valueWithUndefinedInContext:context];
        case '{': return [self convertStructToJSValue:buffer typeEncoding:typeEncoding inContext:context];
        default: return [JSValue valueWithUndefinedInContext:context];
    }
}

+ (JSValue *)convertInvocationArgument:(NSInvocation *)invocation
                               atIndex:(NSInteger)index
                             inContext:(JSContext *)context {
    NSMethodSignature *sig = invocation.methodSignature;
    const char *type = [sig getArgumentTypeAtIndex:index];
    NSUInteger size = 0;
    NSGetSizeAndAlignment(type, &size, NULL);

    void *buffer = calloc(1, size);
    [invocation getArgument:buffer atIndex:index];

    JSValue *result = [self convertToJSValue:buffer typeEncoding:type inContext:context];
    free(buffer);
    return result;
}

+ (void)setInvocationReturnValue:(NSInvocation *)invocation
                       fromJSValue:(JSValue *)value
                         inContext:(JSContext *)context {
    NSMethodSignature *sig = invocation.methodSignature;
    const char *retType = sig.methodReturnType;
    if (retType[0] == 'v') return;

    NSUInteger size = 0;
    NSGetSizeAndAlignment(retType, &size, NULL);

    void *buffer = calloc(1, size);
    [self convertJSValue:value toTypeEncoding:retType buffer:buffer inContext:context];
    [invocation setReturnValue:buffer];
    free(buffer);
}

+ (NSArray<NSString *> *)parseTypeEncodings:(NSMethodSignature *)signature {
    NSMutableArray *types = [NSMutableArray array];
    for (NSUInteger i = 0; i < signature.numberOfArguments; i++) {
        [types addObject:@([signature getArgumentTypeAtIndex:i])];
    }
    return types;
}

#pragma mark - Object conversion helpers

+ (id)jsValueToObjCObject:(JSValue *)value {
    if ([value isNull] || [value isUndefined]) return nil;
    if ([value isString]) return [value toString];
    if ([value isNumber]) return [value toNumber];
    if ([value isBoolean]) return @([value toBool]);

    id obj = [value toObject];
    if ([obj isKindOfClass:[WNBoxing class]]) {
        return [(WNBoxing *)obj unbox];
    }
    if ([obj isKindOfClass:[WNObjCProxy class]]) {
        return [(WNObjCProxy *)obj target];
    }
    return obj;
}

+ (JSValue *)objcObjectToJSValue:(id)obj inContext:(JSContext *)context {
    if (!obj) return [JSValue valueWithNullInContext:context];

    // Wrap ObjC objects that JSC would auto-convert (NSDictionary, NSArray, NSNumber, NSString)
    // to preserve identity for chained method calls.
    // Simple values can be returned directly; complex ObjC objects get boxed.
    if ([obj isKindOfClass:[NSString class]] ||
        [obj isKindOfClass:[NSNumber class]]) {
        return [JSValue valueWithObject:obj inContext:context];
    }

    // For other ObjC objects, box them to preserve identity
    WNBoxing *box = [WNBoxing boxObject:obj];
    return [JSValue valueWithObject:box inContext:context];
}

#pragma mark - Human-readable type encoding

+ (NSDictionary<NSString *, NSString *> *)_encodingToName {
    static NSDictionary *map;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        NSDictionary *fwd = [WNBlockSignatureParser keywordEncodings];
        NSMutableDictionary *rev = [NSMutableDictionary dictionary];

        // Canonical C type names — these take priority when multiple names
        // share the same encoding (e.g. double/CGFloat both encode as "d").
        NSSet *canonical = [NSSet setWithArray:@[
            @"void", @"id", @"BOOL", @"Class", @"SEL",
            @"char", @"unsigned char", @"short", @"unsigned short",
            @"int", @"unsigned int", @"long", @"unsigned long",
            @"long long", @"unsigned long long", @"float", @"double",
        ]];

        for (NSString *name in fwd) {
            NSString *enc = fwd[name];
            if (enc.length == 1) rev[enc] = name;
        }
        for (NSString *name in fwd) {
            NSString *enc = fwd[name];
            if (enc.length == 1 && [canonical containsObject:name]) {
                rev[enc] = name;
            }
        }
        map = [rev copy];
    });
    return map;
}

+ (NSString *)humanReadableType:(const char *)enc {
    if (!enc || !enc[0]) return @"?";

    while (*enc == 'r' || *enc == 'n' || *enc == 'N' || *enc == 'o' ||
           *enc == 'O' || *enc == 'R' || *enc == 'V') {
        enc++;
    }

    // Simple single-char encodings: reuse WNBlockSignatureParser's mapping
    if (enc[0] != '@' && enc[0] != '^' && enc[0] != '{' &&
        enc[0] != '(' && enc[0] != '[') {
        NSString *key = [NSString stringWithFormat:@"%c", enc[0]];
        NSString *name = [self _encodingToName][key];
        if (name) return name;
        if (enc[0] == '*') return @"char *";
        if (enc[0] == '?') return @"void *";
        return [NSString stringWithFormat:@"<%c>", enc[0]];
    }

    // Compound types
    switch (enc[0]) {
        case '@': {
            if (enc[1] == '?') return @"Block";
            if (enc[1] == '"') {
                const char *start = enc + 2;
                const char *end = strchr(start, '"');
                if (end && end > start) {
                    NSString *cls = [[NSString alloc] initWithBytes:start length:(end - start) encoding:NSUTF8StringEncoding];
                    return [cls stringByAppendingString:@" *"];
                }
            }
            return @"id";
        }
        case '^': {
            NSString *pointee = [self humanReadableType:enc + 1];
            return [pointee stringByAppendingString:@" *"];
        }
        case '{': {
            const char *eq = strchr(enc, '=');
            if (eq && eq > enc + 1) {
                return [[NSString alloc] initWithBytes:enc + 1 length:(eq - enc - 1) encoding:NSUTF8StringEncoding];
            }
            const char *close = strchr(enc, '}');
            if (close && close > enc + 1) {
                return [[NSString alloc] initWithBytes:enc + 1 length:(close - enc - 1) encoding:NSUTF8StringEncoding];
            }
            return @"struct";
        }
        case '(': {
            const char *eq = strchr(enc, '=');
            if (eq && eq > enc + 1) {
                return [[NSString alloc] initWithBytes:enc + 1 length:(eq - enc - 1) encoding:NSUTF8StringEncoding];
            }
            return @"union";
        }
        case '[': return @"array";
        default: return [NSString stringWithFormat:@"<%c>", enc[0]];
    }
}

+ (NSString *)humanReadableMethodSignature:(const char *)fullEncoding {
    if (!fullEncoding || !fullEncoding[0]) return @"?";

    NSMutableArray<NSString *> *types = [NSMutableArray array];
    const char *p = fullEncoding;
    while (*p) {
        while (*p >= '0' && *p <= '9') p++;
        if (!*p) break;
        const char *start = p;
        [self skipOneType:&p];
        if (p > start) {
            NSString *enc = [[NSString alloc] initWithBytes:start length:(p - start) encoding:NSUTF8StringEncoding];
            [types addObject:[self humanReadableType:enc.UTF8String]];
        }
    }

    if (types.count == 0) return @"?";

    NSString *retType = types[0];
    NSMutableArray *argTypes = [NSMutableArray array];
    for (NSUInteger i = 3; i < types.count; i++) {
        [argTypes addObject:types[i]];
    }

    if (argTypes.count == 0) {
        return [NSString stringWithFormat:@"→ %@", retType];
    }
    return [NSString stringWithFormat:@"(%@) → %@", [argTypes componentsJoinedByString:@", "], retType];
}

+ (void)skipOneType:(const char **)pp {
    const char *p = *pp;
    while (*p == 'r' || *p == 'n' || *p == 'N' || *p == 'o' || *p == 'O' ||
           *p == 'R' || *p == 'V') {
        p++;
    }
    switch (*p) {
        case '@':
            p++;
            if (*p == '"') {
                p++;
                while (*p && *p != '"') p++;
                if (*p == '"') p++;
            } else if (*p == '?') {
                p++;
            }
            break;
        case '^':
            p++;
            [self skipOneType:&p];
            break;
        case '{': {
            int depth = 1;
            p++;
            while (*p && depth > 0) {
                if (*p == '{') depth++;
                else if (*p == '}') depth--;
                p++;
            }
            break;
        }
        case '(': {
            int depth = 1;
            p++;
            while (*p && depth > 0) {
                if (*p == '(') depth++;
                else if (*p == ')') depth--;
                p++;
            }
            break;
        }
        case '[': {
            int depth = 1;
            p++;
            while (*p && depth > 0) {
                if (*p == '[') depth++;
                else if (*p == ']') depth--;
                p++;
            }
            break;
        }
        case 'b': {
            p++;
            while (*p >= '0' && *p <= '9') p++;
            break;
        }
        default:
            if (*p) p++;
            break;
    }
    while (*p >= '0' && *p <= '9') p++;
    *pp = p;
}

#pragma mark - Struct conversion (CGRect, CGPoint, CGSize, CGAffineTransform)

+ (void)convertJSValue:(JSValue *)value
               toStruct:(const char *)typeEncoding
                 buffer:(void *)buffer
              inContext:(JSContext *)context {
    // If the JSValue wraps an NSValue (via WNBoxing, WNObjCProxy, or directly),
    // extract the raw struct bytes instead of reading individual properties.
    if ([value isObject]) {
        id rawObj = [value toObject];
        NSValue *nsValue = nil;
        if ([rawObj isKindOfClass:[WNBoxing class]]) {
            id u = [(WNBoxing *)rawObj unbox];
            if ([u isKindOfClass:[NSValue class]] && ![u isKindOfClass:[NSNumber class]]) nsValue = u;
        } else if ([rawObj isKindOfClass:[WNObjCProxy class]]) {
            id t = [(WNObjCProxy *)rawObj target];
            if ([t isKindOfClass:[NSValue class]] && ![t isKindOfClass:[NSNumber class]]) nsValue = t;
        } else if ([rawObj isKindOfClass:[NSValue class]] && ![rawObj isKindOfClass:[NSNumber class]]) {
            nsValue = rawObj;
        }
        if (nsValue) {
            NSUInteger expectedSize = 0, valueSize = 0;
            NSGetSizeAndAlignment(typeEncoding, &expectedSize, NULL);
            NSGetSizeAndAlignment(nsValue.objCType, &valueSize, NULL);
            if (valueSize <= expectedSize) {
                [nsValue getValue:buffer];
                return;
            }
        }
    }

    NSString *typeStr = @(typeEncoding);

    if ([typeStr hasPrefix:@"{CGRect="]) {
        CGRect rect;
        rect.origin.x = [value[@"x"] toDouble];
        rect.origin.y = [value[@"y"] toDouble];
        rect.size.width = [value[@"width"] toDouble];
        rect.size.height = [value[@"height"] toDouble];
        *(CGRect *)buffer = rect;
    } else if ([typeStr hasPrefix:@"{CGPoint="]) {
        CGPoint point;
        point.x = [value[@"x"] toDouble];
        point.y = [value[@"y"] toDouble];
        *(CGPoint *)buffer = point;
    } else if ([typeStr hasPrefix:@"{CGSize="]) {
        CGSize size;
        size.width = [value[@"width"] toDouble];
        size.height = [value[@"height"] toDouble];
        *(CGSize *)buffer = size;
    } else if ([typeStr hasPrefix:@"{UIEdgeInsets="]) {
        UIEdgeInsets insets;
        insets.top = [value[@"top"] toDouble];
        insets.left = [value[@"left"] toDouble];
        insets.bottom = [value[@"bottom"] toDouble];
        insets.right = [value[@"right"] toDouble];
        *(UIEdgeInsets *)buffer = insets;
    } else if ([typeStr hasPrefix:@"{NSRange="]) {
        NSRange range;
        range.location = [value[@"location"] toUInt32];
        range.length = [value[@"length"] toUInt32];
        *(NSRange *)buffer = range;
    } else {
        NSLog(@"[WhiteNeedle:TypeConv] Unsupported struct: %s", typeEncoding);
    }
}

+ (JSValue *)convertStructToJSValue:(const void *)buffer
                        typeEncoding:(const char *)typeEncoding
                           inContext:(JSContext *)context {
    NSString *typeStr = @(typeEncoding);

    if ([typeStr hasPrefix:@"{CGRect="]) {
        CGRect rect = *(CGRect *)buffer;
        return [JSValue valueWithObject:@{@"x": @(rect.origin.x), @"y": @(rect.origin.y),
                                          @"width": @(rect.size.width), @"height": @(rect.size.height)}
                              inContext:context];
    } else if ([typeStr hasPrefix:@"{CGPoint="]) {
        CGPoint point = *(CGPoint *)buffer;
        return [JSValue valueWithObject:@{@"x": @(point.x), @"y": @(point.y)} inContext:context];
    } else if ([typeStr hasPrefix:@"{CGSize="]) {
        CGSize size = *(CGSize *)buffer;
        return [JSValue valueWithObject:@{@"width": @(size.width), @"height": @(size.height)} inContext:context];
    } else if ([typeStr hasPrefix:@"{UIEdgeInsets="]) {
        UIEdgeInsets insets = *(UIEdgeInsets *)buffer;
        return [JSValue valueWithObject:@{@"top": @(insets.top), @"left": @(insets.left),
                                          @"bottom": @(insets.bottom), @"right": @(insets.right)}
                              inContext:context];
    } else if ([typeStr hasPrefix:@"{NSRange="]) {
        NSRange range = *(NSRange *)buffer;
        return [JSValue valueWithObject:@{@"location": @(range.location), @"length": @(range.length)}
                              inContext:context];
    }

    return [JSValue valueWithUndefinedInContext:context];
}

@end
