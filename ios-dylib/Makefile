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

OBJC_OBJECTS   := $(patsubst %.m,build/%.o,$(notdir $(OBJC_SOURCES)))
OBJCXX_OBJECTS := $(patsubst %.mm,build/%.o,$(notdir $(OBJCXX_SOURCES)))
C_OBJECTS      := $(patsubst %.c,build/%.o,$(notdir $(C_SOURCES)))
CXX_OBJECTS    := $(patsubst %.cpp,build/%.o,$(notdir $(CXX_SOURCES)))
INSPM_OBJECTS  := $(patsubst %.m,build/insp_%.o,$(notdir $(INSP_M_SOURCES)))
OBJECTS        := $(OBJC_OBJECTS) $(OBJCXX_OBJECTS) $(C_OBJECTS) $(CXX_OBJECTS) $(INSPM_OBJECTS)

OUTPUT       := build/WhiteNeedle.dylib

COMMON_FLAGS := $(ARCH) $(SYSROOT) $(MIN_VER) -O2 -IWhiteNeedle/Sources -IWhiteNeedle/Sources/Inspector
CFLAGS       := $(COMMON_FLAGS) -fobjc-arc -fmodules
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

clean:
	rm -rf build
	@echo "[WhiteNeedle] Cleaned"
