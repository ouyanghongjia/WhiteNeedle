#import "WNSQLiteBridge.h"
#import <sqlite3.h>

static NSString *const kLogPrefix = @"[WNSQLiteBridge]";

@implementation WNSQLiteBridge

static NSMutableDictionary<NSString *, NSDictionary *> *sSnapshots = nil;
static NSMutableDictionary<NSString *, NSDictionary *> *sWatchers = nil;
static int sWatchCounter = 0;

#pragma mark - Helpers

+ (NSString *)sandboxRoot {
    return NSHomeDirectory();
}

+ (NSString *)resolveAbsPath:(NSString *)dbPath {
    if (!dbPath || dbPath.length == 0) return nil;
    if ([dbPath hasPrefix:@"/"]) return dbPath;
    return [[self sandboxRoot] stringByAppendingPathComponent:dbPath];
}

+ (sqlite3 *)openDB:(NSString *)absPath {
    if (!absPath) return NULL;
    sqlite3 *db = NULL;
    int rc = sqlite3_open_v2([absPath UTF8String], &db, SQLITE_OPEN_READONLY, NULL);
    if (rc != SQLITE_OK) {
        NSLog(@"%@ Failed to open %@: %s", kLogPrefix, absPath, sqlite3_errmsg(db));
        if (db) sqlite3_close(db);
        return NULL;
    }
    return db;
}

+ (sqlite3 *)openDBReadWrite:(NSString *)absPath {
    if (!absPath) return NULL;
    sqlite3 *db = NULL;
    int rc = sqlite3_open_v2([absPath UTF8String], &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, NULL);
    if (rc != SQLITE_OK) {
        NSLog(@"%@ Failed to open (rw) %@: %s", kLogPrefix, absPath, sqlite3_errmsg(db));
        if (db) sqlite3_close(db);
        return NULL;
    }
    return db;
}

+ (id)columnValue:(sqlite3_stmt *)stmt index:(int)i {
    int type = sqlite3_column_type(stmt, i);
    switch (type) {
        case SQLITE_INTEGER:
            return @(sqlite3_column_int64(stmt, i));
        case SQLITE_FLOAT:
            return @(sqlite3_column_double(stmt, i));
        case SQLITE_TEXT: {
            const unsigned char *text = sqlite3_column_text(stmt, i);
            return text ? [NSString stringWithUTF8String:(const char *)text] : [NSNull null];
        }
        case SQLITE_BLOB: {
            int bytes = sqlite3_column_bytes(stmt, i);
            return [NSString stringWithFormat:@"<BLOB %d bytes>", bytes];
        }
        case SQLITE_NULL:
        default:
            return [NSNull null];
    }
}

+ (NSArray<NSDictionary *> *)executeQuery:(sqlite3 *)db sql:(const char *)sql maxRows:(int)maxRows {
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        NSLog(@"%@ prepare error: %s", kLogPrefix, sqlite3_errmsg(db));
        return nil;
    }

    NSMutableArray *rows = [NSMutableArray new];
    int colCount = sqlite3_column_count(stmt);
    int rowIndex = 0;

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        if (maxRows > 0 && rowIndex >= maxRows) break;
        NSMutableDictionary *row = [NSMutableDictionary dictionaryWithCapacity:colCount];
        for (int i = 0; i < colCount; i++) {
            NSString *colName = [NSString stringWithUTF8String:sqlite3_column_name(stmt, i)];
            row[colName] = [self columnValue:stmt index:i];
        }
        [rows addObject:row];
        rowIndex++;
    }
    sqlite3_finalize(stmt);
    return rows;
}

#pragma mark - Database Discovery

