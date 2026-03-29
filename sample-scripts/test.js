// WhiteNeedle Test Suite
// Generic test cases for any iOS app

// ═══════════════════════════════════════════════════════════════
// Test 1: List app-specific classes by prefix
// ═══════════════════════════════════════════════════════════════

(function testListAppClasses() {
    var prefixes = ['UI', 'NS', 'CA'];
    for (var p = 0; p < prefixes.length; p++) {
        var names = ObjC.getClassNames(prefixes[p]);
        console.log('[Test1] ' + prefixes[p] + '* classes: ' + names.length);
        for (var i = 0; i < Math.min(names.length, 8); i++) {
            console.log('  → ' + names[i]);
        }
        if (names.length > 8) console.log('  ... and ' + (names.length - 8) + ' more');
    }
})();

// ═══════════════════════════════════════════════════════════════
// Test 2: Change navigation bar color
// ═══════════════════════════════════════════════════════════════

(function testChangeNavBarColor() {
    var app = ObjC.use('UIApplication').invoke('sharedApplication');
    var windows = app.invoke('windows');
    var count = windows.invoke('count');

    var found = 0;
    for (var i = 0; i < count; i++) {
        var win = windows.invoke('objectAtIndex:', [i]);
        findAndColorNavBars(win);
    }

    function findAndColorNavBars(view) {
        var cls = view.className();
        if (cls === 'UINavigationBar') {
            var red = ObjC.use('UIColor').invoke('colorWithRed:green:blue:alpha:', [1.0, 0.2, 0.2, 1.0]);
            view.invoke('setBarTintColor:', [red]);
            view.invoke('setTranslucent:', [false]);
            found++;
            console.log('[Test2] NavBar colored red! (' + found + ')');
        }
        var subs = view.invoke('subviews');
        var c = subs.invoke('count');
        for (var j = 0; j < c; j++) {
            findAndColorNavBars(subs.invoke('objectAtIndex:', [j]));
        }
    }

    if (found === 0) console.log('[Test2] No UINavigationBar found on screen');
})();

// ═══════════════════════════════════════════════════════════════
// Test 3: Modify all UILabel text on screen
// ═══════════════════════════════════════════════════════════════

(function testChangeLabels() {
    var app = ObjC.use('UIApplication').invoke('sharedApplication');
    var windows = app.invoke('windows');
    var count = windows.invoke('count');
    var modified = 0;

    for (var i = 0; i < count; i++) {
        var win = windows.invoke('objectAtIndex:', [i]);
        walkAndChangeLabels(win);
    }

    function walkAndChangeLabels(view) {
        var cls = view.className();
        if (cls === 'UILabel' || cls.indexOf('Label') !== -1) {
            try {
                var text = view.invoke('text');
                if (text && text.toString && text.toString() !== 'null' && text.toString().length > 0) {
                    var original = text.toString();
                    view.invoke('setText:', ['🔥 ' + original]);
                    modified++;
                    if (modified <= 5) {
                        console.log('[Test3] Label: "' + original + '" → "🔥 ' + original + '"');
                    }
                }
            } catch (e) {}
        }
        var subs = view.invoke('subviews');
        var c = subs.invoke('count');
        for (var j = 0; j < c; j++) {
            walkAndChangeLabels(subs.invoke('objectAtIndex:', [j]));
        }
    }

    console.log('[Test3] Modified ' + modified + ' labels');
})();

// ═══════════════════════════════════════════════════════════════
// Test 4: Show Alert — Hook viewDidAppear: to present alert on next page
// ═══════════════════════════════════════════════════════════════

(function testAlertOnViewAppear() {
    Interceptor.attach('-[UIViewController viewDidAppear:]', {
        onEnter: function(self, sel, args) {
            try {
                var vcName = self.className();
                console.log('[Test4] viewDidAppear: ' + vcName);

                Interceptor.detach('-[UIViewController viewDidAppear:]');

                var alertCls = ObjC.use('UIAlertController');
                var alert = alertCls.invoke(
                    'alertControllerWithTitle:message:preferredStyle:',
                    ['WhiteNeedle 🪡', 'Hook success! Current page: ' + vcName, 1]
                );

                var actionCls = ObjC.use('UIAlertAction');
                var okAction = actionCls.invoke(
                    'actionWithTitle:style:handler:',
                    ['OK', 0, null]
                );
                alert.invoke('addAction:', [okAction]);

                self.invoke('presentViewController:animated:completion:', [alert, true, null]);
                console.log('[Test4] Alert presented on ' + vcName);
            } catch (e) {
                console.log('[Test4] Error in hook: ' + e);
            }
        }
    });
    console.log('[Test4] Hook installed — navigate to a new page to trigger alert');
})();

// ═══════════════════════════════════════════════════════════════
// Test 5: Network monitor — Hook NSURLSession (DISABLED by default)
// ═══════════════════════════════════════════════════════════════

