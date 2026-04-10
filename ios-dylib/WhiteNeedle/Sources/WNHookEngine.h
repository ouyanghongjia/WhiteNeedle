#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNHookEngine v2 — NSInvocation-based hooking with full parameter access.
 *
 * Uses _objc_msgForward + forwardInvocation: to intercept method calls
 * and expose ALL arguments / return values to JavaScript callbacks.
 *
 * No JIT/RWX memory required — works on non-jailbroken iOS.
 *
 * Usage from JS:
 *
 *   Interceptor.attach("-[UIViewController viewDidLoad]", {
 *       onEnter(self, sel, args) {
 *           console.log("viewDidLoad:", self.className());
 *       },
 *       onLeave(retval) {
 *           console.log("done, retval:", retval);
 *           // return newValue; // optional: modify return value
 *       }
 *   });
 *
 *   Interceptor.replace("-[MyClass myMethod:]", function(self, args, original) {
 *       console.log("arg0:", args[0]);
 *       return "replaced result";    // 不调 original → 原方法不执行
 *   });
 *
 *   // 调用原方法 + 修改返回值:
 *   Interceptor.replace("-[MyClass myMethod:]", function(self, args, original) {
 *       var result = original(args);  // 调用原方法（可传修改后的 args）
 *       return result + " (modified)";
 *   });
 *
 *   Interceptor.detach("-[UIViewController viewDidLoad]");
 *   Interceptor.detachAll();
 */
@interface WNHookEngine : NSObject

+ (void)registerInContext:(JSContext *)context;

+ (NSArray<NSString *> *)activeHooks;

+ (NSArray<NSDictionary *> *)activeHooksDetailed;

+ (BOOL)pauseHook:(NSString *)selectorKey;

+ (BOOL)resumeHook:(NSString *)selectorKey;

+ (void)detachAll;

@end

NS_ASSUME_NONNULL_END
