/**
 * WhiteNeedle Sample: WNTest + WNAuto 自动化测试示例
 *
 * 演示如何使用 WNTest 框架组织测试用例，
 * 配合 WNAuto 进行 UI 自动化操作和验证。
 *
 * 运行方式:
 *   直接 load_script 加载本文件即可 — wn-test 和 wn-auto 是内置模块，
 *   会通过 require() 自动加载。
 */
(function() {

    var WNTest = require('wn-test');
    var WNAuto = require('wn-auto');

    var t = WNTest.create('WNAuto Full Coverage');

    // ━━━ Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function findOne(id) {
        var arr = WNAuto.find.byId(id);
        return arr && arr.length > 0 ? arr[0] : null;
    }

    function textOf(id) {
        var el = findOne(id);
        return el ? WNAuto.props.text(el) : null;
    }

    function dumpAlertHierarchy(alertVC) {
        try {
            var view = alertVC.invoke('view');
            if (!view) { console.log('[dump] alertVC.view is nil'); return; }
            var stack = [{ v: view, depth: 0 }];
            while (stack.length > 0) {
                var item = stack.pop();
                var v = item.v, d = item.depth;
                if (d > 8) continue;
                var cn = '', txt = '', grCount = 0;
                try { cn = String(v.invoke('class').invoke('description')); } catch(e) {}
                try { var t = v.invoke('text'); if (t) txt = String(t); } catch(e) {}
                try { var grs = v.invoke('gestureRecognizers'); if (grs) grCount = grs.invoke('count'); } catch(e) {}
                var prefix = '';
                for (var p = 0; p < d; p++) prefix += '  ';
                var line = prefix + cn;
                if (txt) line += ' text="' + txt + '"';
                if (grCount > 0) line += ' GR=' + grCount;
                console.log('[dump] ' + line);
                try {
                    var subs = v.invoke('subviews');
                    if (subs) {
                        var c = subs.invoke('count');
                        for (var i = c - 1; i >= 0; i--) {
                            stack.push({ v: subs.invoke('objectAtIndex:', [i]), depth: d + 1 });
                        }
                    }
                } catch(e) {}
            }
        } catch(e) { console.log('[dump] error: ' + e.message); }
    }

    function forceCloseAlerts() {
        // for (var round = 0; round < 5; round++) {
        //     var cur = WNAuto.alert.current();
        //     if (!cur) break;
        //     console.log('forceCloseAlerts round=' + round + ': dismissing alert');
        //     // if (round === 0) dumpAlertHierarchy(cur);
        //     WNAuto.alert.dismiss();
        //     WNAuto.runLoop(500);
        // }
    }

    function findVCByClass(className) {
        var results = WNAuto.find.byClass(className);
        if (results && results.length > 0) return results[0];
        var all = WNAuto.find.byClass('UIView');
        for (var i = 0; i < (all ? all.length : 0); i++) {
            try {
                var resp = all[i].invoke('nextResponder');
                while (resp) {
                    var rc = resp.invoke('class').invoke('description');
                    if (rc === className) return resp;
                    resp = resp.invoke('nextResponder');
                }
            } catch(e) { break; }
        }
        return null;
    }

    t.describe('alert — 弹窗操作', function(ctx) {

        ctx.it('显示 Alert → 检测 → tapButton OK', function(a) {
            forceCloseAlerts();

            var sv = findOne('mainScrollView');
            if (sv) WNAuto.scrollToTop(sv);

            WNAuto.runLoop(300);
            WNAuto.scroll(sv, { y: 800 }, true);
            WNAuto.runLoop(300);

            var btn = findOne('alertButton');
            a.isNotNil(btn, 'alertButton 存在');
            WNAuto.tap(btn);
            WNAuto.runLoop(300);

            var ac = WNAuto.alert.current();
            a.isNotNil(ac, '应检测到 Alert');

            var ok = false;
            try { ok = WNAuto.alert.tapButton('OK'); } catch(e) {
                console.warn('[Test] tapButton(OK) error: ' + e.message);
            }
            WNAuto.runLoop(500);

            // forceCloseAlerts();

            var result = textOf('alertResult');
            a.ok(result && result.indexOf('OK') >= 0,
                 '结果应为 Alert: OK, 实际: ' + result);
                
             WNAuto.runLoop(500);

            var preCheck = WNAuto.alert.current();
            if (preCheck) {
                console.warn('[Test] 发现残留 alert, class=' + WNAuto.props.className(preCheck));
                forceCloseAlerts();
                WNAuto.runLoop(120);
            }
        });

        // ctx.it('显示输入 Alert → typeInField → Submit', function(a) {
        //     forceCloseAlerts();

        //     var preCheck = WNAuto.alert.current();
        //     if (preCheck) {
        //         console.warn('[Test] 发现残留 alert, class=' + WNAuto.props.className(preCheck));
        //         forceCloseAlerts();
        //         WNAuto.runLoop(120);
        //     }

        //     console.log('find.topViewController');

        //     var topVCBefore = WNAuto.find.topViewController();
        //     var topCN = topVCBefore ? WNAuto.props.className(topVCBefore) : 'nil';
        //     console.log('[Test] 当前 topVC: ' + topCN);

        //     var sv = findOne('mainScrollView');
        //     WNAuto.scroll(sv, { y: 800 });
        //     WNAuto.runLoop(180);

        //     var btn = findOne('inputAlertButton');
        //     a.isNotNil(btn, 'inputAlertButton 存在');
        //     WNAuto.tap(btn);
        //     WNAuto.alert.waitFor({ timeout: 2200 });

        //     var ac = WNAuto.alert.current();
        //     if (ac) {
        //         var alertTitle = '';
        //         try { alertTitle = ac.invoke('title'); } catch(e) {}
        //         console.log('[Test] 检测到 Alert, title=' + alertTitle);

        //         if (String(alertTitle) !== 'Input Alert') {
        //             console.warn('[Test] 不是 Input Alert! 尝试 dismiss 后重新弹出');
        //             forceCloseAlerts();
        //             WNAuto.runLoop(180);

        //             WNAuto.tap(btn);
        //             WNAuto.alert.waitFor({ timeout: 2200 });
        //             ac = WNAuto.alert.current();
        //         }
        //     }
        //     a.isNotNil(ac, '应检测到输入 Alert');

        //     try {
        //         WNAuto.alert.typeInField(0, 'hello-wn');
        //     } catch(e) {
        //         console.warn('[Test] typeInField error: ' + e.message);
        //     }
        //     WNAuto.runLoop(120);

        //     try {
        //         var submitted = WNAuto.alert.tapButton('Submit');
        //         a.ok(submitted, '应成功点击 Submit');
        //     } catch(e) {
        //         console.warn('[Test] tapButton(Submit) error: ' + e.message);
        //         try { WNAuto.alert.dismiss(); } catch(_) {}
        //     }
        //     WNAuto.runLoop(200);
        //     if (WNAuto.alert.current()) forceCloseAlerts();

        //     var result = textOf('alertResult');
        //     a.ok(result && result.indexOf('hello-wn') >= 0,
        //          '结果应包含 hello-wn, 实际: ' + result);
        // });
    });

    t.run(function(report) {
        console.log('\n══ 测试报告摘要 ══');
        console.log('总计: ' + report.total +
                    ' | 通过: ' + report.passed +
                    ' | 失败: ' + report.failed +
                    ' | 跳过: ' + report.skipped +
                    ' | 耗时: ' + report.duration + 'ms');
        if (report.failures.length > 0) {
            console.log('\n失败用例:');
            for (var i = 0; i < report.failures.length; i++) {
                console.log('  ✗ ' + report.failures[i]);
            }
        }
    });

    // // ═══════════════════════════════════════════════════════════════
    // // Suite 1: UI 结构验证
    // // ═══════════════════════════════════════════════════════════════

    // var uiSuite = WNTest.create('UI Structure Validation');

    // uiSuite.describe('Key Window', function(ctx) {
    //     ctx.it('should have a key window', function(assert) {
    //         var wins = WNAuto.find.byClass('UIWindow');
    //         assert.gt(wins.length, 0, 'at least one UIWindow exists');
    //     });

    //     ctx.it('should have a root view controller', function(assert) {
    //         var topVC = WNAuto.find.topViewController();
    //         assert.isNotNil(topVC, 'top VC exists');
    //         if (topVC) {
    //             var cn = WNAuto.props.className(topVC);
    //             assert.type(cn, 'string', 'VC has class name');
    //             console.log('  Top VC: ' + cn);
    //         }
    //     });
    // });

    // uiSuite.describe('View Hierarchy', function(ctx) {
    //     ctx.it('should contain UIView instances', function(assert) {
    //         var views = WNAuto.find.byClass('UIView');
    //         assert.gt(views.length, 0, 'UIViews found: ' + views.length);
    //     });

    //     ctx.it('should have visible views', function(assert) {
    //         var views = WNAuto.find.byClass('UIView');
    //         var visibleCount = 0;
    //         for (var i = 0; i < Math.min(views.length, 20); i++) {
    //             if (WNAuto.props.isVisible(views[i])) visibleCount++;
    //         }
    //         assert.gt(visibleCount, 0, 'visible views: ' + visibleCount);
    //     });
    // });

    // // ═══════════════════════════════════════════════════════════════
    // // Suite 2: UI 控件交互
    // // ═══════════════════════════════════════════════════════════════

    // var interactionSuite = WNTest.create('UI Interaction Tests');

    // interactionSuite.describe('Button Detection', function(ctx) {
    //     ctx.it('should find UIButton instances if any', function(assert) {
    //         var buttons = WNAuto.find.byClass('UIButton');
    //         console.log('  Found ' + buttons.length + ' buttons');
    //         assert.type(buttons, 'object', 'buttons is array');

    //         for (var i = 0; i < Math.min(buttons.length, 5); i++) {
    //             var text = WNAuto.props.text(buttons[i]);
    //             if (text) console.log('    Button: "' + text + '"');
    //         }
    //         assert.ok(true, 'button scan completed');
    //     });
    // });

    // interactionSuite.describe('Label Detection', function(ctx) {
    //     ctx.it('should find UILabel instances', function(assert) {
    //         var labels = WNAuto.find.byClass('UILabel');
    //         assert.gt(labels.length, 0, 'UILabels found: ' + labels.length);

    //         for (var i = 0; i < Math.min(labels.length, 5); i++) {
    //             var text = WNAuto.props.text(labels[i]);
    //             if (text) console.log('    Label: "' + text + '"');
    //         }
    //     });
    // });

    // interactionSuite.describe('TextField Interaction', function(ctx) {
    //     ctx.it('should be able to type in UITextField', function(assert) {
    //         var textFields = WNAuto.find.byClass('UITextField');
    //         if (textFields.length === 0) {
    //             assert.skip('UITextField typing', 'no text fields on screen');
    //             return;
    //         }

    //         var tf = textFields[0];
    //         WNAuto.clearText(tf);
    //         WNAuto.type(tf, 'WNAuto test input');
    //         var result = WNAuto.props.text(tf);
    //         assert.eq(result, 'WNAuto test input', 'text was set correctly');

    //         WNAuto.clearText(tf);
    //         var cleared = WNAuto.props.text(tf);
    //         assert.ok(!cleared || cleared.length === 0, 'text was cleared');
    //     });
    // });

    // interactionSuite.describe('Switch Interaction', function(ctx) {
    //     ctx.it('should toggle UISwitch', function(assert) {
    //         var switches = WNAuto.find.byClass('UISwitch');
    //         if (switches.length === 0) {
    //             assert.skip('UISwitch toggle', 'no switches on screen');
    //             return;
    //         }

    //         var sw = switches[0];
    //         var original = WNAuto.props.isSwitchOn(sw);

    //         WNAuto.setSwitch(sw, !original);
    //         var toggled = WNAuto.props.isSwitchOn(sw);
    //         assert.eq(toggled, !original, 'switch toggled');

    //         WNAuto.setSwitch(sw, original);
    //         var restored = WNAuto.props.isSwitchOn(sw);
    //         assert.eq(restored, original, 'switch restored');
    //     });
    // });

    // // ═══════════════════════════════════════════════════════════════
    // // Suite 3: 导航验证
    // // ═══════════════════════════════════════════════════════════════

    // var navSuite = WNTest.create('Navigation Tests');

    // navSuite.describe('ViewController Stack', function(ctx) {
    //     ctx.it('should report VC hierarchy', function(assert) {
    //         var vcs = WNAuto.find.viewControllers();
    //         assert.type(vcs, 'object', 'viewControllers returns array');
    //         console.log('  VC count: ' + vcs.length);
    //         for (var i = 0; i < vcs.length; i++) {
    //             console.log('    ' + '  '.repeat(vcs[i].depth || 0) + vcs[i].class);
    //         }
    //         assert.ok(true, 'VC hierarchy printed');
    //     });
    // });

    // navSuite.describe('Alert Detection', function(ctx) {
    //     ctx.it('should detect alert if present', function(assert) {
    //         var alertVC = WNAuto.alert.current();
    //         if (alertVC) {
    //             console.log('  Alert is present');
    //             assert.ok(true, 'alert detected');
    //         } else {
    //             console.log('  No alert present');
    //             assert.ok(true, 'no alert (normal state)');
    //         }
    //     });
    // });

    // // ═══════════════════════════════════════════════════════════════
    // // Suite 4: WNAuto.find 高级查找
    // // ═══════════════════════════════════════════════════════════════

    // var findSuite = WNTest.create('Advanced Find Tests');

    // findSuite.describe('Combined Search', function(ctx) {
    //     ctx.it('should find visible UILabels', function(assert) {
    //         var labels = WNAuto.find.where({ class: 'UILabel', visible: true });
    //         console.log('  Visible UILabels: ' + labels.length);
    //         assert.type(labels, 'object', 'where returns array');
    //     });

    //     ctx.it('should support waitFor pattern', function(assert) {
    //         var found = WNAuto.find.waitFor(function() {
    //             return WNAuto.find.byClass('UIView').length > 0;
    //         }, { timeout: 2000 });
    //         assert.ok(found, 'waitFor found UIViews');
    //     });
    // });

    // // ═══════════════════════════════════════════════════════════════
    // // 运行所有套件
    // // ═══════════════════════════════════════════════════════════════

    // WNTest.runAll([uiSuite, interactionSuite, navSuite, findSuite], function(summary) {
    //     console.log('\n🏁 All test suites completed.');
    //     console.log('   Total: ' + summary.total +
    //         '  Passed: ' + summary.passed +
    //         '  Failed: ' + summary.failed);

    //     rpc.exports.getLastTestReport = function() {
    //         return summary;
    //     };
    // });

})();
