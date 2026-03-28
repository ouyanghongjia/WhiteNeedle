// test_console.js — 测试 console API (log / warn / error / info / debug)

(function () {
    console.log("=== test_console.js START ===");

    // 1. console.log — 基本日志
    console.log("console.log: basic string output");
    console.log("console.log: number", 42);
    console.log("console.log: boolean", true, false);
    console.log("console.log: null & undefined", null, undefined);
    console.log("console.log: object", { key: "value", nested: { n: 1 } });
    console.log("console.log: array", [1, "two", 3]);

    // 2. console.warn
    console.warn("console.warn: this is a warning message");
    console.warn("console.warn: object warning", { code: 404 });

    // 3. console.error
    console.error("console.error: this is an error message");
    console.error("console.error: with Error object", new Error("test error"));

    // 4. console.info
    console.info("console.info: informational message");
    console.info("console.info: multiple args", "arg1", "arg2", 123);

    // 5. console.debug
    console.debug("console.debug: debug-level message");
    console.debug("console.debug: debugging data", { debug: true, level: 5 });

    // 6. 多参数拼接
    console.log("multi-arg:", "a", "b", "c", 1, 2, 3);

    // 7. 无参数调用
    console.log();

    // 8. 特殊字符
    console.log("special chars: 中文测试 🎯 emoji \\n\\t escaped");

    console.log("=== test_console.js END ===");
})();
