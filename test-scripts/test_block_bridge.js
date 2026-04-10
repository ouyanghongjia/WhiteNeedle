// test_block_bridge.js — $block / $callBlock / $blockSig + OC 深度集成测试
// Part A: $block/$callBlock/$blockSig 基础 API
// Part B: JS 创建 block 传给 OC 方法 (OC 回调 JS)
// Part C: JS hook 带 block 参数的 OC 方法 (JS 调用 block 回调 OC)

// ─── Inline Test Harness ─────────────────────────────────────
var _r = [], _suite = 'block_bridge', _async = 0;
function _log(s, n, d) {
    _r.push({ s: s, n: n, d: d || '' });
    var p = s === 'PASS' ? '  ✓' : s === 'FAIL' ? '  ✗' : '  ⊘';
    var m = p + ' ' + n + (d ? ' — ' + d : '');
    if (s === 'FAIL') console.error(m);
    else if (s === 'SKIP') console.warn(m);
    else console.log(m);
}
var T = {
    suite: function(n) { console.log('\n▸ ' + n); },
    ok: function(c, n) { _log(c ? 'PASS' : 'FAIL', n, c ? '' : 'assertion false'); },
    eq: function(a, b, n) { var p = a === b; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); },
    neq: function(a, b, n) { var p = a !== b; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'values are equal: ' + JSON.stringify(a)); },
    type: function(v, t, n) { var p = typeof v === t; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'typeof is ' + typeof v + ', want ' + t); },
    approx: function(a, b, eps, n) { var p = Math.abs(a - b) < (eps || 0.01); _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'got ' + a + ', want ~' + b); },
    throws: function(fn, n) { try { fn(); _log('FAIL', n, 'no throw'); } catch(e) { _log('PASS', n); } },
    safe: function(fn, n) { try { fn(); _log('PASS', n); } catch(e) { _log('FAIL', n, String(e).substring(0, 120)); } },
    skip: function(n, reason) { _log('SKIP', n, reason || ''); },
    done: function() {
        var p = 0, f = 0, s = 0, fails = [];
        for (var i = 0; i < _r.length; i++) {
            if (_r[i].s === 'PASS') p++;
            else if (_r[i].s === 'FAIL') { f++; fails.push(_r[i].n + ': ' + _r[i].d); }
            else s++;
        }
        console.log('\n══════════════════════════════════════');
        console.log('SUITE: ' + _suite);
        console.log('TOTAL: ' + _r.length + '  PASSED: ' + p + '  FAILED: ' + f + '  SKIPPED: ' + s);
        if (f > 0) { console.error('FAILURES:'); for (var j = 0; j < fails.length; j++) console.error('  • ' + fails[j]); }
        console.log('══════════════════════════════════════');
        console.log('[RESULT_JSON] ' + JSON.stringify({ suite: _suite, total: _r.length, passed: p, failed: f, skipped: s, failures: fails }));
    }
};

// ═══════════════════════════════════════════════════════════════
// Part A: $block / $callBlock / $blockSig 基础 API
// ═══════════════════════════════════════════════════════════════
T.suite('Part A: $block/$callBlock/$blockSig API');

T.type($block, 'function', '$block exists');
T.type($callBlock, 'function', '$callBlock exists');
T.type($blockSig, 'function', '$blockSig exists');

// A1. $blockSig 签名转换
T.eq($blockSig('void (^)()'), 'v@?', '$blockSig void(^)()');
T.eq($blockSig('void (^)(id, double)'), 'v@?@d', '$blockSig void(^)(id,double)');
T.eq($blockSig('id (^)(id)'), '@@?@', '$blockSig id(^)(id)');
T.eq($blockSig('void (^)(id, void (^)(double))'), 'v@?@@?', '$blockSig nested block');

// A2. void(^)(void) — 创建并调用
var voidCalled = false;
var b0 = $block(function () { voidCalled = true; }, 'v@?');
T.ok(!!b0, 'void block created');
$callBlock(b0, 'v@?');
T.ok(voidCalled, 'void block invoked');

// A3. void(^)(id)
var receivedStr = null;
var b1 = $block(function (s) { receivedStr = s; }, 'v@?@');
$callBlock(b1, 'v@?@', 'hello');
T.eq(receivedStr, 'hello', 'void(^)(id) received arg');

// A4. id(^)(id) — 有返回值
var b2 = $block(function (input) { return 'echo:' + input; }, '@@?@');
var r2 = $callBlock(b2, '@@?@', 'test');
T.ok(r2 && r2.toString().indexOf('echo:test') >= 0, 'id(^)(id) return: ' + r2);

