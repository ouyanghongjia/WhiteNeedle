// test_debug_support.js — 测试 Debug.breakpoint / log / trace / time / timeEnd / heapSize

(function () {
    console.log("=== test_debug_support.js START ===");

    if (typeof Debug === "undefined") {
        console.error("Debug: FAIL — not defined");
        return;
    }
    console.log("Debug: namespace exists");

    // 1. Debug.log — 结构化日志
    if (typeof Debug.log === "function") {
        Debug.log("info", "Debug.log test message at INFO level");
        Debug.log("warn", "Debug.log test message at WARN level");
        Debug.log("error", "Debug.log test message at ERROR level");
        console.log("Debug.log: PASS");
    } else {
        console.error("Debug.log: FAIL — not a function");
    }

    // 2. Debug.trace — 打印 JS 调用栈
    if (typeof Debug.trace === "function") {
        var stack = Debug.trace();
        console.log("Debug.trace():", stack);
        if (stack) {
            console.log("Debug.trace: PASS — returned stack");
        }
    } else {
        console.error("Debug.trace: FAIL — not a function");
    }

    // 3. Debug.time / Debug.timeEnd — 性能计时
    if (typeof Debug.time === "function" && typeof Debug.timeEnd === "function") {
        Debug.time("testTimer");

        // 执行一些计算来产生可测量的延迟
        var sum = 0;
        for (var i = 0; i < 100000; i++) {
            sum += i;
        }

        var elapsed = Debug.timeEnd("testTimer");
        console.log("Debug.time/timeEnd: elapsed =", elapsed, "ms");
        if (elapsed !== undefined && elapsed !== null) {
            console.log("Debug.time/timeEnd: PASS");
        }
    } else {
        console.error("Debug.time/timeEnd: FAIL — not functions");
    }

    // 4. 多个计时器并行
    if (typeof Debug.time === "function") {
        Debug.time("timer_A");
        Debug.time("timer_B");

        var x = 0;
        for (var j = 0; j < 50000; j++) x += j;
        var elapsedA = Debug.timeEnd("timer_A");

        for (var k = 0; k < 50000; k++) x += k;
        var elapsedB = Debug.timeEnd("timer_B");

        console.log("timer_A:", elapsedA, "ms, timer_B:", elapsedB, "ms");
        if (elapsedB >= elapsedA) {
            console.log("parallel timers: PASS (B >= A)");
        }
    }

    // 5. Debug.timeEnd 未启动的计时器
    if (typeof Debug.timeEnd === "function") {
        var noTimer = Debug.timeEnd("never_started_timer");
        console.log("Debug.timeEnd (non-existent):", noTimer);
        console.log("timeEnd non-existent: PASS — no crash");
    }

    // 6. Debug.heapSize — 堆内存大小
    if (typeof Debug.heapSize === "function") {
        var heap = Debug.heapSize();
        console.log("Debug.heapSize():", heap);
        if (heap !== undefined && heap !== null) {
            console.log("Debug.heapSize: PASS");
        }
    } else {
        console.error("Debug.heapSize: FAIL — not a function");
    }

    // 7. Debug.breakpoint — 仅验证存在（不实际触发，避免调试器中断）
    if (typeof Debug.breakpoint === "function") {
        console.log("Debug.breakpoint: PASS — function exists (not invoked to avoid debugger halt)");
    } else {
        console.error("Debug.breakpoint: FAIL — not a function");
    }

    console.log("=== test_debug_support.js END ===");
})();
