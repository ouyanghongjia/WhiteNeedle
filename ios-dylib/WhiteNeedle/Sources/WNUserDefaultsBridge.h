#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNUserDefaultsBridge registers the UserDefaults namespace into a JSContext.
 *
 * API:
 *   UserDefaults.getAll(suiteName?)             → all key-value pairs
 *   UserDefaults.get(key, suiteName?)           → single value
 *   UserDefaults.set(key, value, suiteName?)    → write value
 *   UserDefaults.remove(key, suiteName?)        → remove key
 *   UserDefaults.clear(suiteName?)              → remove all keys from suite
 *   UserDefaults.suites()                       → list available plist suites
 */
@interface WNUserDefaultsBridge : NSObject

+ (void)registerInContext:(JSContext *)context;

@end

NS_ASSUME_NONNULL_END
