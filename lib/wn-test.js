/**
 * WNTest — WhiteNeedle 自动化测试框架
 *
 * 提供 describe/it 结构化测试组织、丰富的断言库、
 * beforeEach/afterEach 钩子、异步测试支持、超时控制，
 * 以及结构化 JSON 结果输出。
 *
 * 用法（设备端脚本）:
 *
 *   var t = WNTest.create('MyApp Login Tests');
 *
 *   t.describe('Login Screen', function(ctx) {
 *       ctx.beforeEach(function() { ... });
 *
 *       ctx.it('should show username field', function(assert) {
 *           assert.ok(field !== null, 'username field exists');
 *       });
 *
 *       ctx.it('async login', function(assert, done) {
 *           someAsyncOp(function(result) {
 *               assert.eq(result, 'ok');
 *               done();
 *           });
 *       }, { timeout: 5000 });
 *   });
 *
 *   t.run(); // 或 t.run(function(report) { ... });
 */
var WNTest = (function() {
    'use strict';

    // ─── Utilities ───────────────────────────────────────────

    function deepEqual(a, b) {
        if (a === b) return true;
        if (a === null || b === null) return false;
        if (typeof a !== typeof b) return false;
        if (typeof a !== 'object') return false;

        if (Array.isArray(a)) {
            if (!Array.isArray(b) || a.length !== b.length) return false;
            for (var i = 0; i < a.length; i++) {
                if (!deepEqual(a[i], b[i])) return false;
            }
            return true;
        }

        var keysA = Object.keys(a).sort();
        var keysB = Object.keys(b).sort();
        if (keysA.length !== keysB.length) return false;
        for (var j = 0; j < keysA.length; j++) {
            if (keysA[j] !== keysB[j]) return false;
            if (!deepEqual(a[keysA[j]], b[keysA[j]])) return false;
        }
        return true;
    }

    function truncate(val, maxLen) {
        maxLen = maxLen || 80;
        var s;
        try {
            s = JSON.stringify(val);
        } catch (e) {
            s = String(val);
        }
        return s.length > maxLen ? s.substring(0, maxLen) + '…' : s;
    }

    function elapsed(start) {
        return Date.now() - start;
    }

    // ─── Assert 对象工厂 ─────────────────────────────────────

    function createAssert(results, caseName) {
        var _passed = true;

        function record(pass, msg, detail) {
            var entry = {
                status: pass ? 'pass' : 'fail',
                message: msg || '',
                detail: detail || ''
            };
            results.push(entry);
            if (!pass) _passed = false;
        }

        var assert = {
            /** 布尔断言 */
            ok: function(condition, msg) {
                record(!!condition, msg || 'ok', condition ? '' : 'expected truthy');
            },

            /** 严格相等 (===) */
            eq: function(actual, expected, msg) {
                var pass = actual === expected;
                record(pass,
                    msg || 'eq',
                    pass ? '' : 'got ' + truncate(actual) + ', want ' + truncate(expected));
            },

            /** 严格不等 (!==) */
            neq: function(actual, expected, msg) {
                var pass = actual !== expected;
                record(pass,
                    msg || 'neq',
                    pass ? '' : 'should not equal ' + truncate(expected));
            },

            /** 深度相等 */
            deepEq: function(actual, expected, msg) {
                var pass = deepEqual(actual, expected);
                record(pass,
                    msg || 'deepEq',
                    pass ? '' : 'got ' + truncate(actual) + ', want ' + truncate(expected));
            },

            /** typeof 检查 */
            type: function(val, expectedType, msg) {
                var actual = typeof val;
                record(actual === expectedType,
                    msg || 'type',
                    actual === expectedType ? '' : 'typeof=' + actual + ', want ' + expectedType);
            },

            /** 大于 */
            gt: function(a, b, msg) {
                record(a > b, msg || 'gt', a > b ? '' : a + ' not > ' + b);
            },

            /** 大于等于 */
            gte: function(a, b, msg) {
                record(a >= b, msg || 'gte', a >= b ? '' : a + ' not >= ' + b);
            },

            /** 小于 */
            lt: function(a, b, msg) {
                record(a < b, msg || 'lt', a < b ? '' : a + ' not < ' + b);
            },

            /** 小于等于 */
            lte: function(a, b, msg) {
                record(a <= b, msg || 'lte', a <= b ? '' : a + ' not <= ' + b);
            },

            /** 字符串/数组包含 */
            contains: function(haystack, needle, msg) {
                var pass = false;
                if (typeof haystack === 'string') {
                    pass = haystack.indexOf(needle) >= 0;
                } else if (Array.isArray(haystack)) {
                    for (var i = 0; i < haystack.length; i++) {
                        if (haystack[i] === needle) { pass = true; break; }
                    }
                }
                record(pass,
                    msg || 'contains',
                    pass ? '' : truncate(haystack, 40) + ' does not contain ' + truncate(needle));
            },

            /** 正则匹配 */
            matches: function(str, regex, msg) {
                var pass = regex.test(str);
                record(pass,
                    msg || 'matches',
                    pass ? '' : truncate(str) + ' does not match ' + regex);
            },

            /** 期望抛出异常 */
            throws: function(fn, msg) {
                try {
                    fn();
                    record(false, msg || 'throws', 'no exception thrown');
                } catch (e) {
                    record(true, msg || 'throws');
                }
            },

            /** 期望不抛出异常 */
            noThrow: function(fn, msg) {
                try {
                    fn();
                    record(true, msg || 'noThrow');
                } catch (e) {
                    record(false, msg || 'noThrow', 'threw: ' + (e.message || e));
                }
            },

            /** 值为 null 或 undefined */
            isNil: function(val, msg) {
                record(val === null || val === undefined,
                    msg || 'isNil',
                    (val === null || val === undefined) ? '' : 'got ' + truncate(val));
            },

            /** 值不为 null 且不为 undefined */
            isNotNil: function(val, msg) {
                record(val !== null && val !== undefined,
                    msg || 'isNotNil',
                    (val !== null && val !== undefined) ? '' : 'got nil');
            },

            /** 值是指定类的 ObjC 代理 */
            isObjCClass: function(proxy, expectedClass, msg) {
                var cn = '';
                try { cn = proxy.className(); } catch (e) { /* ignore */ }
                var pass = cn === expectedClass || cn.indexOf(expectedClass) >= 0;
                record(pass,
                    msg || 'isObjCClass',
                    pass ? '' : 'className=' + cn + ', want ' + expectedClass);
            },

            /** 数值在范围内 [min, max] */
            inRange: function(val, min, max, msg) {
                var pass = val >= min && val <= max;
                record(pass,
                    msg || 'inRange',
                    pass ? '' : val + ' not in [' + min + ', ' + max + ']');
            },

            /** 手动标记跳过 */
            skip: function(msg, reason) {
                results.push({
                    status: 'skip',
                    message: msg || 'skip',
                    detail: reason || ''
                });
            },

            /** 当前用例是否全部通过 */
            get passed() { return _passed; }
        };

        return assert;
    }

    // ─── Suite / Context ─────────────────────────────────────

    function createSuite(name) {
        var _describes = [];
        var _globalBefore = [];
        var _globalAfter = [];
        var _startTime = 0;

        var suite = {
            name: name,

            /** 全局 before 钩子 */
            before: function(fn) { _globalBefore.push(fn); },

            /** 全局 after 钩子 */
            after: function(fn) { _globalAfter.push(fn); },

            /** 注册一个测试组 */
            describe: function(groupName, setupFn) {
                var group = {
                    name: groupName,
                    cases: [],
                    beforeEach: [],
                    afterEach: [],
                    beforeAll: [],
                    afterAll: []
                };

                var ctx = {
                    it: function(caseName, testFn, opts) {
                        group.cases.push({
                            name: caseName,
                            fn: testFn,
                            opts: opts || {}
                        });
                    },
                    beforeEach: function(fn) { group.beforeEach.push(fn); },
                    afterEach: function(fn) { group.afterEach.push(fn); },
                    beforeAll: function(fn) { group.beforeAll.push(fn); },
                    afterAll: function(fn) { group.afterAll.push(fn); }
                };

                setupFn(ctx);
                _describes.push(group);
            },

            /** 执行所有测试 */
            run: function(callback) {
                _startTime = Date.now();
                var report = {
                    suite: name,
                    groups: [],
                    total: 0,
                    passed: 0,
                    failed: 0,
                    skipped: 0,
                    errors: 0,
                    duration: 0,
                    failures: []
                };

                console.log('╔══════════════════════════════════════════╗');
                console.log('║  WNTest: ' + name);
                console.log('╚══════════════════════════════════════════╝');

                // global before
                for (var gb = 0; gb < _globalBefore.length; gb++) {
                    try { _globalBefore[gb](); } catch (e) {
                        console.error('[WNTest] global before error: ' + e.message);
                    }
                }

                var pendingAsync = 0;
                var allDone = false;

                function checkComplete() {
                    if (pendingAsync > 0 || allDone) return;
                    allDone = true;
                    finalize();
                }

                function finalize() {
                    // global after
                    for (var ga = 0; ga < _globalAfter.length; ga++) {
                        try { _globalAfter[ga](); } catch (e) {
                            console.error('[WNTest] global after error: ' + e.message);
                        }
                    }

                    report.duration = elapsed(_startTime);

                    // Summary
                    console.log('\n══════════════════════════════════════════');
                    console.log('SUITE: ' + report.suite);
                    console.log('TOTAL: ' + report.total +
                        '  PASSED: ' + report.passed +
                        '  FAILED: ' + report.failed +
                        '  SKIPPED: ' + report.skipped +
                        '  ERRORS: ' + report.errors +
                        '  TIME: ' + report.duration + 'ms');
                    if (report.failures.length > 0) {
                        console.error('FAILURES:');
                        for (var fi = 0; fi < report.failures.length; fi++) {
                            console.error('  • ' + report.failures[fi]);
                        }
                    }
                    console.log('══════════════════════════════════════════');
                    console.log('[RESULT_JSON] ' + JSON.stringify(report));

                    if (typeof callback === 'function') callback(report);
                }

                for (var di = 0; di < _describes.length; di++) {
                    var group = _describes[di];
                    var groupReport = { name: group.name, cases: [] };

                    console.log('\n▸ ' + group.name);

                    // beforeAll
                    for (var ba = 0; ba < group.beforeAll.length; ba++) {
                        try { group.beforeAll[ba](); } catch (e) {
                            console.error('  [beforeAll error] ' + e.message);
                        }
                    }

                    for (var ci = 0; ci < group.cases.length; ci++) {
                        var tc = group.cases[ci];
                        var isAsync = tc.fn.length >= 2;
                        var timeout = tc.opts.timeout || 10000;
                        var assertions = [];
                        var assert = createAssert(assertions, tc.name);
                        var caseStart = Date.now();

                        // beforeEach
                        for (var be = 0; be < group.beforeEach.length; be++) {
                            try { group.beforeEach[be](); } catch (e) {
                                console.error('  [beforeEach error] ' + e.message);
                            }
                        }

                        if (isAsync) {
                            (function(testCase, asserts, assertObj, start, timeoutMs, grp) {
                                pendingAsync++;
                                var settled = false;
                                var timerId = setTimeout(function() {
                                    if (settled) return;
                                    settled = true;
                                    asserts.push({
                                        status: 'fail',
                                        message: 'TIMEOUT',
                                        detail: 'exceeded ' + timeoutMs + 'ms'
                                    });
                                    finishCase(testCase, asserts, start, grp, groupReport);
                                    pendingAsync--;
                                    checkComplete();
                                }, timeoutMs);

                                try {
                                    testCase.fn(assertObj, function() {
                                        if (settled) return;
                                        settled = true;
                                        clearTimeout(timerId);
                                        finishCase(testCase, asserts, start, grp, groupReport);
                                        pendingAsync--;
                                        checkComplete();
                                    });
                                } catch (e) {
                                    if (!settled) {
                                        settled = true;
                                        clearTimeout(timerId);
                                        asserts.push({
                                            status: 'error',
                                            message: 'EXCEPTION',
                                            detail: e.message || String(e)
                                        });
                                        finishCase(testCase, asserts, start, grp, groupReport);
                                        pendingAsync--;
                                        checkComplete();
                                    }
                                }
                            })(tc, assertions, assert, caseStart, timeout, group);
                        } else {
                            try {
                                tc.fn(assert);
                            } catch (e) {
                                assertions.push({
                                    status: 'error',
                                    message: 'EXCEPTION',
                                    detail: e.message || String(e)
                                });
                            }
                            finishCase(tc, assertions, caseStart, group, groupReport);
                        }

                        // afterEach (for sync only; async runs inside closure)
                        if (!isAsync) {
                            for (var ae = 0; ae < group.afterEach.length; ae++) {
                                try { group.afterEach[ae](); } catch (e) {
                                    console.error('  [afterEach error] ' + e.message);
                                }
                            }
                        }
                    }

                    // afterAll
                    for (var aa = 0; aa < group.afterAll.length; aa++) {
                        try { group.afterAll[aa](); } catch (e) {
                            console.error('  [afterAll error] ' + e.message);
                        }
                    }

                    report.groups.push(groupReport);
                }

                function finishCase(tc, asserts, start, grp, groupRpt) {
                    var dur = elapsed(start);
                    var casePassed = 0, caseFailed = 0, caseSkipped = 0, caseErrors = 0;

                    for (var ai = 0; ai < asserts.length; ai++) {
                        var a = asserts[ai];
                        if (a.status === 'pass') casePassed++;
                        else if (a.status === 'fail') caseFailed++;
                        else if (a.status === 'skip') caseSkipped++;
                        else if (a.status === 'error') caseErrors++;
                    }

                    var overall = (caseFailed === 0 && caseErrors === 0) ? 'PASS' : 'FAIL';
                    if (casePassed === 0 && caseFailed === 0 && caseErrors === 0 && caseSkipped > 0) {
                        overall = 'SKIP';
                    }

                    var icon = overall === 'PASS' ? '✓' : overall === 'FAIL' ? '✗' : '⊘';
                    console.log('  ' + icon + ' ' + tc.name + ' (' + dur + 'ms)');

                    for (var pi = 0; pi < asserts.length; pi++) {
                        var entry = asserts[pi];
                        if (entry.status === 'fail' || entry.status === 'error') {
                            console.error('    ✗ ' + entry.message + (entry.detail ? ' — ' + entry.detail : ''));
                        }
                    }

                    report.total++;
                    if (overall === 'PASS') report.passed++;
                    else if (overall === 'FAIL') {
                        report.failed++;
                        var failMessages = [];
                        for (var fi = 0; fi < asserts.length; fi++) {
                            if (asserts[fi].status === 'fail' || asserts[fi].status === 'error') {
                                failMessages.push(asserts[fi].message + ': ' + asserts[fi].detail);
                            }
                        }
                        report.failures.push(grp.name + ' > ' + tc.name + ': ' + failMessages.join('; '));
                    }
                    else if (overall === 'SKIP') report.skipped++;
                    report.errors += caseErrors;

                    groupRpt.cases.push({
                        name: tc.name,
                        status: overall.toLowerCase(),
                        duration: dur,
                        assertions: asserts.length,
                        passed: casePassed,
                        failed: caseFailed,
                        skipped: caseSkipped,
                        errors: caseErrors
                    });
                }

                if (pendingAsync === 0) {
                    finalize();
                }

                return report;
            }
        };

        return suite;
    }

    // ─── Public API ──────────────────────────────────────────

    return {
        /** 版本号 */
        version: '1.0.0',

        /** 创建测试套件 */
        create: function(name) {
            return createSuite(name || 'WNTest Suite');
        },

        /**
         * 快速运行单个测试文件（兼容旧版 inline harness 风格）
         * WNTest.quick('suite_name', function(T) {
         *     T.ok(true, 'basic');
         *     T.eq(1, 1, 'equal');
         * });
         */
        quick: function(suiteName, fn) {
            var results = [];
            var assert = createAssert(results, suiteName);
            var startTime = Date.now();

            console.log('╔══════════════════════════════════════════╗');
            console.log('║  WNTest Quick: ' + suiteName);
            console.log('╚══════════════════════════════════════════╝');

            try {
                fn(assert);
            } catch (e) {
                results.push({
                    status: 'error',
                    message: 'EXCEPTION',
                    detail: e.message || String(e)
                });
            }

            var p = 0, f = 0, s = 0, errs = 0, fails = [];
            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                if (r.status === 'pass') p++;
                else if (r.status === 'fail') { f++; fails.push(r.message + ': ' + r.detail); }
                else if (r.status === 'skip') s++;
                else if (r.status === 'error') { errs++; fails.push(r.message + ': ' + r.detail); }
            }

            console.log('\n══════════════════════════════════════════');
            console.log('SUITE: ' + suiteName);
            console.log('TOTAL: ' + results.length +
                '  PASSED: ' + p + '  FAILED: ' + f +
                '  SKIPPED: ' + s + '  ERRORS: ' + errs +
                '  TIME: ' + elapsed(startTime) + 'ms');
            if (fails.length > 0) {
                console.error('FAILURES:');
                for (var j = 0; j < fails.length; j++) console.error('  • ' + fails[j]);
            }
            console.log('══════════════════════════════════════════');

            var report = {
                suite: suiteName,
                total: results.length,
                passed: p,
                failed: f,
                skipped: s,
                errors: errs,
                duration: elapsed(startTime),
                failures: fails
            };
            console.log('[RESULT_JSON] ' + JSON.stringify(report));
            return report;
        },

        /**
         * 批量运行多个测试套件，汇总结果
         * WNTest.runAll([suite1, suite2], function(summary) { ... });
         */
        runAll: function(suites, callback) {
            var summary = {
                total: 0, passed: 0, failed: 0, skipped: 0, errors: 0,
                duration: 0, suites: [], allFailures: []
            };
            var startTime = Date.now();
            var remaining = suites.length;

            function onSuiteDone(report) {
                summary.total += report.total;
                summary.passed += report.passed;
                summary.failed += report.failed;
                summary.skipped += report.skipped;
                summary.errors += report.errors || 0;
                summary.suites.push({ name: report.suite, result: report });
                for (var i = 0; i < report.failures.length; i++) {
                    summary.allFailures.push('[' + report.suite + '] ' + report.failures[i]);
                }
                remaining--;
                if (remaining <= 0) {
                    summary.duration = elapsed(startTime);
                    console.log('\n╔══════════════════════════════════════════╗');
                    console.log('║  WNTest Summary — ALL SUITES             ║');
                    console.log('╚══════════════════════════════════════════╝');
                    console.log('SUITES: ' + suites.length +
                        '  TOTAL: ' + summary.total +
                        '  PASSED: ' + summary.passed +
                        '  FAILED: ' + summary.failed +
                        '  TIME: ' + summary.duration + 'ms');
                    if (summary.allFailures.length > 0) {
                        console.error('ALL FAILURES:');
                        for (var j = 0; j < summary.allFailures.length; j++) {
                            console.error('  • ' + summary.allFailures[j]);
                        }
                    }
                    console.log('[SUMMARY_JSON] ' + JSON.stringify(summary));
                    if (typeof callback === 'function') callback(summary);
                }
            }

            for (var i = 0; i < suites.length; i++) {
                suites[i].run(onSuiteDone);
            }
        }
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WNTest;
}
if (typeof globalThis !== 'undefined') {
    globalThis.WNTest = WNTest;
} else if (typeof this !== 'undefined') {
    this.WNTest = WNTest;
}
