// test_objc_define.js — 测试 ObjC.define 运行时类创建
// 注意:
// 1. 方法名不要加 "- " / "+ " 前缀
// 2. JS 回调签名为 function(self, args)
// 3. ObjC.define 新增方法的默认类型编码为 "v@:" (void 返回)，因此 invoke 无法获得返回值
//    — 要验证方法已被调用，使用 console.log 等副作用
// 4. 不要在 ObjC.define 方法中调用 self.setProperty/getProperty 来操作同名属性，
//    会导致 KVC → msgForward → JS → KVC 递归

(function () {
    console.log("=== test_objc_define.js START ===");

    if (typeof ObjC.define !== "function") {
        console.error("ObjC.define: FAIL — function not found");
        return;
    }

    // 1. 创建简单类 — 验证方法通过副作用确认调用
    var testClassName1 = "WNTestClass_" + Date.now();
    var greetingCalled = false;
    var addResult = null;

    var WNTestClass = ObjC.define({
        name: testClassName1,
        super: "NSObject",
        methods: {
            "greeting": function (self, args) {
                greetingCalled = true;
                console.log("  [inside greeting] method invoked!");
            },
            "addA:toB:": function (self, args) {
                addResult = (args[0] || 0) + (args[1] || 0);
                console.log("  [inside addA:toB:] computed:", addResult);
            },
            "doLog:": function (self, args) {
                console.log("  [inside doLog:] received:", args[0]);
            }
        }
    });

    console.log("ObjC.define created class:", WNTestClass);
    if (WNTestClass) {
        console.log("ObjC.define: PASS — class created");
    } else {
        console.error("ObjC.define: FAIL — returned null");
        return;
    }

    // 2. 实例化
    var instance = WNTestClass.invoke("new");
    console.log("instance created:", instance);
    if (!instance || !instance.invoke) {
        console.error("instance creation: FAIL");
        return;
    }
    console.log("instance creation: PASS");

    // 3. 调用无参方法 — 通过闭包变量验证
    greetingCalled = false;
    instance.invoke("greeting");
    if (greetingCalled) {
        console.log("custom instance method (greeting): PASS — called");
    } else {
        console.warn("custom instance method (greeting): method not invoked");
    }

    // 4. 调用带参数的方法 — 通过闭包变量验证计算结果
    addResult = null;
    instance.invoke("addA:toB:", [10, 20]);
    if (addResult === 30) {
        console.log("custom method with args (addA:toB:): PASS — result:", addResult);
    } else {
        console.warn("custom method with args: result =", addResult);
    }

    // 5. 调用带单参方法
    instance.invoke("doLog:", ["hello from test"]);
    console.log("custom method with single arg: PASS — no crash");

    // 6. getMethods — 验证方法确实注册在类上
    if (typeof instance.getMethods === "function") {
        var methods = instance.getMethods();
        console.log("ObjC.define instance methods:", methods);
        var hasGreeting = false;
        var hasAdd = false;
        for (var i = 0; i < methods.length; i++) {
            if (methods[i].indexOf("greeting") >= 0) hasGreeting = true;
            if (methods[i].indexOf("addA:toB:") >= 0) hasAdd = true;
        }
        if (hasGreeting && hasAdd) {
            console.log("getMethods contains ObjC.define methods: PASS");
        }
    }

    // 7. respondsToSelector — 实例应响应 ObjC.define 方法
    if (typeof instance.respondsToSelector === "function") {
        var r1 = instance.respondsToSelector("greeting");
        var r2 = instance.respondsToSelector("addA:toB:");
        var r3 = instance.respondsToSelector("nonexistentMethod");
        console.log("instance.respondsToSelector greeting:", r1);
        console.log("instance.respondsToSelector addA:toB::", r2);
        console.log("instance.respondsToSelector nonexistent:", r3);
        if (r1 && r2 && !r3) {
            console.log("respondsToSelector on ObjC.define instance: PASS");
        }
    }

    // 8. 使用 JS 闭包管理状态（避免 KVC 递归）
    var testClassName2 = "WNPerson_" + Date.now();
    var personStore = {};

    var WNPerson = ObjC.define({
        name: testClassName2,
        super: "NSObject",
        methods: {
            "setName:": function (self, args) {
                personStore.name = args[0];
                console.log("  [inside setName:] stored:", args[0]);
            },
            "getName": function (self, args) {
                console.log("  [inside getName] returning:", personStore.name);
            },
            "greet": function (self, args) {
                console.log("  [inside greet] Hello, " + (personStore.name || "unknown") + "!");
            }
        }
    });

    if (WNPerson) {
        console.log("WNPerson class: PASS — created");
        var person = WNPerson.invoke("new");
        if (person && person.invoke) {
            person.invoke("setName:", ["Alice"]);
            if (personStore.name === "Alice") {
                console.log("WNPerson setName: PASS — stored 'Alice'");
            }
            person.invoke("getName");
            person.invoke("greet");
            console.log("WNPerson method calls: PASS — no crash");
        }
    }

    // 9. className / superclass
    if (typeof instance.className === "function") {
        var cn = instance.className();
        console.log("ObjC.define instance.className:", cn);
        if (cn.indexOf("WNTestClass") >= 0) {
            console.log("ObjC.define className: PASS");
        }
    }

    if (typeof instance.superclass === "function") {
        var sc = instance.superclass();
        console.log("ObjC.define instance.superclass:", sc);
        if (sc === "NSObject") {
            console.log("ObjC.define superclass: PASS");
        }
    }

    console.log("=== test_objc_define.js END ===");
})();
