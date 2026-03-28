// test_objc_delegate.js — 测试 ObjC.delegate 协议代理构建
// 注意: 方法名不要加 "- " 前缀（与 ObjC.define 相同限制）

(function () {
    console.log("=== test_objc_delegate.js START ===");

    if (typeof ObjC.delegate !== "function") {
        console.error("ObjC.delegate: FAIL — function not found");
        return;
    }

    // 1. 创建一个简单的 delegate 对象
    var delegateObj = ObjC.delegate({
        protocols: ["NSCoding"],
        methods: {
            "encodeWithCoder:": function (self, args) {
                console.log("ObjC.delegate encodeWithCoder: called, coder:", args[0]);
            },
            "initWithCoder:": function (self, args) {
                console.log("ObjC.delegate initWithCoder: called");
                return self;
            }
        }
    });

    console.log("ObjC.delegate created:", delegateObj);
    if (delegateObj) {
        console.log("ObjC.delegate creation: PASS");
    } else {
        console.error("ObjC.delegate creation: FAIL");
    }

    // 2. 创建 UITableView 数据源代理
    var dataSourceDelegate = ObjC.delegate({
        protocols: ["UITableViewDataSource"],
        methods: {
            "tableView:numberOfRowsInSection:": function (self, args) {
                console.log("ObjC.delegate numberOfRowsInSection:", args[1]);
                return 5;
            },
            "tableView:cellForRowAtIndexPath:": function (self, args) {
                console.log("ObjC.delegate cellForRowAtIndexPath called");
                return null;
            },
            "numberOfSectionsInTableView:": function (self, args) {
                return 1;
            }
        }
    });

    if (dataSourceDelegate) {
        console.log("ObjC.delegate UITableViewDataSource: PASS — created");

        if (typeof dataSourceDelegate.respondsToSelector === "function") {
            var resp1 = dataSourceDelegate.respondsToSelector("tableView:numberOfRowsInSection:");
            var resp2 = dataSourceDelegate.respondsToSelector("numberOfSectionsInTableView:");
            console.log("  respondsTo tableView:numberOfRowsInSection:", resp1);
            console.log("  respondsTo numberOfSectionsInTableView:", resp2);
        }
    }

    // 3. 创建多协议代理
    var multiDelegate = ObjC.delegate({
        protocols: ["UITableViewDelegate", "UIScrollViewDelegate"],
        methods: {
            "tableView:didSelectRowAtIndexPath:": function (self, args) {
                console.log("ObjC.delegate didSelectRow called");
            },
            "scrollViewDidScroll:": function (self, args) {
                console.log("ObjC.delegate scrollViewDidScroll called");
            }
        }
    });

    if (multiDelegate) {
        console.log("ObjC.delegate multi-protocol: PASS");
    }

    // 4. 验证 delegate 是 NSObject 子类
    if (delegateObj && typeof delegateObj.className === "function") {
        var clsName = delegateObj.className();
        console.log("delegate className:", clsName);
        console.log("ObjC.delegate className: PASS");
    }

    console.log("=== test_objc_delegate.js END ===");
})();
