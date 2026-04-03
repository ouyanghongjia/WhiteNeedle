#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNRefGraphBuilder — Builds a reference graph from a root object using BFS,
 * then detects retain cycles via Tarjan's SCC algorithm.
 *
 * Combines outputs from WNIvarLayoutParser, WNBlockAnalyzer,
 * WNAssocTracker, and WNCollectionEnumerator.
 */
@interface WNRefGraphBuilder : NSObject

/// Build a full reference graph starting from rootAddress.
/// @param rootAddress hex address string like "0x1a2b3c4d"
/// @param maxNodes maximum nodes to visit (default 200)
/// @param maxDepth maximum BFS depth (default 15)
/// @return { nodes: [...], edges: [...], cycles: [[nodeId, ...], ...] }
+ (NSDictionary *)buildGraphFromAddress:(NSString *)rootAddress
                               maxNodes:(NSUInteger)maxNodes
                               maxDepth:(NSUInteger)maxDepth;

/// Expand a single node's direct strong references (for lazy loading).
/// @return [{ label, address, className, source }]
+ (NSArray<NSDictionary *> *)expandNodeAtAddress:(NSString *)address;

/// Get detailed info about a single node.
/// @return { className, address, retainCount, size, ivars, blockCaptures, assocObjects }
+ (NSDictionary *)nodeDetailAtAddress:(NSString *)address;

@end

NS_ASSUME_NONNULL_END
