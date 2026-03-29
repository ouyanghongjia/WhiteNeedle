#ifndef WNXXOffset_h
#define WNXXOffset_h

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Runtime offset calculator for JSC internal structures.
 *
 * JSGlobalObject contains a pointer to an internal "Debuggable" object
 * (RemoteControllableTarget) at an offset that varies across iOS versions.
 * We locate it by finding JSGlobalObject::setInspectable's mangled symbol,
 * disassembling the first few instructions to find the member offset.
 *
 * This technique is validated by YSRemoteInspector across iOS 13–17.
 */

typedef struct {
    intptr_t debuggable_offset;   /* offset of RemoteControllableTarget* in JSGlobalObject */
    bool     valid;
} WNJSCOffsets;

/*
 * Compute offsets by analyzing JSC binary code at runtime.
 * Returns a struct with valid=true on success.
 * Thread-safe; caches result after first call.
 */
WNJSCOffsets WNComputeJSCOffsets(void);

/*
 * Given a JSGlobalObject* (obtained from JSGlobalContextRef),
 * return the RemoteControllableTarget* at the computed offset.
 * Returns NULL if offsets are invalid.
 */
void *WNGetDebuggableFromGlobalObject(void *globalObject);

#ifdef __cplusplus
}
#endif

#endif /* WNXXOffset_h */
