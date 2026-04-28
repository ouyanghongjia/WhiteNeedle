// JSON-RPC method dispatch: split from WNRemoteServer.m (audit M1) — behavior unchanged.
#import "WNRemoteServer.h"
#import "WNJSEngine.h"
#import <JavaScriptCore/JavaScriptCore.h>
#import "WNHookEngine.h"
#import "WNObjCBridge.h"
#import "WNNativeBridge.h"
#import "WNNetworkMonitor.h"
#import "WNUIDebugBridge.h"
#import "WNMockInterceptor.h"

@implementation WNRemoteServer (RPC)

- (id)dispatchMethod:(NSString *)method params:(NSDictionary *)params {
    if ([method isEqualToString:@"ping"]) {
        return @{@"pong": @YES};
    }

    if ([method isEqualToString:@"loadScript"]) {
        NSString *code = params[@"code"];
        NSString *name = params[@"name"];
        if (!code || !name) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing code or name"}];
        BOOL ok = [self.engine loadScript:code name:name];
        return @{@"success": @(ok)};
    }

    if ([method isEqualToString:@"unloadScript"]) {
        NSString *name = params[@"name"];
        if (name) [self.engine unloadScript:name];
        return @{@"success": @YES};
    }

    if ([method isEqualToString:@"evaluate"]) {
        NSString *code = params[@"code"];
        if (!code) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing code"}];
        JSValue *result = [self.engine evaluateScript:code];
        return @{@"value": [result toString] ?: @"undefined"};
    }

    if ([method isEqualToString:@"listScripts"]) {
        return @{@"scripts": [self.engine loadedScriptNames]};
    }

    if ([method isEqualToString:@"listHooks"]) {
        NSMutableArray *all = [[WNHookEngine activeHooks] mutableCopy];
        [all addObjectsFromArray:[WNNativeBridge activeCHooks]];
        return @{@"hooks": all};
    }

    if ([method isEqualToString:@"listHooksDetailed"]) {
        return @{@"hooks": [WNHookEngine activeHooksDetailed]};
    }

    if ([method isEqualToString:@"pauseHook"]) {
        NSString *selector = params[@"selector"];
        if (!selector) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing selector"}];
        BOOL ok = [WNHookEngine pauseHook:selector];
        return @{@"success": @(ok)};
    }

    if ([method isEqualToString:@"resumeHook"]) {
        NSString *selector = params[@"selector"];
        if (!selector) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing selector"}];
        BOOL ok = [WNHookEngine resumeHook:selector];
        return @{@"success": @(ok)};
    }

    if ([method isEqualToString:@"listModules"]) {
        JSValue *result = [self.engine evaluateScript:@"Module.enumerateModules()"];
        return @{@"modules": [result toArray] ?: @[]};
    }

    if ([method isEqualToString:@"getClassNames"]) {
        NSString *filter = params[@"filter"];
        NSArray *names = [WNObjCBridge allClassNames:filter];
        return @{@"classes": names};
    }

    if ([method isEqualToString:@"getMethods"]) {
        NSString *className = params[@"className"];
        if (!className) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing className"}];
        Class cls = NSClassFromString(className);
        if (!cls) {
            return @{@"instanceMethods": @[], @"classMethods": @[]};
        }
        NSArray *methods = [WNObjCBridge methodsForClass:cls isInstance:YES];
        NSArray *classMethods = [WNObjCBridge methodsForClass:cls isInstance:NO];
        return @{@"instanceMethods": methods, @"classMethods": classMethods};
    }

    if ([method isEqualToString:@"rpcCall"]) {
        NSString *fnName = params[@"method"];
        NSArray *args = params[@"args"] ?: @[];
        if (!fnName) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing method"}];

        NSString *callCode = [NSString stringWithFormat:@"typeof rpc !== 'undefined' && rpc.exports && rpc.exports.%@? rpc.exports.%@(%@) : undefined",
                              fnName, fnName, [self jsArgsString:args]];
        JSValue *result = [self.engine evaluateScript:callCode];
        id obj = [result toObject];
        if (!obj || [result isUndefined]) return [NSNull null];
        if ([NSJSONSerialization isValidJSONObject:obj]) return obj;
        return [result toString] ?: [NSNull null];
    }

    // --- Network Monitor ---

    if ([method isEqualToString:@"listNetworkRequests"]) {
        return @{@"requests": [[WNNetworkMonitor shared] capturedRequestList]};
    }

    if ([method isEqualToString:@"getNetworkRequest"]) {
        NSString *reqId = params[@"id"];
        if (!reqId) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing id"}];
        NSDictionary *detail = [[WNNetworkMonitor shared] requestDetailForId:reqId];
        return detail ?: [NSNull null];
    }

    if ([method isEqualToString:@"clearNetworkRequests"]) {
        [[WNNetworkMonitor shared] clearAll];
        return @{@"success": @YES};
    }

    if ([method isEqualToString:@"setNetworkCapture"]) {
        NSNumber *enabled = params[@"enabled"];
        if (enabled) [WNNetworkMonitor shared].capturing = [enabled boolValue];
        return @{@"capturing": @([WNNetworkMonitor shared].capturing)};
    }

    // --- View Hierarchy Inspector ---

    if ([method isEqualToString:@"getViewHierarchy"]) {
        return @{@"tree": [WNUIDebugBridge viewHierarchyTree]};
    }

    if ([method isEqualToString:@"getViewControllers"]) {
        return @{@"tree": [WNUIDebugBridge viewControllerTree]};
    }

    if ([method isEqualToString:@"getVCDetail"]) {
        NSString *addr = params[@"address"];
        if (!addr) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing address"}];
        NSDictionary *detail = [WNUIDebugBridge vcDetailForAddress:addr];
        return detail ?: [NSNull null];
    }

    if ([method isEqualToString:@"getViewDetail"]) {
        NSString *addr = params[@"address"];
        if (!addr) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing address"}];
        NSDictionary *detail = [WNUIDebugBridge viewDetailForAddress:addr];
        return detail ?: [NSNull null];
    }

    if ([method isEqualToString:@"setViewProperty"]) {
        NSString *addr = params[@"address"];
        NSString *key = params[@"key"];
        id value = params[@"value"];
        if (!addr || !key) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing address or key"}];
        BOOL ok = [WNUIDebugBridge setViewProperty:addr key:key value:value];
        return @{@"success": @(ok)};
    }

    if ([method isEqualToString:@"highlightView"]) {
        NSString *addr = params[@"address"];
        if (!addr) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing address"}];
        BOOL ok = [WNUIDebugBridge highlightView:addr];
        return @{@"success": @(ok)};
    }

    if ([method isEqualToString:@"clearHighlight"]) {
        [WNUIDebugBridge clearHighlight];
        return @{@"success": @YES};
    }

    if ([method isEqualToString:@"searchViews"]) {
        NSString *className = params[@"className"];
        if (!className) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing className"}];
        return @{@"views": [WNUIDebugBridge searchViewsByClassName:className]};
    }

    if ([method isEqualToString:@"searchViewsByText"]) {
        NSString *text = params[@"text"];
        if (!text) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing text"}];
        return @{@"views": [WNUIDebugBridge searchViewsByText:text]};
    }

    if ([method isEqualToString:@"getScreenshot"]) {
        NSString *b64 = [WNUIDebugBridge screenshotBase64];
        return @{@"base64": b64 ?: [NSNull null]};
    }

    // --- Mock Interceptor ---

    if ([method isEqualToString:@"listMockRules"]) {
        return @{@"rules": [[WNMockInterceptor shared] allRules]};
    }

    if ([method isEqualToString:@"addMockRule"]) {
        WNMockRule *rule = [WNMockRule ruleFromDictionary:params];
        [[WNMockInterceptor shared] addRule:rule];
        return [rule toDictionary];
    }

    if ([method isEqualToString:@"updateMockRule"]) {
        NSString *ruleId = params[@"ruleId"];
        if (!ruleId) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing ruleId"}];
        [[WNMockInterceptor shared] updateRule:ruleId withDict:params];
        return @{@"success": @YES};
    }

    if ([method isEqualToString:@"removeMockRule"]) {
        NSString *ruleId = params[@"ruleId"];
        if (!ruleId) return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing ruleId"}];
        [[WNMockInterceptor shared] removeRule:ruleId];
        return @{@"success": @YES};
    }

    if ([method isEqualToString:@"removeAllMockRules"]) {
        [[WNMockInterceptor shared] removeAllRules];
        return @{@"success": @YES};
    }

    if ([method isEqualToString:@"enableMockInterceptor"]) {
        [[WNMockInterceptor shared] install];
        return @{@"success": @YES, @"installed": @YES};
    }

    if ([method isEqualToString:@"disableMockInterceptor"]) {
        [[WNMockInterceptor shared] uninstall];
        return @{@"success": @YES, @"installed": @NO};
    }

    if ([method isEqualToString:@"getMockInterceptorStatus"]) {
        return @{@"installed": @([WNMockInterceptor shared].installed),
                 @"ruleCount": @([WNMockInterceptor shared].allRules.count)};
    }

    // --- JSContext Reset ---

    if ([method isEqualToString:@"resetContext"]) {
        [self.engine resetContext];
        return @{@"success": @YES};
    }

    // --- File System Operations (sandboxed to Documents/) ---

    if ([method isEqualToString:@"writeFile"]) {
        NSString *relativePath = params[@"path"];
        NSString *content = params[@"content"];
        if (!relativePath || !content) {
            return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing path or content"}];
        }
        NSString *docPath = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
        NSString *fullPath = [docPath stringByAppendingPathComponent:relativePath];

        NSString *dir = [fullPath stringByDeletingLastPathComponent];
        NSFileManager *fm = [NSFileManager defaultManager];
        NSError *err;
        [fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:&err];
        if (err) {
            return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: err.localizedDescription}];
        }
        BOOL okW = [content writeToFile:fullPath atomically:YES encoding:NSUTF8StringEncoding error:&err];
        if (!okW) {
            return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: err.localizedDescription ?: @"writeFile failed"}];
        }
        return @{@"success": @YES};
    }

    if ([method isEqualToString:@"mkdir"]) {
        NSString *relativePath = params[@"path"];
        if (!relativePath) {
            return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing path"}];
        }
        NSString *docPath = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
        NSString *fullPath = [docPath stringByAppendingPathComponent:relativePath];
        NSError *err;
        [[NSFileManager defaultManager] createDirectoryAtPath:fullPath withIntermediateDirectories:YES attributes:nil error:&err];
        if (err) {
            return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: err.localizedDescription}];
        }
        return @{@"success": @YES};
    }

    if ([method isEqualToString:@"removeDir"]) {
        NSString *relativePath = params[@"path"];
        if (!relativePath) {
            return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Missing path"}];
        }
        NSString *docPath = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
        NSString *fullPath = [docPath stringByAppendingPathComponent:relativePath];
        NSFileManager *fmR = [NSFileManager defaultManager];
        if ([fmR fileExistsAtPath:fullPath]) {
            NSError *err;
            [fmR removeItemAtPath:fullPath error:&err];
            if (err) {
                return [NSError errorWithDomain:@"WN" code:1 userInfo:@{NSLocalizedDescriptionKey: err.localizedDescription}];
            }
        }
        return @{@"success": @YES};
    }

    if ([method isEqualToString:@"listInstalledJsModules"]) {
        NSString *docPath = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
        NSString *modulesDir = [docPath stringByAppendingPathComponent:@"wn_installed_modules"];
        NSFileManager *fm2 = [NSFileManager defaultManager];
        NSMutableArray *modules = [NSMutableArray array];
        if ([fm2 fileExistsAtPath:modulesDir]) {
            NSArray *contents = [fm2 contentsOfDirectoryAtPath:modulesDir error:nil];
            for (NSString *name in contents) {
                if ([name hasPrefix:@"."]) continue;
                NSString *fullPath = [modulesDir stringByAppendingPathComponent:name];
                NSDictionary *attrs = [fm2 attributesOfItemAtPath:fullPath error:nil];
                [modules addObject:@{
                    @"name": name,
                    @"size": attrs[NSFileSize] ?: @(0)
                }];
            }
        }
        return @{@"modules": modules};
    }

    return [NSError errorWithDomain:@"WN" code:-32601
                           userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Unknown method: %@", method]}];
}

- (NSString *)jsArgsString:(NSArray *)args {
    NSMutableArray *parts = [NSMutableArray array];
    for (id arg in args) {
        NSData *data = [NSJSONSerialization dataWithJSONObject:@[arg] options:0 error:nil];
        if (data) {
            NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            json = [json substringWithRange:NSMakeRange(1, json.length - 2)];
            [parts addObject:json];
        }
    }
    return [parts componentsJoinedByString:@","];
}

@end
