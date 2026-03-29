#include "WNXXOffset.h"
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>
#include <mach-o/dyld.h>

static WNJSCOffsets g_offsets = { .debuggable_offset = 0, .valid = false };
static bool g_computed = false;

/*
 * ARM64 instruction decoders for extracting member offsets from
 * JSGlobalObject::setInspectable(bool).
 *
 * Typical codegen pattern (arm64):
 *   ldr x8, [x0, #OFFSET]     ; load Debuggable* from this+OFFSET
 *   ...
 * We parse LDR (immediate, unsigned offset) to extract OFFSET.
 *
 * LDR Xt, [Xn, #imm] encoding (64-bit):
 *   1111 1001 01ii iiii iiii iinn nnnt tttt
 *   where imm12 = bits[21:10], offset = imm12 << 3
 */

#if defined(__arm64__) || defined(__aarch64__)

static intptr_t extract_ldr_offset_arm64(const uint32_t *code, int max_insn) {
    for (int i = 0; i < max_insn; i++) {
        uint32_t insn = code[i];

        /* LDR Xt, [Xn, #imm] — 64-bit unsigned offset */
        if ((insn & 0xFFC00000) == 0xF9400000) {
            uint32_t imm12 = (insn >> 10) & 0xFFF;
            uint32_t rn = (insn >> 5) & 0x1F;
            if (rn == 0) { /* x0 = this pointer */
                return (intptr_t)(imm12 << 3);
            }
        }

        /* ADD Xd, Xn, #imm — sometimes used before LDR */
        if ((insn & 0xFF800000) == 0x91000000) {
            uint32_t rn = (insn >> 5) & 0x1F;
            if (rn == 0) {
                uint32_t imm12 = (insn >> 10) & 0xFFF;
                uint32_t shift = (insn >> 22) & 0x1;
                intptr_t addend = imm12;
                if (shift) addend <<= 12;

                /* Next instruction should be LDR from the result register */
                if (i + 1 < max_insn) {
                    uint32_t next = code[i + 1];
                    if ((next & 0xFFC00000) == 0xF9400000) {
                        uint32_t next_imm = (next >> 10) & 0xFFF;
                        return addend + (intptr_t)(next_imm << 3);
                    }
                }
            }
        }
    }
    return -1;
}

#elif defined(__x86_64__)

static intptr_t extract_mov_offset_x86(const uint8_t *code, int max_bytes) {
    /*
     * x86_64 pattern for member access from `this` (rdi):
     *   48 8b 47 XX       mov rax, [rdi+XX]   (1-byte disp)
     *   48 8b 87 XX XX XX XX  mov rax, [rdi+XXXXXXXX] (4-byte disp)
     */
    for (int i = 0; i < max_bytes - 4; i++) {
        /* REX.W MOV reg, [rdi + disp8] */
        if (code[i] == 0x48 && code[i+1] == 0x8B) {
            uint8_t modrm = code[i+2];
            uint8_t mod = (modrm >> 6) & 3;
            uint8_t rm = modrm & 7;
            if (rm == 7 && mod == 1) { /* [rdi + disp8] */
                return (intptr_t)(int8_t)code[i+3];
            }
            if (rm == 7 && mod == 2) { /* [rdi + disp32] */
                int32_t disp;
                memcpy(&disp, &code[i+3], 4);
                return (intptr_t)disp;
            }
        }
    }
    return -1;
}

#endif

/*
 * Mangled symbol for JSC::JSGlobalObject::setInspectable(bool) const
 * This symbol is exported in the JavaScriptCore framework.
 */
static const char *kSetInspectableSymbol =
    "_ZNK3JSC14JSGlobalObject14setInspectableEb";

/* Alternative symbols to try */
static const char *kAltSymbols[] = {
    "_ZN3JSC14JSGlobalObject14setInspectableEb",
    "_ZNK3JSC14JSGlobalObject15inspectorTargetEv",
    NULL
};

WNJSCOffsets WNComputeJSCOffsets(void) {
    if (g_computed) return g_offsets;
    g_computed = true;

    void *jsc = dlopen("/System/Library/Frameworks/JavaScriptCore.framework/JavaScriptCore", RTLD_LAZY);
    if (!jsc) {
        fprintf(stderr, "[WNInspector] Failed to open JavaScriptCore\n");
        return g_offsets;
    }

    void *sym = dlsym(jsc, kSetInspectableSymbol);
    if (!sym) {
        for (int i = 0; kAltSymbols[i]; i++) {
            sym = dlsym(jsc, kAltSymbols[i]);
            if (sym) break;
        }
    }

    if (!sym) {
        fprintf(stderr, "[WNInspector] setInspectable symbol not found\n");
        dlclose(jsc);
        return g_offsets;
    }

    intptr_t offset = -1;

#if defined(__arm64__) || defined(__aarch64__)
    offset = extract_ldr_offset_arm64((const uint32_t *)sym, 16);
#elif defined(__x86_64__)
    offset = extract_mov_offset_x86((const uint8_t *)sym, 64);
#else
    fprintf(stderr, "[WNInspector] Unsupported architecture\n");
#endif

    dlclose(jsc);

    if (offset > 0 && offset < 4096) {
        g_offsets.debuggable_offset = offset;
        g_offsets.valid = true;
        fprintf(stderr, "[WNInspector] JSGlobalObject debuggable offset: %ld\n", (long)offset);
    } else {
        fprintf(stderr, "[WNInspector] Failed to extract debuggable offset (got %ld)\n", (long)offset);
    }

    return g_offsets;
}

void *WNGetDebuggableFromGlobalObject(void *globalObject) {
    WNJSCOffsets offsets = WNComputeJSCOffsets();
    if (!offsets.valid || !globalObject) return NULL;

    /* Read pointer at globalObject + offset */
    void **ptr = (void **)((uint8_t *)globalObject + offsets.debuggable_offset);
    return *ptr;
}
