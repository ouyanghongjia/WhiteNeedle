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
 *   Interceptor.replace("-[MyClass myMethod:]", function(self, args) {
 *       console.log("arg0:", args[0]);
 *       return "replaced result";
 *   });
 *
 *   Interceptor.detach("-[UIViewController viewDidLoad]");
 *   Interceptor.detachAll();
 */
@interface WNHookEngine : NSObject

+ (void)registerInContext:(JSContext *)context;

+ (NSArray<NSString *> *)activeHooks;

@end

NS_ASSUME_NONNULL_END
