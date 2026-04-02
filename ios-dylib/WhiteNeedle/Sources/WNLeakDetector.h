#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNLeakDetector — Snapshot-diff and reference-graph based leak detection.
 *
 * Built on top of WNHeapScanner.  Provides:
 *   1. Heap snapshots (takeSnapshot / diffSnapshots)
 *   2. Strong-reference introspection via ivar scanning
 *   3. Conservative reference-graph building
 *   4. Retain-cycle DFS detection
 *
 * Self-contained module — remove WNLeakDetector.{h,m} + WNHeapScanner.{h,m}
 * and the two `registerInContext:` calls to strip the feature entirely.
 */
@interface WNLeakDetector : NSObject

+ (void)registerInContext:(JSContext *)context;

@end

NS_ASSUME_NONNULL_END
