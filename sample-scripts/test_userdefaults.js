// test_userdefaults.js — 测试 UserDefaults 命名空间 API

(function () {
    console.log("=== test_userdefaults.js START ===");

    if (typeof UserDefaults === "undefined") {
        console.error("UserDefaults: FAIL — not defined");
        return;
    }
    console.log("UserDefaults: namespace exists");

    // 1. getAll — 列出所有键值对
    if (typeof UserDefaults.getAll === "function") {
        var all = UserDefaults.getAll();
        var keys = Object.keys(all);
        console.log("UserDefaults.getAll():", keys.length, "keys");
        if (keys.length > 0) {
            console.log("  sample key:", keys[0], "=", JSON.stringify(all[keys[0]]).substring(0, 60));
        }
        console.log("UserDefaults.getAll: PASS");
    } else {
        console.error("UserDefaults.getAll: FAIL — not a function");
    }

    // 2. set / get — 写入再读取
    if (typeof UserDefaults.set === "function" && typeof UserDefaults.get === "function") {
        UserDefaults.set("wn_test_key", "hello_whiteneedle");
        var val = UserDefaults.get("wn_test_key");
        console.log("UserDefaults.get('wn_test_key'):", val);
        if (val === "hello_whiteneedle") {
            console.log("UserDefaults set/get: PASS");
        } else {
            console.error("UserDefaults set/get: FAIL — mismatch");
        }
    }

    // 3. set 复杂类型
    UserDefaults.set("wn_test_dict", { nested: true, count: 42 });
    var dict = UserDefaults.get("wn_test_dict");
    console.log("UserDefaults dict:", JSON.stringify(dict));

    UserDefaults.set("wn_test_array", [1, "two", 3]);
    var arr = UserDefaults.get("wn_test_array");
    console.log("UserDefaults array:", JSON.stringify(arr));

    // 4. remove — 删除键
    if (typeof UserDefaults.remove === "function") {
        UserDefaults.remove("wn_test_key");
        UserDefaults.remove("wn_test_dict");
        UserDefaults.remove("wn_test_array");
        var afterRemove = UserDefaults.get("wn_test_key");
        console.log("UserDefaults.remove: PASS —", afterRemove === null ? "key removed" : "key still exists");
    }

    // 5. suites — 列出已知 Suite
    if (typeof UserDefaults.suites === "function") {
        var suites = UserDefaults.suites();
        console.log("UserDefaults.suites():", suites.length, "suites");
        suites.forEach(function (s) {
            var label = s.suiteName || s.name;
            var kc = s.keyCount;
            console.log("  suite:", label, "keys:", kc, s.isDefault ? "(default)" : "");
        });
        console.log("UserDefaults.suites: PASS");
    }

    console.log("=== test_userdefaults.js END ===");
})();
