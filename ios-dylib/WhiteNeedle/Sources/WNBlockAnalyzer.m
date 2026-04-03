/**
 * WNBlockAnalyzer.m — Block strong-capture detection via release-detector probes.
 *
 * Uses a dynamically-created sentinel class (via objc runtime) to detect
 * which captured slots a block's dispose helper calls release on.
 * Fully ARC-compatible — no need for -fno-objc-arc.
 */

#import "WNBlockAnalyzer.h"
#import <objc/runtime.h>
#import <objc/message.h>
#import <mach/mach.h>

static NSString *const kLogPrefix = @"[WNBlockAnalyzer]";

#pragma mark - Block ABI structures (Apple-public, stable since 2010)

enum {
    BLOCK_HAS_COPY_DISPOSE = (1 << 25),
    BLOCK_HAS_SIGNATURE    = (1 << 30),
};

struct BlockDescriptor {
    unsigned long reserved;
    unsigned long size;
};

struct BlockDescriptorWithCopyDispose {
    unsigned long reserved;
    unsigned long size;
    void (*copy)(void *dst, void *src);
    void (*dispose)(void *src);
};

struct BlockLiteral {
    void *isa;
    int  flags;
    int  reserved;
    void (*invoke)(void *, ...);
    struct BlockDescriptor *descriptor;
};

#pragma mark - Runtime-created release-detector sentinel

static BOOL sDetectorReleased;
static Class sDetectorClass;

static void detectorRelease(__unsafe_unretained id self, SEL _cmd) {
    sDetectorReleased = YES;
}

static id detectorRetain(__unsafe_unretained id self, SEL _cmd) {
    return self;
}

static void ensureDetectorClass(void) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sDetectorClass = objc_allocateClassPair([NSObject class], "WNReleaseDetector", 0);
        if (!sDetectorClass) {
            sDetectorClass = objc_getClass("WNReleaseDetector");
            return;
        }
        class_addMethod(sDetectorClass, sel_registerName("release"), (IMP)detectorRelease, "v@:");
        class_addMethod(sDetectorClass, sel_registerName("retain"),  (IMP)detectorRetain,  "@@:");
        objc_registerClassPair(sDetectorClass);
    });
}

#pragma mark - Helpers

static BOOL WNSafeReadPointer(uintptr_t addr, uintptr_t *outValue) {
    vm_size_t readOut = 0;
    kern_return_t kr = vm_read_overwrite(mach_task_self(),
                                         (vm_address_t)addr,
                                         sizeof(uintptr_t),
                                         (vm_address_t)outValue,
                                         &readOut);
    return (kr == KERN_SUCCESS && readOut == sizeof(uintptr_t));
}

#pragma mark - Implementation

@implementation WNBlockAnalyzer

+ (BOOL)isBlock:(id)obj {
    if (!obj) return NO;

    Class cls = object_getClass(obj);
    if (!cls) return NO;

    static NSSet *blockClasses = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        NSMutableSet *set = [NSMutableSet set];
        Class c;
        c = NSClassFromString(@"__NSGlobalBlock__");   if (c) [set addObject:c];
        c = NSClassFromString(@"__NSStackBlock__");    if (c) [set addObject:c];
        c = NSClassFromString(@"__NSMallocBlock__");   if (c) [set addObject:c];
        c = NSClassFromString(@"NSBlock");             if (c) [set addObject:c];
        c = NSClassFromString(@"__NSGlobalBlock");     if (c) [set addObject:c];
        c = NSClassFromString(@"__NSMallocBlock");     if (c) [set addObject:c];
        c = NSClassFromString(@"__NSAutoBlock__");     if (c) [set addObject:c];
        blockClasses = [set copy];
    });

    while (cls) {
        if ([blockClasses containsObject:cls]) return YES;
        cls = class_getSuperclass(cls);
    }
    return NO;
}

+ (NSArray<NSDictionary *> *)strongCapturesOfBlock:(id)blockObj {
    if (!blockObj || ![self isBlock:blockObj]) return @[];

    struct BlockLiteral *block = (__bridge struct BlockLiteral *)blockObj;

    BOOL hasCopyDispose = (block->flags & BLOCK_HAS_COPY_DISPOSE) != 0;
    if (!hasCopyDispose) {
        return @[];
    }

    struct BlockDescriptorWithCopyDispose *desc =
        (struct BlockDescriptorWithCopyDispose *)block->descriptor;
    if (!desc || desc->size == 0) return @[];

    unsigned long blockSize = desc->size;
    unsigned long headerSize = sizeof(struct BlockLiteral);
    if (blockSize <= headerSize) return @[];

    unsigned long capturedBytes = blockSize - headerSize;
    NSUInteger slotCount = capturedBytes / sizeof(void *);
    if (slotCount == 0) return @[];

    ensureDetectorClass();
    if (!sDetectorClass) return @[];

    NSMutableArray *results = [NSMutableArray array];

    for (NSUInteger i = 0; i < slotCount; i++) {
        @try {
            void *fakeBlock = calloc(1, blockSize);
            if (!fakeBlock) continue;
            memcpy(fakeBlock, (__bridge void *)blockObj, blockSize);

            uintptr_t slotOffset = headerSize + i * sizeof(void *);

            for (NSUInteger z = 0; z < slotCount; z++) {
                void **zp = (void **)((uint8_t *)fakeBlock + headerSize + z * sizeof(void *));
                *zp = NULL;
            }

            id detector = class_createInstance(sDetectorClass, 0);
            sDetectorReleased = NO;

            void **slotPtr = (void **)((uint8_t *)fakeBlock + slotOffset);
            *slotPtr = (__bridge_retained void *)detector;

            @try {
                desc->dispose(fakeBlock);
            } @catch (NSException *e) {
                /* ignore dispose errors on fake block */
            }

            if (sDetectorReleased) {
                uintptr_t originalAddr = 0;
                uintptr_t originalSlot = (uintptr_t)(__bridge void *)blockObj + slotOffset;
                if (WNSafeReadPointer(originalSlot, &originalAddr) && originalAddr != 0) {
                    Class refClass = nil;
                    @try {
                        refClass = object_getClass((__bridge id)(void *)originalAddr);
                    } @catch (NSException *e) {
                        refClass = nil;
                    }

                    NSString *className = refClass ? NSStringFromClass(refClass) : @"?";
                    [results addObject:@{
                        @"index":     @(i),
                        @"address":   [NSString stringWithFormat:@"0x%lx", (unsigned long)originalAddr],
                        @"className": className,
                        @"source":    @"block_capture",
                    }];
                }
            }

            free(fakeBlock);
        } @catch (NSException *e) {
            NSLog(@"%@ Exception probing slot %lu: %@", kLogPrefix, (unsigned long)i, e);
        }
    }

    return [results copy];
}

@end
