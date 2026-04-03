#import "WNRefGraphBuilder.h"
#import "WNIvarLayoutParser.h"
#import "WNBlockAnalyzer.h"
#import "WNAssocTracker.h"
#import "WNCollectionEnumerator.h"
#import <objc/runtime.h>
#import <mach/mach.h>
#import <CoreFoundation/CoreFoundation.h>

static NSString *const kLogPrefix = @"[WNRefGraphBuilder]";

#pragma mark - Pointer validation

static BOOL WNIsReadablePointer(uintptr_t addr) {
    if (addr < 0x1000) return NO;
    vm_size_t size = 0;
    vm_address_t vmAddr = (vm_address_t)addr;
    mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
    vm_region_basic_info_data_64_t info;
    mach_port_t objectName;

    kern_return_t kr = vm_region_64(mach_task_self(),
                                    &vmAddr,
                                    &size,
                                    VM_REGION_BASIC_INFO_64,
                                    (vm_region_info_t)&info,
                                    &count,
                                    &objectName);
    if (kr != KERN_SUCCESS) return NO;
    return (vmAddr <= (vm_address_t)addr) && (info.protection & VM_PROT_READ);
}

static BOOL WNIsObjCObjectSafe(uintptr_t addr) {
    if (!WNIsReadablePointer(addr)) return NO;

    @try {
        uintptr_t isaRaw = 0;
        vm_size_t outSize = 0;
        kern_return_t kr = vm_read_overwrite(mach_task_self(),
                                              (vm_address_t)addr,
                                              sizeof(uintptr_t),
                                              (vm_address_t)&isaRaw,
                                              &outSize);
        if (kr != KERN_SUCCESS || outSize < sizeof(uintptr_t)) return NO;

#if __arm64__
        isaRaw &= 0x0000000FFFFFFFF8ULL;
#endif

        if (!WNIsReadablePointer(isaRaw)) return NO;

        Class cls = (__bridge Class)(void *)isaRaw;
        const char *name = class_getName(cls);
        if (!name || name[0] == '\0') return NO;

        return class_respondsToSelector(cls, @selector(class));
    } @catch (NSException *e) {
        return NO;
    }
}

static id WNSafeObjectFromAddress(uintptr_t addr) {
    if (!WNIsObjCObjectSafe(addr)) return nil;
    @try {
        return (__bridge id)(void *)addr;
    } @catch (NSException *e) {
        return nil;
    }
}

static uintptr_t WNParseAddress(NSString *hex) {
    if (!hex) return 0;
    unsigned long long val = 0;
    NSScanner *scanner = [NSScanner scannerWithString:hex];
    [scanner scanHexLongLong:&val];
    return (uintptr_t)val;
}

static NSString *WNAddressString(uintptr_t addr) {
    return [NSString stringWithFormat:@"0x%lx", (unsigned long)addr];
}

#pragma mark - Collect all strong references for an object

static NSArray<NSDictionary *> *WNCollectStrongReferences(id obj) {
    NSMutableArray *allRefs = [NSMutableArray array];

    @try {
        NSArray *ivarRefs = [WNIvarLayoutParser strongIvarReferencesForObject:obj];
        [allRefs addObjectsFromArray:ivarRefs];
    } @catch (NSException *e) {
        NSLog(@"%@ ivar scan exception: %@", kLogPrefix, e);
    }

    @try {
        if ([WNBlockAnalyzer isBlock:obj]) {
            NSArray *blockRefs = [WNBlockAnalyzer strongCapturesOfBlock:obj];
            [allRefs addObjectsFromArray:blockRefs];
        }
    } @catch (NSException *e) {
        NSLog(@"%@ block scan exception: %@", kLogPrefix, e);
    }

    @try {
        NSArray *assocRefs = [WNAssocTracker strongAssociationsForObject:obj];
        [allRefs addObjectsFromArray:assocRefs];
    } @catch (NSException *e) {
        NSLog(@"%@ assoc scan exception: %@", kLogPrefix, e);
    }

    @try {
        if ([WNCollectionEnumerator isCollection:obj]) {
            NSArray *collRefs = [WNCollectionEnumerator strongReferencesInCollection:obj];
            [allRefs addObjectsFromArray:collRefs];
        }
    } @catch (NSException *e) {
        NSLog(@"%@ collection scan exception: %@", kLogPrefix, e);
    }

    return allRefs;
}

#pragma mark - Tarjan SCC

