#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNBlockBridge provides bidirectional JS ↔ ObjC block bridging.
 *
 * JS → ObjC Block:
 *   var block = $block(function(str) {
 *       console.log("callback:", str);
 *   }, "v@?@");
 *   // Pass to ObjC method expecting a block parameter
 *
 * ObjC Block → JS (invoking):
 *   $callBlock(block, arg1, arg2);
 *   // Or: automatically when receiving blocks from ObjC, invoke via .call()
 *
 * Type encoding format for blocks follows ObjC convention:
 *   "v@?"           → void (^)(void)
 *   "v@?@"          → void (^)(id)
 *   "v@?@@"         → void (^)(id, id)
 *   "v@?B"          → void (^)(BOOL)
 *   "@@?@"          → id (^)(id)
 *   "v@?@d"         → void (^)(id, double)
 */
@interface WNBlockBridge : NSObject

+ (void)registerInContext:(JSContext *)context;

/**
 * Create an ObjC block from a JS function and ObjC type encoding.
 * Returns a real ObjC block that can be passed to any ObjC API.
 */
+ (nullable id)blockFromJSFunction:(JSValue *)fn
                      typeEncoding:(NSString *)typeEncoding;

/**
 * Invoke an ObjC block with the given arguments using NSInvocation.
 */
+ (nullable JSValue *)callBlock:(id)block
                       withArgs:(NSArray<JSValue *> *)args
                   typeEncoding:(nullable NSString *)typeEncoding
                      inContext:(JSContext *)context;

@end

NS_ASSUME_NONNULL_END
