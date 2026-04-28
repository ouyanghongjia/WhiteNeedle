#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import <dispatch/dispatch.h>

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

/// Control which queue executes pure ObjC invocation work inside invoke/getProperty/setProperty.
/// JSValue conversion always stays on the current JS thread.
extern void WNSetInvokeTargetQueue(dispatch_queue_t _Nullable queue);
extern dispatch_queue_t _Nullable WNGetInvokeTargetQueue(void);
extern BOOL WNIsInvokeMainThreadHopActive(void);

NS_ASSUME_NONNULL_END