// ⚠️ Disabled: NSURLSession hooks may crash under high concurrency
// Uncomment to enable
/*
(function testNetworkMonitor() {
    Interceptor.attach('-[NSURLSession dataTaskWithRequest:completionHandler:]', {
        onEnter: function(self, sel, args) {
            try {
                if (!args || !args[0]) return;
                var request = ObjC.instance(args[0]);
                var url = request.invoke('URL');
                if (!url) return;
                var urlStr = url.invoke('absoluteString').toString();
                var method = request.invoke('HTTPMethod').toString();
                console.log('[Test5:Net] ' + method + ' ' + urlStr);
            } catch (e) {}
        }
    });

    Interceptor.attach('-[NSURLSession dataTaskWithURL:completionHandler:]', {
        onEnter: function(self, sel, args) {
            try {
                if (!args || !args[0]) return;
                var url = ObjC.instance(args[0]);
                console.log('[Test5:Net] GET ' + url.invoke('absoluteString').toString());
            } catch (e) {}
        }
    });

    console.log('[Test5] Network monitor active');
})();
*/
console.log('[Test5] Network monitor DISABLED (uncomment in test.js to enable)');

// ═══════════════════════════════════════════════════════════════
// Test 6: Modify buttons — change title and background color
// ═══════════════════════════════════════════════════════════════

(function testModifyButtons() {
    var app = ObjC.use('UIApplication').invoke('sharedApplication');
    var windows = app.invoke('windows');
    var count = windows.invoke('count');
    var modified = 0;

    for (var i = 0; i < count; i++) {
        walkButtons(windows.invoke('objectAtIndex:', [i]));
    }

    function walkButtons(view) {
        var cls = view.className();
        if (cls === 'UIButton' || cls.indexOf('Button') !== -1) {
            try {
                var title = view.invoke('titleForState:', [0]);
                if (title && title.toString && title.toString() !== 'null' && title.toString().length > 0) {
                    var original = title.toString();
                    view.invoke('setTitle:forState:', ['⚡ ' + original, 0]);
                    var cyan = ObjC.use('UIColor').invoke('cyanColor');
                    view.invoke('setBackgroundColor:', [cyan]);
                    modified++;
                    if (modified <= 5) {
                        console.log('[Test6] Button: "' + original + '" → "⚡ ' + original + '"');
                    }
                }
            } catch (e) {}
        }
        var subs = view.invoke('subviews');
        var c = subs.invoke('count');
        for (var j = 0; j < c; j++) {
            walkButtons(subs.invoke('objectAtIndex:', [j]));
        }
    }

    console.log('[Test6] Modified ' + modified + ' buttons');
})();

// ═══════════════════════════════════════════════════════════════
// Test 7: Add gold border to root view
// ═══════════════════════════════════════════════════════════════

(function testColorBorder() {
    var app = ObjC.use('UIApplication').invoke('sharedApplication');
    var windows = app.invoke('windows');
    var count = windows.invoke('count');

    var rootView = null;
    for (var i = 0; i < count; i++) {
        var win = windows.invoke('objectAtIndex:', [i]);
        var rootVC = win.invoke('rootViewController');
        if (rootVC && rootVC.invoke) {
            var v = rootVC.invoke('view');
            if (v && v.invoke) {
                rootView = v;
                break;
            }
        }
    }

    if (!rootView) {
        console.log('[Test7] No rootView found in any window');
        return;
    }

    var layer = rootView.invoke('layer');
    var gold = ObjC.use('UIColor').invoke('colorWithRed:green:blue:alpha:', [1.0, 0.84, 0.0, 1.0]);
    layer.invoke('setBorderColor:', [gold.invoke('CGColor')]);
    layer.invoke('setBorderWidth:', [6.0]);
    layer.invoke('setCornerRadius:', [16.0]);
    layer.invoke('setMasksToBounds:', [true]);

    console.log('[Test7] Root view now has a gold border!');
})();

// ═══════════════════════════════════════════════════════════════
// Test 8: Hook presentViewController — log all VC presentations
// ═══════════════════════════════════════════════════════════════

(function testHookAlerts() {
    Interceptor.attach('-[UIViewController presentViewController:animated:completion:]', {
        onEnter: function(self, sel, args) {
            try {
                if (!args || !args[0]) {
                    console.log('[Test8] presentVC called with nil argument');
                    return;
                }
                var presented = ObjC.instance(args[0]);
                if (!presented || !presented.className) {
                    console.log('[Test8] presentVC: invalid presented object');
                    return;
                }
                var cls = presented.className();
                var vcName = self.className();
                if (cls === 'UIAlertController' || cls.indexOf('Alert') !== -1) {
                    try {
                        var title = presented.invoke('title');
                        var msg = presented.invoke('message');
                        console.log('[Test8:Alert] title: "' +
                            (title ? title.toString() : '') + '", message: "' +
                            (msg ? msg.toString() : '') + '"');
                    } catch (e2) {
                        console.log('[Test8:Alert] ' + cls + ' (detail parse error)');
                    }
                }
                console.log('[Test8] present ' + cls + ' from ' + vcName);
            } catch (e) {
                console.log('[Test8] Hook error: ' + e);
            }
        }
    });
    console.log('[Test8] Alert interceptor active — all presentViewController calls logged');
})();

