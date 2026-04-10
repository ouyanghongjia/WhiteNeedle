/**
 * WhiteNeedle Sample: Native Bridge
 *
 * 演示底层 C/Native 接口：
 *   - Module.enumerateModules → 列出所有已加载动态库
 *   - Module.findExportByName → 查找符号地址
 *   - Module.enumerateExports → 列出模块导出符号
 *   - $pointer.read/write     → 直接内存读写
 *   - $pointer.alloc/free     → 分配/释放内存
 *   - $struct                 → 定义 C 结构体
 */

// ── 1. 列出已加载模块 ──────────────────────────────────────
var modules = Module.enumerateModules();
console.log('[Native] Loaded modules: ' + modules.length);
for (var i = 0; i < Math.min(modules.length, 5); i++) {
    var m = modules[i];
    console.log('  ' + m.name + ' @ 0x' + m.base);
}

// ── 2. 查找符号地址 ────────────────────────────────────────
var mallocAddr = Module.findExportByName(null, 'malloc');
console.log('[Native] malloc @ ' + mallocAddr);

var objcMsgSend = Module.findExportByName('libobjc.A.dylib', 'objc_msgSend');
console.log('[Native] objc_msgSend @ ' + objcMsgSend);

// ── 3. 内存分配和读写 ──────────────────────────────────────
var buf = $pointer.alloc(64);
console.log('[Native] Allocated 64 bytes @ ' + buf.address);

$pointer.write(buf.address, 'int32', 12345);
var readBack = $pointer.read(buf.address, 'int32');
console.log('[Native] Written 12345, read back: ' + readBack);

$pointer.write(buf.address, 'utf8', 'Hello');
var str = $pointer.read(buf.address, 'utf8');
console.log('[Native] Written "Hello", read back: "' + str + '"');

$pointer.free(buf.address);
console.log('[Native] Memory freed');

// ── 4. 定义和使用 C 结构体 ─────────────────────────────────
var CGPoint = $struct('CGPoint', [
    ['x', 'double'],
    ['y', 'double']
]);

var point = new CGPoint({ x: 100.5, y: 200.3 });
console.log('[Native] CGPoint size: ' + CGPoint.size + ' bytes');
console.log('[Native] point.x = ' + point.x + ', point.y = ' + point.y);
