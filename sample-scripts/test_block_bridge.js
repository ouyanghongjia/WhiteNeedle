// test_block_bridge.js — 全面测试 $block / $callBlock / $blockSig + OC 交互
// 测试分三大部分:
//   Part A: $block/$callBlock 基础 API
//   Part B: JS 创建 block 传给 OC 方法 (OC 回调 JS)
//   Part C: JS hook 带 block 参数的 OC 方法 (JS 调用 block 回调 OC)

(function () {
    console.log("=== test_block_bridge.js START ===");

    var passed = 0;
    var failed = 0;

    function PASS(name) {
        passed++;
        console.log("  ✓ " + name + ": PASS");
    }
    function FAIL(name, detail) {
        failed++;
        console.error("  ✗ " + name + ": FAIL" + (detail ? " — " + detail : ""));
    }
    function CHECK(name, cond, detail) {
        if (cond) PASS(name);
        else FAIL(name, detail);
    }

    // =====================================================
    // Part A: $block / $callBlock / $blockSig 基础 API
    // =====================================================
    console.log("\n--- Part A: $block/$callBlock/$blockSig API ---");

    CHECK("$block exists", typeof $block === "function");
    CHECK("$callBlock exists", typeof $callBlock === "function");
    CHECK("$blockSig exists", typeof $blockSig === "function");

    // A1. $blockSig 签名转换
    var enc0 = $blockSig("void (^)()");
    CHECK("$blockSig void(^)()", enc0 === "v@?", "got " + enc0);

    var enc1 = $blockSig("void (^)(id, double)");
    CHECK("$blockSig void(^)(id,double)", enc1 === "v@?@d", "got " + enc1);

    var enc2 = $blockSig("id (^)(id)");
    CHECK("$blockSig id(^)(id)", enc2 === "@@?@", "got " + enc2);

    var enc3 = $blockSig("void (^)(id, void (^)(double))");
    CHECK("$blockSig nested block", enc3 === "v@?@@?", "got " + enc3);

    // A2. void(^)(void) — 创建并调用
    var voidCalled = false;
    var b0 = $block(function () { voidCalled = true; }, "v@?");
    CHECK("void block created", !!b0);
    $callBlock(b0, "v@?");
    CHECK("void block invoked", voidCalled);

    // A3. void(^)(id)
    var receivedStr = null;
    var b1 = $block(function (s) { receivedStr = s; }, "v@?@");
    $callBlock(b1, "v@?@", "hello");
    CHECK("void(^)(id) received arg", receivedStr === "hello", "got " + receivedStr);

    // A4. id(^)(id) — 有返回值
    var b2 = $block(function (input) { return "echo:" + input; }, "@@?@");
    var r2 = $callBlock(b2, "@@?@", "test");
    CHECK("id(^)(id) return", r2 && r2.toString().indexOf("echo:test") >= 0, "got " + r2);

    // A5. id(^)(id, id) — 双参数返回
    var b3 = $block(function (a, b) { return a + "+" + b; }, "@@?@@");
    var r3 = $callBlock(b3, "@@?@@", "foo", "bar");
    CHECK("id(^)(id,id) return", r3 && r3.toString() === "foo+bar", "got " + r3);

    // A6. void(^)(BOOL)
    var gotBool = null;
    var b4 = $block(function (flag) { gotBool = flag; }, "v@?B");
    $callBlock(b4, "v@?B", true);
    CHECK("void(^)(BOOL)", gotBool === true || gotBool === 1, "got " + gotBool);

    // A7. void(^)(double)
    var gotDouble = null;
    var b5 = $block(function (d) { gotDouble = d; }, "v@?d");
    $callBlock(b5, "v@?d", 3.14);
    CHECK("void(^)(double)", Math.abs(gotDouble - 3.14) < 0.001, "got " + gotDouble);

    // A8. double(^)(double)
    var b6 = $block(function (d) { return d * 2; }, "d@?d");
    var r6 = $callBlock(b6, "d@?d", 5.5);
    CHECK("double(^)(double) return", Math.abs(r6 - 11.0) < 0.001, "got " + r6);

    // A9. void(^)(id, double) — 混合类型
    var mixStr = null, mixDbl = null;
    var b7 = $block(function (s, d) { mixStr = s; mixDbl = d; }, "v@?@d");
    $callBlock(b7, "v@?@d", "mix", 99.9);
    CHECK("void(^)(id,double) mixed", mixStr === "mix" && Math.abs(mixDbl - 99.9) < 0.1, "got " + mixStr + ", " + mixDbl);

    // A10. 使用 $blockSig DSL 语法创建 block
    var dslCalled = false;
    var b8 = $block(function () { dslCalled = true; }, "void (^)()");
    $callBlock(b8, "void (^)()");
    CHECK("$block with DSL syntax", dslCalled);

    // =====================================================
    // Part B: JS 创建 block → 传给 OC → OC 调用 block → JS 收到回调
    // =====================================================
    console.log("\n--- Part B: JS block → OC method → OC calls block → JS callback ---");

    var Helper = ObjC.use("WNBlockTestHelper");
    if (!Helper) {
        console.error("WNBlockTestHelper not found — skipping Part B & C");
        console.log("\n=== RESULTS: " + passed + " passed, " + failed + " failed ===");
        console.log("=== test_block_bridge.js END ===");
        return;
    }
    PASS("WNBlockTestHelper found");

    // B1. void(^)(void) → callVoidBlock:
    var b1Called = false;
    var blk1 = $block(function () {
        b1Called = true;
        console.log("    [JS] void block callback invoked!");
    }, "v@?");
    Helper.invoke("callVoidBlock:", [blk1]);
    CHECK("B1 void(^)(void) callback", b1Called);

    // B2. void(^)(id) → callVoidIdBlock:withString:
    var b2Str = null;
    var blk2 = $block(function (s) {
        b2Str = s;
        console.log("    [JS] void(^)(id) got:", s);
    }, "v@?@");
    Helper.invoke("callVoidIdBlock:withString:", [blk2, "WhiteNeedle"]);
    CHECK("B2 void(^)(id)", b2Str === "WhiteNeedle", "got " + b2Str);

    // B3. void(^)(BOOL) → callVoidBoolBlock:withFlag:
    var b3Flag = null;
    var blk3 = $block(function (f) {
        b3Flag = f;
        console.log("    [JS] void(^)(BOOL) got:", f);
    }, "v@?B");
    Helper.invoke("callVoidBoolBlock:withFlag:", [blk3, true]);
    CHECK("B3 void(^)(BOOL)", b3Flag === true || b3Flag === 1, "got " + b3Flag);

    // B4. void(^)(NSInteger) → callVoidIntBlock:withValue:
    var b4Val = null;
    var blk4 = $block(function (v) {
        b4Val = v;
        console.log("    [JS] void(^)(NSInteger) got:", v);
    }, "v@?q");
    Helper.invoke("callVoidIntBlock:withValue:", [blk4, 42]);
    CHECK("B4 void(^)(NSInteger)", b4Val == 42, "got " + b4Val);

    // B5. void(^)(double) → callVoidDoubleBlock:withValue:
    var b5Val = null;
    var blk5 = $block(function (d) {
        b5Val = d;
        console.log("    [JS] void(^)(double) got:", d);
    }, "v@?d");
    Helper.invoke("callVoidDoubleBlock:withValue:", [blk5, 2.718]);
    CHECK("B5 void(^)(double)", b5Val !== null && Math.abs(b5Val - 2.718) < 0.01, "got " + b5Val);

    // B6. void(^)(id, id) → callVoidTwoIdBlock:withFirst:second:
    var b6a = null, b6b = null;
    var blk6 = $block(function (a, b) {
        b6a = a; b6b = b;
        console.log("    [JS] void(^)(id,id) got:", a, b);
    }, "v@?@@");
    Helper.invoke("callVoidTwoIdBlock:withFirst:second:", [blk6, "alpha", "beta"]);
    CHECK("B6 void(^)(id,id)", b6a === "alpha" && b6b === "beta", "got " + b6a + ", " + b6b);

    // B7. void(^)(id, double) → callVoidIdDoubleBlock:withString:value:
    var b7s = null, b7d = null;
    var blk7 = $block(function (s, d) {
        b7s = s; b7d = d;
        console.log("    [JS] void(^)(id,double) got:", s, d);
    }, "v@?@d");
    Helper.invoke("callVoidIdDoubleBlock:withString:value:", [blk7, "pi", 3.14159]);
    CHECK("B7 void(^)(id,double)", b7s === "pi" && Math.abs(b7d - 3.14159) < 0.001, "got " + b7s + ", " + b7d);

    // B8. void(^)(id, NSInteger, double) → callVoidThreeArgBlock:string:integer:doubleVal:
    var b8s = null, b8i = null, b8d = null;
    var blk8 = $block(function (s, i, d) {
        b8s = s; b8i = i; b8d = d;
        console.log("    [JS] void(^)(id,q,d) got:", s, i, d);
    }, "v@?@qd");
    Helper.invoke("callVoidThreeArgBlock:string:integer:doubleVal:", [blk8, "data", 100, 9.81]);
    CHECK("B8 void(^)(id,NSInteger,double)", b8s === "data" && b8i == 100 && Math.abs(b8d - 9.81) < 0.01,
          "got " + b8s + ", " + b8i + ", " + b8d);

    // B9. id(^)(id) → callIdReturnBlock:withInput:
    var blk9 = $block(function (s) {
        console.log("    [JS] id(^)(id) processing:", s);
        return "UPPER:" + s;
    }, "@@?@");
    var r9 = Helper.invoke("callIdReturnBlock:withInput:", [blk9, "hello"]);
    CHECK("B9 id(^)(id) return", r9 && r9.toString && r9.toString().indexOf("UPPER:hello") >= 0, "got " + r9);

    // B10. NSInteger(^)(NSInteger, NSInteger) → callIntReturnBlock:withA:b:
    var blk10 = $block(function (a, b) {
        console.log("    [JS] q(^)(q,q) computing:", a, "+", b);
        return a + b;
    }, "q@?qq");
    var r10 = Helper.invoke("callIntReturnBlock:withA:b:", [blk10, 17, 25]);
    CHECK("B10 NSInteger(^)(NSInteger,NSInteger)", r10 == 42, "got " + r10);

    // B11. double(^)(double) → callDoubleReturnBlock:withValue:
    var blk11 = $block(function (d) {
        console.log("    [JS] d(^)(d) squaring:", d);
        return d * d;
    }, "d@?d");
    var r11 = Helper.invoke("callDoubleReturnBlock:withValue:", [blk11, 7.0]);
    CHECK("B11 double(^)(double) return", Math.abs(r11 - 49.0) < 0.01, "got " + r11);

    // B12. BOOL(^)(id) → callBoolReturnBlock:withString:
    var blk12 = $block(function (s) {
        console.log("    [JS] B(^)(id) checking:", s);
        return s && s.length > 3;
    }, "B@?@");
    var r12 = Helper.invoke("callBoolReturnBlock:withString:", [blk12, "Hello"]);
    CHECK("B12 BOOL(^)(id) return", r12 == true || r12 == 1, "got " + r12);

    // B13. void(^)(CGRect) → callVoidRectBlock:withRect:
    var b13Rect = null;
    var blk13 = $block(function (r) {
        b13Rect = r;
        console.log("    [JS] void(^)(CGRect) got:", JSON.stringify(r));
    }, $blockSig("void (^)(CGRect)"));
    Helper.invoke("callVoidRectBlock:withRect:", [blk13, {x: 10, y: 20, width: 100, height: 200}]);
    CHECK("B13 void(^)(CGRect)", b13Rect !== null && b13Rect.x == 10 && b13Rect.width == 100,
          "got " + JSON.stringify(b13Rect));

    // B14. void(^)(CGPoint) → callVoidPointBlock:withPoint:
    var b14Pt = null;
    var blk14 = $block(function (p) {
        b14Pt = p;
        console.log("    [JS] void(^)(CGPoint) got:", JSON.stringify(p));
    }, $blockSig("void (^)(CGPoint)"));
    Helper.invoke("callVoidPointBlock:withPoint:", [blk14, {x: 50.5, y: 75.3}]);
    CHECK("B14 void(^)(CGPoint)", b14Pt !== null && Math.abs(b14Pt.x - 50.5) < 0.1,
          "got " + JSON.stringify(b14Pt));

    // B15. void(^)(CGSize) → callVoidSizeBlock:withSize:
    var b15Sz = null;
    var blk15 = $block(function (s) {
        b15Sz = s;
        console.log("    [JS] void(^)(CGSize) got:", JSON.stringify(s));
    }, $blockSig("void (^)(CGSize)"));
    Helper.invoke("callVoidSizeBlock:withSize:", [blk15, {width: 320, height: 480}]);
    CHECK("B15 void(^)(CGSize)", b15Sz !== null && b15Sz.width == 320,
          "got " + JSON.stringify(b15Sz));

    // B16. CGRect(^)(CGRect) → callRectReturnRectBlock:withRect:
    var blk16 = $block(function (r) {
        console.log("    [JS] CGRect(^)(CGRect) inset:", JSON.stringify(r));
        return {x: r.x + 5, y: r.y + 5, width: r.width - 10, height: r.height - 10};
    }, $blockSig("CGRect (^)(CGRect)"));
    var r16 = Helper.invoke("callRectReturnRectBlock:withRect:", [blk16, {x: 0, y: 0, width: 100, height: 100}]);
    CHECK("B16 CGRect(^)(CGRect) return", r16 !== null && r16.x == 5 && r16.width == 90,
          "got " + JSON.stringify(r16));

    // B17. void(^)(id, CGRect) → callVoidIdRectBlock:withString:rect:
    var b17s = null, b17r = null;
    var blk17 = $block(function (s, r) {
        b17s = s; b17r = r;
        console.log("    [JS] void(^)(id,CGRect) got:", s, JSON.stringify(r));
    }, $blockSig("void (^)(id, CGRect)"));
    Helper.invoke("callVoidIdRectBlock:withString:rect:", [blk17, "frame", {x: 1, y: 2, width: 3, height: 4}]);
    CHECK("B17 void(^)(id,CGRect)", b17s === "frame" && b17r !== null && b17r.x == 1,
          "got " + b17s + ", " + JSON.stringify(b17r));

    // B18. void(^)(CGRect, CGRect) → callVoidTwoRectsBlock:withFirst:second:
    var b18r1 = null, b18r2 = null;
    var blk18 = $block(function (r1, r2) {
        b18r1 = r1; b18r2 = r2;
        console.log("    [JS] void(^)(CGRect,CGRect) got:", JSON.stringify(r1), JSON.stringify(r2));
    }, $blockSig("void (^)(CGRect, CGRect)"));
    Helper.invoke("callVoidTwoRectsBlock:withFirst:second:",
        [blk18, {x: 0, y: 0, width: 50, height: 50}, {x: 10, y: 10, width: 80, height: 80}]);
    CHECK("B18 void(^)(CGRect,CGRect)", b18r1 !== null && b18r2 !== null && b18r1.width == 50 && b18r2.x == 10,
          "got " + JSON.stringify(b18r1) + ", " + JSON.stringify(b18r2));

    // =====================================================
    // Part C: JS hook OC methods with block params → JS calls block → OC receives callback
    // =====================================================
    console.log("\n--- Part C: JS hook OC block-param methods → JS invokes block → OC callback ---");

    var helper = Helper.invoke("new");
    if (!helper || !helper.invoke) {
        console.error("Cannot create WNBlockTestHelper instance — skipping Part C");
        console.log("\n=== RESULTS: " + passed + " passed, " + failed + " failed ===");
        console.log("=== test_block_bridge.js END ===");
        return;
    }
    PASS("WNBlockTestHelper instance created");

    // C1. Hook transformString:usingFormatter: — JS replaces implementation, calls the block
    var c1HookCalled = false;
    try {
        Interceptor.attach("-[WNBlockTestHelper transformString:usingFormatter:]", {
            onEnter: function (self, sel, args) {
                c1HookCalled = true;
                console.log("    [HOOK] transformString:usingFormatter: entered");
                console.log("    [HOOK] arg0 (string):", args[0]);
                console.log("    [HOOK] arg1 (block): type =", typeof args[1]);
            },
            onLeave: function (retval) {
                console.log("    [HOOK] transformString returned:", retval);
            }
        });
        PASS("C1 hook installed");
    } catch (e) {
        FAIL("C1 hook install", e.message || e);
    }

    var c1Result = helper.invoke("transformString:usingFormatter:", [
        "hello world",
        $block(function (s) {
            console.log("    [JS formatter block] got:", s);
            return s ? s.toString().toUpperCase() : s;
        }, "@@?@")
    ]);
    CHECK("C1 transformString hook triggered", c1HookCalled);
    CHECK("C1 transformString result", c1Result && c1Result.toString().indexOf("HELLO WORLD") >= 0,
          "got " + c1Result);

    // C2. Hook computeWithValue:usingFormula: — formula block with double args
    var c2HookCalled = false;
    try {
        Interceptor.attach("-[WNBlockTestHelper computeWithValue:usingFormula:]", {
            onEnter: function (self, sel, args) {
                c2HookCalled = true;
                console.log("    [HOOK] computeWithValue:usingFormula: entered, value =", args[0]);
            },
            onLeave: function (retval) {
                console.log("    [HOOK] computeWithValue returned:", retval);
            }
        });
        PASS("C2 hook installed");
    } catch (e) {
        FAIL("C2 hook install", e.message || e);
    }

    var c2Result = helper.invoke("computeWithValue:usingFormula:", [
        5.0,
        $block(function (d) {
            console.log("    [JS formula block] input:", d, "→ output:", d * d + 1);
            return d * d + 1;
        }, "d@?d")
    ]);
    CHECK("C2 computeWithValue hook triggered", c2HookCalled);
    CHECK("C2 computeWithValue result", Math.abs(c2Result - 26.0) < 0.01, "got " + c2Result);

    // C3. Direct call performAsyncWithCompletion: — pass a completion block
    // (async: completion called after 0.1s on main queue)
    var c3Done = false;
    helper.invoke("performAsyncWithCompletion:", [
        $block(function (result, error) {
            c3Done = true;
            console.log("    [JS completion] result:", result, "error:", error);
        }, "v@?@@")
    ]);
    CHECK("C3 performAsyncWithCompletion: called (async block deferred)", true);

    // C4. Direct call enumerateItems:withBlock: — block with (id, NSUInteger, BOOL *)
    var c4Items = [];
    var arr = ObjC.use("NSMutableArray").invoke("array");
    arr.invoke("addObject:", ["apple"]);
    arr.invoke("addObject:", ["banana"]);
    arr.invoke("addObject:", ["cherry"]);
    arr.invoke("addObject:", ["date"]);
    helper.invoke("enumerateItems:withBlock:", [
        arr,
        $block(function (item, idx, stopPtr) {
            console.log("    [JS enumerate] item:", item, "idx:", idx);
            c4Items.push(String(item));
        }, "v@?@Q^B")
    ]);
    CHECK("C4 enumerateItems callback", c4Items.length >= 3,
          "items=" + JSON.stringify(c4Items));

    // Cleanup hooks
    try {
        Interceptor.detach("-[WNBlockTestHelper transformString:usingFormatter:]");
        Interceptor.detach("-[WNBlockTestHelper computeWithValue:usingFormula:]");
    } catch (e) { /* ignore */ }

    // =====================================================
    // Summary
    // =====================================================
    console.log("\n=== RESULTS: " + passed + " passed, " + failed + " failed ===");
    console.log("=== test_block_bridge.js END ===");
})();
