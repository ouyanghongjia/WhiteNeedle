/**
 * WhiteNeedle API Stability Test — Runtime APIs
 *
 * 覆盖: Interceptor (attach/detach/replace/list/rebindSymbol/hookCFunction),
 *       $pointer (alloc/read/write/free), $struct, $block/$callBlock/$blockSig,
 *       Module (findExportByName/enumerateModules/enumerateExports)
 */
(function() {
    var _r = [], _suite = 'api_stability_runtime';
    function _log(s, n, d) {
        _r.push({ s: s, n: n, d: d || '' });
        var p = s === 'PASS' ? '  ✓' : s === 'FAIL' ? '  ✗' : '  ⊘';
        var m = p + ' ' + n + (d ? ' — ' + d : '');
        if (s === 'FAIL') console.error(m); else if (s === 'SKIP') console.warn(m); else console.log(m);
    }
    var T = {
        suite: function(n) { console.log('\n▸ ' + n); },
        ok: function(c, n) { _log(c ? 'PASS' : 'FAIL', n, c ? '' : 'assertion false'); },
        eq: function(a, b, n) { var p = a === b; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); },
        neq: function(a, b, n) { var p = a !== b; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'should not equal ' + JSON.stringify(b)); },
        type: function(v, t, n) { var p = typeof v === t; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'typeof=' + typeof v + ', want ' + t); },
        gt: function(a, b, n) { var p = a > b; _log(p ? 'PASS' : 'FAIL', n, p ? '' : a + ' not > ' + b); },
        approx: function(a, b, eps, n) { var p = Math.abs(a - b) < eps; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'got ' + a + ', want ~' + b); },
        throws: function(fn, n) { try { fn(); _log('FAIL', n, 'no throw'); } catch(e) { _log('PASS', n); } },
        safe: function(fn, n) { try { fn(); _log('PASS', n); } catch(e) { _log('FAIL', n, '' + (e.message || e)); } },
        skip: function(n, reason) { _log('SKIP', n, reason); },
        done: function() {
            var p = 0, f = 0, s = 0, fails = [];
            for (var i = 0; i < _r.length; i++) {
                if (_r[i].s === 'PASS') p++; else if (_r[i].s === 'FAIL') { f++; fails.push(_r[i].n + ': ' + _r[i].d); } else s++;
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
    console.log('║  API Stability Test — Runtime APIs   ║');
    console.log('╚══════════════════════════════════════╝');

    // ═══════════════════════════════════════════════════════════════
    // 1. Interceptor — basic
    // ═══════════════════════════════════════════════════════════════
    T.suite('Interceptor basic');

    if (typeof Interceptor !== 'undefined') {
        T.type(Interceptor.attach, 'function', 'Interceptor.attach exists');
        T.type(Interceptor.detach, 'function', 'Interceptor.detach exists');
        T.type(Interceptor.detachAll, 'function', 'Interceptor.detachAll exists');
        T.type(Interceptor.list, 'function', 'Interceptor.list exists');
        T.type(Interceptor.replace, 'function', 'Interceptor.replace exists');
        T.type(Interceptor.rebindSymbol, 'function', 'Interceptor.rebindSymbol exists');
        T.type(Interceptor.hookCFunction, 'function', 'Interceptor.hookCFunction exists');

        // list() initially
        T.safe(function() {
            var hooks = Interceptor.list();
            T.ok(Array.isArray(hooks), 'Interceptor.list() returns array');
        }, 'Interceptor.list() no crash');

        // attach + onEnter
        var enterCalled = false;
        var leaveCalled = false;
        T.safe(function() {
            Interceptor.attach('-[NSObject description]', {
                onEnter: function(self, sel, args) { enterCalled = true; },
                onLeave: function(retval) { leaveCalled = true; }
            });
            T.ok(true, 'Interceptor.attach() succeeds');

            var hooks = Interceptor.list();
            T.ok(hooks.length > 0, 'list() shows hook after attach');
        }, 'Interceptor.attach no crash');

        // Trigger the hook
        T.safe(function() {
            var NSObject = ObjC.use('NSObject');
            if (NSObject) {
                var obj = NSObject.invoke('new');
                if (obj && obj.invoke) {
                    obj.invoke('description');
                    T.ok(enterCalled, 'onEnter callback was called');
                    T.ok(leaveCalled, 'onLeave callback was called');
                }
            }
        }, 'trigger hook no crash');

        // detach
        T.safe(function() {
            Interceptor.detach('-[NSObject description]');
            T.ok(true, 'Interceptor.detach() succeeds');
        }, 'Interceptor.detach no crash');

        // detach nonexistent — should not crash
        T.safe(function() {
            Interceptor.detach('-[NSObject __fakeMethodXYZ__]');
        }, 'detach(nonexistent) no crash');

        // detachAll
        T.safe(function() {
            Interceptor.attach('-[NSObject class]', { onEnter: function() {} });
            Interceptor.detachAll();
            var hooks = Interceptor.list();
            T.eq(hooks.length, 0, 'detachAll clears all hooks');
        }, 'Interceptor.detachAll no crash');

        // Boundary: attach invalid selector
        T.safe(function() {
            try {
                Interceptor.attach('-[__FakeClass__ __fakeMethod__]', { onEnter: function() {} });
                T.ok(true, 'attach(invalid selector) did not crash');
            } catch(e) {
                T.ok(true, 'attach(invalid selector) throws: ' + ('' + e).substring(0, 60));
            }
        }, 'attach(invalid) handled');

        // Interceptor.replace
        T.suite('Interceptor.replace');
        T.safe(function() {
            var originalCalled = false;
            Interceptor.replace('-[NSObject hash]', function(self, args, original) {
                originalCalled = true;
                var origResult = original();
                return origResult;
            });

            var NSObject = ObjC.use('NSObject');
            if (NSObject) {
                var obj = NSObject.invoke('new');
                if (obj && obj.invoke) {
                    obj.invoke('hash');
                    T.ok(originalCalled, 'replace callback was called');
                }
            }
            Interceptor.detach('-[NSObject hash]');
        }, 'Interceptor.replace no crash');

        // Interceptor.rebindSymbol
        T.suite('Interceptor.rebindSymbol');
        T.safe(function() {
            var addr = Interceptor.rebindSymbol('NSLog');
            if (addr !== undefined) {
                T.type(addr, 'number', 'rebindSymbol("NSLog") returns number');
                T.gt(addr, 0, 'rebindSymbol("NSLog") > 0');
            } else {
                T.skip('rebindSymbol("NSLog")', 'returned undefined');
            }
        }, 'rebindSymbol no crash');

        // Boundary: rebindSymbol nonexistent
        T.safe(function() {
            var addr = Interceptor.rebindSymbol('__totally_fake_symbol_xyz__');
            T.ok(addr === undefined || addr === null || addr === 0, 'rebindSymbol(fake) returns null/undef/0');
        }, 'rebindSymbol(fake) no crash');

        // Cleanup
        Interceptor.detachAll();
    } else {
        T.skip('Interceptor.*', 'Interceptor not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. $pointer — memory operations
    // ═══════════════════════════════════════════════════════════════
    T.suite('$pointer basic');

    if (typeof $pointer !== 'undefined') {
        T.type($pointer.alloc, 'function', '$pointer.alloc exists');
        T.type($pointer.read, 'function', '$pointer.read exists');
        T.type($pointer.write, 'function', '$pointer.write exists');
        T.type($pointer.free, 'function', '$pointer.free exists');

        // alloc + read/write int32
        T.safe(function() {
            var mem = $pointer.alloc(64);
            T.ok(mem !== null && mem !== undefined, 'alloc(64) returns result');
            T.type(mem.address, 'number', 'alloc result has address');
            T.gt(mem.address, 0, 'alloc address > 0');
            T.eq(mem.size, 64, 'alloc size === 64');

            $pointer.write(mem.address, 'int32', 42);
            var val = $pointer.read(mem.address, 'int32');
            T.eq(val, 42, 'int32 write/read roundtrip');

            $pointer.free(mem.address);
        }, '$pointer int32 roundtrip no crash');

        // All integer types
        var intTypes = [
            { type: 'int8', val: -42, size: 1 },
            { type: 'uint8', val: 200, size: 1 },
            { type: 'int16', val: -1000, size: 2 },
            { type: 'uint16', val: 60000, size: 2 },
            { type: 'int32', val: -100000, size: 4 },
            { type: 'uint32', val: 3000000000, size: 4 },
        ];
        for (var i = 0; i < intTypes.length; i++) {
            (function(spec) {
                T.safe(function() {
                    var mem = $pointer.alloc(8);
                    $pointer.write(mem.address, spec.type, spec.val);
                    var rd = $pointer.read(mem.address, spec.type);
                    T.eq(rd, spec.val, spec.type + ' roundtrip: ' + spec.val);
                    $pointer.free(mem.address);
                }, spec.type + ' no crash');
            })(intTypes[i]);
        }

        // float + double (approximate)
        T.safe(function() {
            var mem = $pointer.alloc(16);
            $pointer.write(mem.address, 'float', 3.14);
            var fv = $pointer.read(mem.address, 'float');
            T.approx(fv, 3.14, 0.01, 'float roundtrip ~3.14');

            $pointer.write(mem.address, 'double', 2.718281828);
            var dv = $pointer.read(mem.address, 'double');
            T.approx(dv, 2.718281828, 0.0001, 'double roundtrip ~2.718');

            $pointer.free(mem.address);
        }, 'float/double no crash');

        // bool
        T.safe(function() {
            var mem = $pointer.alloc(4);
            $pointer.write(mem.address, 'bool', true);
            var bv = $pointer.read(mem.address, 'bool');
            T.ok(bv === true || bv === 1, 'bool roundtrip true');

            $pointer.write(mem.address, 'bool', false);
            bv = $pointer.read(mem.address, 'bool');
            T.ok(bv === false || bv === 0, 'bool roundtrip false');

            $pointer.free(mem.address);
        }, 'bool no crash');

        // utf8
        T.safe(function() {
            var mem = $pointer.alloc(256);
            $pointer.write(mem.address, 'utf8', 'hello world');
            var sv = $pointer.read(mem.address, 'utf8');
            T.eq(sv, 'hello world', 'utf8 roundtrip');
            $pointer.free(mem.address);
        }, 'utf8 no crash');

        // Read with count
        T.safe(function() {
            var mem = $pointer.alloc(32);
            for (var j = 0; j < 4; j++) {
                $pointer.write(mem.address + j * 4, 'int32', (j + 1) * 10);
            }
            var vals = $pointer.read(mem.address, 'int32', 4);
            T.ok(Array.isArray(vals), 'read with count returns array');
            if (Array.isArray(vals)) {
                T.eq(vals[0], 10, 'read count[0] === 10');
                T.eq(vals[3], 40, 'read count[3] === 40');
            }
            $pointer.free(mem.address);
        }, 'read with count no crash');

        // Boundary: alloc(0)
        T.safe(function() {
            var mem = $pointer.alloc(0);
            T.ok(mem !== null, 'alloc(0) does not crash');
            if (mem && mem.address) $pointer.free(mem.address);
        }, 'alloc(0) no crash');

        // Boundary: very large alloc
        T.safe(function() {
            var mem = $pointer.alloc(1024 * 1024); // 1MB
            T.ok(mem !== null && mem.address > 0, 'alloc(1MB) succeeds');
            $pointer.free(mem.address);
        }, 'alloc(1MB) no crash');

        // int64 / uint64
        T.safe(function() {
            var mem = $pointer.alloc(16);
            $pointer.write(mem.address, 'int64', 9007199254740991); // Number.MAX_SAFE_INTEGER
            var v = $pointer.read(mem.address, 'int64');
            T.ok(typeof v === 'number', 'int64 read returns number');
            $pointer.free(mem.address);
        }, 'int64 no crash');
    } else {
        T.skip('$pointer.*', '$pointer not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. $struct
    // ═══════════════════════════════════════════════════════════════
    T.suite('$struct');

    if (typeof $struct !== 'undefined') {
        // CGPoint-like
        T.safe(function() {
            var Point = $struct('TestPoint', [
                { name: 'x', type: 'double' },
                { name: 'y', type: 'double' }
            ]);
            T.ok(Point !== null, '$struct("TestPoint") defined');
            T.eq(Point.size, 16, 'Point size === 16 (2×double)');
            T.ok(Array.isArray(Point.fields), 'Point.fields is array');
            T.eq(Point.fields.length, 2, 'Point has 2 fields');

            var p = Point({ x: 10.5, y: 20.5 });
            T.ok(p !== null, 'Point instance created');
            T.approx(p.x, 10.5, 0.01, 'p.x === 10.5');
            T.approx(p.y, 20.5, 0.01, 'p.y === 20.5');
            T.eq(p._structName, 'TestPoint', 'p._structName');
            T.eq(p._size, 16, 'p._size === 16');
        }, 'Point struct no crash');

        // CGRect-like
        T.safe(function() {
            var Rect = $struct('TestRect', [
                { name: 'x', type: 'double' },
                { name: 'y', type: 'double' },
                { name: 'width', type: 'double' },
                { name: 'height', type: 'double' }
            ]);
            T.eq(Rect.size, 32, 'Rect size === 32 (4×double)');

            var r = Rect({ x: 0, y: 0, width: 100, height: 200 });
            T.approx(r.width, 100, 0.01, 'r.width === 100');
            T.approx(r.height, 200, 0.01, 'r.height === 200');
        }, 'Rect struct no crash');

        // update()
        T.safe(function() {
            var Point = $struct('TestPointUpdate', [
                { name: 'x', type: 'double' },
                { name: 'y', type: 'double' }
            ]);
            var p = Point({ x: 1, y: 2 });
            p.update({ x: 100 });
            T.approx(p.x, 100, 0.01, 'update changes x to 100');
            T.approx(p.y, 2, 0.01, 'update preserves y');
        }, 'struct update() no crash');

        // toPointer()
        T.safe(function() {
            var S = $struct('TestToPtr', [{ name: 'val', type: 'int32' }]);
            var s = S({ val: 42 });
            var ptr = s.toPointer();
            T.ok(ptr !== null && ptr !== undefined, 'toPointer() returns value');
        }, 'struct toPointer() no crash');

        // Mixed types
        T.safe(function() {
            var Mixed = $struct('TestMixed', [
                { name: 'flag', type: 'uint8' },
                { name: 'count', type: 'int32' },
                { name: 'value', type: 'double' }
            ]);
            T.gt(Mixed.size, 0, 'Mixed struct has positive size: ' + Mixed.size);

            var m = Mixed({ flag: 1, count: 100, value: 3.14 });
            T.eq(m.flag, 1, 'mixed.flag');
            T.eq(m.count, 100, 'mixed.count');
            T.approx(m.value, 3.14, 0.01, 'mixed.value');
        }, 'mixed type struct no crash');

        // Boundary: negative int
        T.safe(function() {
            var S = $struct('TestNeg', [{ name: 'val', type: 'int32' }]);
            var s = S({ val: -999 });
            T.eq(s.val, -999, 'struct negative int32 === -999');
        }, 'negative int struct no crash');

        // Boundary: default (zero) init
        T.safe(function() {
            var S = $struct('TestDefault', [
                { name: 'a', type: 'int32' },
                { name: 'b', type: 'double' }
            ]);
            var s = S();
            T.eq(s.a, 0, 'default int32 === 0');
            T.approx(s.b, 0, 0.01, 'default double === 0');
        }, 'default struct no crash');
    } else {
        T.skip('$struct.*', '$struct not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. $blockSig / $block / $callBlock
    // ═══════════════════════════════════════════════════════════════
    T.suite('Block bridge');

    if (typeof $blockSig !== 'undefined') {
        // $blockSig
        T.safe(function() {
            var sig1 = $blockSig('void (^)()');
            T.type(sig1, 'string', '$blockSig("void (^)()") returns string');
            T.ok(sig1 && sig1.length > 0, '$blockSig result non-empty: ' + sig1);
        }, '$blockSig void no crash');

        T.safe(function() {
            var sig2 = $blockSig('void (^)(id)');
            T.type(sig2, 'string', '$blockSig("void (^)(id)")');
        }, '$blockSig void(id) no crash');

        T.safe(function() {
            var sig3 = $blockSig('id (^)(id, double)');
            T.type(sig3, 'string', '$blockSig("id (^)(id, double)")');
        }, '$blockSig id(id,double) no crash');

        T.safe(function() {
            var sig4 = $blockSig('BOOL (^)(id)');
            T.type(sig4, 'string', '$blockSig("BOOL (^)(id)")');
        }, '$blockSig BOOL(id) no crash');

        // Boundary: invalid sig
        T.safe(function() {
            var bad = $blockSig('garbage input');
            T.ok(bad === null || bad === undefined || bad === '', '$blockSig(garbage) returns null/empty');
        }, '$blockSig(garbage) no crash');

        // $block + $callBlock
        if (typeof $block !== 'undefined' && typeof $callBlock !== 'undefined') {
            T.safe(function() {
                var called = false;
                var blk = $block(function() { called = true; }, 'void (^)()');
                T.ok(blk !== null, '$block creates block');

                $callBlock(blk, 'void (^)()');
                T.ok(called, '$callBlock invokes block');
            }, '$block/$callBlock void no crash');

            // Block with args
            T.safe(function() {
                var receivedArg = null;
                var blk = $block(function(arg) { receivedArg = arg; }, 'void (^)(id)');
                $callBlock(blk, 'void (^)(id)', 'hello');
                T.ok(receivedArg !== null, '$callBlock passes arg');
            }, '$block with arg no crash');

            // Block with return value
            T.safe(function() {
                var blk = $block(function() { return 42; }, 'int (^)()');
                var result = $callBlock(blk, 'int (^)()');
                T.ok(result !== undefined, '$callBlock returns value: ' + result);
            }, '$block with return no crash');
        } else {
            T.skip('$block/$callBlock', 'not available');
        }
    } else {
        T.skip('$blockSig/$block/$callBlock', 'not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 5. Module
    // ═══════════════════════════════════════════════════════════════
    T.suite('Module');

    if (typeof Module !== 'undefined') {
        T.type(Module.findExportByName, 'function', 'Module.findExportByName exists');
        T.type(Module.enumerateModules, 'function', 'Module.enumerateModules exists');
        T.type(Module.enumerateExports, 'function', 'Module.enumerateExports exists');

        // enumerateModules
        T.safe(function() {
            var mods = Module.enumerateModules();
            T.ok(Array.isArray(mods), 'enumerateModules() returns array');
            T.gt(mods.length, 10, 'enumerateModules() found >10 modules: ' + mods.length);

            if (mods.length > 0) {
                var m = mods[0];
                T.type(m.name, 'string', 'module[0].name is string');
                T.type(m.base, 'string', 'module[0].base is string');
                T.type(m.slide, 'number', 'module[0].slide is number');
            }
        }, 'enumerateModules no crash');

        // findExportByName — common symbols
        T.safe(function() {
            var addr = Module.findExportByName(null, 'strlen');
            T.ok(addr !== undefined && addr !== null, 'findExportByName(null, "strlen") found: ' + addr);
            T.type(addr, 'number', 'strlen address is number');
        }, 'findExportByName(strlen) no crash');

        T.safe(function() {
            var addr = Module.findExportByName(null, 'malloc');
            T.ok(addr !== undefined && addr !== null, 'findExportByName(null, "malloc") found');
        }, 'findExportByName(malloc) no crash');

        T.safe(function() {
            var addr = Module.findExportByName(null, 'objc_getClass');
            T.ok(addr !== undefined && addr !== null, 'findExportByName(null, "objc_getClass") found');
        }, 'findExportByName(objc_getClass) no crash');

        // Boundary: nonexistent symbol
        T.safe(function() {
            var addr = Module.findExportByName(null, '__totally_fake_symbol_xyz__');
            T.ok(addr === undefined || addr === null, 'findExportByName(fake) returns null/undef');
        }, 'findExportByName(fake) no crash');

        // enumerateExports
        T.safe(function() {
            var exports = Module.enumerateExports('Foundation');
            T.ok(Array.isArray(exports), 'enumerateExports("Foundation") returns array');
            // Note: may be empty on some systems
        }, 'enumerateExports("Foundation") no crash');

        // Boundary: nonexistent module
        T.safe(function() {
            var exports = Module.enumerateExports('__FakeModule__');
            T.ok(Array.isArray(exports) || exports === null, 'enumerateExports(fake) handled');
        }, 'enumerateExports(fake) no crash');

        // Module.searchPaths
        T.safe(function() {
            T.ok(Array.isArray(Module.searchPaths), 'Module.searchPaths is array');
        }, 'Module.searchPaths no crash');

        // Module.clearCache + listCached
        T.safe(function() {
            Module.clearCache();
            var cached = Module.listCached();
            T.ok(Array.isArray(cached), 'Module.listCached() returns array');
        }, 'Module.clearCache/listCached no crash');
    } else {
        T.skip('Module.*', 'Module not available');
    }

    T.done();
})();
