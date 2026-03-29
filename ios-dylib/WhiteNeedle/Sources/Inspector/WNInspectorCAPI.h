#ifndef WNInspectorCAPI_h
#define WNInspectorCAPI_h

#include <stdbool.h>
#include <JavaScriptCore/JSContextRef.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * C API for the Inspector bridge.
 * Called from ObjC code (WNInspectorBridge.m) to connect to
 * JSC's internal Inspector for a given JSContext.
 */

typedef void *WNInspectorSession;

/*
 * Callback invoked when the JSC Inspector sends a message to the frontend.
 * The message is a JSON string (WIP protocol). The receiver should send
 * it over WebSocket to the VS Code client.
 */
typedef void (*WNInspectorMessageHandler)(const char *message, void *userData);

/*
 * Create an inspector session for the given JSContext.
 *
 * This resolves the internal RemoteControllableTarget from the JSContext's
 * JSGlobalObject, creates a FrontendChannel, and connects to the target.
 *
 * context:  A JSGlobalContextRef (from [JSContext JSGlobalContextRef])
 * handler:  Callback for messages from JSC to frontend
 * userData: Opaque pointer passed to handler
 *
 * Returns NULL on failure.
 */
WNInspectorSession WNInspectorConnect(JSGlobalContextRef context,
                                       WNInspectorMessageHandler handler,
                                       void *userData);

/*
 * Dispatch a message from the frontend (VS Code) to the JSC Inspector.
 * message: JSON string (WIP/CDP protocol)
 */
void WNInspectorDispatchMessage(WNInspectorSession session, const char *message);

/*
 * Disconnect and destroy the inspector session.
 */
void WNInspectorDisconnect(WNInspectorSession session);

/*
 * Check if the JSC offsets are valid (i.e., can we create a session).
 */
bool WNInspectorIsAvailable(void);

#ifdef __cplusplus
}
#endif

#endif /* WNInspectorCAPI_h */
