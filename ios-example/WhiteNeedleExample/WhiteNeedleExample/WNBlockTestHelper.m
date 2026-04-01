#import "WNBlockTestHelper.h"

@implementation WNBlockTestHelper

#pragma mark - JS creates block, passes to OC (OC calls the block)

+ (void)callVoidBlock:(void (^)(void))block {
    NSLog(@"[BlockTest] callVoidBlock — invoking block...");
    if (block) block();
    NSLog(@"[BlockTest] callVoidBlock — done");
}

+ (void)callVoidIdBlock:(void (^)(NSString *))block withString:(NSString *)str {
    NSLog(@"[BlockTest] callVoidIdBlock — str=%@", str);
    if (block) block(str);
}

+ (void)callVoidBoolBlock:(void (^)(BOOL))block withFlag:(BOOL)flag {
    NSLog(@"[BlockTest] callVoidBoolBlock — flag=%d", flag);
    if (block) block(flag);
}

+ (void)callVoidIntBlock:(void (^)(NSInteger))block withValue:(NSInteger)val {
    NSLog(@"[BlockTest] callVoidIntBlock — val=%ld", (long)val);
    if (block) block(val);
}

+ (void)callVoidDoubleBlock:(void (^)(double))block withValue:(double)val {
    NSLog(@"[BlockTest] callVoidDoubleBlock — val=%f", val);
    if (block) block(val);
}

+ (void)callVoidTwoIdBlock:(void (^)(NSString *, NSString *))block
                 withFirst:(NSString *)a second:(NSString *)b {
    NSLog(@"[BlockTest] callVoidTwoIdBlock — a=%@, b=%@", a, b);
    if (block) block(a, b);
}

+ (void)callVoidIdDoubleBlock:(void (^)(NSString *, double))block
                   withString:(NSString *)s value:(double)d {
    NSLog(@"[BlockTest] callVoidIdDoubleBlock — s=%@, d=%f", s, d);
    if (block) block(s, d);
}

+ (void)callVoidThreeArgBlock:(void (^)(NSString *, NSInteger, double))block
                       string:(NSString *)s integer:(NSInteger)i doubleVal:(double)d {
    NSLog(@"[BlockTest] callVoidThreeArgBlock — s=%@, i=%ld, d=%f", s, (long)i, d);
    if (block) block(s, i, d);
}

+ (NSString *)callIdReturnBlock:(NSString * (^)(NSString *))block withInput:(NSString *)input {
    NSLog(@"[BlockTest] callIdReturnBlock — input=%@", input);
    if (!block) return nil;
    NSString *result = block(input);
    NSLog(@"[BlockTest] callIdReturnBlock — result=%@", result);
    return result;
}

+ (NSInteger)callIntReturnBlock:(NSInteger (^)(NSInteger, NSInteger))block
                          withA:(NSInteger)a b:(NSInteger)b {
    NSLog(@"[BlockTest] callIntReturnBlock — a=%ld, b=%ld", (long)a, (long)b);
    if (!block) return 0;
    NSInteger result = block(a, b);
    NSLog(@"[BlockTest] callIntReturnBlock — result=%ld", (long)result);
    return result;
}

+ (double)callDoubleReturnBlock:(double (^)(double))block withValue:(double)val {
    NSLog(@"[BlockTest] callDoubleReturnBlock — val=%f", val);
    if (!block) return 0;
    double result = block(val);
    NSLog(@"[BlockTest] callDoubleReturnBlock — result=%f", result);
    return result;
}

+ (BOOL)callBoolReturnBlock:(BOOL (^)(NSString *))block withString:(NSString *)str {
    NSLog(@"[BlockTest] callBoolReturnBlock — str=%@", str);
    if (!block) return NO;
    BOOL result = block(str);
    NSLog(@"[BlockTest] callBoolReturnBlock — result=%d", result);
    return result;
}

#pragma mark - Struct-parameter blocks

+ (void)callVoidRectBlock:(void (^)(CGRect))block withRect:(CGRect)rect {
    NSLog(@"[BlockTest] callVoidRectBlock — rect={{%f,%f},{%f,%f}}", rect.origin.x, rect.origin.y, rect.size.width, rect.size.height);
    if (block) block(rect);
}

+ (void)callVoidPointBlock:(void (^)(CGPoint))block withPoint:(CGPoint)point {
    NSLog(@"[BlockTest] callVoidPointBlock — point={%f,%f}", point.x, point.y);
    if (block) block(point);
}

+ (void)callVoidSizeBlock:(void (^)(CGSize))block withSize:(CGSize)size {
    NSLog(@"[BlockTest] callVoidSizeBlock — size={%f,%f}", size.width, size.height);
    if (block) block(size);
}

