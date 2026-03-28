#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

@interface WNDebugSupport : NSObject

+ (void)enableInspectorForContext:(JSContext *)context;

+ (void)registerInContext:(JSContext *)context;

@end

NS_ASSUME_NONNULL_END
