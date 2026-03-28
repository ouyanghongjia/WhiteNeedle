// test_timers.js — 测试 setTimeout / setInterval / clearTimeout / clearInterval

(function () {
    console.log("=== test_timers.js START ===");

    // 1. setTimeout — 延迟执行
    var t1 = setTimeout(function () {
        console.log("setTimeout: fired after 100ms");
    }, 100);
    console.log("setTimeout: returned timer ID:", t1);

    // 2. setTimeout — 0ms 立即延迟
    setTimeout(function () {
        console.log("setTimeout(0): fired on next run loop");
    }, 0);

    // 3. clearTimeout — 取消定时器
    var t2 = setTimeout(function () {
        console.error("clearTimeout: FAIL — this should NOT fire");
    }, 200);
    clearTimeout(t2);
    console.log("clearTimeout: cancelled timer", t2);

    // 4. setInterval — 周期执行
    var count = 0;
    var iv = setInterval(function () {
        count++;
        console.log("setInterval: tick #" + count);
        if (count >= 3) {
            clearInterval(iv);
            console.log("clearInterval: stopped after 3 ticks");
        }
    }, 150);
    console.log("setInterval: returned interval ID:", iv);

    // 5. clearInterval on non-existent ID (should not crash)
    clearInterval(99999);
    console.log("clearInterval: called with invalid ID — no crash");

    // 6. clearTimeout on non-existent ID
    clearTimeout(99999);
    console.log("clearTimeout: called with invalid ID — no crash");

    // 7. setTimeout 嵌套
    setTimeout(function () {
        console.log("nested setTimeout: outer fired");
        setTimeout(function () {
            console.log("nested setTimeout: inner fired");
            console.log("=== test_timers.js END ===");
        }, 50);
    }, 300);
})();
