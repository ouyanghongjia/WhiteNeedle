#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNHeapScanner — Modular heap scanning for ObjC.choose() and leak detection.
 *
 * Walks all malloc zones via `malloc_get_all_zones` and validates candidate
 * pointers using isa checks + `vm_region`. This module is self-contained so
 * it can be removed cleanly if the feature proves unreliable.
 */
@interface WNHeapScanner : NSObject

/**
 * Find all live heap instances of `targetClass` (including subclasses).
 * Returns an array of dictionaries: { address, className, size }.
 * Thread-safe: suspends GC-unfriendly work with @try/@catch guards.
 */
+ (NSArray<NSDictionary *> *)findInstancesOfClass:(Class)targetClass
                                  includeSubclasses:(BOOL)includeSubs
                                           maxCount:(NSUInteger)maxCount;

/**
 * Take a lightweight snapshot of per-class instance counts on the heap.
 * Returns { className → count }.  Used for leak-detection diffs.
 * Only counts classes whose name matches `filter` (nil = all ObjC objects).
 */
+ (NSDictionary<NSString *, NSNumber *> *)heapSnapshotWithFilter:(nullable NSString *)filter
                                                        maxCount:(NSUInteger)maxCount;

/**
 * Scan an object's memory for pointers to other heap-allocated ObjC objects.
 * Conservative pointer scan — used to build reference graphs.
 * Returns array of { offset, address, className }.
 */
+ (NSArray<NSDictionary *> *)scanReferencesFrom:(uintptr_t)objectAddress
                                       maxDepth:(NSUInteger)maxRefs;

@end

NS_ASSUME_NONNULL_END
