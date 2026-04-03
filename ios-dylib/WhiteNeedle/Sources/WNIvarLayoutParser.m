#import "WNIvarLayoutParser.h"
#import <objc/runtime.h>
#import <mach/mach.h>

static NSString *const kLogPrefix = @"[WNIvarLayoutParser]";

#pragma mark - Safe memory read

static BOOL WNSafeReadPointer(uintptr_t addr, uintptr_t *outValue) {
    vm_size_t readOut = 0;
    kern_return_t kr = vm_read_overwrite(mach_task_self(),
                                         (vm_address_t)addr,
                                         sizeof(uintptr_t),
                                         (vm_address_t)outValue,
                                         &readOut);
    return (kr == KERN_SUCCESS && readOut == sizeof(uintptr_t));
}

#pragma mark - Layout bitmap decoding

/**
 * Decode an ivar layout byte sequence into a set of slot indices.
 *
 * Each byte: high nibble = skip count, low nibble = scan count.
 * Terminated by 0x00.  Indices are word-sized slots relative to
 * the instance-variable region (starts after isa for root classes,
 * after superclass ivars for subclasses).
 */
static NSIndexSet *DecodeIvarLayout(const uint8_t *layout) {
    NSMutableIndexSet *indices = [NSMutableIndexSet indexSet];
    if (!layout) return indices;

    NSUInteger idx = 0;
    while (*layout != 0x00) {
        uint8_t skip = (*layout >> 4) & 0x0F;
        uint8_t scan = (*layout) & 0x0F;
        idx += skip;
        for (uint8_t s = 0; s < scan; s++) {
            [indices addIndex:idx];
            idx++;
        }
        layout++;
    }
    return [indices copy];
}

#pragma mark - Ivar lookup table (offset → ivar)

static NSDictionary<NSNumber *, NSString *> *BuildIvarOffsetTable(Class cls) {
    NSMutableDictionary *table = [NSMutableDictionary dictionary];

    while (cls && cls != [NSObject class]) {
        unsigned int count = 0;
        Ivar *ivars = class_copyIvarList(cls, &count);
        for (unsigned int i = 0; i < count; i++) {
            ptrdiff_t off = ivar_getOffset(ivars[i]);
            const char *name = ivar_getName(ivars[i]);
            if (name) {
                table[@(off)] = @(name);
            }
        }
        if (ivars) free(ivars);
        cls = class_getSuperclass(cls);
    }

    return [table copy];
}

#pragma mark - Implementation

@implementation WNIvarLayoutParser

+ (NSArray<NSNumber *> *)strongIvarOffsetsForClass:(Class)cls {
    if (!cls) return @[];

    NSMutableArray<NSNumber *> *allOffsets = [NSMutableArray array];
    Class current = cls;

    while (current && current != [NSObject class]) {
        const uint8_t *strongLayout = class_getIvarLayout(current);
        const uint8_t *weakLayout   = class_getWeakIvarLayout(current);

        NSIndexSet *strongSlots = DecodeIvarLayout(strongLayout);
        NSIndexSet *weakSlots   = DecodeIvarLayout(weakLayout);

        NSUInteger baseOffset = 0;
        Class super_ = class_getSuperclass(current);
        if (super_) {
            baseOffset = class_getInstanceSize(super_);
        }

        [strongSlots enumerateIndexesUsingBlock:^(NSUInteger slotIdx, BOOL *stop) {
            if ([weakSlots containsIndex:slotIdx]) return;
            NSUInteger byteOffset = baseOffset + slotIdx * sizeof(void *);
            [allOffsets addObject:@(byteOffset)];
        }];

        current = class_getSuperclass(current);
    }

    return [allOffsets copy];
}

+ (NSArray<NSDictionary *> *)strongIvarReferencesForObject:(id)obj {
    if (!obj) return @[];

    Class cls = object_getClass(obj);
    if (!cls) return @[];

    NSArray<NSNumber *> *offsets = [self strongIvarOffsetsForClass:cls];
    NSDictionary<NSNumber *, NSString *> *ivarNames = BuildIvarOffsetTable(cls);

    uintptr_t baseAddr = (uintptr_t)(__bridge void *)obj;
    NSMutableArray *results = [NSMutableArray array];

    for (NSNumber *offsetNum in offsets) {
        NSUInteger offset = offsetNum.unsignedIntegerValue;
        uintptr_t slotAddr = baseAddr + offset;

        uintptr_t refAddr = 0;
        if (!WNSafeReadPointer(slotAddr, &refAddr)) continue;
        if (refAddr == 0) continue;

        Class refClass = nil;
        @try {
            refClass = object_getClass((__bridge id)(void *)refAddr);
            if (!refClass) continue;
            (void)class_getName(refClass);
        } @catch (NSException *e) {
            continue;
        }

        NSString *name = ivarNames[offsetNum] ?: [NSString stringWithFormat:@"offset_%lu", (unsigned long)offset];
        NSString *className = NSStringFromClass(refClass) ?: @"?";

        [results addObject:@{
            @"name":      name,
            @"offset":    offsetNum,
            @"address":   [NSString stringWithFormat:@"0x%lx", (unsigned long)refAddr],
            @"className": className,
            @"source":    @"ivar",
        }];
    }

    return [results copy];
}

@end
