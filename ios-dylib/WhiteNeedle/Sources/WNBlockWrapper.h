#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

@interface WNBlockWrapper : NSObject

@property (nonatomic, copy, readonly) NSString *typeEncoding;
@property (nonatomic, copy, readonly) NSString *returnEncoding;
@property (nonatomic, copy, readonly) NSArray<NSString *> *argEncodings;
@property (nonatomic, strong, readonly) JSValue *jsFunction;

- (instancetype)initWithTypeEncoding:(NSString *)typeEncoding
                    callbackFunction:(JSValue *)jsFunction;

- (nullable void *)blockPtr;

@end

NS_ASSUME_NONNULL_END
