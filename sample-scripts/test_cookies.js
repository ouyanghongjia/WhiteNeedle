// test_cookies.js — 测试 Cookies 命名空间 API

(function () {
    console.log("=== test_cookies.js START ===");

    if (typeof Cookies === "undefined") {
        console.error("Cookies: FAIL — not defined");
        return;
    }
    console.log("Cookies: namespace exists");

    // 1. getAll — 获取所有 Cookie
    if (typeof Cookies.getAll === "function") {
        var all = Cookies.getAll();
        console.log("Cookies.getAll(): count =", all.length);
        if (all.length > 0) {
            console.log("  first:", all[0].name, "=", all[0].value, "domain:", all[0].domain);
        }
        console.log("Cookies.getAll: PASS");
    } else {
        console.error("Cookies.getAll: FAIL — not a function");
    }

    // 2. set — 设置 Cookie
    if (typeof Cookies.set === "function") {
        var ok = Cookies.set({
            name: "wn_test_cookie",
            value: "hello_whiteneedle",
            domain: ".localhost",
            path: "/"
        });
        console.log("Cookies.set:", ok ? "PASS" : "FAIL");
    } else {
        console.error("Cookies.set: FAIL — not a function");
    }

    // 3. get — 按名称获取
    if (typeof Cookies.get === "function") {
        var c = Cookies.get("wn_test_cookie");
        console.log("Cookies.get:", c ? "found value=" + c.value : "not found");
        console.log("Cookies.get: PASS");
    } else {
        console.error("Cookies.get: FAIL — not a function");
    }

    // 4. getAll 按域名过滤
    var filtered = Cookies.getAll(".localhost");
    console.log("Cookies.getAll('.localhost'):", filtered.length, "cookies");

    // 5. remove — 删除 Cookie
    if (typeof Cookies.remove === "function") {
        var removed = Cookies.remove("wn_test_cookie", ".localhost");
        console.log("Cookies.remove:", removed ? "PASS" : "FAIL (may not exist)");
    } else {
        console.error("Cookies.remove: FAIL — not a function");
    }

    // 6. clear — 清空（谨慎使用）
    if (typeof Cookies.clear === "function") {
        console.log("Cookies.clear: function exists (not invoked to avoid data loss)");
    } else {
        console.error("Cookies.clear: FAIL — not a function");
    }

    console.log("=== test_cookies.js END ===");
})();
