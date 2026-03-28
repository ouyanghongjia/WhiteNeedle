#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNObjCBridge registers the ObjC Runtime API into a JSContext.
 *
 * Unified API under the ObjC namespace:
 *   ObjC.use("UIApplication").invoke("sharedApplication")
 *
 * Core capabilities (no JIT/RWX required):
 *   - ObjC.use(className)     → class proxy
 *   - proxy.invoke(sel, args) → NSInvocation dynamic dispatch
 *   - ObjC.classes            → objc_copyClassList
 *   - ObjC.choose(cls, cb)    → heap scan
 *   - ObjC.define(spec)       → runtime class creation
 *   - ObjC.delegate(spec)     → delegate builder
 */
@interface WNObjCBridge : NSObject

+ (void)registerInContext:(JSContext *)context;

+ (JSValue *)createInstanceProxy:(id)obj inContext:(JSContext *)context;
+ (JSValue *)createProxyForClassName:(NSString *)className inContext:(JSContext *)context;
+ (NSArray<NSString *> *)allClassNames:(nullable NSString *)filter;
+ (NSArray<NSString *> *)methodsForClass:(Class)cls isInstance:(BOOL)isInstance;

@end

NS_ASSUME_NONNULL_END