// A5. id(^)(id, id) — 双参数返回
var b3 = $block(function (a, b) { return a + '+' + b; }, '@@?@@');
var r3 = $callBlock(b3, '@@?@@', 'foo', 'bar');
T.ok(r3 && r3.toString() === 'foo+bar', 'id(^)(id,id) return: ' + r3);

// A6. void(^)(BOOL)
var gotBool = null;
var b4 = $block(function (flag) { gotBool = flag; }, 'v@?B');
$callBlock(b4, 'v@?B', true);
T.ok(gotBool === true || gotBool === 1, 'void(^)(BOOL): ' + gotBool);

// A7. void(^)(double)
var gotDouble = null;
var b5 = $block(function (d) { gotDouble = d; }, 'v@?d');
$callBlock(b5, 'v@?d', 3.14);
T.approx(gotDouble, 3.14, 0.001, 'void(^)(double)');

// A8. double(^)(double)
var b6 = $block(function (d) { return d * 2; }, 'd@?d');
var r6 = $callBlock(b6, 'd@?d', 5.5);
T.approx(r6, 11.0, 0.001, 'double(^)(double) return');

// A9. void(^)(id, double) — 混合类型
var mixStr = null, mixDbl = null;
var b7 = $block(function (s, d) { mixStr = s; mixDbl = d; }, 'v@?@d');
$callBlock(b7, 'v@?@d', 'mix', 99.9);
T.ok(mixStr === 'mix' && Math.abs(mixDbl - 99.9) < 0.1, 'void(^)(id,double) mixed');

// A10. 使用 $blockSig DSL 语法创建 block
var dslCalled = false;
var b8 = $block(function () { dslCalled = true; }, 'void (^)()');
$callBlock(b8, 'void (^)()');
T.ok(dslCalled, '$block with DSL syntax');

// ═══════════════════════════════════════════════════════════════
// Part B: JS 创建 block → 传给 OC → OC 调用 block → JS 收到回调
// ═══════════════════════════════════════════════════════════════
T.suite('Part B: JS block → OC → callback');

