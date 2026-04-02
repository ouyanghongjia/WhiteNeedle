#import "WNLeakDetector.h"
#import "WNHeapScanner.h"
#import "WNObjCBridge.h"
#import <objc/runtime.h>
#import <malloc/malloc.h>

static NSString *const kLogPrefix = @"[WNLeakDetector]";

#pragma mark - Snapshot storage

static NSMutableDictionary<NSString *, NSDictionary *> *sSnapshots;

static void EnsureSnapshotStore(void) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sSnapshots = [NSMutableDictionary dictionary];
    });
}

#pragma mark - Ivar-based strong reference scanning

static NSArray<NSDictionary *> *GetStrongIvarReferences(id obj) {
    if (!obj) return @[];

    NSMutableArray *refs = [NSMutableArray array];
    Class cls = object_getClass(obj);

    while (cls && cls != [NSObject class]) {
        unsigned int count = 0;
        Ivar *ivars = class_copyIvarList(cls, &count);
        for (unsigned int i = 0; i < count; i++) {
            const char *type = ivar_getTypeEncoding(ivars[i]);
            if (!type || type[0] != '@') continue;

            id ref = nil;
            @try {
                ref = object_getIvar(obj, ivars[i]);
            } @catch (NSException *e) {
                continue;
            }
            if (!ref) continue;

            const char *ivarName = ivar_getName(ivars[i]);
            [refs addObject:@{
                @"name":      ivarName ? @(ivarName) : @"?",
                @"type":      @(type),
                @"address":   [NSString stringWithFormat:@"%p", ref],
                @"className": NSStringFromClass([ref class]) ?: @"?",
            }];
        }
        if (ivars) free(ivars);
        cls = class_getSuperclass(cls);
    }

    return [refs copy];
}

#pragma mark - Cycle detection (DFS)

static NSArray *DetectCyclesFromObject(id startObj, NSUInteger maxDepth) {
    if (!startObj || maxDepth == 0) return @[];

    NSMutableArray *cycles = [NSMutableArray array];
    NSMutableDictionary *visited = [NSMutableDictionary dictionary]; // address -> pathIndex
    NSMutableArray *pathStack = [NSMutableArray array]; // array of { className, ivarName, address }

    void (^__block dfs)(id, NSUInteger);
    dfs = ^(id obj, NSUInteger depth) {
        if (!obj || depth > maxDepth) return;

        NSString *addr = [NSString stringWithFormat:@"%p", obj];
        if (visited[addr]) {
            NSUInteger cycleStart = [visited[addr] unsignedIntegerValue];
            NSMutableArray *cycle = [NSMutableArray array];
            for (NSUInteger idx = cycleStart; idx < pathStack.count; idx++) {
                [cycle addObject:pathStack[idx]];
            }
            if (cycle.count > 1) {
                [cycles addObject:cycle];
            }
            return;
        }

        NSDictionary *node = @{
            @"address":   addr,
            @"className": NSStringFromClass([obj class]) ?: @"?",
        };
        visited[addr] = @(pathStack.count);
        [pathStack addObject:node];

        NSArray *ivarRefs = GetStrongIvarReferences(obj);
        for (NSDictionary *ref in ivarRefs) {
            NSString *refAddr = ref[@"address"];
            if (!refAddr) continue;

            unsigned long long addrVal = 0;
            NSScanner *scanner = [NSScanner scannerWithString:refAddr];
            [scanner scanHexLongLong:&addrVal];
            if (addrVal == 0) continue;

            id refObj = (__bridge id)(void *)(uintptr_t)addrVal;
            if (!refObj) continue;

            NSMutableDictionary *edgeNode = [ref mutableCopy];
            visited[refAddr] = @(pathStack.count);
            [pathStack addObject:edgeNode];
            dfs(refObj, depth + 1);
            [pathStack removeLastObject];
            [visited removeObjectForKey:refAddr];
        }

        [pathStack removeLastObject];
        [visited removeObjectForKey:addr];
    };

    dfs(startObj, 0);
    return [cycles copy];
}

#pragma mark - JSContext registration

@implementation WNLeakDetector