// ═══════════════════════════════════════════════════════════════
// Test 9: Print view controller hierarchy
// ═══════════════════════════════════════════════════════════════

(function testVCStack() {
    var app = ObjC.use('UIApplication').invoke('sharedApplication');
    var windows = app.invoke('windows');
    var count = windows.invoke('count');

    for (var i = 0; i < count; i++) {
        var win = windows.invoke('objectAtIndex:', [i]);
        var rootVC = win.invoke('rootViewController');
        if (rootVC) {
            console.log('[Test9] Window ' + i + ' VC hierarchy:');
            printVCTree(rootVC, 0);
        }
    }

    function printVCTree(vc, depth) {
        var indent = '';
        for (var d = 0; d < depth; d++) indent += '  ';
        var name = vc.className();
        var title = '';
        try {
            var t = vc.invoke('title');
            if (t && t.toString && t.toString() !== 'null') title = ' "' + t.toString() + '"';
        } catch(e) {}
        console.log('[Test9] ' + indent + '├─ ' + name + title);

        try {
            var children = vc.invoke('childViewControllers');
            var c = children.invoke('count');
            for (var j = 0; j < c; j++) {
                printVCTree(children.invoke('objectAtIndex:', [j]), depth + 1);
            }
        } catch(e) {}

        try {
            var presented = vc.invoke('presentedViewController');
            if (presented && presented.invoke) {
                var pName = presented.className();
                if (pName !== 'null') {
                    console.log('[Test9] ' + indent + '  ↳ presented: ' + pName);
                    printVCTree(presented, depth + 1);
                }
            }
        } catch(e) {}
    }
})();

// ═══════════════════════════════════════════════════════════════
// Test 10: List loaded dynamic libraries — find app-specific modules
// ═══════════════════════════════════════════════════════════════

(function testListModules() {
    var modules = Module.enumerateModules();
    var appModules = [];
    for (var i = 0; i < modules.length; i++) {
        var name = modules[i].name;
        if (name.indexOf('WhiteNeedle') !== -1 ||
            name.indexOf('.app/') !== -1) {
            appModules.push(name);
        }
    }
    console.log('[Test10] App-related modules: ' + appModules.length);
    for (var j = 0; j < appModules.length; j++) {
        var short = appModules[j].split('/').pop();
        console.log('  → ' + short);
    }
})();

// ═══════════════════════════════════════════════════════════════
// Test 11: Define a custom class at runtime using ObjC.define
// ═══════════════════════════════════════════════════════════════

(function testDefineClass() {
    var MyHelper = ObjC.define({
        name: 'WNTestHelper',
        super: 'NSObject',
        methods: {
            'greet:': function(self, args) {
                var name = args[0];
                console.log('[Test11] WNTestHelper.greet called with: ' + name);
                return 'Hello from WhiteNeedle, ' + name + '!';
            }
        }
    });

    if (MyHelper) {
        var instance = MyHelper.invoke('new');
        var result = instance.invoke('greet:', ['TargetApp']);
        console.log('[Test11] Result: ' + result);
    } else {
        console.log('[Test11] Failed to define class');
    }
})();

// ═══════════════════════════════════════════════════════════════
// Test 12: Read device and app info
// ═══════════════════════════════════════════════════════════════

(function testDeviceInfo() {
    var device = ObjC.use('UIDevice').invoke('currentDevice');
    console.log('[Test12] Device: ' + device.invoke('name'));
    console.log('[Test12] System: ' + device.invoke('systemName') + ' ' + device.invoke('systemVersion'));
    console.log('[Test12] Model: ' + device.invoke('model'));

    var bundle = ObjC.use('NSBundle').invoke('mainBundle');
    var info = bundle.invoke('infoDictionary');
    var appName = info.invoke('objectForKey:', ['CFBundleDisplayName']);
    var appVersion = info.invoke('objectForKey:', ['CFBundleShortVersionString']);
    var buildNum = info.invoke('objectForKey:', ['CFBundleVersion']);
    var bundleId = bundle.invoke('bundleIdentifier');

    console.log('[Test12] App: ' + (appName ? appName.toString() : 'N/A'));
    console.log('[Test12] Version: ' + (appVersion ? appVersion.toString() : '') +
                ' (' + (buildNum ? buildNum.toString() : '') + ')');
    console.log('[Test12] BundleID: ' + bundleId);
    console.log('[Test12] WhiteNeedle: v' + __wnVersion + ' (' + __wnEngine + ')');
})();

console.log('\n✅ All test cases loaded! Check output above for results.');
console.log('💡 Hook-based tests (4, 8) will produce output as you interact with the app.');
