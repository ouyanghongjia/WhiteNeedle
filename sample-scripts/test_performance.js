// test_performance.js — 测试 Performance 命名空间 API

(function () {
    console.log("=== test_performance.js START ===");

    if (typeof Performance === "undefined") {
        console.error("Performance: FAIL — not defined");
        return;
    }
    console.log("Performance: namespace exists");

    // 1. memory — 与桥接/文档一致：used / virtual / free（字节）
    if (typeof Performance.memory === "function") {
        var mem = Performance.memory();
        console.log("Performance.memory():");
        console.log("  used (RSS):", (mem.used / 1024 / 1024).toFixed(1), "MB");
        console.log("  virtual:", (mem.virtual / 1024 / 1024).toFixed(1), "MB");
        console.log("  free (host):", (mem.free / 1024 / 1024).toFixed(1), "MB");
        console.log("Performance.memory: PASS");
    } else {
        console.error("Performance.memory: FAIL — not a function");
    }

    // 2. cpu — CPU 使用
    if (typeof Performance.cpu === "function") {
        var cpu = Performance.cpu();
        console.log("Performance.cpu():");
        console.log("  userTime:", cpu.userTime.toFixed(3), "s");
        console.log("  systemTime:", cpu.systemTime.toFixed(3), "s");
        console.log("  threadCount:", cpu.threadCount);
        console.log("Performance.cpu: PASS");
    } else {
        console.error("Performance.cpu: FAIL — not a function");
    }

    // 3. snapshot — 综合快照
    if (typeof Performance.snapshot === "function") {
        var snap = Performance.snapshot();
        console.log("Performance.snapshot():");
        console.log("  has memory:", !!snap.memory);
        console.log("  has cpu:", !!snap.cpu);
        console.log("  has timestamp:", !!snap.timestamp);
        console.log("Performance.snapshot: PASS");
    } else {
        console.error("Performance.snapshot: FAIL — not a function");
    }

    // 4. fps — FPS 回调（启动后停止）
    if (typeof Performance.fps === "function" && typeof Performance.stopFps === "function") {
        console.log("Performance.fps: function exists");
        console.log("Performance.stopFps: function exists");
        console.log("Performance.fps/stopFps: PASS (not invoked — requires main run loop)");
    } else {
        console.error("Performance.fps/stopFps: FAIL — not functions");
    }

    console.log("=== test_performance.js END ===");
})();
