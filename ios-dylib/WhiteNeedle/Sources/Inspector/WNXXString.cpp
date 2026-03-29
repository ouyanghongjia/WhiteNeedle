/*
 * WNXXString.cpp — WN::String implementation
 *
 * Resolves WTF::String::fromUTF8 via dlsym (multiple mangled variants).
 * Falls back to JSStringRef public API if all dlsym attempts fail.
 *
 * CRITICAL: The function pointer typedef uses WN::String as the return
 * type so the compiler generates the correct sret calling convention
 * on ARM64 (x8 = return slot, x0/x1 = args).
 *
 * Modeled after YSRemoteInspector's YSCXX::String.
 */

#include "WNXXString.hpp"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dlfcn.h>
#include <JavaScriptCore/JSStringRef.h>
#include <CoreFoundation/CoreFoundation.h>

/* ---------- symbol types ---------- */

/*
 * WTF::String::fromUTF8 is a static member function:
 *   static WTF::String fromUTF8(const unsigned char*, size_t)
 *
 * Because WTF::String has a non-trivial destructor, the return value
 * is passed via hidden sret pointer (x8 on ARM64, stack on x86_64).
 *
 * By declaring the return type as WN::String (which also has a
 * non-trivial destructor), the compiler generates the same sret
 * convention — so the call is ABI-compatible.
 */
namespace WN { class String; }
typedef WN::String (*FromUTF8Fn)(const char *, unsigned long);
typedef void (*StringImplDeref)(void *impl);

/* ---------- lazy-resolved symbols ---------- */

static FromUTF8Fn     g_fromUTF8       = nullptr;
static StringImplDeref g_deref          = nullptr;

/*
 * StringImpl::operator NSString*() const — toll-free bridged to CFStringRef.
 * Much more reliable than manually parsing StringImpl fields.
 */
typedef void *(*ImplToNSStringFn)(void *impl);
static ImplToNSStringFn g_implToNSString = nullptr;

static bool            g_resolved = false;

static void resolve_symbols() {
    if (g_resolved) return;
    g_resolved = true;

    const char *names[] = {
        "_ZN3WTF6String8fromUTF8EPKhm",   /* unsigned char*, size_t — YSRemoteInspector */
        "_ZN3WTF6String8fromUTF8EPKcm",   /* char*, size_t */
        "_ZN3WTF6String8fromUTF8EPKc",    /* char* (single arg) */
        nullptr
    };

    for (int i = 0; names[i]; ++i) {
        void *sym = dlsym(RTLD_DEFAULT, names[i]);
        if (sym) {
            g_fromUTF8 = (FromUTF8Fn)sym;
            break;
        }
    }

    g_deref = (StringImplDeref)dlsym(RTLD_DEFAULT, "_ZN3WTF10StringImpl5derefEv");
    g_implToNSString = (ImplToNSStringFn)dlsym(RTLD_DEFAULT,
        "_ZNK3WTF10StringImplcvP8NSStringEv");
}

/* ---------- String implementation ---------- */