+ (void)registerInContext:(JSContext *)context {
    EnsureSnapshotStore();

    JSValue *ns = [JSValue valueWithNewObjectInContext:context];

    // LeakDetector.takeSnapshot(tag?, filter?) → snapshotId
    ns[@"takeSnapshot"] = ^NSString *(JSValue *tagVal, JSValue *filterVal) {
        NSString *tag = (tagVal && ![tagVal isUndefined] && ![tagVal isNull])
            ? [tagVal toString] : [[NSUUID UUID] UUIDString];
        NSString *filter = (filterVal && ![filterVal isUndefined] && ![filterVal isNull])
            ? [filterVal toString] : nil;

        NSLog(@"%@ Taking snapshot: %@", kLogPrefix, tag);
        NSDictionary *snapshot = [WNHeapScanner heapSnapshotWithFilter:filter maxCount:0];
        @synchronized (sSnapshots) {
            sSnapshots[tag] = snapshot;
        }
        NSLog(@"%@ Snapshot '%@' captured (%lu classes)", kLogPrefix, tag,
              (unsigned long)snapshot.count);
        return tag;
    };

    // LeakDetector.diffSnapshots(tagBefore, tagAfter) → { grown: [{className, before, after, delta}] }
    ns[@"diffSnapshots"] = ^JSValue *(NSString *tagBefore, NSString *tagAfter) {
        JSContext *ctx = [JSContext currentContext];
        NSDictionary *before, *after;
        @synchronized (sSnapshots) {
            before = sSnapshots[tagBefore];
            after  = sSnapshots[tagAfter];
        }
        if (!before || !after) {
            NSLog(@"%@ diffSnapshots: missing snapshot(s)", kLogPrefix);
            return [JSValue valueWithNewObjectInContext:ctx];
        }

        NSMutableArray *grown = [NSMutableArray array];
        NSMutableSet *allKeys = [NSMutableSet setWithArray:before.allKeys];
        [allKeys addObjectsFromArray:after.allKeys];

        for (NSString *cls in allKeys) {
            NSInteger b = [before[cls] integerValue];
            NSInteger a = [after[cls] integerValue];
            NSInteger delta = a - b;
            if (delta > 0) {
                [grown addObject:@{
                    @"className": cls,
                    @"before":    @(b),
                    @"after":     @(a),
                    @"delta":     @(delta),
                }];
            }
        }

        [grown sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
            return [b[@"delta"] compare:a[@"delta"]];
        }];

        return [JSValue valueWithObject:@{ @"grown": grown } inContext:ctx];
    };

    // LeakDetector.clearSnapshot(tag)
    ns[@"clearSnapshot"] = ^(NSString *tag) {
        @synchronized (sSnapshots) {
            [sSnapshots removeObjectForKey:tag];
        }
    };

    // LeakDetector.clearAllSnapshots()
    ns[@"clearAllSnapshots"] = ^{
        @synchronized (sSnapshots) {
            [sSnapshots removeAllObjects];
        }
    };

    // LeakDetector.getStrongReferences(addressHex) → [{ name, type, address, className }]
    ns[@"getStrongReferences"] = ^JSValue *(NSString *addressHex) {
        JSContext *ctx = [JSContext currentContext];
        if (!addressHex) return [JSValue valueWithObject:@[] inContext:ctx];

        unsigned long long addrVal = 0;
        NSScanner *scanner = [NSScanner scannerWithString:addressHex];
        [scanner scanHexLongLong:&addrVal];
        if (addrVal == 0) return [JSValue valueWithObject:@[] inContext:ctx];

        id obj = (__bridge id)(void *)(uintptr_t)addrVal;
        NSArray *refs = GetStrongIvarReferences(obj);
        return [JSValue valueWithObject:refs inContext:ctx];
    };

    // LeakDetector.scanReferences(addressHex, maxRefs?) → conservative pointer scan
    ns[@"scanReferences"] = ^JSValue *(NSString *addressHex, JSValue *maxRefsVal) {
        JSContext *ctx = [JSContext currentContext];
        if (!addressHex) return [JSValue valueWithObject:@[] inContext:ctx];

        unsigned long long addrVal = 0;
        NSScanner *scanner = [NSScanner scannerWithString:addressHex];
        [scanner scanHexLongLong:&addrVal];
        if (addrVal == 0) return [JSValue valueWithObject:@[] inContext:ctx];

        NSUInteger maxRefs = 256;
        if (maxRefsVal && ![maxRefsVal isUndefined]) {
            maxRefs = [maxRefsVal toUInt32];
        }

        NSArray *refs = [WNHeapScanner scanReferencesFrom:(uintptr_t)addrVal maxDepth:maxRefs];
        return [JSValue valueWithObject:refs inContext:ctx];
    };

    // LeakDetector.detectCycles(addressHex, maxDepth?) → [[{address,className}, ...], ...]
    ns[@"detectCycles"] = ^JSValue *(NSString *addressHex, JSValue *maxDepthVal) {
        JSContext *ctx = [JSContext currentContext];
        if (!addressHex) return [JSValue valueWithObject:@[] inContext:ctx];

        unsigned long long addrVal = 0;
        NSScanner *scanner = [NSScanner scannerWithString:addressHex];
        [scanner scanHexLongLong:&addrVal];
        if (addrVal == 0) return [JSValue valueWithObject:@[] inContext:ctx];

        NSUInteger maxDepth = 10;
        if (maxDepthVal && ![maxDepthVal isUndefined]) {
            maxDepth = [maxDepthVal toUInt32];
        }

        id obj = (__bridge id)(void *)(uintptr_t)addrVal;
        NSArray *cycles = DetectCyclesFromObject(obj, maxDepth);
        return [JSValue valueWithObject:cycles inContext:ctx];
    };

    // LeakDetector.findInstances(className, includeSubclasses?, maxCount?)
    ns[@"findInstances"] = ^JSValue *(NSString *className, JSValue *subVal, JSValue *maxVal) {
        JSContext *ctx = [JSContext currentContext];
        Class cls = NSClassFromString(className);
        if (!cls) return [JSValue valueWithObject:@[] inContext:ctx];

        BOOL includeSubs = (subVal && ![subVal isUndefined]) ? [subVal toBool] : YES;
        NSUInteger maxCount = (maxVal && ![maxVal isUndefined]) ? [maxVal toUInt32] : 1000;

        NSArray *instances = [WNHeapScanner findInstancesOfClass:cls
                                                includeSubclasses:includeSubs
                                                         maxCount:maxCount];
        return [JSValue valueWithObject:instances inContext:ctx];
    };

    context[@"LeakDetector"] = ns;
    NSLog(@"%@ Registered LeakDetector namespace in JSContext", kLogPrefix);
}

@end