+ (CGRect)callRectReturnRectBlock:(CGRect (^)(CGRect))block withRect:(CGRect)rect {
    NSLog(@"[BlockTest] callRectReturnRectBlock — input rect={{%f,%f},{%f,%f}}", rect.origin.x, rect.origin.y, rect.size.width, rect.size.height);
    if (!block) return CGRectZero;
    CGRect result = block(rect);
    NSLog(@"[BlockTest] callRectReturnRectBlock — result={{%f,%f},{%f,%f}}", result.origin.x, result.origin.y, result.size.width, result.size.height);
    return result;
}

+ (CGPoint)callPointReturnPointBlock:(CGPoint (^)(CGPoint, double))block
                           withPoint:(CGPoint)point scale:(double)scale {
    NSLog(@"[BlockTest] callPointReturnPointBlock — point={%f,%f}, scale=%f", point.x, point.y, scale);
    if (!block) return CGPointZero;
    CGPoint result = block(point, scale);
    NSLog(@"[BlockTest] callPointReturnPointBlock — result={%f,%f}", result.x, result.y);
    return result;
}

+ (void)callVoidEdgeInsetsBlock:(void (^)(UIEdgeInsets))block withInsets:(UIEdgeInsets)insets {
    NSLog(@"[BlockTest] callVoidEdgeInsetsBlock — insets={%f,%f,%f,%f}", insets.top, insets.left, insets.bottom, insets.right);
    if (block) block(insets);
}

+ (void)callVoidRangeBlock:(void (^)(NSRange))block withRange:(NSRange)range {
    NSLog(@"[BlockTest] callVoidRangeBlock — range={%lu,%lu}", (unsigned long)range.location, (unsigned long)range.length);
    if (block) block(range);
}

+ (void)callVoidIdRectBlock:(void (^)(NSString *, CGRect))block
                 withString:(NSString *)s rect:(CGRect)r {
    NSLog(@"[BlockTest] callVoidIdRectBlock — s=%@, rect={{%f,%f},{%f,%f}}", s, r.origin.x, r.origin.y, r.size.width, r.size.height);
    if (block) block(s, r);
}

+ (void)callVoidTwoRectsBlock:(void (^)(CGRect, CGRect))block
                    withFirst:(CGRect)r1 second:(CGRect)r2 {
    NSLog(@"[BlockTest] callVoidTwoRectsBlock");
    if (block) block(r1, r2);
}

#pragma mark - OC has block parameter methods (for JS hook testing)

- (void)performAsyncWithCompletion:(void (^)(NSString *result, NSError *_Nullable error))completion {
    NSLog(@"[BlockTest] performAsyncWithCompletion — starting work...");
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        NSLog(@"[BlockTest] performAsyncWithCompletion — calling completion with success");
        if (completion) {
            completion(@"async-result-ok", nil);
        }
    });
}

- (NSString *)transformString:(NSString *)input
               usingFormatter:(NSString * (^)(NSString *))formatter {
    NSLog(@"[BlockTest] transformString — input=%@", input);
    if (!formatter) return input;
    NSString *result = formatter(input);
    NSLog(@"[BlockTest] transformString — result=%@", result);
    return result;
}

- (void)enumerateItems:(NSArray *)items
             withBlock:(void (^)(id item, NSUInteger index, BOOL *stop))block {
    NSLog(@"[BlockTest] enumerateItems — count=%lu", (unsigned long)items.count);
    if (!block) return;
    BOOL stop = NO;
    for (NSUInteger i = 0; i < items.count; i++) {
        block(items[i], i, &stop);
        if (stop) {
            NSLog(@"[BlockTest] enumerateItems — stopped at index %lu", (unsigned long)i);
            break;
        }
    }
}

- (CGRect)adjustRect:(CGRect)rect
         withPadding:(UIEdgeInsets)padding
       usingModifier:(CGRect (^)(CGRect, UIEdgeInsets))modifier {
    NSLog(@"[BlockTest] adjustRect — rect={{%f,%f},{%f,%f}}", rect.origin.x, rect.origin.y, rect.size.width, rect.size.height);
    if (!modifier) return rect;
    CGRect result = modifier(rect, padding);
    NSLog(@"[BlockTest] adjustRect — result={{%f,%f},{%f,%f}}", result.origin.x, result.origin.y, result.size.width, result.size.height);
    return result;
}

- (double)computeWithValue:(double)value
              usingFormula:(double (^)(double))formula {
    NSLog(@"[BlockTest] computeWithValue — value=%f", value);
    if (!formula) return value;
    double result = formula(value);
    NSLog(@"[BlockTest] computeWithValue — result=%f", result);
    return result;
}

@end
