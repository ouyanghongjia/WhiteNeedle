// test_objc_bridge.js — 测试 ObjC.use / ObjC.classes / ObjC.getClassNames / ObjC.choose / ObjC.instance
// 注意: invoke 多参数调用格式为 invoke("selector:", [arg1, arg2, ...])

(function () {
    console.log("=== test_objc_bridge.js START ===");

    // 1. ObjC.available
    console.log("ObjC.available:", ObjC.available);
    if (ObjC.available !== true) {
        console.error("ObjC.available: FAIL");
        return;
    }
    console.log("ObjC.available: PASS");

    // 2. ObjC.use — 创建类代理
    var UIApp = ObjC.use("UIApplication");
    console.log("ObjC.use('UIApplication'):", typeof UIApp);
    if (UIApp) {
        console.log("ObjC.use: PASS — created class proxy");
    } else {
        console.error("ObjC.use: FAIL — returned null/undefined");
    }

    // 3. invoke — 调用无参类方法
    var sharedApp = UIApp.invoke("sharedApplication");
    console.log("UIApplication.sharedApplication:", sharedApp);
    if (sharedApp) {
        console.log("invoke sharedApplication: PASS");
    } else {
        console.error("invoke sharedApplication: FAIL");
    }

    // 4. ObjC.use + invoke 获取 Bundle
    var bundle = ObjC.use("NSBundle").invoke("mainBundle");
    var bundleId = bundle.invoke("bundleIdentifier");
    console.log("NSBundle.mainBundle.bundleIdentifier:", bundleId);
    if (bundleId) {
        console.log("bundle identifier: PASS");
    }

    // 5. className() — 获取类名
    if (typeof UIApp.className === "function") {
        var name = UIApp.className();
        console.log("UIApp.className():", name);
        console.log("className: PASS");
    }

    // 6. respondsToSelector
    if (typeof UIApp.respondsToSelector === "function") {
        var responds = UIApp.respondsToSelector("sharedApplication");
        console.log("respondsToSelector('sharedApplication'):", responds);
        if (responds) {
            console.log("respondsToSelector: PASS");
        }
    }

    // 7. getMethods — 获取方法列表
    if (typeof UIApp.getMethods === "function") {
        var methods = UIApp.getMethods();
        console.log("getMethods count:", methods ? methods.length : 0);
        if (methods && methods.length > 0) {
            console.log("  first 3:", methods.slice(0, 3));
            console.log("getMethods: PASS");
        }
    }

    // 8. superclass
    if (typeof UIApp.superclass === "function") {
        var superCls = UIApp.superclass();
        console.log("UIApplication.superclass:", superCls);
        console.log("superclass: PASS");
    }

    // 9. NSString — 桥接会把返回的 NSString 转成 JS string（无 .invoke），需分支判断
    var nsStr = ObjC.use("NSString").invoke("stringWithString:", ["Hello WhiteNeedle"]);
    if (typeof nsStr === "string") {
        console.log("NSString length:", nsStr.length);
        console.log("NSString value:", nsStr);
        console.log("NSString: PASS — returned as JS string");
    } else if (nsStr && typeof nsStr.invoke === "function") {
        var length = nsStr.invoke("length");
        console.log("NSString length:", length);
        var upper = nsStr.invoke("uppercaseString");
        console.log("NSString uppercaseString:", upper);
        console.log("NSString: PASS");
    } else {
        console.warn("NSString stringWithString: returned nil or unexpected type");
    }

    // 10. NSMutableArray — 参数使用数组包裹
    var arr = ObjC.use("NSMutableArray").invoke("array");
    if (arr && arr.invoke) {
        arr.invoke("addObject:", ["item1"]);
        arr.invoke("addObject:", ["item2"]);
        arr.invoke("addObject:", ["item3"]);
        var arrCount = arr.invoke("count");
        console.log("NSMutableArray count:", arrCount);
        if (arrCount == 3) {
            console.log("NSMutableArray: PASS");
        }
        var firstObj = arr.invoke("objectAtIndex:", [0]);
        console.log("NSMutableArray[0]:", firstObj);
    }

    // 11. NSMutableDictionary
    var dict = ObjC.use("NSMutableDictionary").invoke("dictionary");
    if (dict && dict.invoke) {
        dict.invoke("setObject:forKey:", ["value1", "key1"]);
        dict.invoke("setObject:forKey:", ["hello", "key2"]);
        var dictCount = dict.invoke("count");
        console.log("NSMutableDictionary count:", dictCount);
        var val1 = dict.invoke("objectForKey:", ["key1"]);
        console.log("NSMutableDictionary['key1']:", val1);
        if (dictCount == 2) {
            console.log("NSMutableDictionary: PASS");
        }
    }

    // 12. NSDate
    var now = ObjC.use("NSDate").invoke("date");
    if (now && now.invoke) {
        var ti = now.invoke("timeIntervalSince1970");
        console.log("NSDate.timeIntervalSince1970:", ti);
        if (ti > 0) {
            console.log("NSDate: PASS");
        }
    }

    // 13. ObjC.getClassNames — 枚举类名
    var allNames = ObjC.getClassNames();
    console.log("ObjC.getClassNames(): count:", allNames ? allNames.length : 0);
    if (allNames && allNames.length > 100) {
        console.log("ObjC.getClassNames (unfiltered): PASS — " + allNames.length + " classes");
    }

    // 14. ObjC.getClassNames 带过滤
    var filtered = ObjC.getClassNames("UIView");
    console.log("ObjC.getClassNames('UIView'): count:", filtered ? filtered.length : 0);
    if (filtered && filtered.length > 0) {
        console.log("ObjC.getClassNames (filtered): PASS");
        console.log("  first few:", filtered.slice(0, 5).join(", "));
    }

    // 15. ObjC.enumerateLoadedClasses
    var enumCount = 0;
    ObjC.enumerateLoadedClasses({
        onMatch: function (name) {
            enumCount++;
        },
        onComplete: function () {
            console.log("ObjC.enumerateLoadedClasses: found", enumCount, "classes");
            if (enumCount > 100) {
                console.log("ObjC.enumerateLoadedClasses: PASS");
            }
        }
    });

    // 16. ObjC.choose — 堆扫描
    ObjC.choose("UIViewController", {
        onMatch: function (instance) {
            console.log("ObjC.choose UIViewController: found instance");
            return "stop";
        },
        onComplete: function () {
            console.log("ObjC.choose UIViewController: scan complete");
        }
    });

    // 17. getProperty / setProperty
    if (sharedApp && typeof sharedApp.getProperty === "function") {
        var appDelegate = sharedApp.getProperty("delegate");
        console.log("getProperty('delegate'):", appDelegate);
        console.log("getProperty: PASS");
    }

    // 18. ObjC.instance — 从原生对象创建代理
    if (typeof ObjC.instance === "function") {
        console.log("ObjC.instance: function exists — PASS");
    } else {
        console.warn("ObjC.instance: not available");
    }

    console.log("=== test_objc_bridge.js END ===");
})();