+ (NSArray<NSDictionary *> *)discoverDatabases {
    NSString *root = [self sandboxRoot];
    NSFileManager *fm = [NSFileManager defaultManager];
    NSMutableArray *results = [NSMutableArray new];
    NSSet *extensions = [NSSet setWithArray:@[@"db", @"sqlite", @"sqlite3", @"sqlitedb", @"store"]];

    NSDirectoryEnumerator *enumerator = [fm enumeratorAtPath:root];
    NSString *relativePath;
    while ((relativePath = [enumerator nextObject])) {
        NSString *ext = [relativePath pathExtension].lowercaseString;
        if (![extensions containsObject:ext]) continue;

        NSString *absPath = [root stringByAppendingPathComponent:relativePath];
        NSDictionary *attrs = [fm attributesOfItemAtPath:absPath error:nil];
        if (!attrs || [attrs[NSFileType] isEqualToString:NSFileTypeDirectory]) continue;

        sqlite3 *db = [self openDB:absPath];
        if (!db) continue;

        NSArray *tables = [self executeQuery:db sql:"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" maxRows:0];
        sqlite3_close(db);

        [results addObject:@{
            @"path": relativePath,
            @"name": [relativePath lastPathComponent],
            @"size": @([attrs fileSize]),
            @"mtime": @([(NSDate *)attrs[NSFileModificationDate] timeIntervalSince1970] * 1000),
            @"tableCount": @(tables ? tables.count : 0),
            @"tables": tables ? [tables valueForKey:@"name"] : @[],
        }];
    }
    return results;
}

#pragma mark - Register

