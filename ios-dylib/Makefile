SDK       := $(shell xcrun --sdk iphoneos --show-sdk-path)
CC        := $(shell xcrun --sdk iphoneos -f clang)
ARCH      := -arch arm64
MIN_VER   := -mios-version-min=15.0
SYSROOT   := -isysroot $(SDK)
FRAMEWORKS := -framework Foundation -framework UIKit -framework JavaScriptCore

OBJC_SOURCES := $(wildcard WhiteNeedle/Sources/*.m)
C_SOURCES    := $(wildcard WhiteNeedle/Sources/*.c)
SOURCES      := $(OBJC_SOURCES) $(C_SOURCES)
OUTPUT       := build/WhiteNeedle.dylib

CFLAGS    := $(ARCH) $(SYSROOT) $(MIN_VER) -fobjc-arc -fmodules -O2
LDFLAGS   := -dynamiclib -install_name @rpath/WhiteNeedle.dylib $(FRAMEWORKS)

.PHONY: all clean

all: $(OUTPUT)

$(OUTPUT): $(SOURCES)
	@mkdir -p build
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $^
	@echo "[WhiteNeedle] Built: $@"

clean:
	rm -rf build
	@echo "[WhiteNeedle] Cleaned"
