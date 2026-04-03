#import "WNRefGraphDetector.h"
#import "WNRefGraphBuilder.h"
#import "WNAssocTracker.h"
#import <JavaScriptCore/JavaScriptCore.h>

static NSString *const kLogPrefix = @"[WNRefGraphDetector]";

@implementation WNRefGraphDetector

+ (void)registerInContext:(JSContext *)context {
    if (!context) return;

    [WNAssocTracker installIfSafe];

    JSValue *ns = [JSValue valueWithNewObjectInContext:context];

    // RefGraph.isAvailable() → true
    ns[@"isAvailable"] = ^BOOL {
        return YES;
    };

    // RefGraph.buildGraph(address, maxNodes?, maxDepth?)
    // → { nodes: [...], edges: [...], cycles: [[nodeId, ...], ...] }
    ns[@"buildGraph"] = ^JSValue *(NSString *address, JSValue *maxNodesVal, JSValue *maxDepthVal) {
        JSContext *ctx = [JSContext currentContext];
        if (!address.length) {
            return [JSValue valueWithObject:@{@"error": @"address required"} inContext:ctx];
        }

        NSUInteger maxNodes = 200;
        NSUInteger maxDepth = 15;

        if (maxNodesVal && ![maxNodesVal isUndefined] && ![maxNodesVal isNull]) {
            maxNodes = [maxNodesVal toUInt32];
        }
        if (maxDepthVal && ![maxDepthVal isUndefined] && ![maxDepthVal isNull]) {
            maxDepth = [maxDepthVal toUInt32];
        }

        NSDictionary *result = [WNRefGraphBuilder buildGraphFromAddress:address
                                                              maxNodes:maxNodes
                                                              maxDepth:maxDepth];
        return [JSValue valueWithObject:result inContext:ctx];
    };

    // RefGraph.expandNode(address)
    // → [{ label, address, className, source }]
    ns[@"expandNode"] = ^JSValue *(NSString *address) {
        JSContext *ctx = [JSContext currentContext];
        if (!address.length) {
            return [JSValue valueWithObject:@[] inContext:ctx];
        }
        NSArray *refs = [WNRefGraphBuilder expandNodeAtAddress:address];
        return [JSValue valueWithObject:refs inContext:ctx];
    };

    // RefGraph.getNodeDetail(address)
    // → { className, address, retainCount, size, ivars, blockCaptures, assocObjects }
    ns[@"getNodeDetail"] = ^JSValue *(NSString *address) {
        JSContext *ctx = [JSContext currentContext];
        if (!address.length) {
            return [JSValue valueWithObject:@{@"error": @"address required"} inContext:ctx];
        }
        NSDictionary *detail = [WNRefGraphBuilder nodeDetailAtAddress:address];
        return [JSValue valueWithObject:detail inContext:ctx];
    };

    context[@"RefGraph"] = ns;
    NSLog(@"%@ Registered RefGraph namespace in JSContext", kLogPrefix);
}

@end
