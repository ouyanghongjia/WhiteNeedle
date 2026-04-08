#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNWebViewProbe hooks WKWebView initialization to automatically set
 * `inspectable = YES` (iOS 16.4+), making all WKWebViews in the host
 * app discoverable by Safari, ios_webkit_debug_proxy, and VS Code.
 */
@interface WNWebViewProbe : NSObject

+ (void)install;

@end

NS_ASSUME_NONNULL_END
