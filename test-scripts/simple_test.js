(function() {
    'use strict';

    var WNTest = require('wn-test');
    var WNAuto = require('wn-auto');

    var t = WNTest.create('WNAuto Full Coverage');

    console.log('simple_test.js loaded 111222');

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

            var block = $block(function() {
                console.log('dismissViewControllerAnimated:completion:');
            }, 'void (^)(void)');
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

    console.log('simple_test.js loaded 333444');
    var block = $block(function() {
        console.log('dismissViewControllerAnimated:completion:');
    }, 'void (^)(void)');

    console.log('block = ' + block);


    var alertVC = WNAuto.find.topViewController();
    var actions = alertVC.invoke('actions');
    if (!actions) return;

    var count = actions.invoke('count');
    for (var i = 0; i < count; i++) {
        var action = actions.invoke('objectAtIndex:', [i]);
        var title = action.invoke('title');
        var handler = action.getProperty('handler');
        console.log('action = ' + action);
        console.log('title = ' + title);
        console.log('handler = ' + handler);
        if (title && String(title) === 'OK') {
            dispatch.main(function() {
                $callBlock(handler, 'void (^)(id)', action);
            });
            break;
        }
    }
    // var sv = findOne('mainScrollView');
    // if (sv) WNAuto.scrollToTop(sv);
    // WNAuto.runLoop(300);
    // WNAuto.scroll(sv, { y: 800 });
    // WNAuto.runLoop(400);

    // var btn = findOne('alertButton');
    // // a.isNotNil(btn, 'alertButton 存在');
    // WNAuto.tap(btn);
    // WNAuto.runLoop(800);

    // var ac = WNAuto.alert.current();
    // // a.isNotNil(ac, '应检测到 Alert');

    // var ok = false;
    // try { ok = WNAuto.alert.tapButton('OK'); } catch(e) {
    //     console.warn('[Test] tapButton(OK) error: ' + e.message);
    // }
    // WNAuto.runLoop(800);

    // forceCloseAlerts();

})();