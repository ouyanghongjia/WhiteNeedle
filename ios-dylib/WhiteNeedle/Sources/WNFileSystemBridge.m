#import "WNFileSystemBridge.h"

static NSString *const kLogPrefix = @"[WNFileSystemBridge]";

@implementation WNFileSystemBridge

+ (void)registerInContext:(JSContext *)context {
    JSValue *ns = [JSValue valueWithNewObjectInContext:context];
    NSString *sandboxRoot = NSHomeDirectory();

    ns[@"home"] = sandboxRoot;

    ns[@"list"] = ^JSValue *(JSValue *relPath) {
        JSContext *ctx = [JSContext currentContext];
        NSString *rel = @"/";
        if (relPath && ![relPath isUndefined] && ![relPath isNull]) {
            rel = [relPath toString];
        }
        NSString *absPath = [sandboxRoot stringByAppendingPathComponent:rel];

        NSFileManager *fm = [NSFileManager defaultManager];
        BOOL isDir = NO;
        if (![fm fileExistsAtPath:absPath isDirectory:&isDir] || !isDir) {
            return [JSValue valueWithObject:@[] inContext:ctx];
        }

        NSError *error = nil;
        NSArray<NSString *> *items = [fm contentsOfDirectoryAtPath:absPath error:&error];
        if (error) {
            NSLog(@"%@ list error: %@", kLogPrefix, error.localizedDescription);
            return [JSValue valueWithObject:@[] inContext:ctx];
        }

        NSMutableArray *result = [NSMutableArray arrayWithCapacity:items.count];
        for (NSString *name in items) {
            NSString *itemPath = [absPath stringByAppendingPathComponent:name];
            NSDictionary *attrs = [fm attributesOfItemAtPath:itemPath error:nil];
            if (!attrs) continue;

            BOOL itemIsDir = [attrs[NSFileType] isEqualToString:NSFileTypeDirectory];
            unsigned long long fileSize = [attrs fileSize];
            NSDate *mtime = attrs[NSFileModificationDate];
            NSDate *ctime = attrs[NSFileCreationDate];

            [result addObject:@{
                @"name":  name,
                @"path":  [rel stringByAppendingPathComponent:name],
                @"isDir": @(itemIsDir),
                @"size":  @(fileSize),
                @"mtime": @(mtime ? [mtime timeIntervalSince1970] * 1000 : 0),
                @"ctime": @(ctime ? [ctime timeIntervalSince1970] * 1000 : 0),
            }];
        }
        return [JSValue valueWithObject:result inContext:ctx];
    };

    ns[@"read"] = ^JSValue *(NSString *relPath) {
        JSContext *ctx = [JSContext currentContext];
        if (!relPath) return [JSValue valueWithNullInContext:ctx];
        NSString *absPath = [sandboxRoot stringByAppendingPathComponent:relPath];
        NSError *error = nil;
        NSString *content = [NSString stringWithContentsOfFile:absPath encoding:NSUTF8StringEncoding error:&error];
        if (error) {
            NSLog(@"%@ read error: %@", kLogPrefix, error.localizedDescription);
            return [JSValue valueWithNullInContext:ctx];
        }
        return [JSValue valueWithObject:content inContext:ctx];
    };

    ns[@"readBytes"] = ^JSValue *(NSString *relPath) {
        JSContext *ctx = [JSContext currentContext];
        if (!relPath) return [JSValue valueWithNullInContext:ctx];
        NSString *absPath = [sandboxRoot stringByAppendingPathComponent:relPath];
        NSData *data = [NSData dataWithContentsOfFile:absPath];
        if (!data) return [JSValue valueWithNullInContext:ctx];
        return [JSValue valueWithObject:[data base64EncodedStringWithOptions:0] inContext:ctx];
    };

    ns[@"write"] = ^BOOL(NSString *relPath, NSString *content) {
        if (!relPath || !content) return NO;
        NSString *absPath = [sandboxRoot stringByAppendingPathComponent:relPath];
        NSString *dir = [absPath stringByDeletingLastPathComponent];
        [[NSFileManager defaultManager] createDirectoryAtPath:dir
                                  withIntermediateDirectories:YES attributes:nil error:nil];
        NSError *error = nil;
        BOOL ok = [content writeToFile:absPath atomically:YES encoding:NSUTF8StringEncoding error:&error];
        if (error) NSLog(@"%@ write error: %@", kLogPrefix, error.localizedDescription);
        return ok;
    };

    ns[@"exists"] = ^JSValue *(NSString *relPath) {
        JSContext *ctx = [JSContext currentContext];
        if (!relPath) return [JSValue valueWithBool:NO inContext:ctx];
        NSString *absPath = [sandboxRoot stringByAppendingPathComponent:relPath];
        BOOL isDir = NO;
        BOOL exists = [[NSFileManager defaultManager] fileExistsAtPath:absPath isDirectory:&isDir];
        return [JSValue valueWithObject:@{
            @"exists": @(exists),
            @"isDir":  @(isDir)
        } inContext:ctx];
    };

    ns[@"stat"] = ^JSValue *(NSString *relPath) {
        JSContext *ctx = [JSContext currentContext];
        if (!relPath) return [JSValue valueWithNullInContext:ctx];
        NSString *absPath = [sandboxRoot stringByAppendingPathComponent:relPath];
        NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:absPath error:nil];
        if (!attrs) return [JSValue valueWithNullInContext:ctx];

        return [JSValue valueWithObject:@{
            @"size":  @([attrs fileSize]),
            @"type":  attrs[NSFileType] ?: @"unknown",
            @"mtime": @([(NSDate *)attrs[NSFileModificationDate] timeIntervalSince1970] * 1000),
            @"ctime": @([(NSDate *)attrs[NSFileCreationDate] timeIntervalSince1970] * 1000),
            @"owner": attrs[NSFileOwnerAccountName] ?: @"",
            @"permissions": [NSString stringWithFormat:@"%lo", (unsigned long)[attrs filePosixPermissions]],
        } inContext:ctx];
    };

    ns[@"remove"] = ^BOOL(NSString *relPath) {
        if (!relPath) return NO;
        NSString *absPath = [sandboxRoot stringByAppendingPathComponent:relPath];
        NSError *error = nil;
        BOOL ok = [[NSFileManager defaultManager] removeItemAtPath:absPath error:&error];
        if (error) NSLog(@"%@ remove error: %@", kLogPrefix, error.localizedDescription);
        return ok;
    };

    ns[@"mkdir"] = ^BOOL(NSString *relPath) {
        if (!relPath) return NO;
        NSString *absPath = [sandboxRoot stringByAppendingPathComponent:relPath];
        NSError *error = nil;
        BOOL ok = [[NSFileManager defaultManager] createDirectoryAtPath:absPath
                                           withIntermediateDirectories:YES attributes:nil error:&error];
        if (error) NSLog(@"%@ mkdir error: %@", kLogPrefix, error.localizedDescription);
        return ok;
    };

    context[@"FileSystem"] = ns;
    NSLog(@"%@ FileSystem bridge registered", kLogPrefix);
}

@end
