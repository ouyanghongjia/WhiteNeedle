/**
 * Minimal insert_dylib — adds LC_LOAD_DYLIB to a Mach-O binary.
 * Build: clang -o insert_dylib insert_dylib.c -framework Foundation
 * Usage: insert_dylib <dylib_path> <binary> [--inplace]
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <sys/stat.h>
#include <mach-o/loader.h>
#include <mach-o/fat.h>

static bool patch_macho(uint8_t *buf, size_t size, const char *dylib_path) {
    uint32_t magic = *(uint32_t *)buf;
    bool is64 = (magic == MH_MAGIC_64 || magic == MH_CIGAM_64);

    if (magic != MH_MAGIC && magic != MH_MAGIC_64 &&
        magic != MH_CIGAM && magic != MH_CIGAM_64) {
        return false;
    }

    size_t header_size = is64 ? sizeof(struct mach_header_64) : sizeof(struct mach_header);
    struct mach_header_64 *header = (struct mach_header_64 *)buf;

    /* Walk existing load commands to check for duplicates and find end offset */
    uint8_t *lc_ptr = buf + header_size;
    for (uint32_t i = 0; i < header->ncmds; i++) {
        struct load_command *lc = (struct load_command *)lc_ptr;
        if (lc->cmd == LC_LOAD_DYLIB || lc->cmd == LC_LOAD_WEAK_DYLIB) {
            struct dylib_command *dc = (struct dylib_command *)lc_ptr;
            const char *name = (const char *)lc_ptr + dc->dylib.name.offset;
            if (strcmp(name, dylib_path) == 0) {
                fprintf(stderr, "[insert_dylib] Already contains: %s\n", dylib_path);
                return true;
            }
        }
        lc_ptr += lc->cmdsize;
    }

    /* Build new LC_LOAD_DYLIB command */
    size_t name_len = strlen(dylib_path) + 1;
    size_t cmd_size = sizeof(struct dylib_command) + name_len;
    /* Align to pointer size */
    size_t aligned = is64 ? ((cmd_size + 7) & ~7) : ((cmd_size + 3) & ~3);

    /* Check space: there must be room between end of load commands and first section */
    size_t lc_end = header_size + header->sizeofcmds;
    size_t new_lc_end = lc_end + aligned;

    /* Verify we have enough zero-padding */
    bool has_space = true;
    for (size_t j = lc_end; j < lc_end + aligned && j < size; j++) {
        if (buf[j] != 0) { has_space = false; break; }
    }

    if (!has_space || new_lc_end > size) {
        /* Try to strip code signature to make room */
        lc_ptr = buf + header_size;
        for (uint32_t i = 0; i < header->ncmds; i++) {
            struct load_command *lc = (struct load_command *)lc_ptr;
            if (lc->cmd == LC_CODE_SIGNATURE) {
                uint32_t removed_size = lc->cmdsize;
                size_t remaining = (buf + header_size + header->sizeofcmds) - (lc_ptr + removed_size);
                memmove(lc_ptr, lc_ptr + removed_size, remaining);
                memset(lc_ptr + remaining, 0, removed_size);
                header->ncmds--;
                header->sizeofcmds -= removed_size;
                fprintf(stderr, "[insert_dylib] Stripped LC_CODE_SIGNATURE to make room\n");
                lc_end = header_size + header->sizeofcmds;
                new_lc_end = lc_end + aligned;
                has_space = true;
                for (size_t j = lc_end; j < lc_end + aligned && j < size; j++) {
                    if (buf[j] != 0) { has_space = false; break; }
                }
                break;
            }
            lc_ptr += lc->cmdsize;
        }

        if (!has_space) {
            fprintf(stderr, "[insert_dylib] No space for new load command\n");
            return false;
        }
    }

    /* Write the new command */
    struct dylib_command *new_cmd = (struct dylib_command *)(buf + lc_end);
    memset(new_cmd, 0, aligned);
    new_cmd->cmd = LC_LOAD_DYLIB;
    new_cmd->cmdsize = (uint32_t)aligned;
    new_cmd->dylib.name.offset = sizeof(struct dylib_command);
    new_cmd->dylib.timestamp = 2;
    new_cmd->dylib.current_version = 0x10000;
    new_cmd->dylib.compatibility_version = 0x10000;
    memcpy((uint8_t *)new_cmd + sizeof(struct dylib_command), dylib_path, name_len);

    header->ncmds++;
    header->sizeofcmds += (uint32_t)aligned;

    fprintf(stderr, "[insert_dylib] Injected: %s\n", dylib_path);
    return true;
}

int main(int argc, const char *argv[]) {
    if (argc < 3) {
        fprintf(stderr, "Usage: %s <dylib_path> <binary> [--inplace]\n", argv[0]);
        return 1;
    }

    const char *dylib_path = argv[1];
    const char *binary_path = argv[2];
    bool inplace = (argc > 3 && strcmp(argv[3], "--inplace") == 0);

    FILE *fp = fopen(binary_path, "rb");
    if (!fp) { perror("fopen"); return 1; }

    fseek(fp, 0, SEEK_END);
    long file_size = ftell(fp);
    fseek(fp, 0, SEEK_SET);

    uint8_t *buf = malloc(file_size);
    fread(buf, 1, file_size, fp);
    fclose(fp);

    uint32_t magic = *(uint32_t *)buf;
    bool success = false;

    if (magic == FAT_MAGIC || magic == FAT_CIGAM ||
        magic == FAT_MAGIC_64 || magic == FAT_CIGAM_64) {
        /* Universal binary — patch each slice */
        bool swap = (magic == FAT_CIGAM || magic == FAT_CIGAM_64);
        bool fat64 = (magic == FAT_MAGIC_64 || magic == FAT_CIGAM_64);

        uint32_t nfat = *(uint32_t *)(buf + 4);
        if (swap) nfat = __builtin_bswap32(nfat);

        success = true;
        for (uint32_t i = 0; i < nfat; i++) {
            uint64_t offset, fsize;
            if (fat64) {
                struct fat_arch_64 *arch = (struct fat_arch_64 *)(buf + 8 + i * sizeof(struct fat_arch_64));
                offset = swap ? __builtin_bswap64(arch->offset) : arch->offset;
                fsize = swap ? __builtin_bswap64(arch->size) : arch->size;
            } else {
                struct fat_arch *arch = (struct fat_arch *)(buf + 8 + i * sizeof(struct fat_arch));
                offset = swap ? __builtin_bswap32(arch->offset) : arch->offset;
                fsize = swap ? __builtin_bswap32(arch->size) : arch->size;
            }
            if (!patch_macho(buf + offset, fsize, dylib_path)) {
                success = false;
            }
        }
    } else {
        success = patch_macho(buf, file_size, dylib_path);
    }

    if (success) {
        const char *out_path = inplace ? binary_path : "patched_binary";
        FILE *out = fopen(out_path, "wb");
        if (!out) { perror("fopen output"); free(buf); return 1; }
        fwrite(buf, 1, file_size, out);
        fclose(out);
        fprintf(stderr, "[insert_dylib] Written to: %s\n", out_path);
    }

    free(buf);
    return success ? 0 : 1;
}
