/**
 * WhiteNeedle Sample: SQLite API
 *
 * 演示沙盒内 SQLite 数据库操作：
 *   - SQLite.databases     → 发现沙盒内所有数据库文件
 *   - SQLite.tables        → 列出数据库表
 *   - SQLite.schema        → 获取表结构
 *   - SQLite.query         → 执行 SELECT 查询
 *   - SQLite.tableRowCount → 获取行数
 *   - SQLite.indexes       → 获取索引信息
 */

// ── 1. 发现所有数据库 ──────────────────────────────────────
var dbs = SQLite.databases();
console.log('[SQLite] Found ' + dbs.length + ' database(s):');
for (var i = 0; i < dbs.length; i++) {
    console.log('  📦 ' + dbs[i].name + ' (' + dbs[i].size + ' bytes)');
}

if (dbs.length === 0) {
    console.log('[SQLite] No databases found in sandbox. This demo requires at least one .db/.sqlite file.');
} else {
    var dbPath = dbs[0].path;
    console.log('[SQLite] Using: ' + dbPath);

    // ── 2. 列出所有表 ──────────────────────────────────────
    var tables = SQLite.tables(dbPath);
    console.log('[SQLite] Tables: ' + tables.join(', '));

    if (tables.length > 0) {
        var tableName = tables[0];

        // ── 3. 查看表结构 ──────────────────────────────────
        var schema = SQLite.schema(dbPath, tableName);
        console.log('[SQLite] Schema of "' + tableName + '":');
        for (var j = 0; j < schema.length; j++) {
            var col = schema[j];
            console.log('  ' + col.name + ' ' + col.type + (col.pk ? ' [PK]' : ''));
        }

        // ── 4. 查询前 5 行 ─────────────────────────────────
        var rows = SQLite.query(dbPath, 'SELECT * FROM "' + tableName + '" LIMIT 5');
        console.log('[SQLite] First 5 rows: ' + rows.length);
        if (rows.length > 0) {
            console.log('[SQLite] Columns: ' + Object.keys(rows[0]).join(', '));
        }

        // ── 5. 行数 ────────────────────────────────────────
        var count = SQLite.tableRowCount(dbPath, tableName);
        console.log('[SQLite] "' + tableName + '" total rows: ' + count);
    }
}
