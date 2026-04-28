#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@class WNJSEngine;

/**
 * WNRemoteServer provides a TCP JSON-RPC server that allows VSCode
 * (or any client) to send commands to the WhiteNeedle JS engine.
 *
 * Protocol: line-delimited JSON-RPC 2.0 over TCP.
 *
 * Requests (client → server):
 *   loadScript   { code, name }
 *   unloadScript { name }
 *   evaluate     { code }
 *   rpcCall      { method, args }
 *   listScripts  {}
 *   listHooks    {}
 *   getClassNames { filter? }
 *   getMethods   { className }
 *
 * Notifications (server → client):
 *   console      { level, message }
 *   scriptError  { message }
 */
@interface WNRemoteServer : NSObject

- (instancetype)initWithEngine:(WNJSEngine *)engine port:(uint16_t)port;
- (void)start;
- (void)stop;
- (void)broadcastNotification:(NSString *)method params:(NSDictionary *)params;

@property (nonatomic, readonly) uint16_t port;
@property (nonatomic, readonly) BOOL isListening;
/// Exposed for JSON-RPC category (`WNRemoteServerRPC.m`); not part of the original public contract but required for the split.
@property (nonatomic, strong, readonly) WNJSEngine *engine;

@end

NS_ASSUME_NONNULL_END
