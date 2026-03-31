#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@class WNRemoteServer;

/**
 * WNNetworkMonitor — hooks NSURLSession to capture HTTP traffic.
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

@end

NS_ASSUME_NONNULL_END
