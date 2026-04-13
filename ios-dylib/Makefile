SDK       := $(shell xcrun --sdk iphoneos --show-sdk-path)
CC        := $(shell xcrun --sdk iphoneos -f clang)
CXX       := $(shell xcrun --sdk iphoneos -f clang++)
ARCH      := -arch arm64
MIN_VER   := -mios-version-min=15.0
SYSROOT   := -isysroot $(SDK)
FRAMEWORKS := -framework Foundation -framework UIKit -framework JavaScriptCore -framework Security

OBJC_SOURCES  := $(wildcard WhiteNeedle/Sources/*.m)
C_SOURCES     := $(wildcard WhiteNeedle/Sources/*.c)

# libffi sources (arm64 only)
FFI_C_SOURCES := WhiteNeedle/Sources/libffi/src/ffi_arm64.c \
                 WhiteNeedle/Sources/libffi/src/prep_cif.c \
                 WhiteNeedle/Sources/libffi/src/types.c \
                 WhiteNeedle/Sources/libffi/src/closures.c
FFI_ASM_SOURCES := WhiteNeedle/Sources/libffi/src/sysv_arm64.S

OBJC_OBJECTS   := $(patsubst %.m,build/%.o,$(notdir $(OBJC_SOURCES)))
C_OBJECTS      := $(patsubst %.c,build/%.o,$(notdir $(C_SOURCES)))
FFI_C_OBJECTS  := $(patsubst %.c,build/ffi_%.o,$(notdir $(FFI_C_SOURCES)))
FFI_ASM_OBJECTS := $(patsubst %.S,build/ffi_%.o,$(notdir $(FFI_ASM_SOURCES)))
OBJECTS        := $(OBJC_OBJECTS) $(C_OBJECTS) $(FFI_C_OBJECTS) $(FFI_ASM_OBJECTS)

BINARY       := build/WhiteNeedle
FW_DIR       := build/WhiteNeedle.framework

FFI_INCLUDE  := -IWhiteNeedle/Sources/libffi/include -IWhiteNeedle/Sources/libffi/src
# RefGraph module (set WN_REFGRAPH=0 to disable)
WN_REFGRAPH ?= 1

COMMON_FLAGS := $(ARCH) $(SYSROOT) $(MIN_VER) -O2 -IWhiteNeedle/Sources $(FFI_INCLUDE)
CFLAGS       := $(COMMON_FLAGS) -fobjc-arc -fmodules

ifeq ($(WN_REFGRAPH),1)
CFLAGS += -DWN_ENABLE_REFGRAPH=1
endif
CXXFLAGS     := $(COMMON_FLAGS) -std=c++17 -fno-exceptions -fno-rtti
OBJCXXFLAGS  := $(COMMON_FLAGS) -fobjc-arc -fmodules -std=c++17 -fno-exceptions -fno-rtti
LDFLAGS      := -dynamiclib -install_name @rpath/WhiteNeedle.framework/WhiteNeedle $(FRAMEWORKS) -lc++

.PHONY: all clean

all: $(FW_DIR)

$(BINARY): $(OBJECTS)
	@mkdir -p build
	$(CXX) $(ARCH) $(SYSROOT) $(MIN_VER) $(LDFLAGS) -o $@ $^
	@echo "[WhiteNeedle] Linked: $@"

$(FW_DIR): $(BINARY)
	@rm -rf $(FW_DIR)
	@mkdir -p $(FW_DIR)/Headers
	@cp $(BINARY) $(FW_DIR)/WhiteNeedle
	@cp WhiteNeedle/Sources/*.h $(FW_DIR)/Headers/
	@printf '<?xml version="1.0" encoding="UTF-8"?>\n\
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n\
<plist version="1.0">\n<dict>\n\
\t<key>CFBundleIdentifier</key>\n\t<string>com.whiteneedle.WhiteNeedle</string>\n\
\t<key>CFBundleName</key>\n\t<string>WhiteNeedle</string>\n\
\t<key>CFBundleVersion</key>\n\t<string>2.0.0</string>\n\
\t<key>CFBundleShortVersionString</key>\n\t<string>2.0.0</string>\n\
\t<key>CFBundlePackageType</key>\n\t<string>FMWK</string>\n\
\t<key>CFBundleExecutable</key>\n\t<string>WhiteNeedle</string>\n\
\t<key>MinimumOSVersion</key>\n\t<string>15.0</string>\n\
\t<key>CFBundleSupportedPlatforms</key>\n\t<array><string>iPhoneOS</string></array>\n\
</dict>\n</plist>' > $(FW_DIR)/Info.plist
	@echo "[WhiteNeedle] Framework: $(FW_DIR)"

# ObjC sources (top-level)
build/%.o: WhiteNeedle/Sources/%.m
	@mkdir -p build
	$(CC) $(CFLAGS) -c -o $@ $<

# C sources (top-level)
build/%.o: WhiteNeedle/Sources/%.c
	@mkdir -p build
	$(CC) $(COMMON_FLAGS) -c -o $@ $<

# libffi C sources
build/ffi_%.o: WhiteNeedle/Sources/libffi/src/%.c
	@mkdir -p build
	$(CC) $(ARCH) $(SYSROOT) $(MIN_VER) -O2 $(FFI_INCLUDE) -c -o $@ $<

# libffi assembly
build/ffi_%.o: WhiteNeedle/Sources/libffi/src/%.S
	@mkdir -p build
	$(CC) $(ARCH) $(SYSROOT) $(MIN_VER) $(FFI_INCLUDE) -c -o $@ $<

clean:
	rm -rf build
	@echo "[WhiteNeedle] Cleaned"
