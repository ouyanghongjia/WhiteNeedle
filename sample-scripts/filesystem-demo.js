/**
 * WhiteNeedle Sample: FileSystem API
 *
 * 演示沙盒文件系统操作：
 *   - FileSystem.home     → 沙盒根路径
 *   - FileSystem.list     → 列出目录
 *   - FileSystem.write    → 写入文件
 *   - FileSystem.read     → 读取文件
 *   - FileSystem.exists   → 检查存在
 *   - FileSystem.stat     → 文件元信息
 *   - FileSystem.mkdir    → 创建目录
 *   - FileSystem.remove   → 删除文件
 *
 * 所有路径相对于 App 沙盒（NSHomeDirectory），非系统根路径。
 */

// ── 1. 查看沙盒根目录 ──────────────────────────────────────
console.log('[FS] Sandbox home: ' + FileSystem.home);

var entries = FileSystem.list();
console.log('[FS] Root entries:');
for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    console.log('  ' + (e.isDir ? '📁' : '📄') + ' ' + e.name + (e.size ? ' (' + e.size + ' bytes)' : ''));
}

// ── 2. 写入和读取文件 ──────────────────────────────────────
var testPath = 'Documents/wn_test.txt';
FileSystem.write(testPath, 'Hello from WhiteNeedle!\nTimestamp: ' + new Date().toISOString());
console.log('[FS] Written: ' + testPath);

var content = FileSystem.read(testPath);
console.log('[FS] Read back: ' + content);

// ── 3. 检查文件状态 ────────────────────────────────────────
var info = FileSystem.exists(testPath);
console.log('[FS] Exists: ' + JSON.stringify(info));

var stat = FileSystem.stat(testPath);
console.log('[FS] Stat: size=' + stat.size + ', modified=' + stat.modified);

// ── 4. 创建目录 ────────────────────────────────────────────
FileSystem.mkdir('Documents/wn_demo/nested');
console.log('[FS] Created directory: Documents/wn_demo/nested');

// ── 5. 清理 ────────────────────────────────────────────────
FileSystem.remove(testPath);
FileSystem.remove('Documents/wn_demo/nested');
FileSystem.remove('Documents/wn_demo');
console.log('[FS] Cleaned up test files');
