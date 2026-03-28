#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNBoxing wraps native values that would otherwise be auto-converted by JSC
 * (e.g. NSArray, NSDictionary, NSNumber). This preserves the original ObjC
 * identity so method calls and property access continue to work.
 */
@interface WNBoxing : NSObject

@property (nonatomic, strong, nullable) id boxedValue;
@property (nonatomic, assign) void *pointerValue;
@property (nonatomic, assign) BOOL isPointer;

+ (instancetype)boxObject:(nullable id)obj;
+ (instancetype)boxPointer:(void *)ptr;
+ (instancetype)boxWeakObject:(nullable id)obj;

- (nullable id)unbox;
- (void *)unboxPointer;

@end

/**
 * WNBlockBox wraps a JSValue callback into an ObjC block with a given
 * NSMethodSignature, enabling JS functions to be passed where ObjC blocks
 * or target-action callbacks are expected.
 */
@interface WNBlockBox : NSObject

@property (nonatomic, strong) JSValue *jsFunction;
@property (nonatomic, strong) NSMethodSignature *signature;

+ (instancetype)boxBlock:(JSValue *)fn signature:(NSMethodSignature *)sig;

@end

NS_ASSUME_NONNULL_END
