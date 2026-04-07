#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * WNSQLiteBridge registers the SQLite namespace into a JSContext.
 *
 * API:
 *   SQLite.databases()                          → discover .db/.sqlite/.sqlite3 files in sandbox
 *   SQLite.tables(dbPath)                       → list tables in a database
 *   SQLite.schema(dbPath, tableName)            → get table column schema
 *   SQLite.query(dbPath, sql)                   → execute SELECT, return rows
 *   SQLite.execute(dbPath, sql)                 → execute INSERT/UPDATE/DELETE, return changes count
 *   SQLite.tableRowCount(dbPath, tableName)     → quick row count
 *   SQLite.indexes(dbPath, tableName?)          → list indexes
 *   SQLite.snapshot(dbPath, tableName, tag)     → take a snapshot for later diff
 *   SQLite.diff(dbPath, tableName, tag)         → compare current data with a snapshot
 *   SQLite.watch(dbPath, tableName, intervalMs) → poll for changes at interval
 *   SQLite.unwatch(watchId)                     → stop watching
 */
@interface WNSQLiteBridge : NSObject

+ (void)registerInContext:(JSContext *)context;

@end

NS_ASSUME_NONNULL_END
