/**
 * WhiteNeedle API Stability Test — ObjC Bridge
 *
 * 覆盖: ObjC.available/classes/use/instance/define/delegate/getClassNames/
 *       enumerateLoadedClasses/choose, ObjCProxy 全部方法
 * 运行方式: 在 WhiteNeedleExample App 中选择此脚本运行
 */
(function() {
    var _r = [], _suite = 'api_stability_objc';
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
    console.log('║  API Stability Test — ObjC Bridge    ║');
    console.log('╚══════════════════════════════════════╝');

    // ═══════════════════════════════════════════════════════════════
    // 1. ObjC.available
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjC.available');
    T.eq(ObjC.available, true, 'ObjC.available === true');

    // ═══════════════════════════════════════════════════════════════
    // 2. ObjC.classes
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjC.classes');
    T.type(ObjC.classes, 'object', 'ObjC.classes is object');
    T.ok(ObjC.classes['NSObject'] !== undefined, 'ObjC.classes contains NSObject');
    T.ok(ObjC.classes['NSString'] !== undefined, 'ObjC.classes contains NSString');
    T.ok(ObjC.classes['UIView'] !== undefined, 'ObjC.classes contains UIView');

    // ═══════════════════════════════════════════════════════════════
    // 3. ObjC.use — normal cases
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjC.use');

    var NSString = ObjC.use('NSString');
    T.ok(NSString !== null, 'ObjC.use("NSString") returns non-null');

    var NSObject = ObjC.use('NSObject');
    T.ok(NSObject !== null, 'ObjC.use("NSObject") returns non-null');

    var UIView = ObjC.use('UIView');
    T.ok(UIView !== null, 'ObjC.use("UIView") returns non-null');

    // Boundary: non-existent class
    var bad = ObjC.use('__NonExistentClass_XYZ__');
    T.eq(bad, null, 'ObjC.use(nonexistent) returns null');

    // Boundary: empty string
    T.safe(function() {
        var empty = ObjC.use('');
        T.ok(empty === null || empty === undefined, 'ObjC.use("") returns null/undefined');
    }, 'ObjC.use("") no crash');

    // ═══════════════════════════════════════════════════════════════
    // 4. ObjCProxy — className, superclass, respondsToSelector, getMethods
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjCProxy metadata');

    if (NSString) {
        T.safe(function() {
            var cn = NSString.className();
            T.eq(cn, 'NSString', 'NSString.className() === "NSString"');
        }, 'className() no crash');

        T.safe(function() {
            var sc = NSString.superclass();
            T.type(sc, 'string', 'NSString.superclass() returns string');
        }, 'superclass() no crash');

        T.safe(function() {
            var r1 = NSString.respondsToSelector('length');
            T.type(r1, 'boolean', 'respondsToSelector returns boolean');
        }, 'respondsToSelector() no crash');

        T.safe(function() {
            var r = NSString.respondsToSelector('__totallyFakeSelector_xyz__');
            T.eq(r, false, 'respondsToSelector(fake) === false');
        }, 'respondsToSelector(fake) no crash');

        T.safe(function() {
            var methods = NSString.getMethods();
            T.ok(Array.isArray(methods), 'getMethods() returns array');
            T.gt(methods.length, 0, 'getMethods() returns non-empty: ' + methods.length);
        }, 'getMethods() no crash');
    }

    // ═══════════════════════════════════════════════════════════════
    // 5. ObjCProxy.invoke — NSString operations
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjCProxy.invoke — NSString');

    if (NSString) {
        // Class method: +[NSString stringWithString:]
        T.safe(function() {
            var str = NSString.invoke('stringWithString:', ['Hello']);
            T.ok(str !== null && str !== undefined, 'stringWithString: returns value');
        }, 'invoke stringWithString: no crash');

        // +[NSString stringWithFormat:] — single arg
        T.safe(function() {
            var str = NSString.invoke('stringWithFormat:', ['test %d', 42]);
            // stringWithFormat uses first arg as format + rest as args but this depends on implementation
        }, 'invoke stringWithFormat: no crash');

        // Instance method: create and call length
        T.safe(function() {
            var str = NSString.invoke('stringWithString:', ['Hello']);
            if (str && str.invoke) {
                var len = str.invoke('length');
                T.eq(len, 5, 'NSString length === 5');
            } else {
                T.skip('NSString.length', 'stringWithString: did not return proxy');
            }
        }, 'invoke length no crash');

        // UTF8 string
        T.safe(function() {
            var str = NSString.invoke('stringWithString:', ['日本語テスト']);
            if (str && str.invoke) {
                var len = str.invoke('length');
                T.eq(len, 6, 'UTF8 string length === 6');
            }
        }, 'invoke with UTF8 string no crash');

        // Empty string
        T.safe(function() {
            var str = NSString.invoke('stringWithString:', ['']);
            if (str && str.invoke) {
                var len = str.invoke('length');
                T.eq(len, 0, 'empty string length === 0');
            }
        }, 'invoke with empty string no crash');
    }

    // ═══════════════════════════════════════════════════════════════
    // 6. ObjCProxy.invoke — NSMutableArray
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjCProxy.invoke — NSMutableArray');

    var NSMutableArray = ObjC.use('NSMutableArray');
    if (NSMutableArray) {
        T.safe(function() {
            var arr = NSMutableArray.invoke('array');
            T.ok(arr !== null, 'NSMutableArray.array returns value');

            if (arr && arr.invoke) {
                var count0 = arr.invoke('count');
                T.eq(count0, 0, 'empty array count === 0');

                arr.invoke('addObject:', ['hello']);
                arr.invoke('addObject:', ['world']);
                var count2 = arr.invoke('count');
                T.eq(count2, 2, 'array count after 2 adds === 2');

                var first = arr.invoke('objectAtIndex:', [0]);
                T.ok(first !== null, 'objectAtIndex:0 returns value');

                arr.invoke('removeObjectAtIndex:', [0]);
                var count1 = arr.invoke('count');
                T.eq(count1, 1, 'array count after remove === 1');

                arr.invoke('removeAllObjects');
                var count00 = arr.invoke('count');
                T.eq(count00, 0, 'array count after removeAll === 0');
            }
        }, 'NSMutableArray operations no crash');

        // Boundary: objectAtIndex out of bounds
        T.safe(function() {
            var arr = NSMutableArray.invoke('array');
            if (arr && arr.invoke) {
                try {
                    arr.invoke('objectAtIndex:', [999]);
                    _log('FAIL', 'objectAtIndex OOB', 'expected error');
                } catch(e) {
                    T.ok(true, 'objectAtIndex OOB throws: ' + ('' + e).substring(0, 60));
                }
            }
        }, 'objectAtIndex OOB test');
    } else {
        T.skip('NSMutableArray tests', 'NSMutableArray not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 7. ObjCProxy.invoke — NSMutableDictionary
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjCProxy.invoke — NSMutableDictionary');

    var NSMutableDictionary = ObjC.use('NSMutableDictionary');
    if (NSMutableDictionary) {
        T.safe(function() {
            var dict = NSMutableDictionary.invoke('dictionary');
            T.ok(dict !== null, 'NSMutableDictionary.dictionary returns value');

            if (dict && dict.invoke) {
                dict.invoke('setObject:forKey:', ['value1', 'key1']);
                dict.invoke('setObject:forKey:', [42, 'key2']);

                var count = dict.invoke('count');
                T.eq(count, 2, 'dict count === 2');

                var val = dict.invoke('objectForKey:', ['key1']);
                T.ok(val !== null, 'objectForKey returns value');

                dict.invoke('removeObjectForKey:', ['key1']);
                var countAfter = dict.invoke('count');
                T.eq(countAfter, 1, 'dict count after remove === 1');

                // Boundary: objectForKey for missing key
                var missing = dict.invoke('objectForKey:', ['__missing__']);
                T.ok(missing === null || missing === undefined, 'objectForKey(missing) returns null/undef');
            }
        }, 'NSMutableDictionary operations no crash');
    } else {
        T.skip('NSMutableDictionary tests', 'not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 8. ObjCProxy.getProperty / setProperty (KVC)
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjCProxy KVC');

    T.safe(function() {
        var app = ObjC.use('UIApplication');
        if (app) {
            var shared = app.invoke('sharedApplication');
            if (shared && shared.getProperty) {
                var delegate = shared.getProperty('delegate');
                T.ok(delegate !== undefined, 'UIApplication.delegate via getProperty');
            } else {
                T.skip('KVC getProperty', 'sharedApplication not a proxy');
            }
        } else {
            T.skip('KVC getProperty', 'UIApplication not available');
        }
    }, 'KVC getProperty no crash');

    // ═══════════════════════════════════════════════════════════════
    // 9. ObjC.getClassNames
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjC.getClassNames');

    T.safe(function() {
        var all = ObjC.getClassNames();
        T.ok(Array.isArray(all), 'getClassNames() returns array');
        T.gt(all.length, 100, 'getClassNames() returns >100 classes: ' + all.length);
    }, 'getClassNames() no crash');

    T.safe(function() {
        var filtered = ObjC.getClassNames('UIView');
        T.ok(Array.isArray(filtered), 'getClassNames("UIView") returns array');
        T.gt(filtered.length, 0, 'getClassNames("UIView") found matches: ' + filtered.length);
        var allMatch = true;
        for (var i = 0; i < Math.min(filtered.length, 10); i++) {
            if (filtered[i].toLowerCase().indexOf('uiview') < 0) { allMatch = false; break; }
        }
        T.ok(allMatch, 'getClassNames filter works correctly');
    }, 'getClassNames(filter) no crash');

    // Boundary: filter that matches nothing
    T.safe(function() {
        var none = ObjC.getClassNames('__ZZZ_NoMatch_XYZ__');
        T.ok(Array.isArray(none), 'getClassNames(no-match) returns array');
        T.eq(none.length, 0, 'getClassNames(no-match) returns empty');
    }, 'getClassNames(no-match) no crash');

    // Boundary: empty filter
    T.safe(function() {
        var all = ObjC.getClassNames('');
        T.ok(Array.isArray(all), 'getClassNames("") returns array');
        T.gt(all.length, 100, 'getClassNames("") returns all classes');
    }, 'getClassNames("") no crash');

    // ═══════════════════════════════════════════════════════════════
    // 10. ObjC.enumerateLoadedClasses
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjC.enumerateLoadedClasses');

    T.safe(function() {
        var count = 0;
        var completed = false;
        ObjC.enumerateLoadedClasses({
            onMatch: function(className) { count++; },
            onComplete: function() { completed = true; }
        });
        T.ok(completed, 'enumerateLoadedClasses completed');
        T.gt(count, 100, 'enumerateLoadedClasses found >100: ' + count);
    }, 'enumerateLoadedClasses no crash');

    // ═══════════════════════════════════════════════════════════════
    // 11. ObjC.choose (heap scan)
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjC.choose');

    T.safe(function() {
        var found = [];
        ObjC.choose('UIView', {
            onMatch: function(instance) {
                found.push(instance);
            },
            onComplete: function() {}
        });
        T.gt(found.length, 0, 'ObjC.choose("UIView") found instances: ' + found.length);
        if (found.length > 0 && found[0].className) {
            var cn = found[0].className();
            T.ok(cn.indexOf('View') >= 0 || cn.indexOf('UI') >= 0, 'choose result is UIView subclass: ' + cn);
        }
    }, 'ObjC.choose no crash');

    // Boundary: choose nonexistent class
    T.safe(function() {
        var found = [];
        ObjC.choose('__NonExistentClass_XYZ__', {
            onMatch: function(inst) { found.push(inst); },
            onComplete: function() {}
        });
        T.eq(found.length, 0, 'choose(nonexistent) finds nothing');
    }, 'ObjC.choose(nonexistent) no crash');

    // ═══════════════════════════════════════════════════════════════
    // 12. ObjC.instance
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjC.instance');

    T.type(ObjC.instance, 'function', 'ObjC.instance is function');

    T.safe(function() {
        var app = ObjC.use('UIApplication');
        if (app) {
            var shared = app.invoke('sharedApplication');
            if (shared) {
                var proxy = ObjC.instance(shared);
                T.ok(proxy !== null, 'ObjC.instance(nativeObj) returns proxy');
                if (proxy && proxy.className) {
                    var cn = proxy.className();
                    T.ok(cn.indexOf('Application') >= 0, 'instance proxy className: ' + cn);
                }
            }
        }
    }, 'ObjC.instance(object) no crash');

    // Boundary: null/undefined
    T.safe(function() {
        var r = ObjC.instance(null);
        T.ok(r === null || r === undefined, 'ObjC.instance(null) returns null/undef');
    }, 'ObjC.instance(null) no crash');

    // ═══════════════════════════════════════════════════════════════
    // 13. ObjC.define — dynamic class creation
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjC.define');

    T.safe(function() {
        var cls = ObjC.define({
            name: 'WNTestStabilityClass_' + Date.now(),
            super: 'NSObject',
            methods: {
                'greet:': {
                    type: 'id (id)',
                    func: function(self, args) {
                        return 'Hello, ' + args[0];
                    }
                },
                'add:to:': {
                    type: 'int (int, int)',
                    func: function(self, args) {
                        return args[0] + args[1];
                    }
                },
                'noArgs': {
                    type: 'id',
                    func: function(self, args) {
                        return 'no-args-result';
                    }
                }
            }
        });
        T.ok(cls !== null, 'ObjC.define creates class');

        if (cls) {
            var cn = cls.className();
            T.ok(cn.indexOf('WNTestStabilityClass_') >= 0, 'defined class has correct name: ' + cn);

            // Create instance and invoke
            var instance = cls.invoke('new');
            T.ok(instance !== null, 'defined class instantiates');

            if (instance && instance.invoke) {
                var greeting = instance.invoke('greet:', ['World']);
                T.eq(greeting, 'Hello, World', 'defined method greet: works');

                var sum = instance.invoke('add:to:', [10, 20]);
                T.eq(sum, 30, 'defined method add:to: works');

                var noArgs = instance.invoke('noArgs');
                T.eq(noArgs, 'no-args-result', 'defined no-arg method works');

                T.ok(instance.respondsToSelector('greet:'), 'instance responds to defined selector');
                T.ok(!instance.respondsToSelector('__bogus__'), 'instance does not respond to bogus');
            }
        }
    }, 'ObjC.define no crash');

    // ═══════════════════════════════════════════════════════════════
    // 14. ObjC.delegate — protocol implementation
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjC.delegate');

    T.safe(function() {
        var delegateObj = ObjC.delegate({
            protocols: ['NSCoding'],
            methods: {
                'encodeWithCoder:': {
                    type: 'void (id)',
                    func: function(self, args) {}
                }
            }
        });
        T.ok(delegateObj !== null, 'ObjC.delegate creates delegate');
        if (delegateObj && delegateObj.className) {
            T.type(delegateObj.className(), 'string', 'delegate has className');
        }
        if (delegateObj && delegateObj.respondsToSelector) {
            T.ok(delegateObj.respondsToSelector('encodeWithCoder:'), 'delegate responds to protocol method');
        }
    }, 'ObjC.delegate no crash');

    // ═══════════════════════════════════════════════════════════════
    // 15. Stress / Stability tests
    // ═══════════════════════════════════════════════════════════════
    T.suite('ObjC stability');

    // Rapid successive use() calls
    T.safe(function() {
        var classes = ['NSString', 'NSArray', 'NSDictionary', 'NSNumber', 'NSDate',
                       'UIView', 'UILabel', 'UIButton', 'UIViewController', 'NSObject'];
        for (var i = 0; i < classes.length; i++) {
            var c = ObjC.use(classes[i]);
            if (c === null) {
                _log('FAIL', 'rapid use() ' + classes[i], 'returned null');
            }
        }
        T.ok(true, 'rapid successive use() calls (10 classes)');
    }, 'rapid use() no crash');

    // Multiple invocations of same method
    T.safe(function() {
        var NSNumber = ObjC.use('NSNumber');
        if (NSNumber) {
            for (var i = 0; i < 100; i++) {
                var n = NSNumber.invoke('numberWithInt:', [i]);
                if (n && n.invoke) {
                    var v = n.invoke('intValue');
                    if (v !== i) {
                        _log('FAIL', 'repeated invoke', 'iteration ' + i + ': got ' + v);
                        break;
                    }
                }
            }
            T.ok(true, 'repeated invoke 100 times consistent');
        }
    }, 'repeated invoke no crash');

    // Special characters in string args
    T.safe(function() {
        var str = NSString.invoke('stringWithString:', ['\0null\0byte']);
        T.ok(true, 'invoke with null byte in string');
    }, 'null byte in string no crash');

    T.safe(function() {
        var big = '';
        for (var i = 0; i < 10000; i++) big += 'A';
        var str = NSString.invoke('stringWithString:', [big]);
        if (str && str.invoke) {
            var len = str.invoke('length');
            T.eq(len, 10000, 'NSString with 10K chars: length === 10000');
        }
    }, 'large string no crash');

    T.done();
})();
