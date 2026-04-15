#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNBlockAnalyzer — Extracts strongly-captured variables from ObjC blocks.
 *
 * Uses the public Block ABI layout + a "release-detector" black-box technique
 * (borrowed from FBRetainCycleDetector) to determine which captured slots are
 * retained by the block's copy/dispose helpers.
 *
 * ARC-compatible — uses runtime-created sentinel classes instead of manual retain/release.
 */
@interface WNBlockAnalyzer : NSObject

/// Strongly-captured object references inside a block.
/// @return [{ index, address, className, source:"block_capture" }]
+ (NSArray<NSDictionary *> *)strongCapturesOfBlock:(id)blockObj;

/// YES if `obj` is an ObjC block (isa ∈ { __NSGlobalBlock__, __NSStackBlock__, __NSMallocBlock__ }).
+ (BOOL)isBlock:(id)obj;

@end

NS_ASSUME_NONNULL_END
