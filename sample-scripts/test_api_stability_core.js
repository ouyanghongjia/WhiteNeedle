/**
 * WhiteNeedle API Stability Test — Core APIs
 * 
 * 覆盖: 全局变量、Process、rpc.exports、console、timers、require、dispatch
 * 运行方式: 在 WhiteNeedleExample App 中选择此脚本运行
 * 输出: 结构化 PASS/FAIL + JSON 摘要 [RESULT_JSON]
 */
(function() {
    // ─── Inline Test Harness ─────────────────────────────────────
    var _r = [], _suite = 'api_stability_core', _async = 0;
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
        neq: function(a, b, n) { var p = a !== b; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'should not equal ' + JSON.stringify(b)); },
        type: function(v, t, n) { var p = typeof v === t; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'typeof=' + typeof v + ', want ' + t); },
        gt: function(a, b, n) { var p = a > b; _log(p ? 'PASS' : 'FAIL', n, p ? '' : a + ' not > ' + b); },
        throws: function(fn, n) { try { fn(); _log('FAIL', n, 'no throw'); } catch(e) { _log('PASS', n); } },
        safe: function(fn, n) { try { fn(); _log('PASS', n); } catch(e) { _log('FAIL', n, '' + (e.message || e)); } },
        skip: function(n, reason) { _log('SKIP', n, reason); },
        asyncStart: function() { _async++; },
        asyncEnd: function() { _async--; if (_async === 0) T.done(); },
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

    console.log('╔══════════════════════════════════════╗');
    console.log('║  API Stability Test — Core APIs      ║');
    console.log('╚══════════════════════════════════════╝');

    // ═══════════════════════════════════════════════════════════════
    // 1. Global Variables
    // ═══════════════════════════════════════════════════════════════
    T.suite('Global Variables');

    T.type(__wnVersion, 'string', '__wnVersion is string');
    T.ok(__wnVersion.length > 0, '__wnVersion is non-empty');
    T.ok(/^\d+\.\d+/.test(__wnVersion), '__wnVersion looks like semver: ' + __wnVersion);

    T.eq(__wnEngine, 'JavaScriptCore', '__wnEngine === "JavaScriptCore"');

    T.type(__wnLog, 'function', '__wnLog is function');
    T.safe(function() { __wnLog('stability test ping'); }, '__wnLog(string) no crash');
    T.safe(function() { __wnLog(''); }, '__wnLog(empty string) no crash');
    T.safe(function() { __wnLog('emoji 🎯 日本語 العربية'); }, '__wnLog(unicode) no crash');

    // ═══════════════════════════════════════════════════════════════
    // 2. Process
    // ═══════════════════════════════════════════════════════════════
    T.suite('Process');

    T.type(Process, 'object', 'Process exists');
    T.eq(Process.platform, 'ios', 'Process.platform === "ios"');
    T.ok(Process.arch === 'arm64' || Process.arch === 'x86_64', 'Process.arch valid: ' + Process.arch);

    // ═══════════════════════════════════════════════════════════════
    // 3. rpc.exports
    // ═══════════════════════════════════════════════════════════════
    T.suite('rpc.exports');

    T.type(rpc, 'object', 'rpc exists');
    T.type(rpc.exports, 'object', 'rpc.exports exists');

    // 3a. Simple function export
    rpc.exports.testAdd = function(a, b) { return a + b; };
    T.eq(rpc.exports.testAdd(2, 3), 5, 'rpc.exports function works');

    // 3b. Overwrite export
    rpc.exports.testAdd = function(a, b) { return a * b; };
    T.eq(rpc.exports.testAdd(2, 3), 6, 'rpc.exports overwrite works');

    // 3c. Export returning complex object
    rpc.exports.testObj = function() { return { a: 1, b: [2, 3], c: 'hello' }; };
    var obj = rpc.exports.testObj();
    T.ok(obj && obj.a === 1 && obj.b.length === 2, 'rpc.exports returns complex object');

    // 3d. Export with no args
    rpc.exports.testNoArgs = function() { return 42; };
    T.eq(rpc.exports.testNoArgs(), 42, 'rpc.exports no-arg function');

    // 3e. Export returning null/undefined
    rpc.exports.testNull = function() { return null; };
    T.eq(rpc.exports.testNull(), null, 'rpc.exports returns null');

    rpc.exports.testUndef = function() {};
    T.eq(rpc.exports.testUndef(), undefined, 'rpc.exports returns undefined');

    // 3f. Export that throws
    rpc.exports.testThrow = function() { throw new Error('intentional'); };
    T.throws(function() { rpc.exports.testThrow(); }, 'rpc.exports throw propagates');

    // 3g. Cleanup
    delete rpc.exports.testAdd;
    delete rpc.exports.testObj;
    delete rpc.exports.testNoArgs;
    delete rpc.exports.testNull;
    delete rpc.exports.testUndef;
    delete rpc.exports.testThrow;

    // ═══════════════════════════════════════════════════════════════
    // 4. console methods
    // ═══════════════════════════════════════════════════════════════
    T.suite('console');

    T.type(console.log, 'function', 'console.log exists');
    T.type(console.warn, 'function', 'console.warn exists');
    T.type(console.error, 'function', 'console.error exists');
    T.type(console.info, 'function', 'console.info exists');

    // Various argument types
    T.safe(function() { console.log('string'); }, 'console.log(string)');
    T.safe(function() { console.log(123); }, 'console.log(number)');
    T.safe(function() { console.log(true); }, 'console.log(boolean)');
    T.safe(function() { console.log(null); }, 'console.log(null)');
    T.safe(function() { console.log(undefined); }, 'console.log(undefined)');
    T.safe(function() { console.log({ a: 1 }); }, 'console.log(object)');
    T.safe(function() { console.log([1, 2, 3]); }, 'console.log(array)');
    T.safe(function() { console.log('a', 'b', 'c'); }, 'console.log(multiple args)');
    T.safe(function() { console.log(); }, 'console.log(no args)');

    // Edge cases
    T.safe(function() { console.log('🎯🚀🔥'); }, 'console.log(emoji)');
    T.safe(function() { console.log('line1\nline2\ttab'); }, 'console.log(newline+tab)');
    T.safe(function() {
        var big = '';
        for (var i = 0; i < 10000; i++) big += 'x';
        console.log(big);
    }, 'console.log(10KB string)');

    // Circular reference
    T.safe(function() {
        var circ = { a: 1 };
        circ.self = circ;
        console.log(circ);
    }, 'console.log(circular object) no crash');

    // ═══════════════════════════════════════════════════════════════
    // 5. require
    // ═══════════════════════════════════════════════════════════════
    T.suite('require');

    T.type(require, 'function', 'require is function');

    // Built-in modules
    T.safe(function() {
        var events = require('events');
        T.ok(events !== null && events !== undefined, 'require("events") returns module');
        T.type(events.EventEmitter, 'function', 'events.EventEmitter is constructor');
    }, 'require("events") no crash');

    T.safe(function() {
        var util = require('util');
        if (util) {
            T.type(util.format, 'function', 'util.format is function');
            T.type(util.inspect, 'function', 'util.inspect is function');
            var formatted = util.format('hello %s #%d', 'world', 42);
            T.type(formatted, 'string', 'util.format returns string');
        } else {
            T.skip('util.format', 'util module not available');
            T.skip('util.inspect', 'util module not available');
        }
    }, 'require("util") no crash');

    // Same module returns same reference (cache)
    T.safe(function() {
        var e1 = require('events');
        var e2 = require('events');
        T.ok(e1 === e2, 'require cache: same reference');
    }, 'require cache test no crash');

    // Non-existent module
    T.safe(function() {
        var bad = null;
        try {
            bad = require('__nonexistent_module_xyz__');
        } catch(e) {
            T.ok(true, 'require(nonexistent) throws: ' + e.message);
            return;
        }
        if (bad === null || bad === undefined) {
            T.ok(true, 'require(nonexistent) returns null/undefined');
        } else {
            _log('FAIL', 'require(nonexistent)', 'expected throw or null, got: ' + typeof bad);
        }
    }, 'require(nonexistent) handled');

    // ═══════════════════════════════════════════════════════════════
    // 6. dispatch
    // ═══════════════════════════════════════════════════════════════
    T.suite('dispatch');

    if (typeof dispatch !== 'undefined') {
        T.type(dispatch.main, 'function', 'dispatch.main exists');
        T.type(dispatch.mainAsync, 'function', 'dispatch.mainAsync exists');
        T.type(dispatch.after, 'function', 'dispatch.after exists');
        T.type(dispatch.isMainThread, 'function', 'dispatch.isMainThread exists');

        // dispatch.isMainThread
        T.safe(function() {
            var imt = dispatch.isMainThread();
            T.type(imt, 'boolean', 'dispatch.isMainThread returns boolean');
        }, 'dispatch.isMainThread() no crash');

        // dispatch.main — synchronous, returns value
        T.safe(function() {
            var result = dispatch.main(function() { return 42; });
            T.eq(result, 42, 'dispatch.main returns value');
        }, 'dispatch.main(fn) no crash');

        // dispatch.main — exception propagation
        T.safe(function() {
            try {
                dispatch.main(function() { throw new Error('dispatch_test'); });
                _log('FAIL', 'dispatch.main throw', 'no error propagated');
            } catch(e) {
                T.ok(e.message.indexOf('dispatch_test') >= 0, 'dispatch.main propagates error');
            }
        }, 'dispatch.main error handling');

        // dispatch.mainAsync — should not throw, fire-and-forget
        T.safe(function() {
            dispatch.mainAsync(function() { /* no-op */ });
        }, 'dispatch.mainAsync(fn) no crash');

        // dispatch.after — async, deferred
        T.safe(function() {
            dispatch.after(1, function() { /* no-op */ });
        }, 'dispatch.after(1, fn) no crash');

        // Boundary: dispatch.after with 0 delay
        T.safe(function() {
            dispatch.after(0, function() { /* no-op */ });
        }, 'dispatch.after(0, fn) no crash');
    } else {
        T.skip('dispatch.*', 'dispatch namespace not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 7. Timers (async — results printed separately)
    // ═══════════════════════════════════════════════════════════════
    T.suite('Timers');

    T.type(setTimeout, 'function', 'setTimeout exists');
    T.type(setInterval, 'function', 'setInterval exists');
    T.type(clearTimeout, 'function', 'clearTimeout exists');
    T.type(clearInterval, 'function', 'clearInterval exists');

    // setTimeout returns a numeric id
    T.safe(function() {
        var id = setTimeout(function() {}, 99999);
        T.type(id, 'number', 'setTimeout returns number');
        clearTimeout(id);
    }, 'setTimeout returns id');

    // setInterval returns a numeric id
    T.safe(function() {
        var id = setInterval(function() {}, 99999);
        T.type(id, 'number', 'setInterval returns number');
        clearInterval(id);
    }, 'setInterval returns id');

    // clearTimeout with invalid id — should not crash
    T.safe(function() { clearTimeout(99999); }, 'clearTimeout(invalid) no crash');
    T.safe(function() { clearTimeout(-1); }, 'clearTimeout(-1) no crash');
    T.safe(function() { clearTimeout(0); }, 'clearTimeout(0) no crash');
    T.safe(function() { clearInterval(99999); }, 'clearInterval(invalid) no crash');

    // Async timer tests
    T.asyncStart();
    var timerTestsPassed = 0;
    var timerTestsFailed = 0;

    // Test 1: setTimeout fires
    var t1Fired = false;
    setTimeout(function() { t1Fired = true; }, 50);

    // Test 2: clearTimeout prevents firing
    var t2Fired = false;
    var t2Id = setTimeout(function() { t2Fired = true; }, 50);
    clearTimeout(t2Id);

    // Test 3: setInterval fires multiple times
    var t3Count = 0;
    var t3Id = setInterval(function() {
        t3Count++;
        if (t3Count >= 3) clearInterval(t3Id);
    }, 50);

    // Test 4: setTimeout with 0ms delay
    var t4Fired = false;
    setTimeout(function() { t4Fired = true; }, 0);

    // Check async results after delay
    setTimeout(function() {
        T.ok(t1Fired, 'setTimeout(50ms) fires');
        T.ok(!t2Fired, 'clearTimeout prevents firing');
        T.ok(t3Count >= 3, 'setInterval fires ≥3 times: ' + t3Count);
        T.ok(t4Fired, 'setTimeout(0ms) fires');

        // Nested setTimeout
        var nestedFired = false;
        setTimeout(function() {
            nestedFired = true;
            setTimeout(function() {
                T.ok(nestedFired, 'nested setTimeout works');
                T.asyncEnd();
            }, 50);
        }, 50);
    }, 500);

})();
