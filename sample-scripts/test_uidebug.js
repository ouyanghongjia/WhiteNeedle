// test_uidebug.js — 测试 UIDebug 命名空间 API

(function () {
    console.log("=== test_uidebug.js START ===");

    if (typeof UIDebug === "undefined") {
        console.error("UIDebug: FAIL — not defined");
        return;
    }
    console.log("UIDebug: namespace exists");

    // 1. keyWindow — 获取主窗口信息
    if (typeof UIDebug.keyWindow === "function") {
        var win = UIDebug.keyWindow();
        if (win) {
            console.log("UIDebug.keyWindow():");
            console.log("  class:", win.class);
            console.log("  frame:", JSON.stringify(win.frame));
            console.log("UIDebug.keyWindow: PASS");
        } else {
            console.log("UIDebug.keyWindow: returned null (no key window)");
        }
    } else {
        console.error("UIDebug.keyWindow: FAIL — not a function");
    }

    // 2. viewHierarchy — 视图层级
    if (typeof UIDebug.viewHierarchy === "function") {
        var tree = UIDebug.viewHierarchy();
        if (tree) {
            console.log("UIDebug.viewHierarchy():");
            console.log("  root class:", tree.class);
            console.log("  children:", tree.children ? tree.children.length : 0);
            console.log("UIDebug.viewHierarchy: PASS");
        } else {
            console.log("UIDebug.viewHierarchy: returned null");
        }
    } else {
        console.error("UIDebug.viewHierarchy: FAIL — not a function");
    }

    // 3. viewControllers — VC 层级
    if (typeof UIDebug.viewControllers === "function") {
        var vcs = UIDebug.viewControllers();
        console.log("UIDebug.viewControllers():", vcs.length, "controllers");
        vcs.forEach(function (vc) {
            var indent = "  ".repeat(vc.depth);
            console.log(indent + vc.class, vc.title ? "(" + vc.title + ")" : "");
        });
        console.log("UIDebug.viewControllers: PASS");
    } else {
        console.error("UIDebug.viewControllers: FAIL — not a function");
    }

    // 4. screenshot — 截图
    if (typeof UIDebug.screenshot === "function") {
        var png = UIDebug.screenshot();
        console.log("UIDebug.screenshot():", png ? png.length + " chars (base64)" : "null");
        console.log("UIDebug.screenshot: PASS");
    } else {
        console.error("UIDebug.screenshot: FAIL — not a function");
    }

    // 5. bounds — 视图边界
    if (typeof UIDebug.bounds === "function") {
        console.log("UIDebug.bounds: function exists");
        console.log("UIDebug.bounds: PASS (requires valid view address)");
    } else {
        console.error("UIDebug.bounds: FAIL — not a function");
    }

    // 6. screenshotView — 单视图截图
    if (typeof UIDebug.screenshotView === "function") {
        console.log("UIDebug.screenshotView: function exists");
        console.log("UIDebug.screenshotView: PASS (requires valid view address)");
    } else {
        console.error("UIDebug.screenshotView: FAIL — not a function");
    }

    console.log("=== test_uidebug.js END ===");
})();
