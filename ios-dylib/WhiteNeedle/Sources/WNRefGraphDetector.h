#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNRefGraphDetector — JS namespace "RefGraph" registration entry point.
 * Exposes buildGraph / expandNode / getNodeDetail / isAvailable to JavaScript.
 */
@interface WNRefGraphDetector : NSObject

+ (void)registerInContext:(JSContext *)context;

@end

NS_ASSUME_NONNULL_END
