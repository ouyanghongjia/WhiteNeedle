#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

@protocol WNInspectorBridgeDelegate <NSObject>

/**
 * Called when the JSC Inspector backend sends a message to the frontend.
 * The message is a JSON string following the WebKit Inspector Protocol.
 * The delegate should forward this message over WebSocket to VS Code.
 */
- (void)inspectorBridge:(id)bridge didReceiveMessage:(NSString *)message;

/**
 * Called when the inspector session is disconnected (e.g., target went away).
 */
- (void)inspectorBridgeDidDisconnect:(id)bridge;

@end

/**
 * WNInspectorBridge connects to JSC's internal Inspector for a JSContext.
 *
 * It creates a FrontendChannel and connects to the RemoteControllableTarget
 * inside the JSContext's JSGlobalObject, enabling full debugger communication.
 *
 * Usage:
 *   WNInspectorBridge *bridge = [[WNInspectorBridge alloc] initWithContext:jsContext];
 *   bridge.delegate = self;
 *   [bridge connect];
 *   // ... forward messages via delegate and dispatchMessage: ...
 *   [bridge disconnect];
 */
@interface WNInspectorBridge : NSObject

@property (nonatomic, weak, nullable) id<WNInspectorBridgeDelegate> delegate;
@property (nonatomic, readonly) BOOL isConnected;

/**
 * Check if the inspector bridge is available on this iOS version.
 * Returns NO if we can't resolve the necessary JSC internals.
 */
+ (BOOL)isAvailable;

- (instancetype)initWithContext:(JSContext *)context;

/**
 * Connect to the JSContext's internal Inspector.
 * Returns YES on success.
 */
- (BOOL)connect;

/**
 * Disconnect from the Inspector.
 */
- (void)disconnect;

/**
 * Dispatch a message from the frontend (VS Code) to the JSC Inspector.
 * The message should be a JSON string following WIP/CDP protocol.
 */
- (void)dispatchMessage:(NSString *)message;

@end

NS_ASSUME_NONNULL_END
