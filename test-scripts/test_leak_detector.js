// test_leak_detector.js — LeakDetector API 完整测试
// 快照对比、实例搜索、引用扫描、循环检测

// ─── Inline Test Harness ─────────────────────────────────────
var _r = [], _suite = 'leak_detector', _async = 0;
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
    gt: function(a, b, n) { var p = a > b; _log(p ? 'PASS' : 'FAIL', n, p ? '' : a + ' not > ' + b); },
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
// Guard: LeakDetector available?
// ═══════════════════════════════════════════════════════════════
if (typeof LeakDetector === 'undefined') {
    T.skip('LeakDetector (all)', 'LeakDetector not available');
    T.done();
} else {

// ═══════════════════════════════════════════════════════════════
// 1. API 存在性检查
// ═══════════════════════════════════════════════════════════════
T.suite('LeakDetector API existence');

T.type(LeakDetector.takeSnapshot, 'function', 'takeSnapshot exists');
T.type(LeakDetector.diffSnapshots, 'function', 'diffSnapshots exists');
T.type(LeakDetector.findInstances, 'function', 'findInstances exists');
T.type(LeakDetector.detectCycles, 'function', 'detectCycles exists');
T.type(LeakDetector.getStrongReferences, 'function', 'getStrongReferences exists');
T.type(LeakDetector.clearAllSnapshots, 'function', 'clearAllSnapshots exists');

// ═══════════════════════════════════════════════════════════════
// 2. 拍摄基线快照
// ═══════════════════════════════════════════════════════════════
T.suite('Snapshot: baseline');

var beforeTag = null;
T.safe(function () {
    beforeTag = LeakDetector.takeSnapshot('before_leak_test');
}, 'takeSnapshot(before) no crash');
T.ok(beforeTag !== null && beforeTag !== undefined, 'takeSnapshot returns tag: ' + beforeTag);

// ═══════════════════════════════════════════════════════════════
// 3. 制造泄漏场景
// ═══════════════════════════════════════════════════════════════
T.suite('Create leak scenarios');

var LeakExamples = ObjC.use('WNLeakExamples');
if (!LeakExamples) {
    T.skip('leak scenarios (all)', 'WNLeakExamples class not found');
} else {

// 3a: 循环引用 (A <-> B)
T.safe(function () {
    LeakExamples.invoke('createRetainCycle');
    LeakExamples.invoke('createRetainCycle');
    LeakExamples.invoke('createRetainCycle');
}, 'create 3 retain cycles');

// 3b: Timer 泄漏
T.safe(function () {
    LeakExamples.invoke('createTimerLeak');
}, 'create timer leak');

// 3c: Block 捕获泄漏
T.safe(function () {
    LeakExamples.invoke('createBlockCaptureLeak');
    LeakExamples.invoke('createBlockCaptureLeak');
}, 'create 2 block capture leaks');

// 3d: 孤立对象
T.safe(function () {
    LeakExamples.invoke('accumulateOrphanedObjects:', [20]);
}, 'accumulate 20 orphaned objects');

// ═══════════════════════════════════════════════════════════════
// 4. 拍摄操作后快照 & 对比
// ═══════════════════════════════════════════════════════════════
T.suite('Snapshot: diff');

var afterTag = null;
T.safe(function () {
    afterTag = LeakDetector.takeSnapshot('after_leak_test');
}, 'takeSnapshot(after) no crash');
T.ok(afterTag !== null && afterTag !== undefined, 'takeSnapshot(after) returns tag: ' + afterTag);

var diff = null;
T.safe(function () {
    diff = LeakDetector.diffSnapshots('before_leak_test', 'after_leak_test');
}, 'diffSnapshots no crash');
T.ok(diff !== null && diff !== undefined, 'diffSnapshots returns result');
T.ok(diff && diff.grown && diff.grown.length > 0, 'diff.grown has entries: ' + (diff && diff.grown ? diff.grown.length : 0));

var leakyClasses = ['WNRetainCycleA', 'WNRetainCycleB', 'WNTimerLeaker', 'WNBlockCaptureLeak', 'WNOrphanedObject'];
if (diff && diff.grown) {
    var grownNames = [];
    for (var i = 0; i < diff.grown.length; i++) grownNames.push(diff.grown[i].className);
    for (var k = 0; k < leakyClasses.length; k++) {
        T.ok(grownNames.indexOf(leakyClasses[k]) >= 0, 'diff detects growth of ' + leakyClasses[k]);
    }
}

// ═══════════════════════════════════════════════════════════════
// 5. 搜索泄漏实例
// ═══════════════════════════════════════════════════════════════
T.suite('findInstances');

var foundAddresses = {};
var searchTargets = ['WNRetainCycleA', 'WNRetainCycleB', 'WNTimerLeaker', 'WNBlockCaptureLeak', 'WNOrphanedObject'];

for (var t = 0; t < searchTargets.length; t++) {
    var target = searchTargets[t];
    var instances = null;
    T.safe(function () {
        instances = LeakDetector.findInstances(target, false, 50);
    }, 'findInstances(' + target + ') no crash');
    T.ok(instances && instances.length > 0, target + ' found ' + (instances ? instances.length : 0) + ' instances');
    if (instances && instances.length > 0) {
        T.ok(instances[0].address !== undefined, target + '[0] has address');
        T.ok(instances[0].size !== undefined, target + '[0] has size');
        foundAddresses[target] = instances[0].address;
    }
}

// findInstances 边界: 不存在的类
var noInstances = null;
T.safe(function () {
    noInstances = LeakDetector.findInstances('NonExistentClassName12345', false, 10);
}, 'findInstances nonexistent no crash');
T.ok(!noInstances || noInstances.length === 0, 'nonexistent class returns empty');

// ═══════════════════════════════════════════════════════════════
// 6. 循环引用检测
// ═══════════════════════════════════════════════════════════════
T.suite('detectCycles');

if (foundAddresses['WNRetainCycleA']) {
    var addr = foundAddresses['WNRetainCycleA'];
    var cycles = null;
    T.safe(function () {
        cycles = LeakDetector.detectCycles(addr, 10);
    }, 'detectCycles no crash');
    T.ok(cycles !== null && cycles !== undefined, 'detectCycles returns result');
    T.ok(cycles && cycles.length > 0, 'detected ' + (cycles ? cycles.length : 0) + ' cycle(s)');

    if (cycles && cycles.length > 0) {
        var chain = cycles[0];
        T.ok(chain.length >= 2, 'cycle chain has >= 2 nodes');
        T.ok(chain[0].className !== undefined, 'cycle node has className');
        T.ok(chain[0].address !== undefined, 'cycle node has address');
    }
} else {
    T.skip('detectCycles', 'no WNRetainCycleA address');
}

// ═══════════════════════════════════════════════════════════════
// 7. 强引用扫描
// ═══════════════════════════════════════════════════════════════
T.suite('getStrongReferences');

if (foundAddresses['WNRetainCycleA']) {
    var refsA = null;
    T.safe(function () {
        refsA = LeakDetector.getStrongReferences(foundAddresses['WNRetainCycleA']);
    }, 'getStrongReferences(WNRetainCycleA) no crash');
    T.ok(refsA !== null && refsA !== undefined, 'returns result');
    if (refsA && refsA.length > 0) {
        T.ok(refsA[0].name !== undefined, 'ref has name');
        T.ok(refsA[0].type !== undefined, 'ref has type');
        T.ok(refsA[0].className !== undefined, 'ref has className');
        T.ok(refsA[0].address !== undefined, 'ref has address');
    }
} else {
    T.skip('getStrongReferences(A)', 'no address');
}

if (foundAddresses['WNBlockCaptureLeak']) {
    var refsB = null;
    T.safe(function () {
        refsB = LeakDetector.getStrongReferences(foundAddresses['WNBlockCaptureLeak']);
    }, 'getStrongReferences(WNBlockCaptureLeak) no crash');
    T.ok(refsB !== null && refsB !== undefined, 'returns result');
} else {
    T.skip('getStrongReferences(Block)', 'no address');
}

} // end WNLeakExamples guard

// ═══════════════════════════════════════════════════════════════
// 8. 清理快照
// ═══════════════════════════════════════════════════════════════
T.suite('clearAllSnapshots');

T.safe(function () {
    LeakDetector.clearAllSnapshots();
}, 'clearAllSnapshots no crash');

// 清理后再拍快照验证不受影响
var cleanTag = null;
T.safe(function () {
    cleanTag = LeakDetector.takeSnapshot('clean_test');
}, 'takeSnapshot after clear no crash');
T.ok(cleanTag !== null, 'post-clear snapshot works: ' + cleanTag);

T.safe(function () {
    LeakDetector.clearAllSnapshots();
}, 'final clearAllSnapshots');

} // end LeakDetector guard

T.done();