+ (void)registerInContext:(JSContext *)context {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sSnapshots = [NSMutableDictionary new];
        sWatchers = [NSMutableDictionary new];
    });

    JSValue *ns = [JSValue valueWithNewObjectInContext:context];

    // ── databases() ──
    ns[@"databases"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        NSArray *dbs = [self discoverDatabases];
        return [JSValue valueWithObject:dbs inContext:ctx];
    };

    // ── tables(dbPath) ──
    ns[@"tables"] = ^JSValue *(NSString *dbPath) {
        JSContext *ctx = [JSContext currentContext];
        NSString *abs = [self resolveAbsPath:dbPath];
        sqlite3 *db = [self openDB:abs];
        if (!db) return [JSValue valueWithObject:@[] inContext:ctx];

        NSArray *rows = [self executeQuery:db
                                       sql:"SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"
                                   maxRows:0];
        sqlite3_close(db);

        NSMutableArray *result = [NSMutableArray new];
        for (NSDictionary *row in rows) {
            NSString *tableName = row[@"name"];
            if ([tableName hasPrefix:@"sqlite_"]) continue;

            sqlite3 *db2 = [self openDB:abs];
            long long count = 0;
            if (db2) {
                NSString *countSQL = [NSString stringWithFormat:@"SELECT COUNT(*) as cnt FROM \"%@\"",
                                      [tableName stringByReplacingOccurrencesOfString:@"\"" withString:@"\"\""]];
                NSArray *countRows = [self executeQuery:db2 sql:[countSQL UTF8String] maxRows:1];
                if (countRows.count > 0) {
                    count = [countRows[0][@"cnt"] longLongValue];
                }
                sqlite3_close(db2);
            }

            [result addObject:@{
                @"name": tableName,
                @"sql": row[@"sql"] ?: [NSNull null],
                @"rowCount": @(count),
            }];
        }
        return [JSValue valueWithObject:result inContext:ctx];
    };

    // ── schema(dbPath, tableName) ──
    ns[@"schema"] = ^JSValue *(NSString *dbPath, NSString *tableName) {
        JSContext *ctx = [JSContext currentContext];
        if (!tableName) return [JSValue valueWithObject:@[] inContext:ctx];

        NSString *abs = [self resolveAbsPath:dbPath];
        sqlite3 *db = [self openDB:abs];
        if (!db) return [JSValue valueWithObject:@[] inContext:ctx];

        NSString *sql = [NSString stringWithFormat:@"PRAGMA table_info(\"%@\")",
                         [tableName stringByReplacingOccurrencesOfString:@"\"" withString:@"\"\""]];
        NSArray *rows = [self executeQuery:db sql:[sql UTF8String] maxRows:0];
        sqlite3_close(db);
        return [JSValue valueWithObject:(rows ?: @[]) inContext:ctx];
    };

    // ── query(dbPath, sql, limit?) ──
    ns[@"query"] = ^JSValue *(NSString *dbPath, NSString *sqlStr, JSValue *limitArg) {
        JSContext *ctx = [JSContext currentContext];
        if (!sqlStr) {
            return [JSValue valueWithObject:@{@"error": @"SQL is required"} inContext:ctx];
        }

        NSString *abs = [self resolveAbsPath:dbPath];
        sqlite3 *db = [self openDB:abs];
        if (!db) {
            return [JSValue valueWithObject:@{@"error": @"Cannot open database"} inContext:ctx];
        }

        int limit = 500;
        if (limitArg && !limitArg.isUndefined && !limitArg.isNull) {
            limit = [limitArg toInt32];
            if (limit <= 0) limit = 500;
        }

        NSArray *rows = [self executeQuery:db sql:[sqlStr UTF8String] maxRows:limit];
        sqlite3_close(db);

        if (!rows) {
            return [JSValue valueWithObject:@{@"error": @"Query execution failed"} inContext:ctx];
        }

        return [JSValue valueWithObject:@{
            @"rows": rows,
            @"rowCount": @(rows.count),
            @"truncated": @(rows.count >= limit),
        } inContext:ctx];
    };

    // ── execute(dbPath, sql) ──
    ns[@"execute"] = ^JSValue *(NSString *dbPath, NSString *sqlStr) {
        JSContext *ctx = [JSContext currentContext];
        if (!sqlStr) {
            return [JSValue valueWithObject:@{@"error": @"SQL is required"} inContext:ctx];
        }

        NSString *abs = [self resolveAbsPath:dbPath];
        sqlite3 *db = [self openDBReadWrite:abs];
        if (!db) {
            return [JSValue valueWithObject:@{@"error": @"Cannot open database for writing"} inContext:ctx];
        }

        char *errMsg = NULL;
        int rc = sqlite3_exec(db, [sqlStr UTF8String], NULL, NULL, &errMsg);
        int changes = sqlite3_changes(db);
        sqlite3_close(db);

        if (rc != SQLITE_OK) {
            NSString *err = errMsg ? [NSString stringWithUTF8String:errMsg] : @"Unknown error";
            if (errMsg) sqlite3_free(errMsg);
            return [JSValue valueWithObject:@{@"error": err} inContext:ctx];
        }

        return [JSValue valueWithObject:@{
            @"changes": @(changes),
            @"ok": @YES,
        } inContext:ctx];
    };

    // ── tableRowCount(dbPath, tableName) ──
    ns[@"tableRowCount"] = ^JSValue *(NSString *dbPath, NSString *tableName) {
        JSContext *ctx = [JSContext currentContext];
        if (!tableName) return [JSValue valueWithObject:@(0) inContext:ctx];

        NSString *abs = [self resolveAbsPath:dbPath];
        sqlite3 *db = [self openDB:abs];
        if (!db) return [JSValue valueWithObject:@(0) inContext:ctx];

        NSString *sql = [NSString stringWithFormat:@"SELECT COUNT(*) as cnt FROM \"%@\"",
                         [tableName stringByReplacingOccurrencesOfString:@"\"" withString:@"\"\""]];
        NSArray *rows = [self executeQuery:db sql:[sql UTF8String] maxRows:1];
        sqlite3_close(db);

        long long count = 0;
        if (rows.count > 0) count = [rows[0][@"cnt"] longLongValue];
        return [JSValue valueWithObject:@(count) inContext:ctx];
    };

    // ── indexes(dbPath, tableName?) ──
    ns[@"indexes"] = ^JSValue *(NSString *dbPath, JSValue *tableArg) {
        JSContext *ctx = [JSContext currentContext];
        NSString *abs = [self resolveAbsPath:dbPath];
        sqlite3 *db = [self openDB:abs];
        if (!db) return [JSValue valueWithObject:@[] inContext:ctx];

        NSString *sql;
        if (tableArg && !tableArg.isUndefined && !tableArg.isNull) {
            NSString *table = [tableArg toString];
            sql = [NSString stringWithFormat:@"PRAGMA index_list(\"%@\")",
                   [table stringByReplacingOccurrencesOfString:@"\"" withString:@"\"\""]];
        } else {
            sql = @"SELECT name, tbl_name as tableName, sql FROM sqlite_master WHERE type='index' ORDER BY tbl_name, name";
        }

        NSArray *rows = [self executeQuery:db sql:[sql UTF8String] maxRows:0];
        sqlite3_close(db);
        return [JSValue valueWithObject:(rows ?: @[]) inContext:ctx];
    };

    // ── snapshot(dbPath, tableName, tag) ──
    ns[@"snapshot"] = ^JSValue *(NSString *dbPath, NSString *tableName, NSString *tag) {
        JSContext *ctx = [JSContext currentContext];
        if (!tableName || !tag) {
            return [JSValue valueWithObject:@{@"error": @"tableName and tag are required"} inContext:ctx];
        }

        NSString *abs = [self resolveAbsPath:dbPath];
        sqlite3 *db = [self openDB:abs];
        if (!db) {
            return [JSValue valueWithObject:@{@"error": @"Cannot open database"} inContext:ctx];
        }

        NSString *sql = [NSString stringWithFormat:@"SELECT * FROM \"%@\"",
                         [tableName stringByReplacingOccurrencesOfString:@"\"" withString:@"\"\""]];
        NSArray *rows = [self executeQuery:db sql:[sql UTF8String] maxRows:10000];
        sqlite3_close(db);

        NSString *snapKey = [NSString stringWithFormat:@"%@::%@::%@", dbPath, tableName, tag];
        @synchronized(sSnapshots) {
            sSnapshots[snapKey] = @{
                @"rows": rows ?: @[],
                @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000),
            };
        }

        return [JSValue valueWithObject:@{
            @"ok": @YES,
            @"rowCount": @(rows.count),
            @"tag": tag,
        } inContext:ctx];
    };

    // ── diff(dbPath, tableName, tag) ──
    ns[@"diff"] = ^JSValue *(NSString *dbPath, NSString *tableName, NSString *tag) {
        JSContext *ctx = [JSContext currentContext];
        if (!tableName || !tag) {
            return [JSValue valueWithObject:@{@"error": @"tableName and tag are required"} inContext:ctx];
        }

        NSString *snapKey = [NSString stringWithFormat:@"%@::%@::%@", dbPath, tableName, tag];
        NSDictionary *snapData;
        @synchronized(sSnapshots) {
            snapData = sSnapshots[snapKey];
        }

        if (!snapData) {
            return [JSValue valueWithObject:@{@"error": @"No snapshot found for this tag"} inContext:ctx];
        }

        NSString *abs = [self resolveAbsPath:dbPath];
        sqlite3 *db = [self openDB:abs];
        if (!db) {
            return [JSValue valueWithObject:@{@"error": @"Cannot open database"} inContext:ctx];
        }

        NSString *sql = [NSString stringWithFormat:@"SELECT * FROM \"%@\"",
                         [tableName stringByReplacingOccurrencesOfString:@"\"" withString:@"\"\""]];
        NSArray *currentRows = [self executeQuery:db sql:[sql UTF8String] maxRows:10000];
        sqlite3_close(db);

        NSArray *oldRows = snapData[@"rows"];
        NSSet *oldSet = [NSSet setWithArray:oldRows];
        NSSet *newSet = [NSSet setWithArray:currentRows];

        NSMutableArray *added = [NSMutableArray new];
        for (NSDictionary *row in currentRows) {
            if (![oldSet containsObject:row]) [added addObject:row];
        }

        NSMutableArray *removed = [NSMutableArray new];
        for (NSDictionary *row in oldRows) {
            if (![newSet containsObject:row]) [removed addObject:row];
        }

        return [JSValue valueWithObject:@{
            @"snapshotTimestamp": snapData[@"timestamp"],
            @"oldRowCount": @(oldRows.count),
            @"newRowCount": @(currentRows.count),
            @"addedCount": @(added.count),
            @"removedCount": @(removed.count),
            @"added": added,
            @"removed": removed,
            @"hasChanges": @(added.count > 0 || removed.count > 0),
        } inContext:ctx];
    };

    // ── watch(dbPath, tableName, intervalMs) ──
    ns[@"watch"] = ^JSValue *(NSString *dbPath, NSString *tableName, JSValue *intervalArg) {
        JSContext *ctx = [JSContext currentContext];
        if (!dbPath || !tableName) {
            return [JSValue valueWithObject:@{@"error": @"dbPath and tableName are required"} inContext:ctx];
        }

        int intervalMs = 2000;
        if (intervalArg && !intervalArg.isUndefined && !intervalArg.isNull) {
            intervalMs = [intervalArg toInt32];
            if (intervalMs < 500) intervalMs = 500;
        }

        int watchId;
        @synchronized(sWatchers) {
            watchId = ++sWatchCounter;
        }

        NSString *watchKey = [NSString stringWithFormat:@"%d", watchId];
        NSString *snapTag = [NSString stringWithFormat:@"__watch_%d", watchId];

        // Take initial snapshot
        NSString *abs = [self resolveAbsPath:dbPath];
        sqlite3 *db = [self openDB:abs];
        if (!db) {
            return [JSValue valueWithObject:@{@"error": @"Cannot open database"} inContext:ctx];
        }
        NSString *countSQL = [NSString stringWithFormat:@"SELECT COUNT(*) as cnt FROM \"%@\"",
                              [tableName stringByReplacingOccurrencesOfString:@"\"" withString:@"\"\""]];
        NSArray *countRows = [self executeQuery:db sql:[countSQL UTF8String] maxRows:1];
        sqlite3_close(db);

        long long initialCount = 0;
        if (countRows.count > 0) initialCount = [countRows[0][@"cnt"] longLongValue];

        dispatch_queue_t queue = dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0);
        dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);
        dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, intervalMs * NSEC_PER_MSEC),
                                  intervalMs * NSEC_PER_MSEC, (intervalMs / 10) * NSEC_PER_MSEC);

        __block long long lastCount = initialCount;
        NSString *capturedDbPath = [dbPath copy];
        NSString *capturedTable = [tableName copy];

        dispatch_source_set_event_handler(timer, ^{
            NSString *absP = [self resolveAbsPath:capturedDbPath];
            sqlite3 *pollDb = [self openDB:absP];
            if (!pollDb) return;

            NSString *cntSQL = [NSString stringWithFormat:@"SELECT COUNT(*) as cnt FROM \"%@\"",
                                [capturedTable stringByReplacingOccurrencesOfString:@"\"" withString:@"\"\""]];
            NSArray *cntRows = [self executeQuery:pollDb sql:[cntSQL UTF8String] maxRows:1];
            sqlite3_close(pollDb);

            long long currentCount = 0;
            if (cntRows.count > 0) currentCount = [cntRows[0][@"cnt"] longLongValue];

            if (currentCount != lastCount) {
                long long delta = currentCount - lastCount;
                NSLog(@"%@ [watch:%@] %@.%@ changed: %lld → %lld (Δ%+lld)",
                      kLogPrefix, watchKey, capturedDbPath, capturedTable, lastCount, currentCount, delta);
                lastCount = currentCount;
            }
        });

        dispatch_resume(timer);

        @synchronized(sWatchers) {
            sWatchers[watchKey] = @{
                @"timer": timer,
                @"dbPath": capturedDbPath,
                @"tableName": capturedTable,
            };
        }

        NSLog(@"%@ Started watch %@ on %@.%@ every %dms", kLogPrefix, watchKey, dbPath, tableName, intervalMs);

        return [JSValue valueWithObject:@{
            @"watchId": @(watchId),
            @"dbPath": dbPath,
            @"tableName": tableName,
            @"intervalMs": @(intervalMs),
            @"initialRowCount": @(initialCount),
        } inContext:ctx];
    };

    // ── unwatch(watchId) ──
    ns[@"unwatch"] = ^JSValue *(JSValue *watchIdArg) {
        JSContext *ctx = [JSContext currentContext];
        if (!watchIdArg || watchIdArg.isUndefined || watchIdArg.isNull) {
            return [JSValue valueWithObject:@{@"error": @"watchId is required"} inContext:ctx];
        }

        NSString *watchKey = [NSString stringWithFormat:@"%d", [watchIdArg toInt32]];

        @synchronized(sWatchers) {
            NSDictionary *info = sWatchers[watchKey];
            if (!info) {
                return [JSValue valueWithObject:@{@"error": @"Watch not found"} inContext:ctx];
            }

            dispatch_source_t timer = (dispatch_source_t)info[@"timer"];
            if (timer) {
                dispatch_source_cancel(timer);
            }
            [sWatchers removeObjectForKey:watchKey];
        }

        NSLog(@"%@ Stopped watch %@", kLogPrefix, watchKey);
        return [JSValue valueWithObject:@{@"ok": @YES, @"watchId": @([watchIdArg toInt32])} inContext:ctx];
    };

    context[@"SQLite"] = ns;
    NSLog(@"%@ SQLite bridge registered", kLogPrefix);
}

@end
