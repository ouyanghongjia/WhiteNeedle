#import "WNModuleLoader.h"

static NSString *const kLogPrefix = @"[WNModuleLoader]";

@interface WNModuleEntry : NSObject
@property (nonatomic, copy) NSString *name;
@property (nonatomic, strong) JSValue *exports;
@property (nonatomic, assign) BOOL loaded;
@end

@implementation WNModuleEntry
@end

static NSMutableDictionary<NSString *, WNModuleEntry *> *g_moduleCache;
static NSMutableArray<NSString *> *g_searchPaths;
static NSMutableDictionary<NSString *, NSString *> *g_builtinModules;

@implementation WNModuleLoader

+ (void)initialize {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        g_moduleCache = [NSMutableDictionary new];
        g_searchPaths = [NSMutableArray new];
        g_builtinModules = [NSMutableDictionary new];

        [self buildDefaultSearchPaths];
    });
}

+ (void)buildDefaultSearchPaths {
    [g_searchPaths removeAllObjects];

    NSString *docPath = NSSearchPathForDirectoriesInDomains(
        NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
    if (docPath) {
        [g_searchPaths addObject:[docPath stringByAppendingPathComponent:@"wn_modules"]];
        [g_searchPaths addObject:[docPath stringByAppendingPathComponent:@"wn_installed_modules"]];
    }

    NSString *bundlePath = [[NSBundle mainBundle] bundlePath];
    [g_searchPaths addObject:[bundlePath stringByAppendingPathComponent:@"wn_modules"]];
}

+ (void)clearAllCache {
    [g_moduleCache removeAllObjects];
    NSLog(@"%@ Module cache cleared (all)", kLogPrefix);
}

+ (void)resetSearchPaths {
    [self buildDefaultSearchPaths];
    NSLog(@"%@ Search paths reset to defaults: %@", kLogPrefix, g_searchPaths);
}

+ (void)registerInContext:(JSContext *)context {
    [self registerRequireFunction:context];
    [self registerModuleManagement:context];
    [self installBuiltinModules:context];
    NSLog(@"%@ Module system registered (search paths: %@)", kLogPrefix, g_searchPaths);
}

+ (void)setModuleSearchPaths:(NSArray<NSString *> *)paths {
    [g_searchPaths removeAllObjects];
    [g_searchPaths addObjectsFromArray:paths];
}

+ (void)registerBuiltinModule:(NSString *)name source:(NSString *)source {
    g_builtinModules[name] = source;
}

#pragma mark - require()

+ (void)registerRequireFunction:(JSContext *)context {
    context[@"require"] = ^JSValue *(NSString *moduleName) {
        JSContext *ctx = [JSContext currentContext];
        return [WNModuleLoader resolveModule:moduleName inContext:ctx];
    };
}

+ (JSValue *)resolveModule:(NSString *)moduleName inContext:(JSContext *)ctx {
    WNModuleEntry *cached = g_moduleCache[moduleName];
    if (cached && cached.loaded) {
        return cached.exports;
    }

    NSString *source = [self findModuleSource:moduleName];
    if (!source) {
        NSLog(@"%@ Module not found: %@", kLogPrefix, moduleName);
        ctx.exception = [JSValue valueWithNewErrorFromMessage:
            [NSString stringWithFormat:@"Cannot find module '%@'", moduleName]
            inContext:ctx];
        return [JSValue valueWithUndefinedInContext:ctx];
    }

    return [self executeModule:moduleName source:source inContext:ctx];
}

+ (nullable NSString *)findModuleSource:(NSString *)moduleName {
    NSString *builtin = g_builtinModules[moduleName];
    if (builtin) return builtin;

    NSFileManager *fm = [NSFileManager defaultManager];
    NSArray<NSString *> *extensions = @[@"", @".js", @".json"];

    // Strip leading ./ — it's relative to the search paths
    NSString *cleanName = moduleName;
    if ([cleanName hasPrefix:@"./"]) {
        cleanName = [cleanName substringFromIndex:2];
    }

    for (NSString *searchPath in g_searchPaths) {
        for (NSString *ext in extensions) {
            NSString *fullPath = [[searchPath stringByAppendingPathComponent:cleanName]
                                  stringByAppendingString:ext];
            fullPath = [fullPath stringByStandardizingPath];
            if ([fm fileExistsAtPath:fullPath]) {
                NSError *error;
                NSString *content = [NSString stringWithContentsOfFile:fullPath
                                                             encoding:NSUTF8StringEncoding
                                                                error:&error];
                if (content) {
                    if ([ext isEqualToString:@".json"]) {
                        return [NSString stringWithFormat:@"module.exports = %@;", content];
                    }
                    return content;
                }
            }

            NSString *indexPath = [[[searchPath stringByAppendingPathComponent:cleanName]
                                    stringByAppendingPathComponent:@"index"] stringByAppendingString:@".js"];
            indexPath = [indexPath stringByStandardizingPath];
            if ([fm fileExistsAtPath:indexPath]) {
                return [NSString stringWithContentsOfFile:indexPath
                                                encoding:NSUTF8StringEncoding
                                                   error:nil];
            }
        }
    }

    return nil;
}

+ (JSValue *)executeModule:(NSString *)moduleName source:(NSString *)source inContext:(JSContext *)ctx {
    WNModuleEntry *entry = [WNModuleEntry new];
    entry.name = moduleName;
    entry.loaded = NO;
    g_moduleCache[moduleName] = entry;

    NSString *wrappedSource = [NSString stringWithFormat:
        @"(function(module, exports, require) {\n%@\n})",
        source];

    JSValue *factory = [ctx evaluateScript:wrappedSource];
    if (!factory || [factory isUndefined]) {
        NSLog(@"%@ Failed to parse module: %@", kLogPrefix, moduleName);
        return [JSValue valueWithUndefinedInContext:ctx];
    }

    JSValue *moduleObj = [JSValue valueWithNewObjectInContext:ctx];
    JSValue *exportsObj = [JSValue valueWithNewObjectInContext:ctx];
    moduleObj[@"exports"] = exportsObj;

    JSValue *requireFn = ctx[@"require"];

    [factory callWithArguments:@[moduleObj, exportsObj, requireFn]];

    entry.exports = moduleObj[@"exports"];
    entry.loaded = YES;

    NSLog(@"%@ Loaded: %@", kLogPrefix, moduleName);
    return entry.exports;
}

#pragma mark - Module Management

+ (void)registerModuleManagement:(JSContext *)context {
    JSValue *moduleNS = context[@"Module"];
    if (!moduleNS || [moduleNS isUndefined]) {
        moduleNS = [JSValue valueWithNewObjectInContext:context];
        context[@"Module"] = moduleNS;
    }

    moduleNS[@"searchPaths"] = g_searchPaths;

    moduleNS[@"addSearchPath"] = ^(NSString *path) {
        if (!path) return;
        NSString *resolved = path;
        if (![path hasPrefix:@"/"]) {
            NSString *docPath = NSSearchPathForDirectoriesInDomains(
                NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
            resolved = [docPath stringByAppendingPathComponent:path];
        }
        if (![g_searchPaths containsObject:resolved]) {
            [g_searchPaths addObject:resolved];
            NSLog(@"%@ Added search path: %@", kLogPrefix, resolved);
        }
    };

    moduleNS[@"clearCache"] = ^{
        [g_moduleCache removeAllObjects];
        NSLog(@"%@ Module cache cleared", kLogPrefix);
    };

    moduleNS[@"listCached"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        NSMutableArray *names = [NSMutableArray new];
        [g_moduleCache enumerateKeysAndObjectsUsingBlock:^(NSString *key, WNModuleEntry *entry, BOOL *stop) {
            [names addObject:@{@"name": key, @"loaded": @(entry.loaded)}];
        }];
        return [JSValue valueWithObject:names inContext:ctx];
    };
}

#pragma mark - Builtin Modules

+ (void)installBuiltinModules:(JSContext *)context {
    [self registerBuiltinModule:@"events" source:
     @"function EventEmitter() { this._events = {}; }\n"
     @"EventEmitter.prototype.on = function(event, fn) {\n"
     @"  if (!this._events[event]) this._events[event] = [];\n"
     @"  this._events[event].push(fn);\n"
     @"  return this;\n"
     @"};\n"
     @"EventEmitter.prototype.emit = function(event) {\n"
     @"  var args = Array.prototype.slice.call(arguments, 1);\n"
     @"  var fns = this._events[event] || [];\n"
     @"  for (var i = 0; i < fns.length; i++) fns[i].apply(this, args);\n"
     @"  return fns.length > 0;\n"
     @"};\n"
     @"EventEmitter.prototype.off = function(event, fn) {\n"
     @"  if (!fn) { delete this._events[event]; return this; }\n"
     @"  var fns = this._events[event] || [];\n"
     @"  this._events[event] = fns.filter(function(f) { return f !== fn; });\n"
     @"  return this;\n"
     @"};\n"
     @"module.exports = { EventEmitter: EventEmitter };\n"
    ];

    [self registerBuiltinModule:@"util" source:
     @"module.exports = {\n"
     @"  format: function() {\n"
     @"    var args = Array.prototype.slice.call(arguments);\n"
     @"    var fmt = args.shift() || '';\n"
     @"    return fmt.replace(/%[sd]/g, function() { return args.length ? String(args.shift()) : ''; });\n"
     @"  },\n"
     @"  inspect: function(obj) { return JSON.stringify(obj, null, 2); }\n"
     @"};\n"
    ];
}

@end
