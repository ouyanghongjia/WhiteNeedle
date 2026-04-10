/**
 * WhiteNeedle Sample: Dispatch & Timers
 *
 * 演示线程调度和定时器 API：
 *   - dispatch.main         → 同步执行主线程代码
 *   - dispatch.mainAsync    → 异步投递到主线程
 *   - dispatch.after        → 延迟执行
 *   - dispatch.isMainThread → 检查当前线程
 *   - setTimeout/setInterval/clearInterval
 */

// ── 1. 主线程检查 ──────────────────────────────────────────
console.log('[Dispatch] On main thread? ' + dispatch.isMainThread());

// ── 2. 同步主线程执行 ──────────────────────────────────────
var result = dispatch.main(function () {
    console.log('[Dispatch] Inside dispatch.main — isMainThread: ' + dispatch.isMainThread());
    return 42;
});
console.log('[Dispatch] dispatch.main returned: ' + result);

// ── 3. 异步主线程执行 ──────────────────────────────────────
dispatch.mainAsync(function () {
    console.log('[Dispatch] Inside dispatch.mainAsync (async, no return value)');
});

// ── 4. 延迟执行 ────────────────────────────────────────────
dispatch.after(1000, function () {
    console.log('[Dispatch] dispatch.after(1000ms) fired');
});

// ── 5. setTimeout / setInterval ────────────────────────────
setTimeout(function () {
    console.log('[Timer] setTimeout(500ms) fired');
}, 500);

var count = 0;
var intervalId = setInterval(function () {
    count++;
    console.log('[Timer] setInterval tick #' + count);
    if (count >= 3) {
        clearInterval(intervalId);
        console.log('[Timer] Interval cleared after 3 ticks');
    }
}, 800);
