#import "WNHeapScanner.h"
#import <objc/runtime.h>
#import <malloc/malloc.h>
#import <mach/mach.h>
#import <mach/vm_map.h>
#if __has_feature(ptrauth_calls)
#import <ptrauth.h>
#endif

static NSString *const kLogPrefix = @"[WNHeapScanner]";

#pragma mark - Pointer validation (internal)

static BOOL WNIsReadableAddress(uintptr_t addr) {
    if (addr == 0 || addr % sizeof(void *) != 0) return NO;

    vm_address_t region = (vm_address_t)addr;
    vm_size_t size = 0;
    vm_region_basic_info_data_64_t info;
    mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
    mach_port_t objName = MACH_PORT_NULL;

    kern_return_t kr = vm_region_64(mach_task_self(), &region, &size,
                                    VM_REGION_BASIC_INFO_64,
                                    (vm_region_info_t)&info, &count, &objName);
    if (kr != KERN_SUCCESS) return NO;
    if (!(info.protection & VM_PROT_READ)) return NO;
    if ((vm_address_t)addr < region || (vm_address_t)addr >= region + size) return NO;
    return YES;
}

static Class WNClassFromIsa(uintptr_t isa) {
    if (isa == 0) return nil;

    uintptr_t clsPtr = isa;
#if __has_feature(ptrauth_calls)
    clsPtr = (uintptr_t)ptrauth_strip((void *)isa, ptrauth_key_process_dependent_data);
#else
    clsPtr = isa & (uintptr_t)0xfffffffffffffff8ULL;
#endif
    if (clsPtr == 0 || clsPtr % sizeof(void *) != 0) return nil;

    if (!WNIsReadableAddress(clsPtr)) return nil;

    return (__bridge Class)(void *)clsPtr;
}

static BOOL WNIsObjCObject(uintptr_t addr, Class *outClass) {
    if (!WNIsReadableAddress(addr)) return NO;
    if (malloc_size((void *)addr) < sizeof(void *)) return NO;

    uintptr_t isa = 0;
    vm_size_t readOut = 0;
    kern_return_t kr = vm_read_overwrite(mach_task_self(), (vm_address_t)addr,
                                         sizeof(uintptr_t), (vm_address_t)&isa, &readOut);
    if (kr != KERN_SUCCESS || readOut < sizeof(uintptr_t)) return NO;

    Class cls = WNClassFromIsa(isa);
    if (!cls) return NO;

    const char *name = class_getName(cls);
    if (!name || name[0] == '\0') return NO;

    if (outClass) *outClass = cls;
    return YES;
}

#pragma mark - Malloc zone enumeration callback

typedef struct {
    Class            targetClass;
    BOOL             includeSubs;
    NSUInteger       maxCount;
    NSMutableArray  *results;
    BOOL             collectCounts;
    NSMutableDictionary *countMap;
} WNHeapScanContext;

static void WNMallocEnumerator(task_t task, void *baton,
                                unsigned type, vm_range_t *ranges,
                                unsigned rangeCount) {
    WNHeapScanContext *ctx = (WNHeapScanContext *)baton;
    if (!ctx) return;

    for (unsigned i = 0; i < rangeCount; i++) {
        if (ctx->maxCount > 0 && ctx->results.count >= ctx->maxCount) return;

        vm_address_t addr = ranges[i].address;
        vm_size_t size = ranges[i].size;

        if (size < sizeof(void *) * 2) continue;

        Class cls = nil;
        @try {
            if (!WNIsObjCObject((uintptr_t)addr, &cls)) continue;
        } @catch (NSException *e) {
            continue;
        }

        if (!cls) continue;

        if (ctx->collectCounts) {
            NSString *name = NSStringFromClass(cls);
            if (name) {
                NSNumber *prev = ctx->countMap[name];
                ctx->countMap[name] = @(prev.unsignedIntegerValue + 1);
            }
            continue;
        }

        if (ctx->targetClass) {
            BOOL match = NO;
            if (ctx->includeSubs) {
                Class c = cls;
                while (c) {
                    if (c == ctx->targetClass) { match = YES; break; }
                    c = class_getSuperclass(c);
                }
            } else {
                match = (cls == ctx->targetClass);
            }
            if (!match) continue;
        }

        NSString *className = NSStringFromClass(cls);
        if (!className) continue;

        [ctx->results addObject:@{
            @"address":   [NSString stringWithFormat:@"0x%lx", (unsigned long)addr],
            @"className": className,
            @"size":      @(size),
        }];
    }
}

#pragma mark - Public API

@implementation WNHeapScanner