@interface WNTarjanContext : NSObject {
@public
    NSMutableDictionary<NSString *, NSNumber *> *indexMap;
    NSMutableDictionary<NSString *, NSNumber *> *lowlinkMap;
    NSMutableDictionary<NSString *, NSNumber *> *onStackMap;
    NSMutableArray<NSString *> *stack;
    NSInteger currentIndex;
    NSMutableArray<NSArray<NSString *> *> *sccs;
}
@end
@implementation WNTarjanContext
@end

static void TarjanStrongConnect(NSString *nodeId,
                                NSDictionary<NSString *, NSArray<NSString *> *> *adjacency,
                                WNTarjanContext *ctx) {
    ctx->indexMap[nodeId] = @(ctx->currentIndex);
    ctx->lowlinkMap[nodeId] = @(ctx->currentIndex);
    ctx->currentIndex++;
    [ctx->stack addObject:nodeId];
    ctx->onStackMap[nodeId] = @YES;

    NSArray<NSString *> *neighbors = adjacency[nodeId] ?: @[];
    for (NSString *neighbor in neighbors) {
        if (!ctx->indexMap[neighbor]) {
            TarjanStrongConnect(neighbor, adjacency, ctx);
            NSInteger myLow = ctx->lowlinkMap[nodeId].integerValue;
            NSInteger nLow = ctx->lowlinkMap[neighbor].integerValue;
            ctx->lowlinkMap[nodeId] = @(MIN(myLow, nLow));
        } else if (ctx->onStackMap[neighbor].boolValue) {
            NSInteger myLow = ctx->lowlinkMap[nodeId].integerValue;
            NSInteger nIdx = ctx->indexMap[neighbor].integerValue;
            ctx->lowlinkMap[nodeId] = @(MIN(myLow, nIdx));
        }
    }

    if (ctx->lowlinkMap[nodeId].integerValue == ctx->indexMap[nodeId].integerValue) {
        NSMutableArray<NSString *> *component = [NSMutableArray array];
        NSString *w;
        do {
            w = ctx->stack.lastObject;
            [ctx->stack removeLastObject];
            ctx->onStackMap[w] = @NO;
            [component addObject:w];
        } while (![w isEqualToString:nodeId]);

        if (component.count > 1) {
            [ctx->sccs addObject:[component copy]];
        }
    }
}

static NSArray<NSArray<NSString *> *> *WNDetectCycles(NSArray<NSDictionary *> *nodes,
                                                      NSArray<NSDictionary *> *edges) {
    NSMutableDictionary<NSString *, NSArray<NSString *> *> *adjacency = [NSMutableDictionary dictionary];

    for (NSDictionary *node in nodes) {
        NSString *nid = node[@"id"];
        if (nid && !adjacency[nid]) {
            adjacency[nid] = [NSMutableArray array];
        }
    }

    for (NSDictionary *edge in edges) {
        NSString *from = edge[@"from"];
        NSString *to = edge[@"to"];
        if (from && to) {
            NSMutableArray *list = (NSMutableArray *)adjacency[from];
            if (!list) {
                list = [NSMutableArray array];
                adjacency[from] = list;
            }
            [list addObject:to];
        }
    }

    WNTarjanContext *ctx = [[WNTarjanContext alloc] init];
    ctx->indexMap = [NSMutableDictionary dictionary];
    ctx->lowlinkMap = [NSMutableDictionary dictionary];
    ctx->onStackMap = [NSMutableDictionary dictionary];
    ctx->stack = [NSMutableArray array];
    ctx->currentIndex = 0;
    ctx->sccs = [NSMutableArray array];

    for (NSString *nodeId in adjacency.allKeys) {
        if (!ctx->indexMap[nodeId]) {
            TarjanStrongConnect(nodeId, adjacency, ctx);
        }
    }

    return [ctx->sccs copy];
}

#pragma mark - Public API

@implementation WNRefGraphBuilder

