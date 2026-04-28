/**
 * 验证 wn-auto.js 中 _isKindOfClass(proxy, 'UINavigationController') 与
 * 旧版「类名字符串包含 UINavigationController」的差异。
 *
 * 运行环境：WhiteNeedle 注入的 App（需 UIKit 前台窗口）。
 * 用法：VS Code / Cursor 推送执行本脚本，查看 Console 与 WNTest 报告。
 *
 * 期望（自定义导航子类如 BaseNavigationController）：
 *   - isKindOfClass(root, 'UINavigationController') === true
 *   - 类名字符串不一定包含子串 "UINavigationController"
 */
(function () {
    'use strict';

    var WNTest = require('wn-test');

    /** 与 ios-dylib/WhiteNeedle/BuiltinModules/wn-auto.js 中 _isKindOfClass 保持同步 */
    function isKindOfClass(proxy, className) {
        try {
            var cls = ObjC.use(className);
            if (!cls) return false;
            return !!proxy.invoke('isKindOfClass:', [cls]);
        } catch (e) {
            return false;
        }
    }

    function activeKeyWindow() {
        var UIApp = ObjC.use('UIApplication').invoke('sharedApplication');
        try {
            var scenes = UIApp.invoke('connectedScenes');
            if (scenes) {
                var allObjects = scenes.invoke('allObjects');
                var count = allObjects.invoke('count');
                for (var i = 0; i < count; i++) {
                    var scene = allObjects.invoke('objectAtIndex:', [i]);
                    var scn = scene.invoke('class').invoke('description');
                    if (scn.indexOf('UIWindowScene') >= 0) {
                        var windows = scene.invoke('windows');
                        var wCount = windows.invoke('count');
                        for (var j = 0; j < wCount; j++) {
                            var w = windows.invoke('objectAtIndex:', [j]);
                            if (w.invoke('isKeyWindow')) return w;
                        }
                    }
                }
            }
        } catch (e) { /* ignore */ }
        try {
            var kw = UIApp.invoke('keyWindow');
            if (kw) return kw;
        } catch (e2) { /* ignore */ }
        return null;
    }

    var t = WNTest.create('WNAuto _isKindOfClass 校验');

    t.describe('ObjC.use + isKindOfClass:', function (ctx) {
        ctx.it('UINavigationController / UIViewController 类对象可被 ObjC.use', function (assert) {
            var NavCls = ObjC.use('UINavigationController');
            var VcCls = ObjC.use('UIViewController');
            assert.isNotNil(NavCls, 'ObjC.use(UINavigationController)');
            assert.isNotNil(VcCls, 'ObjC.use(UIViewController)');
        });

        ctx.it('根 VC：isKindOfClass 与「字符串包含 UINavigationController」对比', function (assert) {
            var keyWin = activeKeyWindow();
            assert.isNotNil(keyWin, 'keyWindow');
            var root = keyWin.invoke('rootViewController');
            assert.isNotNil(root, 'rootViewController');

            var cn = String(root.invoke('class').invoke('description'));
            var legacyNav = cn.indexOf('UINavigationController') >= 0;
            var kindNav = isKindOfClass(root, 'UINavigationController');
            var kindVC = isKindOfClass(root, 'UIViewController');

            console.log('[isKindTest] root class            = ' + cn);
            console.log('[isKindTest] legacyStringNav       = ' + legacyNav);
            console.log('[isKindTest] isKindOfClass Nav     = ' + kindNav);
            console.log('[isKindTest] isKindOfClass UIViewController = ' + kindVC);

            assert.ok(kindVC, '根 VC 应是 UIViewController 子类');

            if (kindNav && !legacyNav) {
                console.log(
                    '[isKindTest] ✓ 自定义 UINavigationController 子类：isKindOfClass 为 true，字符串不含 UINavigationController（wn-auto 应用 isKindOfClass 修复的理由）'
                );
            }

            if (kindNav) {
                var top = root.invoke('topViewController');
                assert.isNotNil(top, 'UINavigationController 应有 topViewController');
                console.log('[isKindTest] topViewController class = ' + String(top.invoke('class').invoke('description')));
            }
        });

        ctx.it('TabBar：若为 UITabBarController 则检查 selected', function (assert) {
            var keyWin = activeKeyWindow();
            if (!keyWin) {
                assert.ok(true, 'skip');
                return;
            }
            var root = keyWin.invoke('rootViewController');
            if (!root) {
                assert.ok(true, 'skip');
                return;
            }
            var kindTab = isKindOfClass(root, 'UITabBarController');
            console.log('[isKindTest] isKindOfClass UITabBarController = ' + kindTab);
            if (kindTab) {
                var sel = root.invoke('selectedViewController');
                assert.isNotNil(sel, 'TabBar 应有 selectedViewController');
                console.log('[isKindTest] selectedViewController class = ' + String(sel.invoke('class').invoke('description')));
            }
            assert.ok(true, 'done');
        });
    });

    t.run(function (report) {
        if (typeof console !== 'undefined' && console.log) {
            console.log('[isKindTest] RESULT_JSON ' + JSON.stringify(report));
        }
    });
})();
