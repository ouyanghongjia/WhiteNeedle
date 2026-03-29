/*
 * WNInspectorCAPI.cpp — C bridge for ObjC ↔ C++ Inspector
 *
 * Rewritten to use proper C++ virtual dispatch on RemoteControllableTarget.
 * No more manual vtable slot guessing — the compiler handles it.
 *
 * Key changes from the previous version:
 *   - Cast debuggable to WN::RemoteControllableTarget* and use C++ virtual calls
 *   - Use WN::String::fromUTF8 for proper message dispatch
 *   - Direct cast of JSGlobalContextRef → JSGlobalObject* (like YSRemoteInspector)
 *
 * Modeled after YSRemoteInspector's YSCInspectorAPI.
 */

#include "WNInspectorCAPI.h"
#include "WNXXOffset.h"
#include "WNXXString.hpp"
#include "WNXXFrontendChannel.hpp"
#include "WNXXRemoteTarget.hpp"
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <dlfcn.h>
#include <utility>

struct WNInspectorSessionImpl {
    WN::FrontendChannelImpl     *channel;
    WN::RemoteControllableTarget *target;
    void                         *globalObject;
};

/*
 * Get JSGlobalObject* from JSGlobalContextRef.
 *
 * YSRemoteInspector does: (void *)jsContext — direct cast.
 * On iOS, JSGlobalContextRef (OpaqueJSContext*) in the embedded
 * JavaScriptCore IS effectively a wrapper around JSGlobalObject.
 * The debuggable offset is computed from this base.
 *
 * We also try the private toJS() symbol when available (simulator).
 */
typedef void *(*ToJSFn)(void *ctx);

static void *getGlobalObjectFromContext(JSGlobalContextRef ctx) {
    static ToJSFn g_toJS = nullptr;
    static bool resolved = false;

    if (!resolved) {
        resolved = true;
        g_toJS = (ToJSFn)dlsym(RTLD_DEFAULT, "_ZN3JSC4toJSEP15OpaqueJSContext");
    }

    if (g_toJS) {
        void *result = g_toJS((void *)ctx);
        if (result) return result;
    }

    return (void *)ctx;
}

extern "C" {

WNInspectorSession WNInspectorConnect(JSGlobalContextRef context,
                                       WNInspectorMessageHandler handler,
                                       void *userData) {
    if (!context || !handler) {
        fprintf(stderr, "[WNInspector] Connect failed: invalid arguments\n");
        return nullptr;
    }

    WNJSCOffsets offsets = WNComputeJSCOffsets();
    if (!offsets.valid) {
        fprintf(stderr, "[WNInspector] Connect failed: JSC offsets not available\n");
        return nullptr;
    }

    void *globalObj = getGlobalObjectFromContext(context);
    if (!globalObj) {
        fprintf(stderr, "[WNInspector] Connect failed: no JSGlobalObject\n");
        return nullptr;
    }

    void *debuggable = WNGetDebuggableFromGlobalObject(globalObj);
    if (!debuggable) {
        fprintf(stderr, "[WNInspector] Connect failed: no debuggable target\n");
        return nullptr;
    }

    auto *target = reinterpret_cast<WN::RemoteControllableTarget *>(debuggable);
    auto *channel = new WN::FrontendChannelImpl(handler, userData);
    target->connect(*channel, false, false);

    auto *session = new WNInspectorSessionImpl();
    session->channel      = channel;
    session->target       = target;
    session->globalObject = globalObj;

    fprintf(stderr, "[WNInspector] Inspector session created successfully\n");
    return (WNInspectorSession)session;
}

void WNInspectorDispatchMessage(WNInspectorSession session, const char *message) {
    if (!session || !message) return;

    auto *impl = (WNInspectorSessionImpl *)session;
    size_t len = strlen(message);

    WN::String str = WN::String::fromUTF8(message, (unsigned long)len);
    if (str.isNull()) {
        fprintf(stderr, "[WNInspector] Failed to create WTF::String for dispatch\n");
        return;
    }

    impl->target->dispatchMessageFromRemote(std::move(str));
}

void WNInspectorDisconnect(WNInspectorSession session) {
    if (!session) return;

    auto *impl = (WNInspectorSessionImpl *)session;

    if (impl->target && impl->channel) {
        impl->target->disconnect(*impl->channel);
    }

    delete impl->channel;
    delete impl;
}

bool WNInspectorIsAvailable(void) {
    WNJSCOffsets offsets = WNComputeJSCOffsets();
    return offsets.valid;
}

} /* extern "C" */
