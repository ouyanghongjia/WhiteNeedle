/**
 * WhiteNeedle Sample: Performance Monitor
 *
 * 演示性能监控 API：
 *   - Performance.memory    → 内存使用
 *   - Performance.cpu       → CPU 使用
 *   - Performance.fps       → 帧率监控（CADisplayLink）
 *   - Performance.snapshot  → 综合快照
 *   - Debug.time / timeEnd  → 代码段耗时测量
 *   - Debug.heapSize        → 进程内存
 */

// ── 1. 内存快照 ────────────────────────────────────────────
var mem = Performance.memory();
if (mem) {
    console.log('[Perf] Memory — used: ' + (mem.used / 1048576).toFixed(1) + ' MB'
        + ', virtual: ' + (mem.virtual / 1048576).toFixed(1) + ' MB');
}

// ── 2. CPU 使用 ────────────────────────────────────────────
var cpu = Performance.cpu();
if (cpu) {
    console.log('[Perf] CPU — user: ' + cpu.userTime.toFixed(2) + 's'
        + ', system: ' + cpu.systemTime.toFixed(2) + 's'
        + ', threads: ' + cpu.threadCount);
}

// ── 3. 综合快照 ────────────────────────────────────────────
var snap = Performance.snapshot();
console.log('[Perf] Snapshot: ' + JSON.stringify(snap));

// ── 4. Debug.heapSize ──────────────────────────────────────
var heap = Debug.heapSize();
console.log('[Perf] Heap — resident: ' + (heap.residentSize / 1048576).toFixed(1) + ' MB'
    + ', virtual: ' + (heap.virtualSize / 1048576).toFixed(1) + ' MB');

// ── 5. FPS 监控（5 秒后自动停止） ──────────────────────────
console.log('[Perf] Starting FPS monitor for 5 seconds...');
Performance.fps(function (fps) {
    console.log('[Perf] FPS: ' + fps);
});

setTimeout(function () {
    Performance.stopFps();
    console.log('[Perf] FPS monitor stopped');
}, 5000);

// ── 6. 代码段耗时测量 ──────────────────────────────────────
Debug.time('loop_benchmark');
var sum = 0;
for (var i = 0; i < 100000; i++) { sum += i; }
var elapsed = Debug.timeEnd('loop_benchmark');
console.log('[Perf] 100K loop: ' + elapsed + ' ms');