namespace WN {

String::String() : m_impl(nullptr) {}

String::~String() {
    if (m_impl) {
        resolve_symbols();
        if (g_deref) {
            g_deref(m_impl);
        }
        m_impl = nullptr;
    }
}

String::String(String &&other) : m_impl(other.m_impl) {
    other.m_impl = nullptr;
}

String &String::operator=(String &&other) {
    if (this != &other) {
        if (m_impl && g_deref) g_deref(m_impl);
        m_impl = other.m_impl;
        other.m_impl = nullptr;
    }
    return *this;
}

/*
 * Create a WTF::String from UTF-8 bytes.
 *
 * Primary path: call the real WTF::String::fromUTF8 via dlsym.
 *               The compiler handles sret ABI automatically because
 *               the return type (WN::String) is non-trivially destructible.
 *
 * Fallback:     JSStringCreateWithUTF8CString → extract StringImpl* at offset 8.
 */
String String::fromUTF8(const char *characters, unsigned long length) {
    resolve_symbols();

    if (g_fromUTF8) {
        /*
         * Direct call through function pointer.
         * Compiler generates:  x8 = &returnSlot, x0 = characters, x1 = length
         * WebKit function:     writes StringImpl* to [x8]
         *
         * Copy elision ensures the returnSlot IS our return value storage.
         */
        String result = g_fromUTF8(characters, length);
        if (!result.isNull()) return result;
    }

    /* ---------- JSStringRef fallback ---------- */
    JSStringRef jsStr = JSStringCreateWithUTF8CString(characters);
    if (!jsStr) return String();

    /*
     * OpaqueJSString layout:
     *   offset 0  : refcount (or isa)  — 8 bytes
     *   offset 8  : WTF::String m_string — 8 bytes (= StringImpl*)
     *
     * We extract the StringImpl* and take ownership by NOT releasing
     * the JSStringRef (its destructor would deref the same StringImpl).
     * This leaks the small OpaqueJSString wrapper (~24 bytes), which
     * is acceptable for debugging.
     */
    unsigned char *raw = (unsigned char *)jsStr;
    void *implPtr = *(void **)(raw + sizeof(void *));
    if (implPtr) {
        String result;
        result.m_impl = implPtr;
        return result;
    }

    JSStringRelease(jsStr);
    return String();
}

/*
 * Convert StringImpl to a malloc'd UTF-8 C string.
 * Caller must free() the result.
 *
 * Strategy:
 *   1. Primary: StringImpl::operator NSString*() → CFStringGetCString
 *      (most reliable — uses WebKit's own conversion)
 *   2. Fallback: manual StringImpl field parsing
 */
char *String::toUTF8() const {
    if (!m_impl) return nullptr;

    resolve_symbols();

    /* ---------- Primary: operator NSString*() ---------- */
    if (g_implToNSString) {
        void *nsStr = g_implToNSString(m_impl);
        if (nsStr) {
            CFStringRef cfStr = (CFStringRef)nsStr;
            CFIndex cfLen = CFStringGetLength(cfStr);
            CFIndex maxSize = CFStringGetMaximumSizeForEncoding(cfLen,
                                  kCFStringEncodingUTF8) + 1;
            char *buf = (char *)malloc((size_t)maxSize);
            if (CFStringGetCString(cfStr, buf, maxSize, kCFStringEncodingUTF8)) {
                return buf;
            }
            free(buf);
        }
    }

    /* ---------- Fallback: manual StringImpl parsing ---------- */
    /*
     * StringImpl layout (WebKit, 64-bit):
     *   offset 0  : uint32_t refCount
     *   offset 4  : uint32_t length
     *   offset 8  : union { const LChar* m_data8; const UChar* m_data16; }
     *   offset 16 : uint32_t hashAndFlags
     *
     * Modern WebKit (iOS 16+) flag bits:
     *   bit 0 : isAtom
     *   bit 1 : isSymbol
     *   bit 2 : is8Bit  (1 = Latin-1, 0 = UTF-16)
     *   bits 3-4 : bufferOwnership
     */
    unsigned char *p = (unsigned char *)m_impl;
    uint32_t len   = *(uint32_t *)(p + 4);
    void    *data  = *(void **)(p + 8);
    uint32_t flags = *(uint32_t *)(p + 16);
    bool is8Bit    = (flags & 4) != 0;  /* bit 2 in modern WebKit */

    if (!data || len == 0) return nullptr;

    if (is8Bit) {
        char *buf = (char *)malloc(len + 1);
        memcpy(buf, data, len);
        buf[len] = '\0';
        return buf;
    }

    /* UTF-16 → UTF-8 (BMP only — sufficient for JSON/Inspector messages) */
    const uint16_t *u16 = (const uint16_t *)data;
    size_t maxBytes = len * 3 + 1;
    char *buf = (char *)malloc(maxBytes);
    size_t pos = 0;
    for (uint32_t i = 0; i < len; i++) {
        uint16_t ch = u16[i];
        if (ch < 0x80) {
            buf[pos++] = (char)ch;
        } else if (ch < 0x800) {
            buf[pos++] = (char)(0xC0 | (ch >> 6));
            buf[pos++] = (char)(0x80 | (ch & 0x3F));
        } else {
            buf[pos++] = (char)(0xE0 | (ch >> 12));
            buf[pos++] = (char)(0x80 | ((ch >> 6) & 0x3F));
            buf[pos++] = (char)(0x80 | (ch & 0x3F));
        }
    }
    buf[pos] = '\0';
    return buf;
}

} /* namespace WN */
