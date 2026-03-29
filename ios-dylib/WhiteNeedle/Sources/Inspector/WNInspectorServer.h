#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNInspectorServer implements a WebSocket-based Inspector server.
 *
 * It provides:
 *  - HTTP GET /json         → CDP-compatible target list
 *  - HTTP GET /json/version → Version info
 *  - WebSocket upgrade      → Inspector protocol channel
 *
 * The server bridges between VS Code's DAP client (over WebSocket)
 * and JSC's internal Inspector (via WNInspectorBridge).
 *
 * Default port: 9222
 */
@interface WNInspectorServer : NSObject

@property (nonatomic, readonly) uint16_t port;
@property (nonatomic, readonly) BOOL isListening;
@property (nonatomic, readonly) BOOL hasActiveSession;

- (instancetype)initWithContext:(JSContext *)context port:(uint16_t)port;

/**
 * Start listening for connections.
 */
- (void)start;

/**
 * Stop the server and close all connections.
 */
- (void)stop;

/**
 * Get the WebSocket debugger URL for the active target.
 */
- (nullable NSString *)webSocketDebuggerUrl;

@end

NS_ASSUME_NONNULL_END
