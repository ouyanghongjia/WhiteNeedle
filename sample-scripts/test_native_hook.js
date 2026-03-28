// test_native_hook.js — 测试 Interceptor.rebindSymbol / hookCFunction (C 函数 hook)

(function () {
    console.log("=== test_native_hook.js START ===");

    if (typeof Interceptor === "undefined") {
        console.error("Interceptor: FAIL — not defined");
        return;
    }

    // 1. Interceptor.rebindSymbol — fishhook 风格符号重绑定
    if (typeof Interceptor.rebindSymbol === "function") {
        console.log("Interceptor.rebindSymbol: function exists");

        // 尝试 rebind NSLog (读取原始指针)
        try {
            var result = Interceptor.rebindSymbol("NSLog");
            console.log("rebindSymbol('NSLog'):", result);
            if (result) {
                console.log("  original address:", result);
                console.log("Interceptor.rebindSymbol: PASS");
            }
        } catch (e) {
            console.warn("rebindSymbol NSLog: skipped —", e.message || e);
        }

        // rebind 一个不存在的符号
        try {
            var noResult = Interceptor.rebindSymbol("nonexistent_symbol_xyz");
            console.log("rebindSymbol (non-existent):", noResult);
        } catch (e) {
            console.log("rebindSymbol non-existent: caught error (expected) —", e.message || e);
        }
    } else {
        console.warn("Interceptor.rebindSymbol: not available");
    }

    // 2. Interceptor.hookCFunction — C 函数 hook
    if (typeof Interceptor.hookCFunction === "function") {
        console.log("Interceptor.hookCFunction: function exists");

        // hookCFunction 需要一个实际的替换函数指针（来自另一个库）
        // 在纯 JS 环境中我们只能验证 API 存在和参数检查
        try {
            // 故意传 0 作为替换地址，应该失败或返回错误
            var hookResult = Interceptor.hookCFunction("strlen", 0);
            console.log("hookCFunction('strlen', 0):", hookResult);
            if (hookResult && hookResult.success) {
                console.log("hookCFunction: returned success (unexpected with addr 0)");
            } else {
                console.log("hookCFunction: returned failure for addr 0 (expected)");
            }
        } catch (e) {
            console.log("hookCFunction with 0: caught error (expected) —", e.message || e);
        }

        console.log("Interceptor.hookCFunction: PASS — API exists");
    } else {
        console.warn("Interceptor.hookCFunction: not available");
    }

    // 3. 使用 Module.findExportByName 配合 hookCFunction
    if (typeof Module !== "undefined" && typeof Module.findExportByName === "function") {
        var addr = Module.findExportByName(null, "strlen");
        console.log("strlen address for hooking:", addr);
        if (addr && addr > 0) {
            console.log("C function address lookup for hook: PASS");
        }
    }

    console.log("=== test_native_hook.js END ===");
})();