+ (NSArray<NSDictionary *> *)findInstancesOfClass:(Class)targetClass
                                  includeSubclasses:(BOOL)includeSubs
                                           maxCount:(NSUInteger)maxCount {
    if (!targetClass) return @[];

    NSMutableArray *results = [NSMutableArray array];

    WNHeapScanContext ctx = {
        .targetClass   = targetClass,
        .includeSubs   = includeSubs,
        .maxCount      = maxCount > 0 ? maxCount : 10000,
        .results       = results,
        .collectCounts = NO,
        .countMap      = nil,
    };

    vm_address_t *zones = NULL;
    unsigned int zoneCount = 0;
    kern_return_t kr = malloc_get_all_zones(mach_task_self(), NULL, &zones, &zoneCount);
    if (kr != KERN_SUCCESS) {
        NSLog(@"%@ malloc_get_all_zones failed: %d", kLogPrefix, kr);
        return @[];
    }

    for (unsigned int z = 0; z < zoneCount; z++) {
        malloc_zone_t *zone = (malloc_zone_t *)zones[z];
        if (!zone || !zone->introspect || !zone->introspect->enumerator) continue;

        @try {
            zone->introspect->enumerator(mach_task_self(),
                                         &ctx,
                                         MALLOC_PTR_IN_USE_RANGE_TYPE,
                                         (vm_address_t)zone,
                                         NULL,
                                         WNMallocEnumerator);
        } @catch (NSException *e) {
            NSLog(@"%@ Zone enumeration exception: %@", kLogPrefix, e);
        }
    }

    NSLog(@"%@ Found %lu instances of %@", kLogPrefix,
          (unsigned long)results.count, NSStringFromClass(targetClass));
    return [results copy];
}

+ (NSDictionary<NSString *, NSNumber *> *)heapSnapshotWithFilter:(nullable NSString *)filter
                                                        maxCount:(NSUInteger)maxCount {
    NSMutableDictionary *countMap = [NSMutableDictionary dictionary];
    NSMutableArray *dummy = [NSMutableArray array];

    WNHeapScanContext ctx = {
        .targetClass   = nil,
        .includeSubs   = NO,
        .maxCount      = maxCount > 0 ? maxCount : NSUIntegerMax,
        .results       = dummy,
        .collectCounts = YES,
        .countMap      = countMap,
    };

    vm_address_t *zones = NULL;
    unsigned int zoneCount = 0;
    kern_return_t kr = malloc_get_all_zones(mach_task_self(), NULL, &zones, &zoneCount);
    if (kr != KERN_SUCCESS) return @{};

    for (unsigned int z = 0; z < zoneCount; z++) {
        malloc_zone_t *zone = (malloc_zone_t *)zones[z];
        if (!zone || !zone->introspect || !zone->introspect->enumerator) continue;

        @try {
            zone->introspect->enumerator(mach_task_self(),
                                         &ctx,
                                         MALLOC_PTR_IN_USE_RANGE_TYPE,
                                         (vm_address_t)zone,
                                         NULL,
                                         WNMallocEnumerator);
        } @catch (NSException *e) {
            continue;
        }
    }

    if (filter.length > 0) {
        NSMutableDictionary *filtered = [NSMutableDictionary dictionary];
        for (NSString *key in countMap) {
            if ([key rangeOfString:filter options:NSCaseInsensitiveSearch].location != NSNotFound) {
                filtered[key] = countMap[key];
            }
        }
        return [filtered copy];
    }

    return [countMap copy];
}

+ (NSArray<NSDictionary *> *)scanReferencesFrom:(uintptr_t)objectAddress
                                       maxDepth:(NSUInteger)maxRefs {
    if (!WNIsReadableAddress(objectAddress)) return @[];

    size_t objectSize = malloc_size((void *)objectAddress);
    if (objectSize < sizeof(void *)) return @[];

    NSMutableArray *refs = [NSMutableArray array];
    NSUInteger limit = maxRefs > 0 ? maxRefs : 256;

    for (size_t offset = 0; offset + sizeof(void *) <= objectSize && refs.count < limit; offset += sizeof(void *)) {
        uintptr_t value = 0;
        vm_size_t readOut = 0;
        kern_return_t kr = vm_read_overwrite(mach_task_self(),
                                             (vm_address_t)(objectAddress + offset),
                                             sizeof(uintptr_t),
                                             (vm_address_t)&value,
                                             &readOut);
        if (kr != KERN_SUCCESS || readOut < sizeof(uintptr_t)) continue;
        if (value == 0 || value == objectAddress) continue;

        Class cls = nil;
        @try {
            if (!WNIsObjCObject(value, &cls)) continue;
        } @catch (NSException *e) {
            continue;
        }

        NSString *className = cls ? NSStringFromClass(cls) : @"?";
        [refs addObject:@{
            @"offset":    @(offset),
            @"address":   [NSString stringWithFormat:@"0x%lx", (unsigned long)value],
            @"className": className,
        }];
    }

    return [refs copy];
}

@end
