# SQLite API

WhiteNeedle 提供 `SQLite` 命名空间，允许在运行时浏览、查询和监控 iOS 应用沙盒中的 SQLite 数据库。

---

## SQLite.databases()

扫描沙盒中所有 `.db`、`.sqlite`、`.sqlite3`、`.sqlitedb`、`.store` 文件。

**返回值**: `SQLiteDatabaseInfo[]`

```javascript
var dbs = SQLite.databases();
dbs.forEach(function(db) {
    console.log(db.name + " — " + db.tableCount + " tables, " + db.size + " bytes");
    console.log("  Path: " + db.path);
});
```

---

## SQLite.tables(dbPath)

列出数据库中所有用户表（排除 `sqlite_` 前缀的内部表）及其行数。

| 参数 | 类型 | 说明 |
|------|------|------|
| `dbPath` | `string` | 数据库路径（相对沙盒根目录或绝对路径） |

**返回值**: `SQLiteTableInfo[]`

```javascript
var tables = SQLite.tables("Library/Application Support/app.sqlite");
tables.forEach(function(t) {
    console.log(t.name + " — " + t.rowCount + " rows");
});
```

---

## SQLite.schema(dbPath, tableName)

获取表的列定义信息（PRAGMA table_info）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `dbPath` | `string` | 数据库路径 |
| `tableName` | `string` | 表名 |

**返回值**: `SQLiteColumnInfo[]`

```javascript
var cols = SQLite.schema("Library/app.db", "users");
cols.forEach(function(c) {
    console.log(c.name + " " + c.type + (c.pk ? " [PK]" : ""));
});
```

---

## SQLite.query(dbPath, sql, limit?)

执行 SELECT 查询，返回结果行。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dbPath` | `string` | — | 数据库路径 |
| `sql` | `string` | — | SQL SELECT 语句 |
| `limit` | `number` | `500` | 最大返回行数 |

**返回值**: `{ rows, rowCount, truncated }` 或 `{ error }`

```javascript
var result = SQLite.query("Library/app.db", "SELECT * FROM users WHERE active = 1", 50);
if (result.error) {
    console.log("Error: " + result.error);
} else {
    result.rows.forEach(function(row) {
        console.log(JSON.stringify(row));
    });
}
```

---

## SQLite.execute(dbPath, sql)

执行写操作（INSERT/UPDATE/DELETE）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `dbPath` | `string` | 数据库路径 |
| `sql` | `string` | SQL 语句 |

**返回值**: `{ changes, ok }` 或 `{ error }`

```javascript
var result = SQLite.execute("Library/app.db", "DELETE FROM logs WHERE created_at < '2025-01-01'");
console.log(result.changes + " rows deleted");
```

---

## SQLite.tableRowCount(dbPath, tableName)

快速获取表的行数。

**返回值**: `number`

```javascript
var count = SQLite.tableRowCount("Library/app.db", "events");
console.log("Events: " + count + " rows");
```

---

## SQLite.indexes(dbPath, tableName?)

列出索引信息。若提供 tableName 则只列出该表的索引。

**返回值**: `Record<string, any>[]`

```javascript
var indexes = SQLite.indexes("Library/app.db", "users");
indexes.forEach(function(idx) {
    console.log(idx.name + " (unique: " + idx.unique + ")");
});
```

---

## SQLite.snapshot(dbPath, tableName, tag)

创建表数据的快照，供后续 `diff()` 对比。

| 参数 | 类型 | 说明 |
|------|------|------|
| `dbPath` | `string` | 数据库路径 |
| `tableName` | `string` | 表名 |
| `tag` | `string` | 快照标签（用于标识和检索） |

**返回值**: `{ ok, rowCount, tag }` 或 `{ error }`

```javascript
var snap = SQLite.snapshot("Library/app.db", "events", "before_action");
console.log("Snapshot saved: " + snap.rowCount + " rows");
```

---

## SQLite.diff(dbPath, tableName, tag)

将当前表数据与之前的快照进行对比，找出新增和删除的行。

| 参数 | 类型 | 说明 |
|------|------|------|
| `dbPath` | `string` | 数据库路径 |
| `tableName` | `string` | 表名 |
| `tag` | `string` | 快照标签 |

**返回值**: `SQLiteDiffResult`

```javascript
// 1. 先创建快照
SQLite.snapshot("Library/app.db", "events", "check");

// 2. 在应用中执行操作...

// 3. 对比变化
var diff = SQLite.diff("Library/app.db", "events", "check");
if (diff.hasChanges) {
    console.log("Added: " + diff.addedCount + ", Removed: " + diff.removedCount);
    diff.added.forEach(function(row) { console.log("  + " + JSON.stringify(row)); });
    diff.removed.forEach(function(row) { console.log("  - " + JSON.stringify(row)); });
} else {
    console.log("No changes");
}
```

---

## SQLite.watch(dbPath, tableName, intervalMs?)

启动定时轮询，监控表的行数变化。变化日志输出到设备日志。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dbPath` | `string` | — | 数据库路径 |
| `tableName` | `string` | — | 表名 |
| `intervalMs` | `number` | `2000` | 轮询间隔（最小 500ms） |

**返回值**: `SQLiteWatchResult`

```javascript
var w = SQLite.watch("Library/app.db", "events", 1000);
console.log("Watching with id=" + w.watchId + ", initial=" + w.initialRowCount);
```

---

## SQLite.unwatch(watchId)

停止指定的监控。

| 参数 | 类型 | 说明 |
|------|------|------|
| `watchId` | `number` | `watch()` 返回的 watchId |

```javascript
SQLite.unwatch(1);
```

---

## 典型工作流

### 调试数据库写入

1. 打开 VS Code 中的 **SQLite Browser** 面板
2. 点击 **Discover Databases** 扫描沙盒
3. 展开目标数据库，选择要监控的表
4. 在 **Monitor** 标签页点击 **Take Snapshot**
5. 在 iOS 应用中执行操作
6. 点击 **Diff vs Snapshot** 查看变化

### 使用 Snippet 脚本

在 **Snippets** 面板中可以找到以下预置脚本：

- **Discover SQLite Databases** — 扫描并列出所有数据库
- **List SQLite Tables** — 列出指定库的表和行数
- **Run SQL Query** — 执行自定义查询
- **Show Table Schema** — 查看表结构
- **Monitor Table Changes** — 快照 + 对比工作流
- **Watch Table Row Count** — 实时轮询监控

## 注意事项

- 数据库以只读方式打开（`SQLITE_OPEN_READONLY`），`execute()` 以读写方式打开
- `BLOB` 类型字段显示为 `"<BLOB N bytes>"` 占位文本
- 快照数据存储在内存中，进程重启后丢失
- `watch()` 基于 `dispatch_source` 定时器轮询，仅检测行数变化
- 路径支持相对沙盒根目录或绝对路径两种格式