+ (NSDictionary *)buildGraphFromAddress:(NSString *)rootAddress
                               maxNodes:(NSUInteger)maxNodes
                               maxDepth:(NSUInteger)maxDepth {
    if (!rootAddress.length) {
        return @{@"nodes": @[], @"edges": @[], @"cycles": @[], @"error": @"empty address"};
    }

    if (maxNodes == 0) maxNodes = 200;
    if (maxDepth == 0) maxDepth = 15;

    uintptr_t rootAddr = WNParseAddress(rootAddress);
    id rootObj = WNSafeObjectFromAddress(rootAddr);
    if (!rootObj) {
        return @{@"nodes": @[], @"edges": @[], @"cycles": @[],
                 @"error": @"invalid or freed object at root address"};
    }

    NSMutableArray<NSDictionary *> *nodes = [NSMutableArray array];
    NSMutableArray<NSDictionary *> *edges = [NSMutableArray array];
    NSMutableSet<NSString *> *visited = [NSMutableSet set];

    NSMutableArray<NSArray *> *queue = [NSMutableArray array];
    [queue addObject:@[@(rootAddr), @(0)]];

    while (queue.count > 0 && nodes.count < maxNodes) {
        NSArray *item = queue.firstObject;
        [queue removeObjectAtIndex:0];

        uintptr_t addr = [item[0] unsignedLongValue];
        NSUInteger depth = [item[1] unsignedIntegerValue];

        NSString *nodeId = WNAddressString(addr);
        if ([visited containsObject:nodeId]) continue;
        [visited addObject:nodeId];

        id obj = WNSafeObjectFromAddress(addr);
        if (!obj) continue;

        BOOL isBlock = NO;
        @try { isBlock = [WNBlockAnalyzer isBlock:obj]; } @catch (NSException *e) {}

        NSDictionary *node = @{
            @"id":          nodeId,
            @"className":   NSStringFromClass([obj class]) ?: @"?",
            @"address":     nodeId,
            @"retainCount": @(CFGetRetainCount((__bridge CFTypeRef)obj)),
            @"instanceSize":@(class_getInstanceSize([obj class])),
            @"isBlock":     @(isBlock),
        };
        [nodes addObject:node];

        if (depth >= maxDepth) continue;

        NSArray<NSDictionary *> *refs = WNCollectStrongReferences(obj);
        for (NSDictionary *ref in refs) {
            NSString *refAddr = ref[@"address"];
            if (!refAddr) continue;

            NSString *label = ref[@"name"] ?: ref[@"key"] ?: ref[@"index"] ?: ref[@"source"] ?: @"";
            NSString *source = ref[@"source"] ?: @"unknown";

            NSDictionary *edge = @{
                @"from":   nodeId,
                @"to":     refAddr,
                @"label":  label,
                @"source": source,
            };
            [edges addObject:edge];

            if (![visited containsObject:refAddr]) {
                uintptr_t refAddrVal = WNParseAddress(refAddr);
                if (refAddrVal != 0) {
                    [queue addObject:@[@(refAddrVal), @(depth + 1)]];
                }
            }
        }
    }

    NSArray<NSArray<NSString *> *> *cycles = WNDetectCycles(nodes, edges);

    return @{
        @"nodes":  nodes,
        @"edges":  edges,
        @"cycles": cycles,
    };
}

+ (NSArray<NSDictionary *> *)expandNodeAtAddress:(NSString *)address {
    uintptr_t addr = WNParseAddress(address);
    id obj = WNSafeObjectFromAddress(addr);
    if (!obj) return @[];

    return WNCollectStrongReferences(obj);
}

+ (NSDictionary *)nodeDetailAtAddress:(NSString *)address {
    uintptr_t addr = WNParseAddress(address);
    id obj = WNSafeObjectFromAddress(addr);
    if (!obj) {
        return @{@"error": @"invalid or freed object"};
    }

    NSArray *ivars = @[];
    NSArray *blockCaptures = @[];
    NSArray *assocObjects = @[];

    @try { ivars = [WNIvarLayoutParser strongIvarReferencesForObject:obj]; }
    @catch (NSException *e) {}

    @try {
        if ([WNBlockAnalyzer isBlock:obj]) {
            blockCaptures = [WNBlockAnalyzer strongCapturesOfBlock:obj];
        }
    } @catch (NSException *e) {}

    @try { assocObjects = [WNAssocTracker strongAssociationsForObject:obj]; }
    @catch (NSException *e) {}

    return @{
        @"className":     NSStringFromClass([obj class]) ?: @"?",
        @"address":       address,
        @"retainCount":   @(CFGetRetainCount((__bridge CFTypeRef)obj)),
        @"size":          @(class_getInstanceSize([obj class])),
        @"isBlock":       @([WNBlockAnalyzer isBlock:obj]),
        @"ivars":         ivars,
        @"blockCaptures": blockCaptures,
        @"assocObjects":  assocObjects,
    };
}

@end
