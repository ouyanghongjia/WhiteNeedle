SDK       := $(shell xcrun --sdk iphoneos --show-sdk-path)
CC        := $(shell xcrun --sdk iphoneos -f clang)
CXX       := $(shell xcrun --sdk iphoneos -f clang++)
ARCH      := -arch arm64
MIN_VER   := -mios-version-min=15.0
SYSROOT   := -isysroot $(SDK)
FRAMEWORKS := -framework Foundation -framework UIKit -framework JavaScriptCore -framework Security

OBJC_SOURCES  := $(wildcard WhiteNeedle/Sources/*.m)
OBJCXX_SOURCES := $(wildcard WhiteNeedle/Sources/Inspector/*.mm)
C_SOURCES     := $(wildcard WhiteNeedle/Sources/*.c) $(wildcard WhiteNeedle/Sources/Inspector/*.c)
CXX_SOURCES   := $(wildcard WhiteNeedle/Sources/Inspector/*.cpp)
INSP_M_SOURCES := $(wildcard WhiteNeedle/Sources/Inspector/*.m)

# libffi sources (arm64 only)
FFI_C_SOURCES := WhiteNeedle/Sources/libffi/src/ffi_arm64.c \
                 WhiteNeedle/Sources/libffi/src/prep_cif.c \
                 WhiteNeedle/Sources/libffi/src/types.c \
                 WhiteNeedle/Sources/libffi/src/closures.c
FFI_ASM_SOURCES := WhiteNeedle/Sources/libffi/src/sysv_arm64.S

OBJC_OBJECTS   := $(patsubst %.m,build/%.o,$(notdir $(OBJC_SOURCES)))
OBJCXX_OBJECTS := $(patsubst %.mm,build/%.o,$(notdir $(OBJCXX_SOURCES)))
C_OBJECTS      := $(patsubst %.c,build/%.o,$(notdir $(C_SOURCES)))
CXX_OBJECTS    := $(patsubst %.cpp,build/%.o,$(notdir $(CXX_SOURCES)))
INSPM_OBJECTS  := $(patsubst %.m,build/insp_%.o,$(notdir $(INSP_M_SOURCES)))
FFI_C_OBJECTS  := $(patsubst %.c,build/ffi_%.o,$(notdir $(FFI_C_SOURCES)))
FFI_ASM_OBJECTS := $(patsubst %.S,build/ffi_%.o,$(notdir $(FFI_ASM_SOURCES)))
OBJECTS        := $(OBJC_OBJECTS) $(OBJCXX_OBJECTS) $(C_OBJECTS) $(CXX_OBJECTS) $(INSPM_OBJECTS) $(FFI_C_OBJECTS) $(FFI_ASM_OBJECTS)

OUTPUT       := build/WhiteNeedle.dylib

FFI_INCLUDE  := -IWhiteNeedle/Sources/libffi/include -IWhiteNeedle/Sources/libffi/src
# RefGraph module (set WN_REFGRAPH=0 to disable)
WN_REFGRAPH ?= 1

COMMON_FLAGS := $(ARCH) $(SYSROOT) $(MIN_VER) -O2 -IWhiteNeedle/Sources -IWhiteNeedle/Sources/Inspector $(FFI_INCLUDE)
CFLAGS       := $(COMMON_FLAGS) -fobjc-arc -fmodules

ifeq ($(WN_REFGRAPH),1)
CFLAGS += -DWN_ENABLE_REFGRAPH=1
endif
CXXFLAGS     := $(COMMON_FLAGS) -std=c++17 -fno-exceptions -fno-rtti
OBJCXXFLAGS  := $(COMMON_FLAGS) -fobjc-arc -fmodules -std=c++17 -fno-exceptions -fno-rtti
LDFLAGS      := -dynamiclib -install_name @rpath/WhiteNeedle.dylib $(FRAMEWORKS) -lc++

.PHONY: all clean

all: $(OUTPUT)

$(OUTPUT): $(OBJECTS)
	@mkdir -p build
	$(CXX) $(ARCH) $(SYSROOT) $(MIN_VER) $(LDFLAGS) -o $@ $^
	@echo "[WhiteNeedle] Built: $@"

# ObjC sources (top-level)
build/%.o: WhiteNeedle/Sources/%.m
	@mkdir -p build
	$(CC) $(CFLAGS) -c -o $@ $<

# C sources (top-level)
build/%.o: WhiteNeedle/Sources/%.c
	@mkdir -p build
	$(CC) $(COMMON_FLAGS) -c -o $@ $<

# C sources (Inspector/)
build/%.o: WhiteNeedle/Sources/Inspector/%.c
	@mkdir -p build
	$(CC) $(COMMON_FLAGS) -c -o $@ $<

# C++ sources (Inspector/)
build/%.o: WhiteNeedle/Sources/Inspector/%.cpp
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -c -o $@ $<

# ObjC++ sources (Inspector/)
build/%.o: WhiteNeedle/Sources/Inspector/%.mm
	@mkdir -p build
	$(CXX) $(OBJCXXFLAGS) -c -o $@ $<

# ObjC sources (Inspector/) — prefixed to avoid name collision
build/insp_%.o: WhiteNeedle/Sources/Inspector/%.m
	@mkdir -p build
	$(CC) $(CFLAGS) -c -o $@ $<

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
