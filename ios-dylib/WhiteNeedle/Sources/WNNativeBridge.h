#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

@interface WNNativeBridge : NSObject

+ (void)registerInContext:(JSContext *)context;

+ (NSArray<NSString *> *)activeCHooks;

@end

NS_ASSUME_NONNULL_END
