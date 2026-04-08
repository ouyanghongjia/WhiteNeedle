/**
 * WhiteNeedle Snippet Library Reliability Test
 *
 * 验证 snippetLibrary.ts 中所有内置代码片段的 API 调用是否可靠。
 * 每个片段的核心逻辑都会被提取并验证：
 *   - 所依赖的全局 API 存在且可调用
 *   - 关键调用不会崩溃
 *   - 返回值类型和结构符合预期
 *
 * 运行方式: 在 WhiteNeedleExample App 中选择此脚本运行
 * 输出: 结构化 PASS/FAIL + JSON 摘要 [RESULT_JSON]
 */
(function() {
    var _r = [], _suite = 'snippet_library';
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
        safe: function(fn, n) { try { fn(); _log('PASS', n); } catch(e) { _log('FAIL', n, '' + (e.message || e)); } },
        skip: function(n, reason) { _log('SKIP', n, reason); },
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
    console.log('║  Snippet Library Reliability Test     ║');
    console.log('╚══════════════════════════════════════╝');

    // helper reused by multiple snippets
    function s(v) { return v ? v.toString() : '?'; }

    // ═══════════════════════════════════════════════════════════════
    // HOOK SNIPPETS
    // ═══════════════════════════════════════════════════════════════

    // [hook-method-basic] Hook ObjC Method
    T.suite('hook-method-basic: Hook ObjC Method');
    T.safe(function() {
        T.type(Interceptor, 'object', 'Interceptor exists');
        T.type(Interceptor.attach, 'function', 'Interceptor.attach is function');
        T.type(Interceptor.detach, 'function', 'Interceptor.detach is function');
    }, 'Interceptor API available');

    T.safe(function() {
        Interceptor.attach('-[NSObject description]', {
            onEnter: function(self, sel, args) {},
            onLeave: function(retval) {}
        });
        Interceptor.detach('-[NSObject description]');
    }, 'hook-method-basic: attach + detach no crash');

    // [hook-replace-retval] Replace Return Value
    T.suite('hook-replace-retval: Replace Return Value');
    T.safe(function() {
        Interceptor.attach('-[NSObject isEqual:]', {
            onLeave: function(retval) {
                // snippet uses retval.replace() — we just test the callback fires
            }
        });
        Interceptor.detach('-[NSObject isEqual:]');
    }, 'hook-replace-retval: onLeave callback no crash');

    // [hook-viewdidload] Track ViewController Lifecycle
    T.suite('hook-viewdidload: Track ViewController Lifecycle');
    T.safe(function() {
        var sels = ['viewDidLoad', 'viewWillAppear:', 'viewDidAppear:', 'viewWillDisappear:'];
        sels.forEach(function(sel) {
            Interceptor.attach('-[UIViewController ' + sel + ']', {
                onEnter: function(self) {
                    // snippet calls self.invoke("class")
                }
            });
        });
        sels.forEach(function(sel) {
            Interceptor.detach('-[UIViewController ' + sel + ']');
        });
    }, 'hook-viewdidload: hook 4 lifecycle methods no crash');

    // [hook-all-methods] Trace All Methods of a Class
    T.suite('hook-all-methods: Trace All Methods of a Class');
    T.safe(function() {
        var cls = ObjC.use('NSBundle');
        T.ok(cls !== null && cls !== undefined, 'ObjC.use("NSBundle") returns object');
        var methods = cls.getMethods();
        T.ok(Array.isArray(methods), 'getMethods() returns array');
        T.gt(methods.length, 0, 'NSBundle has methods: ' + methods.length);

        if (methods.length > 0) {
            var first = methods[0];
            T.type(first, 'string', 'method entry is string');
            var selPart = first.split(' (')[0];
            T.ok(selPart.length > 0, 'can extract selector from method entry');
        }
    }, 'hook-all-methods: ObjC.use + getMethods no crash');

    // [hook-notifications] Monitor NSNotifications
    T.suite('hook-notifications: Monitor NSNotifications');
    T.safe(function() {
        Interceptor.attach('-[NSNotificationCenter postNotification:]', {
            onEnter: function(self, sel, args) {
                var notif = args[0];
                if (notif) {
                    var name = s(notif.invoke('name'));
                    var obj = notif.invoke('object');
                }
            }
        });
        Interceptor.detach('-[NSNotificationCenter postNotification:]');
    }, 'hook-notifications: hook + detach no crash');

    // [hook-user-interaction] Track Button Taps & Actions
    T.suite('hook-user-interaction: Track Button Taps & Actions');
    T.safe(function() {
        Interceptor.attach('-[UIApplication sendAction:to:from:forEvent:]', {
            onEnter: function(self, sel, args) {
                var action = args[0] ? args[0].toString() : '?';
                var from = args[2] ? (args[2].invoke('class') || '?') : '?';
            }
        });
        Interceptor.detach('-[UIApplication sendAction:to:from:forEvent:]');
    }, 'hook-user-interaction: hook sendAction no crash');

    // [hook-url-scheme] Monitor URL Opens & Deep Links
    T.suite('hook-url-scheme: Monitor URL Opens & Deep Links');
    T.safe(function() {
        Interceptor.attach('-[UIApplication openURL:]', {
            onEnter: function(self, sel, args) {
                var url = args[0] ? s(args[0].invoke('absoluteString')) : '?';
            }
        });
        Interceptor.detach('-[UIApplication openURL:]');
    }, 'hook-url-scheme: hook openURL no crash');

    T.safe(function() {
        Interceptor.attach('-[UIApplication openURL:options:completionHandler:]', {
            onEnter: function(self, sel, args) {}
        });
        Interceptor.detach('-[UIApplication openURL:options:completionHandler:]');
    }, 'hook-url-scheme: hook openURL:options: no crash');

    // ═══════════════════════════════════════════════════════════════
    // RUNTIME SNIPPETS
    // ═══════════════════════════════════════════════════════════════

    // [runtime-class-search] Search ObjC Classes
    T.suite('runtime-class-search: Search ObjC Classes');
    T.safe(function() {
        T.type(ObjC.getClassNames, 'function', 'ObjC.getClassNames is function');
        var matched = ObjC.getClassNames('ViewController');
        T.ok(Array.isArray(matched), 'getClassNames returns array');
        T.gt(matched.length, 0, 'found classes matching "ViewController": ' + matched.length);
    }, 'runtime-class-search: getClassNames no crash');

    // [runtime-dump-methods] Dump Class Methods
    T.suite('runtime-dump-methods: Dump Class Methods');
    T.safe(function() {
        var cls = ObjC.use('UIApplication');
        T.ok(cls, 'ObjC.use("UIApplication") returns object');
        var methods = cls.getMethods();
        T.ok(Array.isArray(methods), 'getMethods() returns array');
        T.gt(methods.length, 0, 'UIApplication has methods: ' + methods.length);
    }, 'runtime-dump-methods: dump UIApplication no crash');

    // [runtime-call-method] Call Class/Instance Method
    T.suite('runtime-call-method: Call Class/Instance Method');
    T.safe(function() {
        var instance = ObjC.use('UIApplication').invoke('sharedApplication');
        T.ok(instance, 'sharedApplication returns instance');
        var result = instance.invoke('delegate');
        T.ok(result !== undefined, 'delegate() returns something');
    }, 'runtime-call-method: invoke chain no crash');

    // [runtime-class-hierarchy] Print Class Hierarchy
    T.suite('runtime-class-hierarchy: Print Class Hierarchy');
    T.safe(function() {
        var chain = [];
        var name = 'UIButton';
        var maxIter = 20;
        while (name && name !== 'nil' && maxIter-- > 0) {
            chain.push(name);
            var cls = ObjC.use(name);
            if (!cls) break;
            var sc = cls.invoke('superclass');
            name = (sc && sc !== 'nil') ? sc.toString() : null;
        }
        T.gt(chain.length, 1, 'UIButton hierarchy has depth > 1: ' + chain.join(' > '));
        T.ok(chain.indexOf('UIButton') === 0, 'chain starts with UIButton');
        T.ok(chain.indexOf('NSObject') >= 0, 'chain contains NSObject');
    }, 'runtime-class-hierarchy: walk superclass chain no crash');

    // [runtime-find-instances] Find Live Instances on Heap
    T.suite('runtime-find-instances: Find Live Instances on Heap');
    if (typeof LeakDetector !== 'undefined' && typeof LeakDetector.findInstances === 'function') {
        T.safe(function() {
            var results = LeakDetector.findInstances('UIViewController', true, 5);
            T.ok(Array.isArray(results), 'findInstances returns array');
            if (results.length > 0) {
                T.ok(results[0].className, 'result has className');
                T.ok(results[0].address, 'result has address');
            }
        }, 'runtime-find-instances: findInstances no crash');
    } else {
        T.skip('runtime-find-instances', 'LeakDetector.findInstances not available');
    }

    // [runtime-inspect-refs] Inspect Strong References
    T.suite('runtime-inspect-refs: Inspect Strong References');
    if (typeof LeakDetector !== 'undefined' && typeof LeakDetector.getStrongReferences === 'function') {
        T.safe(function() {
            var instances = LeakDetector.findInstances('UIViewController', false, 1);
            if (instances && instances.length > 0) {
                var addr = instances[0].address;
                var refs = LeakDetector.getStrongReferences(addr);
                T.ok(Array.isArray(refs), 'getStrongReferences returns array');
            } else {
                T.skip('runtime-inspect-refs (data)', 'no UIViewController instance available');
            }
        }, 'runtime-inspect-refs: getStrongReferences no crash');
    } else {
        T.skip('runtime-inspect-refs', 'LeakDetector.getStrongReferences not available');
    }

    // [runtime-detect-cycles] Detect Retain Cycles
    T.suite('runtime-detect-cycles: Detect Retain Cycles');
    if (typeof LeakDetector !== 'undefined' && typeof LeakDetector.detectCycles === 'function') {
        T.safe(function() {
            var instances = LeakDetector.findInstances('UIViewController', false, 1);
            if (instances && instances.length > 0) {
                var addr = instances[0].address;
                var cycles = LeakDetector.detectCycles(addr, 5);
                T.ok(Array.isArray(cycles), 'detectCycles returns array');
            } else {
                T.skip('runtime-detect-cycles (data)', 'no UIViewController instance available');
            }
        }, 'runtime-detect-cycles: detectCycles no crash');
    } else {
        T.skip('runtime-detect-cycles', 'LeakDetector.detectCycles not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // NETWORK SNIPPETS
    // ═══════════════════════════════════════════════════════════════

    // [network-monitor-all] Monitor All HTTP Requests
    T.suite('network-monitor-all: Monitor All HTTP Requests');
    T.safe(function() {
        Interceptor.attach('-[NSURLSession dataTaskWithRequest:completionHandler:]', {
            onEnter: function(self, sel, args) {
                var req = args[0];
                var urlObj = req ? req.invoke('URL') : null;
                var method = req ? req.invoke('HTTPMethod') : null;
                var url = urlObj ? urlObj.invoke('absoluteString') : null;
            }
        });
        Interceptor.attach('-[NSURLSession dataTaskWithURL:completionHandler:]', {
            onEnter: function(self, sel, args) {
                var url = args[0] ? args[0].invoke('absoluteString') : null;
            }
        });
        Interceptor.detach('-[NSURLSession dataTaskWithRequest:completionHandler:]');
        Interceptor.detach('-[NSURLSession dataTaskWithURL:completionHandler:]');
    }, 'network-monitor-all: hook + invoke chain no crash');

    // [network-log-headers] Log Request Headers
    T.suite('network-log-headers: Log Request Headers');
    T.safe(function() {
        Interceptor.attach('-[NSURLSession dataTaskWithRequest:completionHandler:]', {
            onEnter: function(self, sel, args) {
                var req = args[0];
                if (!req) return;
                var urlObj = req.invoke('URL');
                var headers = req.invoke('allHTTPHeaderFields');
                if (headers) {
                    headers.invoke('description');
                }
            }
        });
        Interceptor.detach('-[NSURLSession dataTaskWithRequest:completionHandler:]');
    }, 'network-log-headers: allHTTPHeaderFields invoke no crash');

    // [network-filter-domain] Filter Requests by Domain
    T.suite('network-filter-domain: Filter Requests by Domain');
    T.safe(function() {
        Interceptor.attach('-[NSURLSession dataTaskWithRequest:completionHandler:]', {
            onEnter: function(self, sel, args) {
                var req = args[0];
                if (!req) return;
                var urlObj = req.invoke('URL');
                var url = urlObj ? s(urlObj.invoke('absoluteString')) : '';
                var matched = url.indexOf('example.com') !== -1;
            }
        });
        Interceptor.detach('-[NSURLSession dataTaskWithRequest:completionHandler:]');
    }, 'network-filter-domain: domain filter logic no crash');

    // ═══════════════════════════════════════════════════════════════
    // UI SNIPPETS
    // ═══════════════════════════════════════════════════════════════

    // [ui-dump-hierarchy] Dump View Hierarchy
    T.suite('ui-dump-hierarchy: Dump View Hierarchy');
    if (typeof UIDebug !== 'undefined') {
        T.safe(function() {
            T.type(UIDebug.viewHierarchy, 'function', 'UIDebug.viewHierarchy is function');
            var tree = UIDebug.viewHierarchy();
            if (tree) {
                T.ok(tree['class'], 'root has class property');
                function checkNode(node) {
                    if (node.subviews && Array.isArray(node.subviews)) {
                        node.subviews.forEach(function(sub) { checkNode(sub); });
                    }
                }
                checkNode(tree);
            }
        }, 'ui-dump-hierarchy: viewHierarchy + recursive walk no crash');
    } else {
        T.skip('ui-dump-hierarchy', 'UIDebug not available');
    }

    // [ui-find-viewcontrollers] List All ViewControllers
    T.suite('ui-find-viewcontrollers: List All ViewControllers');
    if (typeof UIDebug !== 'undefined') {
        T.safe(function() {
            T.type(UIDebug.viewControllers, 'function', 'UIDebug.viewControllers is function');
            var vcs = UIDebug.viewControllers();
            T.ok(vcs !== undefined, 'viewControllers() returns something');
            if (vcs && vcs.length > 0) {
                T.ok(vcs[0]['class'], 'first VC has class');
                T.ok(vcs[0].address !== undefined, 'first VC has address');
            }
        }, 'ui-find-viewcontrollers: viewControllers no crash');
    } else {
        T.skip('ui-find-viewcontrollers', 'UIDebug not available');
    }

    // [ui-topmost-vc] Get Topmost ViewController
    T.suite('ui-topmost-vc: Get Topmost ViewController');
    T.safe(function() {
        var app = ObjC.use('UIApplication').invoke('sharedApplication');
        T.ok(app, 'sharedApplication exists');
        var window = app.invoke('keyWindow');
        if (window) {
            var vc = window.invoke('rootViewController');
            T.ok(vc, 'rootViewController exists');
            if (vc) {
                var cls = vc.invoke('class');
                T.ok(cls, 'rootVC has class: ' + s(cls));
                var presented = vc.invoke('presentedViewController');
            }
        } else {
            T.skip('ui-topmost-vc (window)', 'no keyWindow');
        }
    }, 'ui-topmost-vc: walk VC chain no crash');

    // [ui-screenshot] Take Screenshot
    T.suite('ui-screenshot: Take Screenshot');
    if (typeof UIDebug !== 'undefined' && typeof UIDebug.screenshot === 'function') {
        T.safe(function() {
            var base64 = UIDebug.screenshot();
            if (base64) {
                T.type(base64, 'string', 'screenshot returns string');
                T.gt(base64.length, 100, 'screenshot base64 has data: ' + base64.length + ' chars');
            } else {
                T.skip('ui-screenshot (data)', 'screenshot returned null');
            }
        }, 'ui-screenshot: screenshot() no crash');
    } else {
        T.skip('ui-screenshot', 'UIDebug.screenshot not available');
    }

    // [ui-search-views] Search Views by Class
    T.suite('ui-search-views: Search Views by Class');
    if (typeof UIDebug !== 'undefined' && typeof UIDebug.searchViews === 'function') {
        T.safe(function() {
            var results = UIDebug.searchViews('UILabel');
            T.ok(Array.isArray(results), 'searchViews returns array');
            if (results.length > 0) {
                T.ok(results[0].address, 'result has address');
            }
        }, 'ui-search-views: searchViews("UILabel") no crash');
    } else {
        T.skip('ui-search-views', 'UIDebug.searchViews not available');
    }

    // [ui-view-detail] Inspect View Properties
    T.suite('ui-view-detail: Inspect View Properties');
    if (typeof UIDebug !== 'undefined' && typeof UIDebug.viewDetail === 'function' && typeof UIDebug.searchViews === 'function') {
        T.safe(function() {
            var views = UIDebug.searchViews('UILabel');
            if (views && views.length > 0) {
                var addr = views[0].address;
                var detail = UIDebug.viewDetail(addr);
                T.ok(detail, 'viewDetail returns object');
                if (detail) {
                    T.ok(detail['class'], 'detail has class');
                }
            } else {
                T.skip('ui-view-detail (data)', 'no UILabel found');
            }
        }, 'ui-view-detail: viewDetail no crash');
    } else {
        T.skip('ui-view-detail', 'UIDebug.viewDetail not available');
    }

    // [ui-highlight-view] Highlight View on Device
    T.suite('ui-highlight-view: Highlight View on Device');
    if (typeof UIDebug !== 'undefined' && typeof UIDebug.highlightView === 'function') {
        T.safe(function() {
            var views = UIDebug.searchViews('UILabel');
            if (views && views.length > 0) {
                UIDebug.highlightView(views[0].address);
                if (typeof UIDebug.clearHighlight === 'function') {
                    UIDebug.clearHighlight();
                }
            } else {
                T.skip('ui-highlight-view (data)', 'no UILabel found');
            }
        }, 'ui-highlight-view: highlightView + clearHighlight no crash');
    } else {
        T.skip('ui-highlight-view', 'UIDebug.highlightView not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // STORAGE SNIPPETS
    // ═══════════════════════════════════════════════════════════════

    // [storage-userdefaults-dump] Dump UserDefaults (App Only)
    T.suite('storage-userdefaults-dump: Dump UserDefaults (App Only)');
    if (typeof UserDefaults !== 'undefined') {
        T.safe(function() {
            T.type(UserDefaults.getAllApp, 'function', 'UserDefaults.getAllApp is function');
            var all = UserDefaults.getAllApp();
            T.type(all, 'object', 'getAllApp returns object');
            var keys = Object.keys(all);
            T.ok(keys.length >= 0, 'getAllApp keys count: ' + keys.length);
        }, 'storage-userdefaults-dump: getAllApp no crash');
    } else {
        T.skip('storage-userdefaults-dump', 'UserDefaults not available');
    }

    // [storage-userdefaults-dump-all] Dump UserDefaults (All Keys)
    T.suite('storage-userdefaults-dump-all: Dump UserDefaults (All Keys)');
    if (typeof UserDefaults !== 'undefined') {
        T.safe(function() {
            T.type(UserDefaults.getAll, 'function', 'UserDefaults.getAll is function');
            T.type(UserDefaults.isSystemKey, 'function', 'UserDefaults.isSystemKey is function');
            var all = UserDefaults.getAll();
            T.type(all, 'object', 'getAll returns object');
            var keys = Object.keys(all);
            T.gt(keys.length, 0, 'getAll has keys: ' + keys.length);

            var sysResult = UserDefaults.isSystemKey('AppleLanguages');
            T.type(sysResult, 'boolean', 'isSystemKey returns boolean');

            var appCount = 0, sysCount = 0;
            keys.forEach(function(key) {
                if (UserDefaults.isSystemKey(key)) sysCount++; else appCount++;
            });
            T.ok(appCount + sysCount === keys.length, 'app + sys = total');
        }, 'storage-userdefaults-dump-all: getAll + isSystemKey no crash');
    } else {
        T.skip('storage-userdefaults-dump-all', 'UserDefaults not available');
    }

    // [storage-userdefaults-get] Read UserDefaults Key
    T.suite('storage-userdefaults-get: Read UserDefaults Key');
    if (typeof UserDefaults !== 'undefined') {
        T.safe(function() {
            T.type(UserDefaults.get, 'function', 'UserDefaults.get is function');
            var value = UserDefaults.get('__wn_test_nonexistent_key__');
            T.ok(value === null || value === undefined, 'nonexistent key returns null/undefined');
        }, 'storage-userdefaults-get: get() no crash');
    } else {
        T.skip('storage-userdefaults-get', 'UserDefaults not available');
    }

    // [storage-keychain-read] Find Keychain Wrapper Classes
    T.suite('storage-keychain-read: Find Keychain Wrapper Classes');
    T.safe(function() {
        var patterns = ['Keychain', 'KeyChain', 'Credential', 'SecItem', 'Token'];
        var allClasses = [];
        patterns.forEach(function(p) {
            var matches = ObjC.getClassNames(p);
            matches.forEach(function(name) {
                if (allClasses.indexOf(name) === -1) allClasses.push(name);
            });
        });
        T.ok(Array.isArray(allClasses), 'collected keychain-related classes');

        if (allClasses.length > 0) {
            var cls = ObjC.use(allClasses[0]);
            if (cls) {
                var methods = cls.getMethods();
                T.ok(Array.isArray(methods), 'getMethods on keychain class works');
            }
        }
    }, 'storage-keychain-read: search + getMethods no crash');

    // [storage-list-sandbox] Browse Sandbox Directory
    T.suite('storage-list-sandbox: Browse Sandbox Directory');
    if (typeof FileSystem !== 'undefined') {
        T.safe(function() {
            var base = FileSystem.home;
            T.type(base, 'string', 'FileSystem.home is string');
            var path = base + '/Documents';
            var items = FileSystem.list(path);
            T.ok(Array.isArray(items), 'FileSystem.list returns array');
            if (items.length > 0) {
                T.ok(items[0].name !== undefined, 'item has name');
                T.ok(items[0].isDir !== undefined, 'item has isDir');
            }
        }, 'storage-list-sandbox: list Documents no crash');
    } else {
        T.skip('storage-list-sandbox', 'FileSystem not available');
    }

    // [storage-read-file] Read File Contents
    T.suite('storage-read-file: Read File Contents');
    if (typeof FileSystem !== 'undefined') {
        T.safe(function() {
            T.type(FileSystem.exists, 'function', 'FileSystem.exists is function');
            T.type(FileSystem.read, 'function', 'FileSystem.read is function');
            T.type(FileSystem.stat, 'function', 'FileSystem.stat is function');

            var testPath = FileSystem.home + '/Documents/__wn_snippet_test__.txt';
            FileSystem.write(testPath, 'snippet_test_data');
            var info = FileSystem.exists(testPath);
            T.ok(info && info.exists, 'test file exists');
            var stat = FileSystem.stat(testPath);
            T.ok(stat && stat.size > 0, 'stat returns size');
            var content = FileSystem.read(testPath);
            T.eq(content, 'snippet_test_data', 'read returns correct content');
            FileSystem.remove(testPath);
        }, 'storage-read-file: write + exists + stat + read + remove no crash');
    } else {
        T.skip('storage-read-file', 'FileSystem not available');
    }

    // [storage-dump-cookies] Dump All Cookies
    T.suite('storage-dump-cookies: Dump All Cookies');
    if (typeof Cookies !== 'undefined') {
        T.safe(function() {
            T.type(Cookies.getAll, 'function', 'Cookies.getAll is function');
            var cookies = Cookies.getAll();
            T.ok(Array.isArray(cookies), 'getAll returns array');
            if (cookies.length > 0) {
                T.ok(cookies[0].name !== undefined, 'cookie has name');
                T.ok(cookies[0].domain !== undefined, 'cookie has domain');
            }
        }, 'storage-dump-cookies: getAll no crash');
    } else {
        T.skip('storage-dump-cookies', 'Cookies not available');
    }

    // [storage-sqlite-discover] Discover SQLite Databases
    T.suite('storage-sqlite-discover: Discover SQLite Databases');
    if (typeof SQLite !== 'undefined') {
        T.safe(function() {
            T.type(SQLite.databases, 'function', 'SQLite.databases is function');
            var dbs = SQLite.databases();
            T.ok(Array.isArray(dbs), 'databases() returns array');
            if (dbs.length > 0) {
                T.ok(dbs[0].name, 'db has name');
                T.ok(dbs[0].path, 'db has path');
                T.ok(dbs[0].tableCount !== undefined, 'db has tableCount');
                T.ok(Array.isArray(dbs[0].tables), 'db has tables array');
            }
        }, 'storage-sqlite-discover: databases() no crash');
    } else {
        T.skip('storage-sqlite-discover', 'SQLite not available');
    }

    // [storage-sqlite-tables] List SQLite Tables
    T.suite('storage-sqlite-tables: List SQLite Tables');
    if (typeof SQLite !== 'undefined' && typeof SQLite.tables === 'function') {
        T.safe(function() {
            var dbs = SQLite.databases();
            if (dbs.length > 0) {
                var dbPath = dbs[0].path;
                var relPath = dbPath.replace(FileSystem.home + '/', '');
                var tables = SQLite.tables(relPath);
                T.ok(Array.isArray(tables), 'tables() returns array');
                if (tables.length > 0) {
                    T.ok(tables[0].name, 'table has name');
                    T.ok(tables[0].rowCount !== undefined, 'table has rowCount');
                }
            } else {
                T.skip('storage-sqlite-tables (data)', 'no SQLite databases found');
            }
        }, 'storage-sqlite-tables: tables() no crash');
    } else {
        T.skip('storage-sqlite-tables', 'SQLite.tables not available');
    }

    // [storage-sqlite-query] Run SQL Query
    T.suite('storage-sqlite-query: Run SQL Query');
    if (typeof SQLite !== 'undefined' && typeof SQLite.query === 'function') {
        T.safe(function() {
            var dbs = SQLite.databases();
            if (dbs.length > 0) {
                var dbPath = dbs[0].path;
                var relPath = dbPath.replace(FileSystem.home + '/', '');
                var result = SQLite.query(relPath, 'SELECT 1 as test_col');
                T.ok(result, 'query returns result');
                if (result && !result.error) {
                    T.ok(result.rows !== undefined, 'result has rows');
                    T.ok(result.rowCount !== undefined, 'result has rowCount');
                }
            } else {
                T.skip('storage-sqlite-query (data)', 'no SQLite databases found');
            }
        }, 'storage-sqlite-query: query() no crash');
    } else {
        T.skip('storage-sqlite-query', 'SQLite.query not available');
    }

    // [storage-sqlite-schema] Show Table Schema
    T.suite('storage-sqlite-schema: Show Table Schema');
    if (typeof SQLite !== 'undefined' && typeof SQLite.schema === 'function') {
        T.safe(function() {
            var dbs = SQLite.databases();
            if (dbs.length > 0 && dbs[0].tables.length > 0) {
                var dbPath = dbs[0].path;
                var relPath = dbPath.replace(FileSystem.home + '/', '');
                var tableName = dbs[0].tables[0];
                var cols = SQLite.schema(relPath, tableName);
                T.ok(Array.isArray(cols), 'schema returns array');
                if (cols.length > 0) {
                    T.ok(cols[0].name, 'column has name');
                }
            } else {
                T.skip('storage-sqlite-schema (data)', 'no tables found');
            }
        }, 'storage-sqlite-schema: schema() no crash');
    } else {
        T.skip('storage-sqlite-schema', 'SQLite.schema not available');
    }

    // [storage-sqlite-snapshot-diff] Monitor Table Changes
    T.suite('storage-sqlite-snapshot-diff: Monitor Table Changes');
    if (typeof SQLite !== 'undefined' && typeof SQLite.snapshot === 'function' && typeof SQLite.diff === 'function') {
        T.safe(function() {
            var dbs = SQLite.databases();
            if (dbs.length > 0 && dbs[0].tables.length > 0) {
                var dbPath = dbs[0].path;
                var relPath = dbPath.replace(FileSystem.home + '/', '');
                var tableName = dbs[0].tables[0];
                var snap = SQLite.snapshot(relPath, tableName, '__wn_test__');
                T.ok(snap, 'snapshot returns result');
                T.ok(snap.rowCount !== undefined, 'snapshot has rowCount');

                var diff = SQLite.diff(relPath, tableName, '__wn_test__');
                T.ok(diff, 'diff returns result');
                T.ok(diff.hasChanges !== undefined, 'diff has hasChanges');
            } else {
                T.skip('storage-sqlite-snapshot-diff (data)', 'no tables found');
            }
        }, 'storage-sqlite-snapshot-diff: snapshot + diff no crash');
    } else {
        T.skip('storage-sqlite-snapshot-diff', 'SQLite.snapshot/diff not available');
    }

    // [storage-sqlite-watch] Watch Table Row Count
    T.suite('storage-sqlite-watch: Watch Table Row Count');
    if (typeof SQLite !== 'undefined' && typeof SQLite.watch === 'function' && typeof SQLite.unwatch === 'function') {
        T.safe(function() {
            var dbs = SQLite.databases();
            if (dbs.length > 0 && dbs[0].tables.length > 0) {
                var dbPath = dbs[0].path;
                var relPath = dbPath.replace(FileSystem.home + '/', '');
                var tableName = dbs[0].tables[0];
                var w = SQLite.watch(relPath, tableName, 5000);
                T.ok(w, 'watch returns result');
                if (!w.error) {
                    T.ok(w.watchId !== undefined, 'watch has watchId');
                    T.ok(w.initialRowCount !== undefined, 'watch has initialRowCount');
                    SQLite.unwatch(w.watchId);
                }
            } else {
                T.skip('storage-sqlite-watch (data)', 'no tables found');
            }
        }, 'storage-sqlite-watch: watch + unwatch no crash');
    } else {
        T.skip('storage-sqlite-watch', 'SQLite.watch/unwatch not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // PERFORMANCE SNIPPETS
    // ═══════════════════════════════════════════════════════════════

    // [perf-memory-snapshot] Memory Usage Snapshot
    T.suite('perf-memory-snapshot: Memory Usage Snapshot');
    if (typeof Performance !== 'undefined') {
        T.safe(function() {
            T.type(Performance.memory, 'function', 'Performance.memory is function');
            var info = Performance.memory();
            T.ok(info, 'memory() returns object');
            T.type(info.used, 'number', 'info.used is number');
            T.type(info.virtual, 'number', 'info.virtual is number');
            T.type(info.free, 'number', 'info.free is number');
            T.gt(info.used, 0, 'used memory > 0');
        }, 'perf-memory-snapshot: memory() returns valid data');
    } else {
        T.skip('perf-memory-snapshot', 'Performance not available');
    }

    // [perf-fps-monitor] FPS Monitor
    T.suite('perf-fps-monitor: FPS Monitor');
    if (typeof Performance !== 'undefined') {
        T.safe(function() {
            T.type(Performance.fps, 'function', 'Performance.fps is function');
            T.type(Performance.stopFps, 'function', 'Performance.stopFps is function');
            Performance.fps(function(fps) {});
            Performance.stopFps();
        }, 'perf-fps-monitor: fps + stopFps no crash');
    } else {
        T.skip('perf-fps-monitor', 'Performance not available');
    }

    // [perf-full-snapshot] Full Performance Snapshot
    T.suite('perf-full-snapshot: Full Performance Snapshot');
    if (typeof Performance !== 'undefined' && typeof Performance.snapshot === 'function') {
        T.safe(function() {
            var snap = Performance.snapshot();
            T.ok(snap, 'snapshot() returns object');
            if (snap.memory) {
                T.gt(snap.memory.used, 0, 'memory.used > 0');
            }
            if (snap.cpu) {
                T.type(snap.cpu.userTime, 'number', 'cpu.userTime is number');
                T.type(snap.cpu.systemTime, 'number', 'cpu.systemTime is number');
                T.type(snap.cpu.threadCount, 'number', 'cpu.threadCount is number');
            }
        }, 'perf-full-snapshot: snapshot() returns valid data');
    } else {
        T.skip('perf-full-snapshot', 'Performance.snapshot not available');
    }

    // [perf-cpu-usage] CPU Usage
    T.suite('perf-cpu-usage: CPU Usage');
    if (typeof Performance !== 'undefined' && typeof Performance.cpu === 'function') {
        T.safe(function() {
            var cpu = Performance.cpu();
            T.ok(cpu, 'cpu() returns object');
            T.type(cpu.userTime, 'number', 'userTime is number');
            T.type(cpu.systemTime, 'number', 'systemTime is number');
            T.type(cpu.threadCount, 'number', 'threadCount is number');
            T.gt(cpu.threadCount, 0, 'threadCount > 0');
        }, 'perf-cpu-usage: cpu() returns valid data');
    } else {
        T.skip('perf-cpu-usage', 'Performance.cpu not available');
    }

    // [perf-heap-snapshot] Take Heap Snapshot
    T.suite('perf-heap-snapshot: Take Heap Snapshot');
    if (typeof LeakDetector !== 'undefined' && typeof LeakDetector.takeSnapshot === 'function') {
        T.safe(function() {
            LeakDetector.takeSnapshot('__wn_snippet_test_snap__');
        }, 'perf-heap-snapshot: takeSnapshot no crash');
    } else {
        T.skip('perf-heap-snapshot', 'LeakDetector.takeSnapshot not available');
    }

    // [perf-heap-diff] Compare Heap Snapshots
    T.suite('perf-heap-diff: Compare Heap Snapshots');
    if (typeof LeakDetector !== 'undefined' && typeof LeakDetector.takeSnapshot === 'function' && typeof LeakDetector.diffSnapshots === 'function') {
        T.safe(function() {
            LeakDetector.takeSnapshot('__wn_snippet_before__');
            LeakDetector.takeSnapshot('__wn_snippet_after__');
            var diff = LeakDetector.diffSnapshots('__wn_snippet_before__', '__wn_snippet_after__');
            T.ok(diff, 'diffSnapshots returns result');
            if (diff) {
                T.ok(diff.grown !== undefined || diff.shrunk !== undefined, 'diff has grown/shrunk');
            }
        }, 'perf-heap-diff: takeSnapshot + diffSnapshots no crash');
    } else {
        T.skip('perf-heap-diff', 'LeakDetector.diffSnapshots not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // UTILITY SNIPPETS
    // ═══════════════════════════════════════════════════════════════

    // [util-rpc-template] RPC Export Template
    T.suite('util-rpc-template: RPC Export Template');
    T.safe(function() {
        T.type(rpc, 'object', 'rpc exists');
        T.type(rpc.exports, 'object', 'rpc.exports exists');

        var bundle = ObjC.use('NSBundle').invoke('mainBundle');
        T.ok(bundle, 'NSBundle.mainBundle works');
        var bid = bundle.invoke('bundleIdentifier');
        T.ok(bid, 'bundleIdentifier returns value');
        var bpath = bundle.invoke('bundlePath');
        T.ok(bpath, 'bundlePath returns value');
        T.type(FileSystem.home, 'string', 'FileSystem.home works in sandbox context');
    }, 'util-rpc-template: RPC + NSBundle + FileSystem.home no crash');

    // [util-app-info] Print App Info
    T.suite('util-app-info: Print App Info');
    T.safe(function() {
        var bundle = ObjC.use('NSBundle').invoke('mainBundle');
        var bundleId = bundle.invoke('bundleIdentifier');
        T.ok(bundleId, 'bundleIdentifier: ' + s(bundleId));
        var bundlePath = bundle.invoke('bundlePath');
        T.ok(bundlePath, 'bundlePath: ' + s(bundlePath));
        var executablePath = bundle.invoke('executablePath');
        T.ok(executablePath, 'executablePath: ' + s(executablePath));
        T.type(FileSystem.home, 'string', 'FileSystem.home is string');
    }, 'util-app-info: all invoke calls no crash');

    // [util-device-info] Print Device Info
    T.suite('util-device-info: Print Device Info');
    T.safe(function() {
        var device = ObjC.use('UIDevice').invoke('currentDevice');
        T.ok(device, 'UIDevice.currentDevice exists');
        var name = device.invoke('name');
        T.ok(name, 'device name: ' + s(name));
        var model = device.invoke('model');
        T.ok(model, 'device model: ' + s(model));
        var sysName = device.invoke('systemName');
        T.ok(sysName, 'systemName: ' + s(sysName));
        var sysVer = device.invoke('systemVersion');
        T.ok(sysVer, 'systemVersion: ' + s(sysVer));
        var vendorId = device.invoke('identifierForVendor');
        if (vendorId) {
            var uuid = vendorId.invoke('UUIDString');
            T.ok(uuid, 'vendor UUID: ' + s(uuid));
        }
    }, 'util-device-info: all invoke calls no crash');

    // [util-list-modules] List Loaded Frameworks
    T.suite('util-list-modules: List Loaded Frameworks');
    if (typeof Module !== 'undefined' && typeof Module.enumerateModules === 'function') {
        T.safe(function() {
            var mods = Module.enumerateModules();
            T.ok(Array.isArray(mods), 'enumerateModules returns array');
            T.gt(mods.length, 0, 'has loaded modules: ' + mods.length);

            var appMods = [];
            var sysMods = 0;
            mods.forEach(function(m) {
                var n = m.name || '';
                if (n.indexOf('/usr/') === -1 && n.indexOf('/System/') === -1 && n.indexOf('/Library/') === -1) {
                    appMods.push(m);
                } else {
                    sysMods++;
                }
            });
            T.ok(appMods.length + sysMods === mods.length, 'app + system = total');
        }, 'util-list-modules: enumerateModules + filter no crash');
    } else {
        T.skip('util-list-modules', 'Module.enumerateModules not available');
    }

    // [util-env-dump] Dump Process Environment
    T.suite('util-env-dump: Dump Process Environment');
    T.safe(function() {
        var bundle = ObjC.use('NSBundle').invoke('mainBundle');
        T.ok(bundle.invoke('bundleIdentifier'), 'bundleIdentifier works');
        var device = ObjC.use('UIDevice').invoke('currentDevice');
        T.ok(device.invoke('model'), 'device model works');
        var mem = Performance.memory();
        T.gt(mem.used, 0, 'memory used > 0');
        T.type(FileSystem.home, 'string', 'FileSystem.home is string');
        if (typeof Module !== 'undefined' && typeof Module.enumerateModules === 'function') {
            var mods = Module.enumerateModules();
            T.gt(mods.length, 0, 'has modules');
        }
    }, 'util-env-dump: combined env dump no crash');

    // ═══════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════
    T.done();
})();
