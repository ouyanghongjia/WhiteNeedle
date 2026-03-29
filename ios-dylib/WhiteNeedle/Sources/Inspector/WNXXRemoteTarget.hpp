#ifndef WNXXRemoteTarget_hpp
#define WNXXRemoteTarget_hpp

/*
 * ABI-compatible declarations for WebKit's RemoteControllableTarget
 * and RemoteInspectionTarget.
 *
 * These abstract classes mirror WebKit's internal class hierarchy
 * EXACTLY so that reinterpret_cast<RemoteControllableTarget*>(ptr)
 * gives correct virtual dispatch through the real WebKit vtable.
 *
 * We never instantiate these classes ourselves — they are only used
 * to CAST raw pointers obtained from the JSGlobalObject debuggable
 * field and call virtual methods on them.
 *
 * Vtable layout (Itanium C++ ABI):
 *   slot 0 : ~RemoteControllableTarget()   [complete]
 *   slot 1 : ~RemoteControllableTarget()   [deleting]
 *   slot 2 : connect(FrontendChannel&, bool, bool)
 *   slot 3 : disconnect(FrontendChannel&)
 *   slot 4 : type() const
 *   slot 5 : remoteControlAllowed() const
 *   slot 6 : dispatchMessageFromRemote(String&&)
 *
 * Modeled after YSRemoteInspector's YSCXX::RemoteControllableTarget.
 */

namespace WN {

class FrontendChannel;
class String;

class RemoteControllableTarget {
public:
    virtual ~RemoteControllableTarget() = 0;
    virtual void connect(FrontendChannel &channel,
                         bool isAutomaticInspection = false,
                         bool immediatelyPause = false) = 0;
    virtual void disconnect(FrontendChannel &channel) = 0;
    virtual unsigned int type() const = 0;
    virtual bool remoteControlAllowed() const = 0;
    virtual void dispatchMessageFromRemote(String &&message) = 0;
};

} /* namespace WN */

#endif /* WNXXRemoteTarget_hpp */
