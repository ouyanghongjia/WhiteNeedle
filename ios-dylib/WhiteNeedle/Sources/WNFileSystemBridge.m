#import "WNFileSystemBridge.h"

static NSString *const kLogPrefix = @"[WNFileSystemBridge]";

/// Resolves JS paths: relative to sandbox, absolute under NSHome, or "/Documents/..." style.
static NSString *WNFSAbsolutePath(NSString *path, NSString *sandboxRoot) {
    if (!path.length) return [sandboxRoot stringByStandardizingPath];
    NSString *root = [sandboxRoot stringByStandardizingPath];
    NSString *std = [path stringByStandardizingPath];
    if ([std hasPrefix:root]) return std;
    if ([path hasPrefix:@"/"]) {
        return [sandboxRoot stringByAppendingPathComponent:[path substringFromIndex:1]];
    }
    return [sandboxRoot stringByAppendingPathComponent:path];
}

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
        NSString *absPath = WNFSAbsolutePath(rel, sandboxRoot);

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
        NSString *absPath = WNFSAbsolutePath(relPath, sandboxRoot);
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
        NSString *absPath = WNFSAbsolutePath(relPath, sandboxRoot);
        NSData *data = [NSData dataWithContentsOfFile:absPath];
        if (!data) return [JSValue valueWithNullInContext:ctx];
        return [JSValue valueWithObject:[data base64EncodedStringWithOptions:0] inContext:ctx];
    };

    ns[@"write"] = ^BOOL(NSString *relPath, NSString *content) {
        if (!relPath || !content) return NO;
        NSString *absPath = WNFSAbsolutePath(relPath, sandboxRoot);
        NSString *dir = [absPath stringByDeletingLastPathComponent];
        [[NSFileManager defaultManager] createDirectoryAtPath:dir
                                  withIntermediateDirectories:YES attributes:nil error:nil];
        NSError *error = nil;
        BOOL ok = [content writeToFile:absPath atomically:YES encoding:NSUTF8StringEncoding error:&error];
        if (error) NSLog(@"%@ write error: %@", kLogPrefix, error.localizedDescription);
        return ok;
    };

    ns[@"writeBytes"] = ^BOOL(NSString *relPath, NSString *base64Data) {
        if (!relPath || !base64Data) return NO;
        NSData *data = [[NSData alloc] initWithBase64EncodedString:base64Data options:0];
        if (!data) {
            NSLog(@"%@ writeBytes error: invalid base64 data", kLogPrefix);
            return NO;
        }
        NSString *absPath = WNFSAbsolutePath(relPath, sandboxRoot);
        NSString *dir = [absPath stringByDeletingLastPathComponent];
        [[NSFileManager defaultManager] createDirectoryAtPath:dir
                                  withIntermediateDirectories:YES attributes:nil error:nil];
        BOOL ok = [data writeToFile:absPath atomically:YES];
        if (!ok) NSLog(@"%@ writeBytes error: failed to write to %@", kLogPrefix, absPath);
        return ok;
    };

    ns[@"exists"] = ^JSValue *(NSString *relPath) {
        JSContext *ctx = [JSContext currentContext];
        if (!relPath) return [JSValue valueWithBool:NO inContext:ctx];
        NSString *absPath = WNFSAbsolutePath(relPath, sandboxRoot);
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
        NSString *absPath = WNFSAbsolutePath(relPath, sandboxRoot);
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
        NSString *absPath = WNFSAbsolutePath(relPath, sandboxRoot);
        NSError *error = nil;
        BOOL ok = [[NSFileManager defaultManager] removeItemAtPath:absPath error:&error];
        if (error) NSLog(@"%@ remove error: %@", kLogPrefix, error.localizedDescription);
        return ok;
    };

    ns[@"mkdir"] = ^BOOL(NSString *relPath) {
        if (!relPath) return NO;
        NSString *absPath = WNFSAbsolutePath(relPath, sandboxRoot);
        NSError *error = nil;
        BOOL ok = [[NSFileManager defaultManager] createDirectoryAtPath:absPath
                                           withIntermediateDirectories:YES attributes:nil error:&error];
        if (error) NSLog(@"%@ mkdir error: %@", kLogPrefix, error.localizedDescription);
        return ok;
    };

    ns[@"move"] = ^BOOL(NSString *fromRel, NSString *toRel) {
        if (!fromRel || !toRel) return NO;
        NSString *absFrom = WNFSAbsolutePath(fromRel, sandboxRoot);
        NSString *absTo   = WNFSAbsolutePath(toRel, sandboxRoot);
        NSString *toDir = [absTo stringByDeletingLastPathComponent];
        [[NSFileManager defaultManager] createDirectoryAtPath:toDir
                                  withIntermediateDirectories:YES attributes:nil error:nil];
        NSError *error = nil;
        BOOL ok = [[NSFileManager defaultManager] moveItemAtPath:absFrom toPath:absTo error:&error];
        if (error) NSLog(@"%@ move error: %@", kLogPrefix, error.localizedDescription);
        return ok;
    };

    ns[@"copy"] = ^BOOL(NSString *fromRel, NSString *toRel) {
        if (!fromRel || !toRel) return NO;
        NSString *absFrom = WNFSAbsolutePath(fromRel, sandboxRoot);
        NSString *absTo   = WNFSAbsolutePath(toRel, sandboxRoot);
        NSString *toDir = [absTo stringByDeletingLastPathComponent];
        [[NSFileManager defaultManager] createDirectoryAtPath:toDir
                                  withIntermediateDirectories:YES attributes:nil error:nil];
        NSError *error = nil;
        BOOL ok = [[NSFileManager defaultManager] copyItemAtPath:absFrom toPath:absTo error:&error];
        if (error) NSLog(@"%@ copy error: %@", kLogPrefix, error.localizedDescription);
        return ok;
    };

    ns[@"snapshot"] = ^JSValue *(JSValue *pathsVal, JSValue *maxDepthVal) {
        JSContext *ctx = [JSContext currentContext];
        NSArray *paths = @[@"Documents", @"Library", @"tmp"];
        if (pathsVal && ![pathsVal isUndefined] && ![pathsVal isNull]) {
            paths = [pathsVal toArray];
        }
        int maxDepth = 10;
        if (maxDepthVal && ![maxDepthVal isUndefined] && ![maxDepthVal isNull]) {
            maxDepth = [maxDepthVal toInt32];
            if (maxDepth < 1) maxDepth = 1;
        }

        NSFileManager *fm = [NSFileManager defaultManager];
        NSMutableArray *result = [NSMutableArray new];

        for (NSString *rootRel in paths) {
            if (![rootRel isKindOfClass:[NSString class]]) continue;
            NSString *absRoot = WNFSAbsolutePath(rootRel, sandboxRoot);
            BOOL isDir = NO;
            if (![fm fileExistsAtPath:absRoot isDirectory:&isDir] || !isDir) continue;

            NSDirectoryEnumerator *enumerator = [fm enumeratorAtPath:absRoot];
            NSString *relItem;
            while ((relItem = [enumerator nextObject])) {
                if ([relItem hasPrefix:@"."]) {
                    [enumerator skipDescendants];
                    continue;
                }
                if ((int)enumerator.level > maxDepth) {
                    [enumerator skipDescendants];
                    continue;
                }
                NSDictionary *attrs = enumerator.fileAttributes;
                if (!attrs) continue;
                BOOL itemIsDir = [attrs[NSFileType] isEqualToString:NSFileTypeDirectory];
                unsigned long long fileSize = [attrs fileSize];
                NSDate *mtime = attrs[NSFileModificationDate];
                [result addObject:@{
                    @"path":  [rootRel stringByAppendingPathComponent:relItem],
                    @"size":  @(fileSize),
                    @"mtime": @(mtime ? [mtime timeIntervalSince1970] * 1000 : 0),
                    @"isDir": @(itemIsDir),
                }];
            }
        }
        return [JSValue valueWithObject:result inContext:ctx];
    };

    context[@"FileSystem"] = ns;
    NSLog(@"%@ FileSystem bridge registered", kLogPrefix);
}

@end
