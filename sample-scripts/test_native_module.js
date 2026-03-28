// test_native_module.js — 测试 Module.enumerateModules / enumerateExports / findExportByName

(function () {
    console.log("=== test_native_module.js START ===");

    if (typeof Module === "undefined") {
        console.error("Module: FAIL — not defined");
        return;
    }
    console.log("Module: exists");

    // 1. Module.enumerateModules — 枚举所有加载的动态库
    if (typeof Module.enumerateModules === "function") {
        var modules = Module.enumerateModules();
        console.log("Module.enumerateModules():", modules ? "array" : "null");
        if (modules && modules.length > 0) {
            console.log("  loaded modules count:", modules.length);
            console.log("  first 5:");
            for (var i = 0; i < Math.min(5, modules.length); i++) {
                var m = modules[i];
                console.log("    [" + i + "]", m.name || m.path || JSON.stringify(m));
            }
            console.log("Module.enumerateModules: PASS");
        } else {
            console.error("Module.enumerateModules: FAIL — empty or null");
        }
    } else {
        console.error("Module.enumerateModules: FAIL — not a function");
    }

    // 2. Module.findExportByName — 查找已知符号
    if (typeof Module.findExportByName === "function") {
        // 查找 libc 中的 strlen
        var strlenAddr = Module.findExportByName(null, "strlen");
        console.log("Module.findExportByName(null, 'strlen'):", strlenAddr);
        if (strlenAddr) {
            console.log("findExportByName strlen: PASS");
        } else {
            console.warn("findExportByName strlen: not found (may need specific module)");
        }

        // 查找 libSystem 中的 malloc
        var mallocAddr = Module.findExportByName(null, "malloc");
        console.log("Module.findExportByName(null, 'malloc'):", mallocAddr);
        if (mallocAddr) {
            console.log("findExportByName malloc: PASS");
        }

        // 查找 ObjC 运行时函数
        var objcGetClass = Module.findExportByName(null, "objc_getClass");
        console.log("Module.findExportByName(null, 'objc_getClass'):", objcGetClass);
        if (objcGetClass) {
            console.log("findExportByName objc_getClass: PASS");
        }

        // 查找不存在的符号
        var noSymbol = Module.findExportByName(null, "this_symbol_does_not_exist_12345");
        console.log("findExportByName (non-existent):", noSymbol);
        if (!noSymbol || noSymbol == 0) {
            console.log("findExportByName non-existent: PASS — returned null/0");
        }

        // 在指定模块中查找
        var nslogAddr = Module.findExportByName("Foundation", "NSLog");
        console.log("Module.findExportByName('Foundation', 'NSLog'):", nslogAddr);
        if (nslogAddr) {
            console.log("findExportByName in specific module: PASS");
        }
    } else {
        console.error("Module.findExportByName: FAIL — not a function");
    }

    // 3. Module.enumerateExports — 枚举模块导出符号
    if (typeof Module.enumerateExports === "function") {
        var exports = Module.enumerateExports("UIKit");
        console.log("Module.enumerateExports('UIKit'):", exports ? "array" : "null");
        if (exports && exports.length > 0) {
            console.log("  exports count:", exports.length);
            console.log("  first 5:");
            for (var j = 0; j < Math.min(5, exports.length); j++) {
                var exp = exports[j];
                console.log("    [" + j + "]", exp.name || JSON.stringify(exp));
            }
            console.log("Module.enumerateExports: PASS");
        } else {
            console.warn("Module.enumerateExports UIKit: empty or null");
        }

        // 枚举 Foundation
        var foundationExports = Module.enumerateExports("Foundation");
        if (foundationExports) {
            console.log("Foundation exports count:", foundationExports.length);
        }
    } else {
        console.error("Module.enumerateExports: FAIL — not a function");
    }

    console.log("=== test_native_module.js END ===");
})();
