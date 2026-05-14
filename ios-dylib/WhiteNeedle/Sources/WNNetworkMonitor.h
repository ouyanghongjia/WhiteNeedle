#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@class WNRemoteServer;

/**
 * WNNetworkMonitor — captures HTTP traffic via NSURLProtocol.
 *
 * Uses a custom NSURLProtocol subclass injected into NSURLSessionConfiguration
 * to intercept ALL NSURLSession traffic (completion-based and delegate-based).
 *
 * Broadcasts JSON-RPC notifications:
 *   networkRequest  — when a request starts
 *   networkResponse — when a response completes
 *
 * RPC methods (via WNRemoteServer):
 *   listNetworkRequests   — returns captured request list
 *   getNetworkRequest     — returns full detail for a single request
 *   clearNetworkRequests  — clears captured data
 *   setNetworkCapture     — enable/disable capture
 */
@interface WNNetworkMonitor : NSObject

+ (instancetype)shared;

- (void)startWithServer:(WNRemoteServer *)server;
- (void)stop;

@property (nonatomic, assign) BOOL capturing;

- (NSArray<NSDictionary *> *)capturedRequestList;
- (nullable NSDictionary *)requestDetailForId:(NSString *)requestId;
- (void)clearAll;

/// Inject an externally captured request (e.g. from WNCurlMonitor) into the shared store.
- (void)injectCapturedSummary:(NSDictionary *)summary;

@end

NS_ASSUME_NONNULL_END
