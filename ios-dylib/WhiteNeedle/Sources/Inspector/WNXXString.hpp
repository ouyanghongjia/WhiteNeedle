#ifndef WNXXString_hpp
#define WNXXString_hpp

/*
 * ABI-compatible wrapper around WTF::String (8 bytes = one StringImpl*).
 *
 * Modeled after YSRemoteInspector's YSCXX::String.
 * The layout matches WTF::String exactly so we can reinterpret_cast
 * between them and pass by value/reference across the ABI boundary.
 */

namespace WN {

class String {
public:
    String();
    ~String();

    String(String &&other);
    String &operator=(String &&other);

    String(const String &) = delete;
    String &operator=(const String &) = delete;

    static String fromUTF8(const char *characters, unsigned long length);

    char *toUTF8() const;

    bool isNull() const { return m_impl == nullptr; }
    void *impl() const { return m_impl; }

private:
    void *m_impl; /* WTF::StringImpl* (RefCounted) */
};

} /* namespace WN */

#endif /* WNXXString_hpp */
