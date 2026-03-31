#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@class WNRemoteServer;

/**
 * WNCurlMonitor — attempts to hook libcurl functions via fishhook
 * for monitoring knet (ks-network) traffic.
 *
 * Since knet is built on libcurl, this module hooks:
 *   - curl_easy_perform: to capture request timing and completion
 *   - curl_easy_getinfo: to extract URL, status code, response size
 *
 * If libcurl symbols are dynamically linked, hooks succeed and
 * curl-based requests appear in the network monitor.
 *
 * If symbols are statically linked (fishhook can't rebind them),
 * the module reports the limitation and falls back gracefully.
 *
 * Host mapping via getaddrinfo still works regardless, since
 * libcurl calls getaddrinfo for DNS resolution.
 */
@interface WNCurlMonitor : NSObject

+ (instancetype)shared;

- (void)startWithServer:(WNRemoteServer *)server;

@property (nonatomic, readonly) BOOL hookSucceeded;

@end

NS_ASSUME_NONNULL_END
