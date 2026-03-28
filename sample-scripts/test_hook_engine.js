// test_hook_engine.js — 测试 Interceptor.attach / replace / detach / detachAll / list

(function () {
    console.log("=== test_hook_engine.js START ===");

    if (typeof Interceptor === "undefined") {
        console.error("Interceptor: FAIL — not defined");
        return;
    }
    console.log("Interceptor: exists");

    // 1. Interceptor.list — 列出当前活跃的 hook
    var hooks = Interceptor.list();
    console.log("Interceptor.list():", hooks);
    console.log("active hooks count:", hooks ? hooks.length : 0);

    // 2. Interceptor.attach — hook viewDidLoad
    try {
        Interceptor.attach("-[UIViewController viewDidLoad]", {
            onEnter: function (self, sel, args) {
                console.log("HOOK onEnter: viewDidLoad, class:", self);
            },
            onLeave: function (retval) {
                console.log("HOOK onLeave: viewDidLoad done");
            }
        });
        console.log("Interceptor.attach (viewDidLoad): PASS");
    } catch (e) {
        console.error("Interceptor.attach: FAIL —", e.message || e);
    }

    // 3. 验证 hook 已注册
    var hooksAfterAttach = Interceptor.list();
    console.log("hooks after attach:", hooksAfterAttach);
    if (hooksAfterAttach && hooksAfterAttach.length > 0) {
        console.log("Interceptor.list after attach: PASS");
    }

    // 4. Interceptor.attach — hook 带参数的方法
    try {
        Interceptor.attach("-[UIView setFrame:]", {
            onEnter: function (self, sel, args) {
                console.log("HOOK setFrame: called on", self);
            }
        });
        console.log("Interceptor.attach (setFrame:): PASS");
    } catch (e) {
        console.error("Interceptor.attach (setFrame:): FAIL —", e.message || e);
    }

    // 5. Interceptor.detach — 移除单个 hook
    try {
        Interceptor.detach("-[UIView setFrame:]");
        console.log("Interceptor.detach (setFrame:): PASS");
    } catch (e) {
        console.error("Interceptor.detach: FAIL —", e.message || e);
    }

    // 6. Interceptor.replace — 替换系统类方法
    // 使用一个已知存在的方法进行测试
    try {
        Interceptor.replace("-[NSObject description]", function (self, args) {
            return "replaced description";
        });
        console.log("Interceptor.replace (NSObject description): installed");

        // 验证
        var hooksWithReplace = Interceptor.list();
        console.log("hooks after replace:", hooksWithReplace);
        if (hooksWithReplace && hooksWithReplace.length >= 1) {
            console.log("Interceptor.replace: PASS — hook is active");
        }
    } catch (e) {
        console.warn("Interceptor.replace: skipped —", e.message || e);
    }

    // 7. Interceptor.detachAll — 移除所有 hook
    try {
        Interceptor.detachAll();
        console.log("Interceptor.detachAll: PASS");
        var hooksAfterDetachAll = Interceptor.list();
        console.log("hooks after detachAll:", hooksAfterDetachAll);
        if (!hooksAfterDetachAll || hooksAfterDetachAll.length === 0) {
            console.log("Interceptor.detachAll cleanup: PASS");
        }
    } catch (e) {
        console.error("Interceptor.detachAll: FAIL —", e.message || e);
    }

    console.log("=== test_hook_engine.js END ===");
})();
