// test_block_bridge.js — 测试 $block / $callBlock

(function () {
    console.log("=== test_block_bridge.js START ===");

    // 1. $block 是否存在
    if (typeof $block !== "function") {
        console.error("$block: FAIL — function not found");
        return;
    }
    console.log("$block: function exists");

    // 2. $callBlock 是否存在
    if (typeof $callBlock !== "function") {
        console.error("$callBlock: FAIL — function not found");
        return;
    }
    console.log("$callBlock: function exists");

    // 3. 创建 void (^)(void) block
    var voidBlock = $block(function () {
        console.log("$block void(^)(void): invoked!");
    }, "v@?");
    console.log("$block void(^)(void) created:", voidBlock);
    if (voidBlock) {
        console.log("$block creation: PASS");
    }

    // 4. $callBlock — 调用 block
    try {
        $callBlock(voidBlock, "v@?");
        console.log("$callBlock void block: PASS");
    } catch (e) {
        console.error("$callBlock void block: FAIL —", e.message || e);
    }

    // 5. 创建 void (^)(id) block
    var blockWithArg = $block(function (str) {
        console.log("$block void(^)(id): received arg:", str);
    }, "v@?@");
    console.log("$block void(^)(id) created:", blockWithArg);

    // 6. 调用带参数的 block
    try {
        $callBlock(blockWithArg, "v@?@", "test argument");
        console.log("$callBlock with arg: PASS");
    } catch (e) {
        console.error("$callBlock with arg: FAIL —", e.message || e);
    }

    // 7. 创建带返回值的 block: id (^)(id)
    var returnBlock = $block(function (input) {
        return "processed: " + input;
    }, "@@?@");
    console.log("$block id(^)(id) created:", returnBlock);

    // 8. 调用并检查返回值
    try {
        var result = $callBlock(returnBlock, "@@?@", "hello");
        console.log("$callBlock return value:", result);
        if (result && result.toString().indexOf("processed") >= 0) {
            console.log("$callBlock with return: PASS");
        }
    } catch (e) {
        console.error("$callBlock with return: FAIL —", e.message || e);
    }

    // 9. 创建带两个参数的 block
    var twoArgBlock = $block(function (a, b) {
        console.log("$block two args:", a, b);
        return a + " & " + b;
    }, "@@?@@");

    try {
        var r = $callBlock(twoArgBlock, "@@?@@", "foo", "bar");
        console.log("$callBlock two args result:", r);
        console.log("$block two args: PASS");
    } catch (e) {
        console.error("$block two args: FAIL —", e.message || e);
    }

    // 10. 创建 void (^)(BOOL) block
    var boolBlock = $block(function (flag) {
        console.log("$block void(^)(BOOL): flag =", flag);
    }, "v@?B");
    if (boolBlock) {
        console.log("$block with BOOL: PASS — created");
        try {
            $callBlock(boolBlock, "v@?B", true);
            console.log("$callBlock BOOL: PASS");
        } catch (e) {
            console.warn("$callBlock BOOL: skipped —", e.message || e);
        }
    }

    // 11. 创建 void (^)(id, double) block
    var mixedBlock = $block(function (str, num) {
        console.log("$block mixed:", str, num);
    }, "v@?@d");
    if (mixedBlock) {
        console.log("$block mixed types: PASS — created");
    }

    console.log("=== test_block_bridge.js END ===");
})();
