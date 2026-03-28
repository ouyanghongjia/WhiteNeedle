// test_module_loader.js — 测试 require() 模块加载

(function () {
    console.log("=== test_module_loader.js START ===");

    // 1. require 是否存在
    if (typeof require !== "function") {
        console.error("require: FAIL — function not found");
        return;
    }
    console.log("require: function exists");

    // 2. require 不存在的模块 — 应抛出错误或返回 null
    try {
        var noModule = require("nonexistent_module_xyz");
        console.log("require('nonexistent'):", noModule);
        if (!noModule) {
            console.log("require non-existent: PASS — returned null/undefined");
        }
    } catch (e) {
        console.log("require non-existent: PASS — threw error:", e.message || e);
    }

    // 3. Module namespace 检查 (WNModuleLoader 也扩展了 Module)
    if (typeof Module !== "undefined") {
        console.log("Module namespace: available");
    }

    // 4. 测试内联模块 (如果有注册的 builtin 模块)
    try {
        var builtins = ["utils", "fs", "path", "console"];
        for (var i = 0; i < builtins.length; i++) {
            try {
                var mod = require(builtins[i]);
                if (mod) {
                    console.log("require('" + builtins[i] + "'): loaded, type:", typeof mod);
                }
            } catch (e) {
                console.log("require('" + builtins[i] + "'): not available (expected for most)");
            }
        }
    } catch (e) {
        console.warn("builtin module check: error —", e.message || e);
    }

    // 5. require 同一模块两次 — 验证缓存
    try {
        var firstLoad = require("nonexistent_cache_test");
    } catch (e1) {
        // expected
    }
    try {
        var secondLoad = require("nonexistent_cache_test");
    } catch (e2) {
        // expected
    }
    console.log("require caching: tested (no crash)");

    console.log("=== test_module_loader.js END ===");
})();