var Helper = ObjC.use('WNBlockTestHelper');
if (!Helper) {
    T.skip('Part B (all)', 'WNBlockTestHelper not found');
    T.skip('Part C (all)', 'WNBlockTestHelper not found');
    T.done();
} else {

T.ok(true, 'WNBlockTestHelper found');

// B1. void(^)(void) → callVoidBlock:
var b1Called = false;
var blk1 = $block(function () { b1Called = true; }, 'v@?');
Helper.invoke('callVoidBlock:', [blk1]);
T.ok(b1Called, 'B1 void(^)(void) callback');

// B2. void(^)(id) → callVoidIdBlock:withString:
var b2Str = null;
var blk2 = $block(function (s) { b2Str = s; }, 'v@?@');
Helper.invoke('callVoidIdBlock:withString:', [blk2, 'WhiteNeedle']);
T.eq(b2Str, 'WhiteNeedle', 'B2 void(^)(id)');

// B3. void(^)(BOOL) → callVoidBoolBlock:withFlag:
var b3Flag = null;
var blk3 = $block(function (f) { b3Flag = f; }, 'v@?B');
Helper.invoke('callVoidBoolBlock:withFlag:', [blk3, true]);
T.ok(b3Flag === true || b3Flag === 1, 'B3 void(^)(BOOL): ' + b3Flag);

// B4. void(^)(NSInteger) → callVoidIntBlock:withValue:
var b4Val = null;
var blk4 = $block(function (v) { b4Val = v; }, 'v@?q');
Helper.invoke('callVoidIntBlock:withValue:', [blk4, 42]);
T.ok(b4Val == 42, 'B4 void(^)(NSInteger): ' + b4Val);

// B5. void(^)(double) → callVoidDoubleBlock:withValue:
var b5Val = null;
var blk5 = $block(function (d) { b5Val = d; }, 'v@?d');
Helper.invoke('callVoidDoubleBlock:withValue:', [blk5, 2.718]);
T.approx(b5Val, 2.718, 0.01, 'B5 void(^)(double)');

// B6. void(^)(id, id) → callVoidTwoIdBlock:withFirst:second:
var b6a = null, b6b = null;
var blk6 = $block(function (a, b) { b6a = a; b6b = b; }, 'v@?@@');
Helper.invoke('callVoidTwoIdBlock:withFirst:second:', [blk6, 'alpha', 'beta']);
T.ok(b6a === 'alpha' && b6b === 'beta', 'B6 void(^)(id,id)');

// B7. void(^)(id, double) → callVoidIdDoubleBlock:withString:value:
var b7s = null, b7d = null;
var blk7 = $block(function (s, d) { b7s = s; b7d = d; }, 'v@?@d');
Helper.invoke('callVoidIdDoubleBlock:withString:value:', [blk7, 'pi', 3.14159]);
T.ok(b7s === 'pi', 'B7 string arg');
T.approx(b7d, 3.14159, 0.001, 'B7 double arg');

// B8. void(^)(id, NSInteger, double) → callVoidThreeArgBlock:string:integer:doubleVal:
var b8s = null, b8i = null, b8d = null;
var blk8 = $block(function (s, i, d) { b8s = s; b8i = i; b8d = d; }, 'v@?@qd');
Helper.invoke('callVoidThreeArgBlock:string:integer:doubleVal:', [blk8, 'data', 100, 9.81]);
T.ok(b8s === 'data' && b8i == 100, 'B8 string+int args');
T.approx(b8d, 9.81, 0.01, 'B8 double arg');

// B9. id(^)(id) → callIdReturnBlock:withInput:
var blk9 = $block(function (s) { return 'UPPER:' + s; }, '@@?@');
var r9 = Helper.invoke('callIdReturnBlock:withInput:', [blk9, 'hello']);
T.ok(r9 && r9.toString().indexOf('UPPER:hello') >= 0, 'B9 id(^)(id) return: ' + r9);

// B10. NSInteger(^)(NSInteger, NSInteger) → callIntReturnBlock:withA:b:
var blk10 = $block(function (a, b) { return a + b; }, 'q@?qq');
var r10 = Helper.invoke('callIntReturnBlock:withA:b:', [blk10, 17, 25]);
T.ok(r10 == 42, 'B10 NSInteger(^)(q,q) return: ' + r10);

// B11. double(^)(double) → callDoubleReturnBlock:withValue:
var blk11 = $block(function (d) { return d * d; }, 'd@?d');
var r11 = Helper.invoke('callDoubleReturnBlock:withValue:', [blk11, 7.0]);
T.approx(r11, 49.0, 0.01, 'B11 double(^)(double) return');

// B12. BOOL(^)(id) → callBoolReturnBlock:withString:
var blk12 = $block(function (s) { return s && s.length > 3; }, 'B@?@');
var r12 = Helper.invoke('callBoolReturnBlock:withString:', [blk12, 'Hello']);
T.ok(r12 == true || r12 == 1, 'B12 BOOL(^)(id) return: ' + r12);

// B13. void(^)(CGRect) → callVoidRectBlock:withRect:
var b13Rect = null;
var blk13 = $block(function (r) { b13Rect = r; }, $blockSig('void (^)(CGRect)'));
Helper.invoke('callVoidRectBlock:withRect:', [blk13, {x: 10, y: 20, width: 100, height: 200}]);
T.ok(b13Rect !== null && b13Rect.x == 10 && b13Rect.width == 100, 'B13 void(^)(CGRect)');

// B14. void(^)(CGPoint) → callVoidPointBlock:withPoint:
var b14Pt = null;
var blk14 = $block(function (p) { b14Pt = p; }, $blockSig('void (^)(CGPoint)'));
Helper.invoke('callVoidPointBlock:withPoint:', [blk14, {x: 50.5, y: 75.3}]);
T.ok(b14Pt !== null && Math.abs(b14Pt.x - 50.5) < 0.1, 'B14 void(^)(CGPoint)');

// B15. void(^)(CGSize) → callVoidSizeBlock:withSize:
var b15Sz = null;
var blk15 = $block(function (s) { b15Sz = s; }, $blockSig('void (^)(CGSize)'));
Helper.invoke('callVoidSizeBlock:withSize:', [blk15, {width: 320, height: 480}]);
T.ok(b15Sz !== null && b15Sz.width == 320, 'B15 void(^)(CGSize)');

// B16. CGRect(^)(CGRect) → callRectReturnRectBlock:withRect:
var blk16 = $block(function (r) {
    return {x: r.x + 5, y: r.y + 5, width: r.width - 10, height: r.height - 10};
}, $blockSig('CGRect (^)(CGRect)'));
var r16 = Helper.invoke('callRectReturnRectBlock:withRect:', [blk16, {x: 0, y: 0, width: 100, height: 100}]);
T.ok(r16 !== null && r16.x == 5 && r16.width == 90, 'B16 CGRect(^)(CGRect) return');

// B17. void(^)(id, CGRect) → callVoidIdRectBlock:withString:rect:
var b17s = null, b17r = null;
var blk17 = $block(function (s, r) { b17s = s; b17r = r; }, $blockSig('void (^)(id, CGRect)'));
Helper.invoke('callVoidIdRectBlock:withString:rect:', [blk17, 'frame', {x: 1, y: 2, width: 3, height: 4}]);
T.ok(b17s === 'frame' && b17r !== null && b17r.x == 1, 'B17 void(^)(id,CGRect)');

// B18. void(^)(CGRect, CGRect) → callVoidTwoRectsBlock:withFirst:second:
var b18r1 = null, b18r2 = null;
var blk18 = $block(function (r1, r2) { b18r1 = r1; b18r2 = r2; }, $blockSig('void (^)(CGRect, CGRect)'));
Helper.invoke('callVoidTwoRectsBlock:withFirst:second:',
    [blk18, {x: 0, y: 0, width: 50, height: 50}, {x: 10, y: 10, width: 80, height: 80}]);
T.ok(b18r1 !== null && b18r2 !== null && b18r1.width == 50 && b18r2.x == 10, 'B18 void(^)(CGRect,CGRect)');

// ═══════════════════════════════════════════════════════════════
// Part C: JS hook OC methods with block params
// ═══════════════════════════════════════════════════════════════
T.suite('Part C: JS hook OC block-param methods');

var helper = Helper.invoke('new');
if (!helper || !helper.invoke) {
    T.skip('Part C (all)', 'cannot create WNBlockTestHelper instance');
} else {

T.ok(true, 'WNBlockTestHelper instance created');

// C1. Hook transformString:usingFormatter:
var c1HookCalled = false;
T.safe(function () {
    Interceptor.attach('-[WNBlockTestHelper transformString:usingFormatter:]', {
        onEnter: function (self, sel, args) { c1HookCalled = true; },
        onLeave: function (retval) {}
    });
}, 'C1 hook installed');

var c1Result = helper.invoke('transformString:usingFormatter:', [
    'hello world',
    $block(function (s) { return s ? s.toString().toUpperCase() : s; }, '@@?@')
]);
T.ok(c1HookCalled, 'C1 hook triggered');
T.ok(c1Result && c1Result.toString().indexOf('HELLO WORLD') >= 0, 'C1 result: ' + c1Result);

// C2. Hook computeWithValue:usingFormula:
var c2HookCalled = false;
T.safe(function () {
    Interceptor.attach('-[WNBlockTestHelper computeWithValue:usingFormula:]', {
        onEnter: function (self, sel, args) { c2HookCalled = true; },
        onLeave: function (retval) {}
    });
}, 'C2 hook installed');

var c2Result = helper.invoke('computeWithValue:usingFormula:', [
    5.0,
    $block(function (d) { return d * d + 1; }, 'd@?d')
]);
T.ok(c2HookCalled, 'C2 hook triggered');
T.approx(c2Result, 26.0, 0.01, 'C2 result');

// C3. performAsyncWithCompletion: — async completion block
var c3Done = false;
helper.invoke('performAsyncWithCompletion:', [
    $block(function (result, error) { c3Done = true; }, 'v@?@@')
]);
T.ok(true, 'C3 performAsyncWithCompletion: called (async deferred)');

// C4. enumerateItems:withBlock: — block with (id, NSUInteger, BOOL *)
var c4Items = [];
var arr = ObjC.use('NSMutableArray').invoke('array');
arr.invoke('addObject:', ['apple']);
arr.invoke('addObject:', ['banana']);
arr.invoke('addObject:', ['cherry']);
arr.invoke('addObject:', ['date']);
helper.invoke('enumerateItems:withBlock:', [
    arr,
    $block(function (item, idx, stopPtr) { c4Items.push(String(item)); }, 'v@?@Q^B')
]);
T.ok(c4Items.length >= 3, 'C4 enumerateItems callback count=' + c4Items.length);

// Cleanup hooks
try {
    Interceptor.detach('-[WNBlockTestHelper transformString:usingFormatter:]');
    Interceptor.detach('-[WNBlockTestHelper computeWithValue:usingFormula:]');
} catch (e) { /* ignore */ }

} // end Part C

} // end Part B/C guard

T.done();
