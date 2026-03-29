#ifndef WNXXFrontendChannel_hpp
#define WNXXFrontendChannel_hpp

/*
 * ABI-compatible FrontendChannel matching WebKit's internal class.
 *
 * By inheriting from the abstract base and overriding virtual methods,
 * the compiler generates the correct vtable automatically — no more
 * manual vtable construction or slot guessing.
 *
 * Vtable layout (Itanium C++ ABI, ARM64):
 *   slot 0 : ~FrontendChannel()     [complete]
 *   slot 1 : ~FrontendChannel()     [deleting]
 *   slot 2 : connectionType() const
 *   slot 3 : sendMessageToFrontend(const String&)
 *
 * Modeled after YSRemoteInspector's YSCXX::FrontendChannel.
 */

namespace WN {

class String;

class FrontendChannel {
public:
    virtual ~FrontendChannel() {}
    virtual unsigned int connectionType() const = 0;
    virtual void sendMessageToFrontend(const String &message) = 0;
};

typedef void (*InspectorMessageCallback)(const char *message, void *userData);

class FrontendChannelImpl : public FrontendChannel {
public:
    FrontendChannelImpl(InspectorMessageCallback callback, void *userData);
    ~FrontendChannelImpl() override;
    unsigned int connectionType() const override;
    void sendMessageToFrontend(const String &message) override;

private:
    InspectorMessageCallback m_callback;
    void *m_userData;
};

} /* namespace WN */

#endif /* WNXXFrontendChannel_hpp */
