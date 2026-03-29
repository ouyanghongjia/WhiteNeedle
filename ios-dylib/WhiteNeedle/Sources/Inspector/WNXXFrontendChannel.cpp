/*
 * WNXXFrontendChannel.cpp — FrontendChannelImpl implementation
 *
 * Uses proper C++ inheritance for compiler-generated vtable.
 * JSC calls sendMessageToFrontend() through the vtable; we convert
 * the WTF::String to UTF-8 and forward to the ObjC server via callback.
 *
 * Modeled after YSRemoteInspector's YSCXX::FrontendChannelImpl.
 */

#include "WNXXFrontendChannel.hpp"
#include "WNXXString.hpp"
#include <cstdlib>

namespace WN {

FrontendChannelImpl::FrontendChannelImpl(InspectorMessageCallback callback,
                                         void *userData)
    : m_callback(callback)
    , m_userData(userData) {
}

FrontendChannelImpl::~FrontendChannelImpl() {
    m_callback = nullptr;
    m_userData  = nullptr;
}

/*
 * Return 0 = Local.  YSRemoteInspector uses Local and it works.
 * WebKit's enum:  Local = 0, Remote = 1
 */
unsigned int FrontendChannelImpl::connectionType() const {
    return 0;
}

void FrontendChannelImpl::sendMessageToFrontend(const String &message) {
    if (!m_callback) return;

    char *utf8 = message.toUTF8();
    if (!utf8) return;

    m_callback(utf8, m_userData);
    free(utf8);
}

} /* namespace WN */
