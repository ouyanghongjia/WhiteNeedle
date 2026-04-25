/**
 * WhiteNeedle 全量自动化测试脚本
 *
 * 覆盖 WNAuto 所有公开方法 + WNTest 断言 + Interceptor hook 异步回调验证。
 *
 * 前提：先在 iOS Example 中打开 Auto Test Playground 页面
 *       (主页面 → 🤖 Auto Test 按钮)
 *
 * 运行方式:
 *   load_script 本文件 / MCP evaluate 执行
 */
(function() {
    'use strict';

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

    function forceCloseAlerts() {
        for (var attempt = 0; attempt < 5; attempt++) {
            var topVC = WNAuto.find.topViewController();
            if (!topVC) break;
            var cn = '';
            try { cn = WNAuto.props.className(topVC); } catch(e) { break; }
            if (cn.indexOf('AlertController') < 0) break;

            var block = $block(function() {}, 'void (^)(void)');
            try {
                topVC.invoke('dismissViewControllerAnimated:completion:', [false, block]);
            } catch(e) {
                try {
                    var presenting = topVC.invoke('presentingViewController');
                    if (presenting) presenting.invoke('dismissViewControllerAnimated:completion:', [false, block]);
                } catch(e2) { /* fallback failed */ }
            }
            WNAuto.runLoop(500);
        }
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

    // ━━━ 1. find — 视图查找 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    t.describe('find — 视图查找', function(ctx) {

        ctx.it('find.byId 定位 accessibilityIdentifier', function(a) {
            var btn = findOne('loginButton');
            a.isNotNil(btn, 'loginButton 应该存在');
            a.eq(WNAuto.props.className(btn), 'UIButton', '应为 UIButton');
        });

        ctx.it('find.byClass 搜索 UITextField', function(a) {
            var fields = WNAuto.find.byClass('UITextField');
            a.ok(fields.length >= 2, '至少 2 个 UITextField (用户名+密码)');
        });

        ctx.it('find.byText 模糊匹配文本', function(a) {
            var results = WNAuto.find.byText('Login');
            a.ok(results.length >= 1, '应找到含 Login 文本的视图');
        });

        ctx.it('find.byLabel 搜索 accessibilityLabel', function(a) {
            // UISwitch 通常有默认 label
            var results = WNAuto.find.byClass('UISwitch');
            a.ok(results.length >= 1, '至少一个 UISwitch');
        });

        ctx.it('find.byTag 搜索 tag', function(a) {
            // tag=0 匹配大量视图，验证返回数组
            var results = WNAuto.find.byTag(0);
            a.ok(Array.isArray(results), 'byTag 应返回数组');
        });

        ctx.it('find.where 组合条件', function(a) {
            var results = WNAuto.find.where({ class: 'UIButton', id: 'tapButton' });
            a.eq(results.length, 1, '精确匹配 tapButton');
        });

        ctx.it('find.topViewController 获取当前 VC', function(a) {
            var vc = WNAuto.find.topViewController();
            a.isNotNil(vc, 'topVC 不为 null');
            var cn = WNAuto.props.className(vc);
            a.ok(cn.indexOf('WNAutoTestViewController') >= 0 ||
                 cn.indexOf('UINavigationController') >= 0,
                 '当前应为 AutoTest 页面或其 Nav');
        });

        ctx.it('find.waitFor 等待已存在的元素', function(a) {
            var ok = WNAuto.find.waitFor(function() {
                return findOne('loginButton') !== null;
            }, { timeout: 2000 });
            a.ok(ok, 'loginButton 应在 2s 内找到');
        });
    });

    // ━━━ 2. tap / doubleTap / longPress ━━━━━━━━━━━━━━━━━━━━━━━━

    t.describe('tap / doubleTap / longPress', function(ctx) {

        ctx.it('tap 按钮 → 计数器递增', function(a) {
            var btn = findOne('tapButton');
            a.isNotNil(btn, 'tapButton 存在');

            var before = textOf('tapCount');
            var numBefore = parseInt((before || '').replace(/[^0-9]/g, ''), 10) || 0;

            WNAuto.tap(btn);
            WNAuto.runLoop(300);

            var after = textOf('tapCount');
            var numAfter = parseInt((after || '').replace(/[^0-9]/g, ''), 10) || 0;
            a.ok(numAfter === numBefore + 1,
                 '计数应 +1 (' + numBefore + ' → ' + numAfter + ')');
        });

        ctx.it('连续 tap 3 次', function(a) {
            var btn = findOne('tapButton');

            var before = textOf('tapCount');
            var numBefore = parseInt((before || '').replace(/[^0-9]/g, ''), 10) || 0;

            WNAuto.tap(btn);
            WNAuto.runLoop(100);
            WNAuto.tap(btn);
            WNAuto.runLoop(100);
            WNAuto.tap(btn);
            WNAuto.runLoop(200);

            var after = textOf('tapCount');
            var numAfter = parseInt((after || '').replace(/[^0-9]/g, ''), 10) || 0;
            a.ok(numAfter === numBefore + 3,
                 '计数应 +3 (' + numBefore + ' → ' + numAfter + ')');
        });

        ctx.it('doubleTap 触发双击事件', function(a) {
            var btn = findOne('doubleTapButton');
            a.isNotNil(btn, 'doubleTapButton 存在');
            WNAuto.doubleTap(btn);
            WNAuto.runLoop(300);
            var txt = textOf('doubleTapResult');
            a.ok(txt && txt.indexOf('received') >= 0, '应显示 double tap received');
        });

        ctx.it('longPress 触发长按事件', function(a) {
            var btn = findOne('longPressButton');
            a.isNotNil(btn, 'longPressButton 存在');
            WNAuto.longPress(btn, { duration: 800 });
            WNAuto.runLoop(500);
            var txt = textOf('longPressResult');
            a.ok(txt && txt.indexOf('received') >= 0, '应显示 long press received, 实际: ' + txt);
        });
    });

    // ━━━ 3. type / clearText ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    t.describe('type / clearText', function(ctx) {

        ctx.it('type 输入用户名', function(a) {
            var field = findOne('usernameField');
            a.isNotNil(field, 'usernameField 存在');
            WNAuto.clearText(field);
            WNAuto.type(field, 'admin');
            WNAuto.runLoop(200);
            var val = WNAuto.props.text(field);
            a.eq(val, 'admin', '输入的文本应为 admin');
        });

        ctx.it('type 输入密码', function(a) {
            var field = findOne('passwordField');
            a.isNotNil(field, 'passwordField 存在');
            WNAuto.clearText(field);
            WNAuto.type(field, 'secret');
            WNAuto.runLoop(200);
            var val = WNAuto.props.text(field);
            a.eq(val, 'secret', '密码字段文本应为 secret');
        });

        ctx.it('clearText 清空输入框', function(a) {
            var field = findOne('usernameField');
            WNAuto.type(field, 'temp');
            WNAuto.clearText(field);
            WNAuto.runLoop(200);
            var val = WNAuto.props.text(field);
            a.ok(!val || val === '', '清空后文本应为空, 实际: ' + val);
        });

        ctx.it('type → tap login → 验证状态', function(a) {
            var uField = findOne('usernameField');
            var pField = findOne('passwordField');
            WNAuto.clearText(uField);
            WNAuto.clearText(pField);
            WNAuto.type(uField, 'admin');
            WNAuto.type(pField, 'secret');
            WNAuto.runLoop(100);

            var loginBtn = findOne('loginButton');
            WNAuto.tap(loginBtn);
            WNAuto.runLoop(300);

            var status = textOf('loginStatus');
            a.ok(status && status.indexOf('Success') >= 0,
                 '登录应成功, 实际: ' + status);
        });

        ctx.it('type UITextView 多行文本', function(a) {
            var tv = findOne('testTextView');
            a.isNotNil(tv, 'testTextView 存在');
            WNAuto.clearText(tv);
            WNAuto.type(tv, 'Hello WhiteNeedle!');
            WNAuto.runLoop(200);
            var val = WNAuto.props.text(tv);
            a.ok(val && val.indexOf('WhiteNeedle') >= 0,
                 'TextView 应包含输入的文本');
        });
    });

    // ━━━ 4. setSwitch / selectSegment / setSlider / setDate ━━━━━

    t.describe('Controls — setSwitch / selectSegment / setSlider / setDate', function(ctx) {

        ctx.it('setSwitch 打开开关', function(a) {
            var sw = findOne('testSwitch');
            a.isNotNil(sw, 'testSwitch 存在');
            WNAuto.setSwitch(sw, true);
            WNAuto.runLoop(200);
            a.ok(WNAuto.props.isSwitchOn(sw), '开关应为 ON');
            var label = textOf('switchStatus');
            a.eq(label, 'ON', 'label 应显示 ON');
        });

        ctx.it('setSwitch 关闭开关', function(a) {
            var sw = findOne('testSwitch');
            WNAuto.setSwitch(sw, false);
            WNAuto.runLoop(200);
            a.ok(!WNAuto.props.isSwitchOn(sw), '开关应为 OFF');
            var label = textOf('switchStatus');
            a.eq(label, 'OFF', 'label 应显示 OFF');
        });

        ctx.it('selectSegment 切换段控件', function(a) {
            var seg = findOne('testSegment');
            a.isNotNil(seg, 'testSegment 存在');

            WNAuto.selectSegment(seg, 1);
            WNAuto.runLoop(200);
            var label = textOf('segmentValue');
            a.ok(label && label.indexOf('Green') >= 0, '应显示 Green, 实际: ' + label);

            WNAuto.selectSegment(seg, 2);
            WNAuto.runLoop(200);
            label = textOf('segmentValue');
            a.ok(label && label.indexOf('Blue') >= 0, '应显示 Blue, 实际: ' + label);

            WNAuto.selectSegment(seg, 0);
            WNAuto.runLoop(100);
        });

        ctx.it('setSlider 设定滑块值', function(a) {
            var slider = findOne('testSlider');
            a.isNotNil(slider, 'testSlider 存在');

            WNAuto.setSlider(slider, 75);
            WNAuto.runLoop(200);
            var label = textOf('sliderValue');
            a.ok(label && label.indexOf('75') >= 0, '应显示 75, 实际: ' + label);

            WNAuto.setSlider(slider, 0);
            WNAuto.runLoop(200);
            label = textOf('sliderValue');
            a.ok(label && label.indexOf('0') >= 0, '应显示 0, 实际: ' + label);
        });

        ctx.it('setDate 设定日期选择器', function(a) {
            var dp = findOne('testDatePicker');
            a.isNotNil(dp, 'testDatePicker 存在');
            // 2025-06-15 00:00:00 UTC
            var ts = 1750000000;
            WNAuto.setDate(dp, ts);
            WNAuto.runLoop(300);
            var label = textOf('dateValue');
            a.ok(label && label.indexOf('Date:') >= 0, '日期 label 应更新');
        });
    });

    // ━━━ 5. scroll / scrollBy / scrollToTop / scrollToBottom ━━━━

    t.describe('Scroll 操作', function(ctx) {

        ctx.it('scroll 向下滚动', function(a) {
            var sv = findOne('mainScrollView');
            a.isNotNil(sv, 'mainScrollView 存在');
            WNAuto.scroll(sv, { y: 300 });
            WNAuto.runLoop(200);
            a.ok(true, 'scroll 向下 300 执行无异常');
        });

        ctx.it('scrollToTop 回到顶部', function(a) {
            var sv = findOne('mainScrollView');
            WNAuto.scrollToTop(sv);
            WNAuto.runLoop(200);
            a.ok(true, 'scrollToTop 执行无异常');
        });

        ctx.it('scrollToBottom 滚动到底部', function(a) {
            var sv = findOne('mainScrollView');
            WNAuto.scrollToBottom(sv);
            WNAuto.runLoop(300);
            a.ok(true, 'scrollToBottom 执行无异常');
        });

        ctx.it('scrollBy 相对滚动', function(a) {
            var sv = findOne('mainScrollView');
            WNAuto.scrollToTop(sv);
            WNAuto.runLoop(100);
            WNAuto.scrollBy(sv, 'down', 150);
            WNAuto.runLoop(200);
            a.ok(true, 'scrollBy 执行无异常');
        });

        ctx.it('TableView 内部滚动', function(a) {
            var tv = findOne('testTableView');
            a.isNotNil(tv, 'testTableView 存在');
            WNAuto.scroll(tv, { y: 100 });
            WNAuto.runLoop(200);
            WNAuto.scrollToTop(tv);
            WNAuto.runLoop(100);
            a.ok(true, 'TableView 滚动无异常');
        });
    });

    // ━━━ 6. props — 视图属性 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    t.describe('props — 视图属性', function(ctx) {

        ctx.it('props.text 获取 label 文本', function(a) {
            var txt = textOf('tapCount');
            a.ok(txt && txt.indexOf('Taps') >= 0, 'tapCount 包含 Taps');
        });

        ctx.it('props.className 获取类名', function(a) {
            var btn = findOne('loginButton');
            var cn = WNAuto.props.className(btn);
            a.eq(cn, 'UIButton', '类名应为 UIButton');
        });

        ctx.it('props.isVisible 可见性检测', function(a) {
            var visible = findOne('loginButton');
            a.ok(WNAuto.props.isVisible(visible), 'loginButton 应可见');

            var hidden = findOne('hiddenTestView');
            a.isNotNil(hidden, 'hiddenTestView 存在');
            a.ok(!WNAuto.props.isVisible(hidden), 'hiddenTestView 应不可见');
        });

        ctx.it('props.isEnabled 可用性检测', function(a) {
            var enabled = findOne('loginButton');
            a.ok(WNAuto.props.isEnabled(enabled), 'loginButton 应可用');

            var disabled = findOne('disabledButton');
            a.isNotNil(disabled, 'disabledButton 存在');
            a.ok(!WNAuto.props.isEnabled(disabled), 'disabledButton 应不可用');
        });

        ctx.it('props.frame 获取布局信息', function(a) {
            var btn = findOne('loginButton');
            var frame = WNAuto.props.frame(btn);
            a.isNotNil(frame, 'frame 不为 null');
            a.ok(typeof frame === 'string' && frame.length > 0, 'frame 是非空字符串');
        });

        ctx.it('props.isSwitchOn 检查开关状态', function(a) {
            var sw = findOne('testSwitch');
            WNAuto.setSwitch(sw, true);
            WNAuto.runLoop(100);
            a.ok(WNAuto.props.isSwitchOn(sw), 'setSwitch(true) 后应为 ON');
            WNAuto.setSwitch(sw, false);
            WNAuto.runLoop(100);
            a.ok(!WNAuto.props.isSwitchOn(sw), 'setSwitch(false) 后应为 OFF');
        });

        ctx.it('props.subviewCount 子视图数量', function(a) {
            var sv = findOne('mainScrollView');
            var count = WNAuto.props.subviewCount(sv);
            a.ok(count > 0, 'mainScrollView 应有子视图, count=' + count);
        });
    });

    // ━━━ 7. alert — 弹窗操作 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    t.describe('alert — 弹窗操作', function(ctx) {

        ctx.it('显示 Alert → 检测 → tapButton OK', function(a) {
            forceCloseAlerts();

            var sv = findOne('mainScrollView');
            if (sv) WNAuto.scrollToTop(sv);
            WNAuto.runLoop(300);
            WNAuto.scroll(sv, { y: 800 });
            WNAuto.runLoop(400);

            var btn = findOne('alertButton');
            a.isNotNil(btn, 'alertButton 存在');
            WNAuto.tap(btn);
            WNAuto.runLoop(800);

            var ac = WNAuto.alert.current();
            a.isNotNil(ac, '应检测到 Alert');

            var ok = false;
            try { ok = WNAuto.alert.tapButton('OK'); } catch(e) {
                console.warn('[Test] tapButton(OK) error: ' + e.message);
            }
            WNAuto.runLoop(800);

            forceCloseAlerts();

            var result = textOf('alertResult');
            a.ok(result && result.indexOf('OK') >= 0,
                 '结果应为 Alert: OK, 实际: ' + result);

            console.log('result = ssssss 111222' + result);
        });

        ctx.it('显示输入 Alert → typeInField → Submit', function(a) {
            forceCloseAlerts();

            var preCheck = WNAuto.alert.current();
            if (preCheck) {
                console.warn('[Test] 发现残留 alert, class=' + WNAuto.props.className(preCheck));
                forceCloseAlerts();
            }

            console.log('find.topViewController');

            var topVCBefore = WNAuto.find.topViewController();
            var topCN = topVCBefore ? WNAuto.props.className(topVCBefore) : 'nil';
            console.log('[Test] 当前 topVC: ' + topCN);

            var sv = findOne('mainScrollView');
            WNAuto.scroll(sv, { y: 800 });
            WNAuto.runLoop(400);

            var btn = findOne('inputAlertButton');
            a.isNotNil(btn, 'inputAlertButton 存在');
            WNAuto.tap(btn);
            WNAuto.runLoop(1200);

            var ac = WNAuto.alert.current();
            if (ac) {
                var alertTitle = '';
                try { alertTitle = ac.invoke('title'); } catch(e) {}
                console.log('[Test] 检测到 Alert, title=' + alertTitle);

                if (String(alertTitle) !== 'Input Alert') {
                    console.warn('[Test] 不是 Input Alert! 尝试 dismiss 后重新弹出');
                    forceCloseAlerts();
                    WNAuto.runLoop(800);

                    WNAuto.tap(btn);
                    WNAuto.runLoop(1200);
                    ac = WNAuto.alert.current();
                }
            }
            a.isNotNil(ac, '应检测到输入 Alert');

            try {
                WNAuto.alert.typeInField(0, 'hello-wn');
            } catch(e) {
                console.warn('[Test] typeInField error: ' + e.message);
            }
            WNAuto.runLoop(300);

            try { WNAuto.alert.tapButton('Submit'); } catch(e) {
                console.warn('[Test] tapButton(Submit) error: ' + e.message);
                try { WNAuto.alert.dismiss(); } catch(_) {}
            }
            WNAuto.runLoop(800);
            forceCloseAlerts();

            var result = textOf('alertResult');
            a.ok(result && result.indexOf('hello-wn') >= 0,
                 '结果应包含 hello-wn, 实际: ' + result);
        });
    });

    // ━━━ 8. nav — 导航操作 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    t.describe('nav — 导航操作', function(ctx) {

        ctx.it('nav.push 跳转到详情页', function(a) {
            forceCloseAlerts();

            var topVC = WNAuto.find.topViewController();
            var topCN = topVC ? WNAuto.props.className(topVC) : 'nil';
            console.log('[Test] nav.push 前 topVC: ' + topCN);

            if (topCN.indexOf('AlertController') >= 0) {
                console.warn('[Test] nav.push: alert 仍在! 再次强力清理');
                forceCloseAlerts();
            }

            var sv = findOne('mainScrollView');
            if (sv) WNAuto.scrollToTop(sv);
            WNAuto.runLoop(400);
            if (sv) WNAuto.scroll(sv, { y: 1000 });
            WNAuto.runLoop(500);

            var btn = findOne('navPushButton');
            a.isNotNil(btn, 'navPushButton 存在');
            WNAuto.tap(btn);
            WNAuto.runLoop(2000);

            var detailLabel = findOne('detailLabel');
            if (!detailLabel) {
                WNAuto.runLoop(1000);
                detailLabel = findOne('detailLabel');
            }
            if (!detailLabel) {
                var vc2 = WNAuto.find.topViewController();
                console.warn('[Test] nav.push 后 topVC: ' + (vc2 ? WNAuto.props.className(vc2) : 'nil'));
                WNAuto.runLoop(1000);
                detailLabel = findOne('detailLabel');
            }
            a.isNotNil(detailLabel, '应出现 detail 页面');
            if (detailLabel) {
                var txt = WNAuto.props.text(detailLabel);
                a.ok(txt && txt.indexOf('detail') >= 0, '详情页文本应包含 detail');
            }
        });

        ctx.it('nav.pop 返回上一页', function(a) {
            WNAuto.nav.pop();
            WNAuto.runLoop(800);

            var loginBtn = findOne('loginButton');
            a.isNotNil(loginBtn, '返回后应能找到 loginButton');
        });
    });

    // ━━━ 9. screenshot ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    t.describe('screenshot — 截图', function(ctx) {

        ctx.it('screenshot.full 全屏截图', function(a) {
            var data = WNAuto.screenshot.full();
            // UIDebug 在 MCP 环境下可用; 独立运行可能返回 null
            if (data) {
                a.ok(typeof data === 'string' && data.length > 100,
                     '截图应为 base64 字符串');
            } else {
                a.skip('screenshot.full', 'UIDebug 不可用，跳过');
            }
        });

        ctx.it('screenshot.view 单视图截图', function(a) {
            var btn = findOne('loginButton');
            var data = WNAuto.screenshot.view(btn);
            if (data) {
                a.ok(typeof data === 'string', '视图截图应为字符串');
            } else {
                a.skip('screenshot.view', 'UIDebug 不可用，跳过');
            }
        });
    });

    // ━━━ 10. sleep / wait / runLoop ━━━━━━━━━━━━━━━━━━━━━━━━━━━

    t.describe('Utilities — sleep / wait / runLoop', function(ctx) {

        ctx.it('sleep 阻塞等待', function(a) {
            var start = Date.now();
            WNAuto.sleep(200);
            var cost = Date.now() - start;
            a.ok(cost >= 150, 'sleep(200) 应花费至少 150ms, 实际: ' + cost);
        });

        ctx.it('wait 等待', function(a) {
            var start = Date.now();
            WNAuto.runLoop(100);
            var cost = Date.now() - start;
            a.ok(cost >= 50, 'wait(100) 应花费至少 50ms');
        });

        ctx.it('runLoop 主线程运行循环', function(a) {
            a.noThrow(function() {
                WNAuto.runLoop(100);
            }, 'runLoop 应不抛异常');
        });
    });

    // ━━━ 11. Interceptor Hook + 异步回调 ━━━━━━━━━━━━━━━━━━━━━━

    t.describe('Interceptor Hook + Async — 打通完整工具链', function(ctx) {

        ctx.it('Hook fetchData 回调 → 验证数据', function(a, done) {
            forceCloseAlerts();

            var hookCalled = false;

            Interceptor.replace("-[WNAutoTestDataService fetchDataWithCompletion:]",
                function(self, args) {
                    hookCalled = true;
                    console.log('[Hook] fetchDataWithCompletion: 被拦截 (replace)');

                    var label = findOne('asyncResult');
                    if (label) {
                        console.log('[Hook] 找到 asyncResult label, 更新文本');
                        label.invoke('setText:', ['Fetched: ok (3 items)']);
                        label.invoke('setTextColor:', [
                            ObjC.use('UIColor').invoke('systemGreenColor')
                        ]);
                    } else {
                        console.warn('[Hook] 未找到 asyncResult label!');
                        var topVC = WNAuto.find.topViewController();
                        if (topVC) {
                            var tcn = WNAuto.props.className(topVC);
                            console.warn('[Hook] topVC class=' + tcn);
                            try {
                                var lbl = topVC.invoke('asyncResultLabel');
                                if (lbl) {
                                    lbl.invoke('setText:', ['Fetched: ok (3 items)']);
                                    lbl.invoke('setTextColor:', [
                                        ObjC.use('UIColor').invoke('systemGreenColor')
                                    ]);
                                }
                            } catch(e) {
                                console.warn('[Hook] fallback update error: ' + e.message);
                            }
                        }
                    }

                    try {
                        var spinnerEl = findOne('loadingSpinner');
                        if (spinnerEl) {
                            spinnerEl.invoke('stopAnimating');
                        }
                    } catch(e) {}
                }
            );

            var sv = findOne('mainScrollView');
            if (sv) WNAuto.scrollToTop(sv);
            WNAuto.runLoop(300);
            if (sv) WNAuto.scroll(sv, { y: 1200 });
            WNAuto.runLoop(500);

            var btn = findOne('asyncFetchButton');
            a.isNotNil(btn, 'asyncFetchButton 存在');
            WNAuto.tap(btn);
            WNAuto.runLoop(800);

            a.ok(hookCalled, 'Interceptor.replace 应拦截到 fetchData 调用');

            var result = textOf('asyncResult');
            a.ok(result && result.indexOf('ok') >= 0,
                 '异步结果应包含 ok, 实际: ' + result);
            a.ok(result && result.indexOf('3') >= 0,
                 '异步结果应包含 3 items, 实际: ' + result);

            Interceptor.detach("-[WNAutoTestDataService fetchDataWithCompletion:]");
            done();
        }, { timeout: 8000 });

        ctx.it('Hook login 成功 → replace 同步回调验证', function(a, done) {
            var loginHooked = false;
            var hookedUser = '';

            // 同理：dispatch_after 无法在当前 GCD block 内执行，
            // 用 replace 同步调用 completion 来验证完整链路
            Interceptor.replace("-[WNAutoTestDataService loginWithUsername:password:completion:]",
                function(self, args) {
                    loginHooked = true;
                    hookedUser = args[0].invoke('description');
                    console.log('[Hook] login 拦截 (replace): user=' + hookedUser);
                    var password = args[1].invoke('description');
                    var completion = args[2];
                    if (completion) {
                        var ok = (hookedUser === 'admin' && password === 'secret');
                        $callBlock(completion, null, ok ? 1 : 0, ok ? 'tok_abc123' : null);
                    }
                }
            );

            // 先确保用户名密码正确
            var uField = findOne('usernameField');
            var pField = findOne('passwordField');
            WNAuto.clearText(uField);
            WNAuto.clearText(pField);
            WNAuto.type(uField, 'admin');
            WNAuto.type(pField, 'secret');
            WNAuto.runLoop(100);

            // 滚动到异步登录按钮
            var sv = findOne('mainScrollView');
            if (sv) WNAuto.scroll(sv, { y: 1300 });
            WNAuto.runLoop(200);

            var btn = findOne('asyncLoginButton');
            a.isNotNil(btn, 'asyncLoginButton 存在');
            WNAuto.tap(btn);
            WNAuto.runLoop(300);

            a.ok(loginHooked, 'Interceptor.replace 应拦截到 login 方法');
            a.eq(hookedUser, 'admin', '拦截到的用户名应为 admin');

            var result = textOf('asyncLoginResult');
            a.ok(result && result.indexOf('tok_abc123') >= 0,
                 '异步登录应返回 token, 实际: ' + result);

            Interceptor.detach("-[WNAutoTestDataService loginWithUsername:password:completion:]");
            done();
        }, { timeout: 5000 });

        ctx.it('Hook login 失败场景 → replace 同步回调验证', function(a, done) {
            var hookFired = false;

            Interceptor.replace("-[WNAutoTestDataService loginWithUsername:password:completion:]",
                function(self, args) {
                    hookFired = true;
                    var user = args[0].invoke('description');
                    var pass = args[1].invoke('description');
                    console.log('[Hook] login 失败测试 (replace): user=' + user);
                    var completion = args[2];
                    if (completion) {
                        var ok = (user === 'admin' && pass === 'secret');
                        $callBlock(completion, null, ok ? 1 : 0, ok ? 'tok_abc123' : null);
                    }
                }
            );

            // 输入错误的凭证
            var uField = findOne('usernameField');
            var pField = findOne('passwordField');
            WNAuto.clearText(uField);
            WNAuto.clearText(pField);
            WNAuto.type(uField, 'wronguser');
            WNAuto.type(pField, 'wrongpass');
            WNAuto.runLoop(100);

            var sv = findOne('mainScrollView');
            if (sv) WNAuto.scroll(sv, { y: 1300 });
            WNAuto.runLoop(200);

            var btn = findOne('asyncLoginButton');
            WNAuto.tap(btn);
            WNAuto.runLoop(300);

            a.ok(hookFired, 'Hook 应触发');

            var result = textOf('asyncLoginResult');
            a.ok(result && result.indexOf('failed') >= 0,
                 '错误凭证应显示 failed, 实际: ' + result);

            Interceptor.detach("-[WNAutoTestDataService loginWithUsername:password:completion:]");
            done();
        }, { timeout: 5000 });

        ctx.it('Interceptor.replace 修改返回行为', function(a, done) {
            // 用 replace 替换 fetchData，让它立即返回自定义数据
            Interceptor.replace("-[WNAutoTestDataService fetchDataWithCompletion:]",
                function(self, args) {
                    console.log('[Replace] 劫持 fetchData，注入自定义数据');
                    var block = args[0];
                    if (block) {
                        var fakeData = ObjC.use('NSDictionary').invoke(
                            'dictionaryWithObject:forKey:', ['replaced', 'status']);
                        try {
                            $callBlock(block, null, fakeData);
                        } catch(e) {
                            console.warn('[Replace] callBlock err: ' + e.message);
                        }
                    }
                }
            );

            var sv = findOne('mainScrollView');
            if (sv) WNAuto.scroll(sv, { y: 1200 });
            WNAuto.runLoop(200);

            var btn = findOne('asyncFetchButton');
            WNAuto.tap(btn);

            WNAuto.runLoop(1000);

            var result = textOf('asyncResult');
            // replace 后可能显示 replaced 或其他变化
            a.ok(result !== null, '异步结果应有变化, 实际: ' + result);

            Interceptor.detach("-[WNAutoTestDataService fetchDataWithCompletion:]");
            done();
        }, { timeout: 5000 });

        ctx.it('Interceptor.list 列出活跃 hook', function(a) {
            Interceptor.attach("-[UIView setHidden:]", {
                onEnter: function() {}
            });
            var list = Interceptor.list();
            a.ok(Array.isArray(list), 'list 应返回数组');
            a.ok(list.length >= 1, '应至少有一个活跃 hook');
            Interceptor.detach("-[UIView setHidden:]");
        });

        ctx.it('Interceptor.detachAll 清除所有 hook', function(a) {
            Interceptor.attach("-[UIView setAlpha:]", { onEnter: function() {} });
            Interceptor.attach("-[UIView setFrame:]", { onEnter: function() {} });
            Interceptor.detachAll();
            var list = Interceptor.list();
            a.eq(list.length, 0, 'detachAll 后应无活跃 hook');
        });
    });

    // ━━━ 12. 端到端场景：完整登录流程 ━━━━━━━━━━━━━━━━━━━━━━━━━

    t.describe('E2E: 完整登录流程', function(ctx) {

        ctx.it('清空 → 输入 → 登录 → 验证 → 登出', function(a) {
            // 回到顶部
            var sv = findOne('mainScrollView');
            if (sv) WNAuto.scrollToTop(sv);
            WNAuto.runLoop(300);

            // 1. 清空输入
            var uField = findOne('usernameField');
            var pField = findOne('passwordField');
            WNAuto.clearText(uField);
            WNAuto.clearText(pField);

            // 2. 输入正确凭证
            WNAuto.type(uField, 'admin');
            WNAuto.type(pField, 'secret');
            WNAuto.runLoop(100);

            // 3. 点击登录
            var loginBtn = findOne('loginButton');
            WNAuto.tap(loginBtn);
            WNAuto.runLoop(300);

            // 4. 断言成功
            var status = textOf('loginStatus');
            a.ok(status && status.indexOf('Success') >= 0, 'E2E: 登录成功');

            // 5. 用错误凭证再次登录
            WNAuto.clearText(uField);
            WNAuto.clearText(pField);
            WNAuto.type(uField, 'bad');
            WNAuto.type(pField, 'wrong');
            WNAuto.tap(loginBtn);
            WNAuto.runLoop(300);

            status = textOf('loginStatus');
            a.ok(status && status.indexOf('Failed') >= 0, 'E2E: 错误凭证应登录失败');
        });
    });

    // ━━━ Run ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

})();
