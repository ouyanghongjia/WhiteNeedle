/**
 * WhiteNeedle Sample: Block Bridge
 *
 * 演示 ObjC Block 与 JS 函数之间的互操作：
 *   - $block      → 将 JS 函数包装为 ObjC Block
 *   - $callBlock  → 调用现有 ObjC Block
 *   - $blockSig   → 解析 Block 类型签名
 *
 * Block 是 iOS 开发中广泛使用的回调机制，很多 API 的
 * completionHandler 参数都是 Block 类型。
 */

// ── 1. 创建 ObjC Block 并传给 ObjC 方法 ────────────────────
dispatch.main(function () {
    var block = $block(function () {
        console.log('[Block] JS callback invoked from ObjC!');
    }, 'v');  // 'v' = void return, no arguments

    // 使用 dispatch_async 来调用这个 Block
    var queue = ObjC.use('NSOperationQueue').invoke('mainQueue');
    queue.invoke('addOperationWithBlock:', [block]);
    console.log('[Block] Queued block on main operation queue');
});

// ── 2. 创建带参数的 Block ──────────────────────────────────
dispatch.after(500, function () {
    dispatch.main(function () {
        var completionBlock = $block(function (success) {
            console.log('[Block] Completion called, success=' + success);
        }, 'vB');  // void return, BOOL argument

        // 手动调用 block 验证
        $callBlock(completionBlock, 'vB', true);
    });
});

// ── 3. $blockSig 解析签名 ──────────────────────────────────
var sig = $blockSig('void (^)(NSString *, NSInteger)');
console.log('[Block] Parsed signature: ' + sig);

console.log('[Block] Block bridge demo loaded');
