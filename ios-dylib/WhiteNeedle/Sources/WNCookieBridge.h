#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNCookieBridge registers the Cookies namespace into a JSContext.
 *
 * API:
 *   Cookies.getAll(domain?)         → all cookies, optionally filtered by domain
 *   Cookies.get(name, domain?)      → single cookie by name
 *   Cookies.set(properties)         → add or update a cookie
 *   Cookies.remove(name, domain)    → delete a specific cookie
 *   Cookies.clear()                 → remove all cookies
 */
@interface WNCookieBridge : NSObject

+ (void)registerInContext:(JSContext *)context;

@end

NS_ASSUME_NONNULL_END
