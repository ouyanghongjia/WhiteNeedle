#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface WNBlockTestHelper : NSObject

#pragma mark - JS creates block, passes to OC (OC calls the block)

+ (void)callVoidBlock:(void (^)(void))block;
+ (void)callVoidIdBlock:(void (^)(NSString *))block withString:(NSString *)str;
+ (void)callVoidBoolBlock:(void (^)(BOOL))block withFlag:(BOOL)flag;
+ (void)callVoidIntBlock:(void (^)(NSInteger))block withValue:(NSInteger)val;
+ (void)callVoidDoubleBlock:(void (^)(double))block withValue:(double)val;
+ (void)callVoidTwoIdBlock:(void (^)(NSString *, NSString *))block
                 withFirst:(NSString *)a second:(NSString *)b;
+ (void)callVoidIdDoubleBlock:(void (^)(NSString *, double))block
                   withString:(NSString *)s value:(double)d;
+ (void)callVoidThreeArgBlock:(void (^)(NSString *, NSInteger, double))block
                      string:(NSString *)s integer:(NSInteger)i doubleVal:(double)d;

+ (NSString *)callIdReturnBlock:(NSString * (^)(NSString *))block withInput:(NSString *)input;
+ (NSInteger)callIntReturnBlock:(NSInteger (^)(NSInteger, NSInteger))block
                          withA:(NSInteger)a b:(NSInteger)b;
+ (double)callDoubleReturnBlock:(double (^)(double))block withValue:(double)val;
+ (BOOL)callBoolReturnBlock:(BOOL (^)(NSString *))block withString:(NSString *)str;

#pragma mark - Struct-parameter blocks

+ (void)callVoidRectBlock:(void (^)(CGRect))block withRect:(CGRect)rect;
+ (void)callVoidPointBlock:(void (^)(CGPoint))block withPoint:(CGPoint)point;
+ (void)callVoidSizeBlock:(void (^)(CGSize))block withSize:(CGSize)size;
+ (CGRect)callRectReturnRectBlock:(CGRect (^)(CGRect))block withRect:(CGRect)rect;
+ (CGPoint)callPointReturnPointBlock:(CGPoint (^)(CGPoint, double))block
                           withPoint:(CGPoint)point scale:(double)scale;
+ (void)callVoidEdgeInsetsBlock:(void (^)(UIEdgeInsets))block withInsets:(UIEdgeInsets)insets;
+ (void)callVoidRangeBlock:(void (^)(NSRange))block withRange:(NSRange)range;
+ (void)callVoidIdRectBlock:(void (^)(NSString *, CGRect))block
                 withString:(NSString *)s rect:(CGRect)r;
+ (void)callVoidTwoRectsBlock:(void (^)(CGRect, CGRect))block
                    withFirst:(CGRect)r1 second:(CGRect)r2;

#pragma mark - OC has block parameter methods (for JS hook testing)

- (void)performAsyncWithCompletion:(void (^)(NSString *result, NSError *_Nullable error))completion;
- (NSString *)transformString:(NSString *)input
               usingFormatter:(NSString * (^)(NSString *))formatter;
- (void)enumerateItems:(NSArray *)items
             withBlock:(void (^)(id item, NSUInteger index, BOOL *stop))block;
- (CGRect)adjustRect:(CGRect)rect
         withPadding:(UIEdgeInsets)padding
       usingModifier:(CGRect (^)(CGRect, UIEdgeInsets))modifier;
- (double)computeWithValue:(double)value
              usingFormula:(double (^)(double))formula;

@end

NS_ASSUME_NONNULL_END
