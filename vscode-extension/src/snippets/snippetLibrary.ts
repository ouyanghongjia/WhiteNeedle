export interface ScriptSnippet {
    id: string;
    name: string;
    category: SnippetCategory;
    description: string;
    tags: string[];
    params?: SnippetParam[];
    code: string;
}

export interface ScriptHistoryEntry {
    snippetId: string;
    snippetName: string;
    timestamp: number;
    params?: Record<string, string>;
}

export const HISTORY_MAX_ENTRIES = 50;
export const FAVORITES_KEY = 'whiteneedle.favoriteSnippets';
export const HISTORY_KEY = 'whiteneedle.scriptHistory';

export interface SnippetParam {
    name: string;
    placeholder: string;
    description: string;
}

export type SnippetCategory =
    | 'hook'
    | 'runtime'
    | 'network'
    | 'ui'
    | 'storage'
    | 'performance'
    | 'utility';

export const CATEGORY_LABELS: Record<SnippetCategory, string> = {
    hook: 'Method Hook',
    runtime: 'ObjC Runtime',
    network: 'Network',
    ui: 'UI Debug',
    storage: 'Storage',
    performance: 'Performance',
    utility: 'Utility',
};

export const BUILTIN_SNIPPETS: ScriptSnippet[] = [
    // ---- Hook ----
    {
        id: 'hook-method-basic',
        name: 'Hook ObjC Method',
        category: 'hook',
        description: 'Hook an Objective-C instance or class method with onEnter/onLeave callbacks',
        tags: ['hook', 'intercept', 'swizzle'],
        params: [
            { name: 'SELECTOR', placeholder: '-[UIViewController viewDidLoad]', description: 'ObjC method selector' },
        ],
        code: `Interceptor.attach("{{SELECTOR}}", {
    onEnter: function(self, sel, args) {
        console.log("[Hook] {{SELECTOR}} called");
        console.log("  self:", self);
    },
    onLeave: function(retval) {
        console.log("[Hook] {{SELECTOR}} returned:", retval);
    }
});

console.log("[WhiteNeedle] Hooked {{SELECTOR}}");`,
    },
    {
        id: 'hook-replace-retval',
        name: 'Replace Return Value',
        category: 'hook',
        description: 'Hook a method and replace its return value',
        tags: ['hook', 'replace', 'return'],
        params: [
            { name: 'SELECTOR', placeholder: '-[MyClass isVIPUser]', description: 'ObjC method selector' },
            { name: 'NEW_VALUE', placeholder: 'true', description: 'New return value' },
        ],
        code: `Interceptor.attach("{{SELECTOR}}", {
    onLeave: function(retval) {
        console.log("[Hook] Original return:", retval);
        retval.replace({{NEW_VALUE}});
        console.log("[Hook] Replaced with:", {{NEW_VALUE}});
    }
});

console.log("[WhiteNeedle] Return value hook active for {{SELECTOR}}");`,
    },
    {
        id: 'hook-viewdidload',
        name: 'Track ViewController Lifecycle',
        category: 'hook',
        description: 'Log every UIViewController that loads, appears, or disappears',
        tags: ['hook', 'viewcontroller', 'lifecycle', 'ui'],
        code: `["viewDidLoad", "viewWillAppear:", "viewDidAppear:", "viewWillDisappear:"].forEach(function(sel) {
    Interceptor.attach("-[UIViewController " + sel + "]", {
        onEnter: function(self) {
            console.log("[VC] " + (self.invoke("class") || "?") + " " + sel);
        }
    });
});

console.log("[WhiteNeedle] ViewController lifecycle tracking active");`,
    },
    {
        id: 'hook-all-methods',
        name: 'Trace All Methods of a Class',
        category: 'hook',
        description: 'Hook every method on a class and log calls',
        tags: ['hook', 'trace', 'class', 'dump'],
        params: [
            { name: 'CLASS_NAME', placeholder: 'NSURLSession', description: 'Target class name' },
        ],
        code: `var cls = ObjC.use("{{CLASS_NAME}}");
if (!cls) {
    console.error("[Trace] Class not found: {{CLASS_NAME}}");
} else {
    var methods = cls.getMethods();
    console.log("[Trace] Hooking " + methods.length + " methods on {{CLASS_NAME}}");
    methods.forEach(function(entry) {
        var sel = entry.split(" (")[0];
        try {
            Interceptor.attach("-[{{CLASS_NAME}} " + sel + "]", {
                onEnter: function() {
                    console.log("[Trace] -[{{CLASS_NAME}} " + sel + "]");
                }
            });
        } catch(e) {}
    });
    console.log("[Trace] Ready — monitoring {{CLASS_NAME}}");
}`,
    },

    // ---- Runtime ----
    {
        id: 'runtime-class-search',
        name: 'Search ObjC Classes',
        category: 'runtime',
        description: 'Search loaded ObjC classes by keyword filter',
        tags: ['class', 'search', 'enumerate'],
        params: [
            { name: 'FILTER', placeholder: 'ViewController', description: 'Class name filter keyword' },
        ],
        code: `var filter = "{{FILTER}}";
var matched = ObjC.getClassNames(filter);

console.log("[Search] Found " + matched.length + " classes matching '" + filter + "':");
matched.forEach(function(name) {
    console.log("  " + name);
});`,
    },
    {
        id: 'runtime-dump-methods',
        name: 'Dump Class Methods',
        category: 'runtime',
        description: 'List all instance and class methods of an ObjC class',
        tags: ['class', 'method', 'dump', 'inspect'],
        params: [
            { name: 'CLASS_NAME', placeholder: 'UIApplication', description: 'Class name to inspect' },
        ],
        code: `var cls = ObjC.use("{{CLASS_NAME}}");
if (!cls) {
    console.error("[Dump] Class not found: {{CLASS_NAME}}");
} else {
    var methods = cls.getMethods();
    console.log("[Dump] {{CLASS_NAME}} — " + methods.length + " methods:");
    methods.forEach(function(m) {
        console.log("  " + m);
    });
}`,
    },
    {
        id: 'runtime-call-method',
        name: 'Call Class/Instance Method',
        category: 'runtime',
        description: 'Get a singleton instance and call a method on it',
        tags: ['invoke', 'call', 'singleton'],
        params: [
            { name: 'CLASS_NAME', placeholder: 'UIApplication', description: 'Class name' },
            { name: 'SINGLETON_SEL', placeholder: 'sharedApplication', description: 'Singleton accessor' },
            { name: 'METHOD', placeholder: 'delegate', description: 'Method to call' },
        ],
        code: `var instance = ObjC.use("{{CLASS_NAME}}").invoke("{{SINGLETON_SEL}}");
var result = instance.invoke("{{METHOD}}");
console.log("[Call] {{CLASS_NAME}}.{{SINGLETON_SEL}}.{{METHOD}}():", result);`,
    },
    {
        id: 'runtime-class-hierarchy',
        name: 'Print Class Hierarchy',
        category: 'runtime',
        description: 'Walk the superclass chain from a given class up to NSObject',
        tags: ['class', 'hierarchy', 'superclass', 'inheritance'],
        params: [
            { name: 'CLASS_NAME', placeholder: 'UIButton', description: 'Starting class name' },
        ],
        code: `var chain = [];
var name = "{{CLASS_NAME}}";
while (name && name !== "nil") {
    chain.push(name);
    var cls = ObjC.use(name);
    if (!cls) break;
    var sc = cls.invoke("superclass");
    name = (sc && sc !== "nil") ? sc.toString() : null;
}
if (chain.length === 0) {
    console.error("[Hierarchy] Class not found: {{CLASS_NAME}}");
} else {
    console.log("[Hierarchy] {{CLASS_NAME}} inheritance chain:");
    chain.forEach(function(c, i) {
        console.log("  " + "  ".repeat(i) + c);
    });
}`,
    },

    // ---- Network ----
    {
        id: 'network-monitor-all',
        name: 'Monitor All HTTP Requests',
        category: 'network',
        description: 'Hook NSURLSession and NSURLConnection to log every network request',
        tags: ['network', 'http', 'request', 'monitor'],
        code: `function s(v) { return v ? v.toString() : "?"; }

Interceptor.attach("-[NSURLSession dataTaskWithRequest:completionHandler:]", {
    onEnter: function(self, sel, args) {
        var req = args[0];
        var urlObj = req ? req.invoke("URL") : null;
        console.log("[NET] " + s(req ? req.invoke("HTTPMethod") : null) + " " + s(urlObj ? urlObj.invoke("absoluteString") : null));
    }
});

Interceptor.attach("-[NSURLSession dataTaskWithURL:completionHandler:]", {
    onEnter: function(self, sel, args) {
        console.log("[NET] GET " + s(args[0] ? args[0].invoke("absoluteString") : null));
    }
});

console.log("[WhiteNeedle] Network monitor active");`,
    },
    {
        id: 'network-log-headers',
        name: 'Log Request Headers',
        category: 'network',
        description: 'Capture and log HTTP request headers for all NSURLSession requests',
        tags: ['network', 'headers', 'http'],
        code: `function s(v) { return v ? v.toString() : "?"; }

Interceptor.attach("-[NSURLSession dataTaskWithRequest:completionHandler:]", {
    onEnter: function(self, sel, args) {
        var req = args[0];
        if (!req) return;
        var urlObj = req.invoke("URL");
        console.log("[NET] " + s(req.invoke("HTTPMethod")) + " " + s(urlObj ? urlObj.invoke("absoluteString") : null));
        var headers = req.invoke("allHTTPHeaderFields");
        if (headers) {
            console.log("[NET] Headers: " + s(headers.invoke("description")));
        }
    }
});

console.log("[WhiteNeedle] Request header logger active");`,
    },
    {
        id: 'network-filter-domain',
        name: 'Filter Requests by Domain',
        category: 'network',
        description: 'Only log requests matching a specific domain',
        tags: ['network', 'filter', 'domain'],
        params: [
            { name: 'DOMAIN', placeholder: 'api.example.com', description: 'Domain to filter' },
        ],
        code: `function s(v) { return v ? v.toString() : "?"; }

Interceptor.attach("-[NSURLSession dataTaskWithRequest:completionHandler:]", {
    onEnter: function(self, sel, args) {
        var req = args[0];
        if (!req) return;
        var urlObj = req.invoke("URL");
        var url = urlObj ? s(urlObj.invoke("absoluteString")) : "";
        if (url.indexOf("{{DOMAIN}}") !== -1) {
            console.log("[NET] " + s(req.invoke("HTTPMethod")) + " " + url);
        }
    }
});

console.log("[WhiteNeedle] Filtering requests for domain: {{DOMAIN}}");`,
    },

    // ---- UI ----
    {
        id: 'ui-dump-hierarchy',
        name: 'Dump View Hierarchy',
        category: 'ui',
        description: 'Print the full view hierarchy from the key window (uses UIDebug API)',
        tags: ['ui', 'view', 'hierarchy', 'dump'],
        code: `var tree = UIDebug.viewHierarchy();
function printView(node, depth) {
    var indent = "";
    for (var i = 0; i < depth; i++) indent += "  ";
    var cls = node["class"] || "?";
    var frame = node.frame || "";
    var hidden = node.hidden ? " [hidden]" : "";
    console.log(indent + cls + " " + frame + hidden);
    if (node.subviews) {
        node.subviews.forEach(function(sub) { printView(sub, depth + 1); });
    }
}

if (tree) {
    console.log("[UI] View hierarchy from keyWindow:");
    printView(tree, 0);
} else {
    console.log("[UI] No view hierarchy available");
}`,
    },
    {
        id: 'ui-find-viewcontrollers',
        name: 'List All ViewControllers',
        category: 'ui',
        description: 'Find all active UIViewControllers in the window hierarchy (uses UIDebug API)',
        tags: ['ui', 'viewcontroller', 'list'],
        code: `var vcs = UIDebug.viewControllers();
if (vcs && vcs.length > 0) {
    console.log("[UI] Active ViewControllers (" + vcs.length + "):");
    vcs.forEach(function(vc) {
        var indent = "";
        for (var i = 0; i < (vc.depth || 0); i++) indent += "  ";
        console.log(indent + (vc["class"] || "?") + (vc.title ? " — " + vc.title : "") + " @ " + (vc.address || "?"));
    });
} else {
    console.log("[UI] No ViewControllers found");
}`,
    },

    // ---- Storage ----
    {
        id: 'storage-userdefaults-dump',
        name: 'Dump UserDefaults (App Only)',
        category: 'storage',
        description: 'Print app-specific key-value pairs, filtering out Apple/system keys (uses UserDefaults.getAllApp)',
        tags: ['userdefaults', 'dump', 'storage', 'app', 'filtered'],
        code: `var all = UserDefaults.getAllApp();
var keys = Object.keys(all);
console.log("[Storage] App UserDefaults — " + keys.length + " keys (system keys excluded):");
keys.sort().forEach(function(key) {
    var val = all[key];
    var display = (typeof val === "object") ? JSON.stringify(val) : String(val);
    if (display.length > 100) display = display.substring(0, 100) + "...";
    console.log("  " + key + " = " + display);
});`,
    },
    {
        id: 'storage-userdefaults-dump-all',
        name: 'Dump UserDefaults (All Keys)',
        category: 'storage',
        description: 'Print ALL key-value pairs including system keys, with system key markers',
        tags: ['userdefaults', 'dump', 'storage', 'all', 'system'],
        code: `var all = UserDefaults.getAll();
var keys = Object.keys(all);
var appCount = 0, sysCount = 0;
keys.sort().forEach(function(key) {
    var isSys = UserDefaults.isSystemKey(key);
    if (isSys) sysCount++; else appCount++;
    var val = all[key];
    var display = (typeof val === "object") ? JSON.stringify(val) : String(val);
    if (display.length > 100) display = display.substring(0, 100) + "...";
    var tag = isSys ? "[SYS] " : "[APP] ";
    console.log("  " + tag + key + " = " + display);
});
console.log("[Storage] Total: " + keys.length + " keys (" + appCount + " app, " + sysCount + " system)");`,
    },
    {
        id: 'storage-keychain-read',
        name: 'Find Keychain Wrapper Classes',
        category: 'storage',
        description: 'Discover keychain-related classes and their methods in the app',
        tags: ['keychain', 'security', 'credentials'],
        params: [
            { name: 'SERVICE', placeholder: 'com.myapp.auth', description: 'Keyword to filter (e.g. service name, Keychain, Token)' },
        ],
        code: `var keyword = "{{SERVICE}}";
function s(v) { return v ? v.toString() : "?"; }

var patterns = ["Keychain", "KeyChain", "keychain", "Credential", "credential", "SecItem", "Token", "token"];
if (keyword && patterns.indexOf(keyword) === -1) patterns.push(keyword);

var allClasses = [];
patterns.forEach(function(p) {
    var matches = ObjC.getClassNames(p);
    matches.forEach(function(name) {
        if (allClasses.indexOf(name) === -1) allClasses.push(name);
    });
});

console.log("[Keychain] Found " + allClasses.length + " keychain-related classes:");
allClasses.forEach(function(name) {
    console.log("\\n  [Class] " + name);
    var cls = ObjC.use(name);
    if (!cls) return;
    var methods = cls.getMethods();
    var interesting = methods.filter(function(m) {
        var ml = m.toLowerCase();
        return ml.indexOf("get") !== -1 || ml.indexOf("read") !== -1 ||
               ml.indexOf("load") !== -1 || ml.indexOf("save") !== -1 ||
               ml.indexOf("password") !== -1 || ml.indexOf("token") !== -1 ||
               ml.indexOf("secret") !== -1 || ml.indexOf("item") !== -1 ||
               ml.indexOf("query") !== -1 || ml.indexOf("fetch") !== -1;
    });
    if (interesting.length > 0) {
        interesting.forEach(function(m) { console.log("    " + m); });
    } else {
        console.log("    (no obvious getter methods — try: cls.getMethods() for full list)");
    }
});

if (allClasses.length === 0) {
    console.log("[Keychain] No keychain wrapper classes found.");
    console.log("[Keychain] Tip: try ObjC.getClassNames('Auth') or ObjC.getClassNames('Secret')");
}`,
    },

    // ---- Performance ----
    {
        id: 'perf-memory-snapshot',
        name: 'Memory Usage Snapshot',
        category: 'performance',
        description: 'Report current app memory usage via Mach APIs',
        tags: ['memory', 'performance', 'monitor'],
        code: `var info = Performance.memory();
console.log("[Perf] Memory Snapshot:");
console.log("  Used:    " + (info.used / 1024 / 1024).toFixed(1) + " MB");
console.log("  Virtual: " + (info.virtual / 1024 / 1024).toFixed(1) + " MB");
console.log("  Free:    " + (info.free / 1024 / 1024).toFixed(1) + " MB");`,
    },
    {
        id: 'perf-fps-monitor',
        name: 'FPS Monitor',
        category: 'performance',
        description: 'Start a continuous FPS monitoring loop',
        tags: ['fps', 'performance', 'render', 'monitor'],
        code: `Performance.fps(function(fps) {
    if (fps < 55) {
        console.warn("[FPS] Drop detected: " + fps + " fps");
    }
});

console.log("[WhiteNeedle] FPS monitor active — warnings below 55 fps");
console.log("[WhiteNeedle] To stop: Performance.stopFps()");`,
    },

    // ---- Utility ----
    {
        id: 'util-rpc-template',
        name: 'RPC Export Template',
        category: 'utility',
        description: 'Template for creating RPC-callable functions from VS Code',
        tags: ['rpc', 'export', 'template'],
        code: `rpc.exports = {
    ping: function() {
        return "pong";
    },

    getAppInfo: function() {
        var bundle = ObjC.use("NSBundle").invoke("mainBundle");
        return {
            bundleId: bundle.invoke("bundleIdentifier") || "N/A",
            bundlePath: bundle.invoke("bundlePath") || "N/A",
            sandbox: FileSystem.home
        };
    },

    getMemory: function() {
        return Performance.memory();
    },

    evaluate: function(expr) {
        try {
            return { result: eval(expr) };
        } catch(e) {
            return { error: e.message };
        }
    }
};

console.log("[WhiteNeedle] RPC exports ready. Call via rpcCall('ping').");`,
    },
    {
        id: 'util-app-info',
        name: 'Print App Info',
        category: 'utility',
        description: 'Display the running app bundle ID, path, and executable name',
        tags: ['app', 'info', 'bundle', 'version'],
        code: `var bundle = ObjC.use("NSBundle").invoke("mainBundle");
var bundleId = bundle.invoke("bundleIdentifier") || "N/A";
var bundlePath = bundle.invoke("bundlePath") || "N/A";
var executablePath = bundle.invoke("executablePath") || "N/A";

console.log("[App] Bundle ID:  " + bundleId);
console.log("[App] Bundle Path: " + bundlePath);
console.log("[App] Executable:  " + executablePath);
console.log("[App] Sandbox:     " + FileSystem.home);`,
    },
    {
        id: 'util-device-info',
        name: 'Print Device Info',
        category: 'utility',
        description: 'Display current device model, OS version, and name',
        tags: ['device', 'info', 'ios'],
        code: `function s(v) { return v ? v.toString() : "N/A"; }
var device = ObjC.use("UIDevice").invoke("currentDevice");
console.log("[Device] Name:       " + s(device.invoke("name")));
console.log("[Device] Model:      " + s(device.invoke("model")));
console.log("[Device] System:     " + s(device.invoke("systemName")) + " " + s(device.invoke("systemVersion")));
var vendorId = device.invoke("identifierForVendor");
console.log("[Device] Identifier: " + (vendorId ? s(vendorId.invoke("UUIDString")) : "N/A"));`,
    },

    // ---- UI (additional) ----
    {
        id: 'ui-topmost-vc',
        name: 'Get Topmost ViewController',
        category: 'ui',
        description: 'Walk the presentation and container chain to find the currently visible ViewController',
        tags: ['ui', 'viewcontroller', 'topmost', 'visible', 'current', 'presented'],
        code: `var app = ObjC.use("UIApplication").invoke("sharedApplication");
var window = app.invoke("keyWindow");
if (!window) {
    console.log("[UI] No key window found");
} else {
    var vc = window.invoke("rootViewController");
    var chain = [];
    while (vc) {
        var cls = vc.invoke("class") || "?";
        chain.push(cls);
        var presented = vc.invoke("presentedViewController");
        if (presented) { vc = presented; continue; }
        if (cls.indexOf("Navigation") !== -1) {
            try { var top = vc.invoke("topViewController"); if (top) { vc = top; continue; } } catch(e) {}
        }
        if (cls.indexOf("TabBar") !== -1) {
            try { var sel = vc.invoke("selectedViewController"); if (sel) { vc = sel; continue; } } catch(e) {}
        }
        break;
    }
    console.log("[UI] Topmost: " + chain[chain.length - 1]);
    console.log("[UI] Chain: " + chain.join(" > "));
}`,
    },
    {
        id: 'ui-screenshot',
        name: 'Take Screenshot',
        category: 'ui',
        description: 'Capture the current screen as a PNG image and save to Documents',
        tags: ['ui', 'screenshot', 'capture', 'png', 'image'],
        code: `var base64 = UIDebug.screenshot();
if (base64) {
    var path = FileSystem.home + "/Documents/wn-screenshot.png";
    FileSystem.writeBytes(path, base64);
    console.log("[UI] Screenshot saved: " + path);
    console.log("[UI] Size: ~" + (base64.length * 3 / 4 / 1024).toFixed(0) + " KB");
} else {
    console.log("[UI] Screenshot failed");
}`,
    },
    {
        id: 'ui-search-views',
        name: 'Search Views by Class',
        category: 'ui',
        description: 'Find all views matching a class name in the current window',
        tags: ['ui', 'view', 'search', 'find', 'class'],
        params: [
            { name: 'VIEW_CLASS', placeholder: 'UIButton', description: 'View class name to search for' },
        ],
        code: `var results = UIDebug.searchViews("{{VIEW_CLASS}}");
if (results && results.length > 0) {
    console.log("[UI] Found " + results.length + " {{VIEW_CLASS}} views:");
    results.forEach(function(v, i) {
        console.log("  #" + (i + 1) + ": " + (v.frame || "") + " @ " + (v.address || "?") + (v.hidden ? " [hidden]" : ""));
    });
} else {
    console.log("[UI] No {{VIEW_CLASS}} found");
}`,
    },
    {
        id: 'ui-view-detail',
        name: 'Inspect View Properties',
        category: 'ui',
        description: 'Get all properties of a specific view by memory address',
        tags: ['ui', 'view', 'inspect', 'detail', 'properties', 'frame'],
        params: [
            { name: 'ADDRESS', placeholder: '0x121486b20', description: 'View memory address' },
        ],
        code: `var detail = UIDebug.viewDetail("{{ADDRESS}}");
if (detail) {
    console.log("[UI] View {{ADDRESS}}:");
    Object.keys(detail).forEach(function(key) {
        var val = detail[key];
        var display = (typeof val === "object") ? JSON.stringify(val) : String(val);
        console.log("  " + key + ": " + display);
    });
} else {
    console.log("[UI] View not found: {{ADDRESS}}");
}`,
    },
    {
        id: 'ui-highlight-view',
        name: 'Highlight View on Device',
        category: 'ui',
        description: 'Add a colored border to a view on the device screen for visual identification',
        tags: ['ui', 'highlight', 'border', 'visual', 'debug'],
        params: [
            { name: 'ADDRESS', placeholder: '0x121486b20', description: 'View memory address to highlight' },
        ],
        code: `UIDebug.highlightView("{{ADDRESS}}");
console.log("[UI] Highlighted view {{ADDRESS}} — look for the colored border on device");
console.log("[UI] Run UIDebug.clearHighlight() to remove");`,
    },

    // ---- Runtime (additional) ----
    {
        id: 'runtime-find-instances',
        name: 'Find Live Instances on Heap',
        category: 'runtime',
        description: 'Scan the heap for live instances of a class (including subclasses)',
        tags: ['heap', 'find', 'instances', 'scan', 'memory', 'leak'],
        params: [
            { name: 'CLASS_NAME', placeholder: 'UIViewController', description: 'Class to search for' },
            { name: 'MAX_COUNT', placeholder: '20', description: 'Maximum number of results' },
        ],
        code: `var results = LeakDetector.findInstances("{{CLASS_NAME}}", true, {{MAX_COUNT}});
if (results && results.length > 0) {
    console.log("[Heap] " + results.length + " live {{CLASS_NAME}} instances:");
    results.forEach(function(obj, i) {
        console.log("  #" + (i + 1) + " " + (obj.className || "?") + " @ " + (obj.address || "?"));
    });
} else {
    console.log("[Heap] No live {{CLASS_NAME}} instances");
}`,
    },
    {
        id: 'runtime-inspect-refs',
        name: 'Inspect Strong References',
        category: 'runtime',
        description: 'List all strong ivar references held by an object — useful for understanding retain relationships',
        tags: ['references', 'ivars', 'strong', 'retain', 'inspect', 'memory'],
        params: [
            { name: 'ADDRESS', placeholder: '0x121486b20', description: 'Object memory address' },
        ],
        code: `var refs = LeakDetector.getStrongReferences("{{ADDRESS}}");
if (refs && refs.length > 0) {
    console.log("[Refs] Strong references from {{ADDRESS}} (" + refs.length + "):");
    refs.forEach(function(ref) {
        console.log("  ." + (ref.ivar || "?") + " -> " + (ref.className || "?") + " @ " + (ref.address || "?"));
    });
} else {
    console.log("[Refs] No strong references from {{ADDRESS}}");
}`,
    },
    {
        id: 'runtime-detect-cycles',
        name: 'Detect Retain Cycles',
        category: 'runtime',
        description: 'Run DFS cycle detection from an object to find retain cycles',
        tags: ['retain', 'cycle', 'leak', 'memory', 'reference', 'circular'],
        params: [
            { name: 'ADDRESS', placeholder: '0x121486b20', description: 'Object address to start from' },
            { name: 'MAX_DEPTH', placeholder: '10', description: 'Maximum search depth' },
        ],
        code: `console.log("[Cycle] Scanning from {{ADDRESS}} (depth {{MAX_DEPTH}})...");
var cycles = LeakDetector.detectCycles("{{ADDRESS}}", {{MAX_DEPTH}});
if (cycles && cycles.length > 0) {
    console.log("[Cycle] Found " + cycles.length + " retain cycle(s):");
    cycles.forEach(function(chain, ci) {
        console.log("  Cycle #" + (ci + 1) + ":");
        chain.forEach(function(node) {
            console.log("    " + (node.className || "?") + " @ " + (node.address || "?") + " --(" + (node.retainedVia || "?") + ")--> ");
        });
    });
} else {
    console.log("[Cycle] No retain cycles detected from {{ADDRESS}}");
}`,
    },

    // ---- Performance (additional) ----
    {
        id: 'perf-full-snapshot',
        name: 'Full Performance Snapshot',
        category: 'performance',
        description: 'Capture combined CPU + memory + timestamp in one call',
        tags: ['performance', 'cpu', 'memory', 'snapshot', 'combined'],
        code: `var snap = Performance.snapshot();
console.log("[Perf] === Performance Snapshot ===");
if (snap.memory) {
    console.log("  Memory Used:    " + (snap.memory.used / 1024 / 1024).toFixed(1) + " MB");
    console.log("  Memory Virtual: " + (snap.memory.virtual / 1024 / 1024).toFixed(1) + " MB");
    console.log("  Memory Free:    " + (snap.memory.free / 1024 / 1024).toFixed(1) + " MB");
}
if (snap.cpu) {
    console.log("  CPU User:       " + snap.cpu.userTime.toFixed(2) + "s");
    console.log("  CPU System:     " + snap.cpu.systemTime.toFixed(2) + "s");
    console.log("  Threads:        " + snap.cpu.threadCount);
}`,
    },
    {
        id: 'perf-cpu-usage',
        name: 'CPU Usage',
        category: 'performance',
        description: 'Report current CPU time, system time, and active thread count',
        tags: ['cpu', 'performance', 'threads', 'usage'],
        code: `var cpu = Performance.cpu();
console.log("[Perf] CPU Usage:");
console.log("  User Time:   " + cpu.userTime.toFixed(2) + "s");
console.log("  System Time: " + cpu.systemTime.toFixed(2) + "s");
console.log("  Threads:     " + cpu.threadCount);`,
    },
    {
        id: 'perf-heap-snapshot',
        name: 'Take Heap Snapshot',
        category: 'performance',
        description: 'Take a named heap snapshot for later comparison (leak detection step 1)',
        tags: ['heap', 'snapshot', 'memory', 'leak', 'baseline'],
        params: [
            { name: 'TAG', placeholder: 'before', description: 'Snapshot tag name (e.g. before, after, baseline)' },
        ],
        code: `LeakDetector.takeSnapshot("{{TAG}}");
console.log("[Heap] Snapshot '{{TAG}}' saved");
console.log("[Heap] Next: perform the suspected leaking action, then take another snapshot and diff:");
console.log("[Heap]   LeakDetector.takeSnapshot('after')");
console.log("[Heap]   JSON.stringify(LeakDetector.diffSnapshots('{{TAG}}', 'after'))");`,
    },
    {
        id: 'perf-heap-diff',
        name: 'Compare Heap Snapshots',
        category: 'performance',
        description: 'Diff two named snapshots to find classes with growing instance counts (leak detection step 2)',
        tags: ['heap', 'diff', 'compare', 'leak', 'memory', 'delta'],
        params: [
            { name: 'BEFORE_TAG', placeholder: 'before', description: 'Earlier snapshot tag' },
            { name: 'AFTER_TAG', placeholder: 'after', description: 'Later snapshot tag' },
        ],
        code: `var diff = LeakDetector.diffSnapshots("{{BEFORE_TAG}}", "{{AFTER_TAG}}");
if (diff && diff.grown && diff.grown.length > 0) {
    console.log("[Heap] Classes with INCREASED instance count:");
    diff.grown.forEach(function(c) {
        console.log("  +" + c.delta + "  " + c.className + " (now " + c.current + ")");
    });
} else {
    console.log("[Heap] No growth detected between '{{BEFORE_TAG}}' and '{{AFTER_TAG}}'");
}
if (diff && diff.shrunk && diff.shrunk.length > 0) {
    console.log("[Heap] Classes with decreased count:");
    diff.shrunk.forEach(function(c) {
        console.log("  " + c.delta + "  " + c.className + " (now " + c.current + ")");
    });
}`,
    },

    // ---- Storage (additional) ----
    {
        id: 'storage-list-sandbox',
        name: 'Browse Sandbox Directory',
        category: 'storage',
        description: 'List files and folders in the app sandbox',
        tags: ['filesystem', 'sandbox', 'files', 'directory', 'browse'],
        params: [
            { name: 'SUBPATH', placeholder: 'Documents', description: 'Subdirectory (Documents, Library, tmp) or empty for root' },
        ],
        code: `var base = FileSystem.home;
var sub = "{{SUBPATH}}";
var path = sub ? base + "/" + sub : base;
var items = FileSystem.list(path);
if (items && items.length > 0) {
    console.log("[FS] " + path + " (" + items.length + " items):");
    items.forEach(function(item) {
        var tag = item.isDir ? "[DIR] " : "      ";
        var size = item.isDir ? "" : " (" + (item.size / 1024).toFixed(1) + " KB)";
        console.log("  " + tag + item.name + size);
    });
} else {
    console.log("[FS] Empty or not found: " + path);
}`,
    },
    {
        id: 'storage-read-file',
        name: 'Read File Contents',
        category: 'storage',
        description: 'Read a text file from the app sandbox',
        tags: ['filesystem', 'read', 'file', 'text', 'plist', 'json'],
        params: [
            { name: 'FILEPATH', placeholder: 'Documents/config.json', description: 'Path relative to sandbox root' },
        ],
        code: `var path = FileSystem.home + "/{{FILEPATH}}";
var info = FileSystem.exists(path);
if (info && info.exists) {
    var stat = FileSystem.stat(path);
    console.log("[FS] " + path + " (" + (stat.size / 1024).toFixed(1) + " KB)");
    var content = FileSystem.read(path);
    console.log(content);
} else {
    console.log("[FS] File not found: " + path);
}`,
    },
    {
        id: 'storage-dump-cookies',
        name: 'Dump All Cookies',
        category: 'storage',
        description: 'List all HTTP cookies stored by the app',
        tags: ['cookies', 'http', 'storage', 'web', 'session'],
        code: `var cookies = Cookies.getAll();
if (cookies && cookies.length > 0) {
    console.log("[Cookies] " + cookies.length + " cookies:");
    cookies.forEach(function(c) {
        var exp = c.expiresDate ? " (exp: " + c.expiresDate + ")" : " (session)";
        var val = String(c.value || "");
        if (val.length > 50) val = val.substring(0, 50) + "...";
        console.log("  " + (c.domain || "?") + " | " + (c.name || "?") + "=" + val + exp);
    });
} else {
    console.log("[Cookies] No cookies found");
}`,
    },
    {
        id: 'storage-userdefaults-get',
        name: 'Read UserDefaults Key',
        category: 'storage',
        description: 'Read a single key from NSUserDefaults',
        tags: ['userdefaults', 'read', 'key', 'value'],
        params: [
            { name: 'KEY', placeholder: 'user_token', description: 'Key to read' },
        ],
        code: `var value = UserDefaults.get("{{KEY}}");
if (value !== null && value !== undefined) {
    console.log("[Storage] {{KEY}} = " + JSON.stringify(value));
    console.log("[Storage] Type: " + typeof value);
} else {
    console.log("[Storage] Key '{{KEY}}' not found");
    console.log("[Storage] Tip: use 'Dump UserDefaults' snippet to see all keys");
}`,
    },

    // ---- SQLite / Database ----
    {
        id: 'storage-sqlite-discover',
        name: 'Discover SQLite Databases',
        category: 'storage',
        description: 'Scan the app sandbox for all SQLite database files',
        tags: ['sqlite', 'database', 'discover', 'scan', 'db'],
        code: `var dbs = SQLite.databases();\nconsole.log("[SQLite] Found " + dbs.length + " databases:");\ndbs.forEach(function(db) {\n    console.log("  " + db.name + " (" + db.tableCount + " tables, " + (db.size / 1024).toFixed(1) + " KB)");\n    console.log("    Path: " + db.path);\n    if (db.tables.length > 0) console.log("    Tables: " + db.tables.join(", "));\n});`,
    },
    {
        id: 'storage-sqlite-tables',
        name: 'List SQLite Tables',
        category: 'storage',
        description: 'List all tables and their row counts in a database',
        tags: ['sqlite', 'tables', 'schema', 'database'],
        params: [
            { name: 'DB_PATH', placeholder: 'Library/Application Support/app.sqlite', description: 'Relative path to database file' },
        ],
        code: `var tables = SQLite.tables("{{DB_PATH}}");\nconsole.log("[SQLite] Tables in {{DB_PATH}}:");\ntables.forEach(function(t) {\n    console.log("  " + t.name + " — " + t.rowCount + " rows");\n});`,
    },
    {
        id: 'storage-sqlite-query',
        name: 'Run SQL Query',
        category: 'storage',
        description: 'Execute a SQL query and print the results',
        tags: ['sqlite', 'query', 'select', 'sql'],
        params: [
            { name: 'DB_PATH', placeholder: 'Library/Application Support/app.sqlite', description: 'Relative path to database file' },
            { name: 'SQL', placeholder: 'SELECT * FROM users LIMIT 10', description: 'SQL query to execute' },
        ],
        code: `var result = SQLite.query("{{DB_PATH}}", "{{SQL}}");\nif (result.error) {\n    console.log("[SQLite] Error: " + result.error);\n} else {\n    console.log("[SQLite] " + result.rowCount + " rows" + (result.truncated ? " (truncated)" : "") + ":");\n    result.rows.forEach(function(row, i) {\n        console.log("  [" + i + "] " + JSON.stringify(row));\n    });\n}`,
    },
    {
        id: 'storage-sqlite-schema',
        name: 'Show Table Schema',
        category: 'storage',
        description: 'Display column definitions for a SQLite table',
        tags: ['sqlite', 'schema', 'columns', 'table'],
        params: [
            { name: 'DB_PATH', placeholder: 'Library/Application Support/app.sqlite', description: 'Relative path to database file' },
            { name: 'TABLE', placeholder: 'users', description: 'Table name' },
        ],
        code: `var cols = SQLite.schema("{{DB_PATH}}", "{{TABLE}}");\nconsole.log("[SQLite] Schema for {{TABLE}}:");\ncols.forEach(function(c) {\n    var pk = c.pk ? " [PK]" : "";\n    var nn = c.notnull ? " NOT NULL" : "";\n    var def = c.dflt_value != null ? " DEFAULT " + c.dflt_value : "";\n    console.log("  " + c.name + " " + (c.type || "ANY") + nn + def + pk);\n});`,
    },
    {
        id: 'storage-sqlite-snapshot-diff',
        name: 'Monitor Table Changes (Snapshot + Diff)',
        category: 'storage',
        description: 'Take a snapshot of a table, then diff later to see what changed',
        tags: ['sqlite', 'monitor', 'diff', 'snapshot', 'changes', 'watch'],
        params: [
            { name: 'DB_PATH', placeholder: 'Library/Application Support/app.sqlite', description: 'Relative path to database file' },
            { name: 'TABLE', placeholder: 'events', description: 'Table name to monitor' },
        ],
        code: `// Step 1: Take a snapshot\nvar snap = SQLite.snapshot("{{DB_PATH}}", "{{TABLE}}", "monitor");\nconsole.log("[SQLite] Snapshot taken: " + snap.rowCount + " rows in {{TABLE}}");\nconsole.log("[SQLite] Now perform your action in the app, then run this script again with Step 2");\n\n// Step 2 (uncomment after performing your action):\n// var diff = SQLite.diff("{{DB_PATH}}", "{{TABLE}}", "monitor");\n// if (diff.error) { console.log("[SQLite] " + diff.error); }\n// else if (!diff.hasChanges) { console.log("[SQLite] No changes detected"); }\n// else {\n//     console.log("[SQLite] Changes: " + diff.oldRowCount + " → " + diff.newRowCount);\n//     console.log("[SQLite] Added: " + diff.addedCount + ", Removed: " + diff.removedCount);\n//     diff.added.forEach(function(r) { console.log("  + " + JSON.stringify(r)); });\n//     diff.removed.forEach(function(r) { console.log("  - " + JSON.stringify(r)); });\n// }`,
    },
    {
        id: 'storage-sqlite-watch',
        name: 'Watch Table Row Count',
        category: 'storage',
        description: 'Poll a table for row count changes at a regular interval',
        tags: ['sqlite', 'watch', 'monitor', 'poll', 'realtime'],
        params: [
            { name: 'DB_PATH', placeholder: 'Library/Application Support/app.sqlite', description: 'Relative path to database file' },
            { name: 'TABLE', placeholder: 'events', description: 'Table name to watch' },
        ],
        code: `var w = SQLite.watch("{{DB_PATH}}", "{{TABLE}}", 2000);\nif (w.error) {\n    console.log("[SQLite] Watch error: " + w.error);\n} else {\n    console.log("[SQLite] Watching {{TABLE}} (id=" + w.watchId + ", every " + w.intervalMs + "ms)");\n    console.log("[SQLite] Initial rows: " + w.initialRowCount);\n    console.log("[SQLite] Changes will appear in device logs. To stop: SQLite.unwatch(" + w.watchId + ")");\n}`,
    },

    // ---- Hook (additional) ----
    {
        id: 'hook-notifications',
        name: 'Monitor NSNotifications',
        category: 'hook',
        description: 'Log all NSNotificationCenter notifications being posted in the app',
        tags: ['hook', 'notification', 'observe', 'nsnotificationcenter', 'event'],
        code: `function s(v) { return v ? v.toString() : "nil"; }

Interceptor.attach("-[NSNotificationCenter postNotification:]", {
    onEnter: function(self, sel, args) {
        var notif = args[0];
        if (!notif) return;
        var name = s(notif.invoke("name"));
        if (name.indexOf("_UI") === 0) return;
        var obj = notif.invoke("object");
        var sender = obj ? s(obj.invoke("class")) : "nil";
        console.log("[Notify] " + name + " from " + sender);
    }
});

console.log("[WhiteNeedle] NSNotification monitor active (system UI notifications filtered)");`,
    },
    {
        id: 'hook-user-interaction',
        name: 'Track Button Taps & Actions',
        category: 'hook',
        description: 'Log all UIControl sendAction events — captures button taps, switch toggles, etc.',
        tags: ['hook', 'button', 'tap', 'action', 'touch', 'uicontrol', 'interaction'],
        code: `Interceptor.attach("-[UIApplication sendAction:to:from:forEvent:]", {
    onEnter: function(self, sel, args) {
        var action = args[0] ? args[0].toString() : "?";
        var from = args[2] ? (args[2].invoke("class") || "?") : "?";
        var to = args[1] ? (args[1].invoke("class") || "?") : "?";
        console.log("[Action] " + action + "  " + from + " -> " + to);
    }
});

console.log("[WhiteNeedle] UI action tracker active");`,
    },
    {
        id: 'hook-url-scheme',
        name: 'Monitor URL Opens & Deep Links',
        category: 'hook',
        description: 'Log all openURL calls to capture deep links, universal links, and scheme-based routing',
        tags: ['hook', 'url', 'deeplink', 'scheme', 'universal', 'openurl'],
        code: `function s(v) { return v ? v.toString() : "?"; }

Interceptor.attach("-[UIApplication openURL:]", {
    onEnter: function(self, sel, args) {
        var url = args[0] ? s(args[0].invoke("absoluteString")) : "?";
        console.log("[URL] openURL: " + url);
    }
});

Interceptor.attach("-[UIApplication openURL:options:completionHandler:]", {
    onEnter: function(self, sel, args) {
        var url = args[0] ? s(args[0].invoke("absoluteString")) : "?";
        console.log("[URL] openURL (options): " + url);
    }
});

console.log("[WhiteNeedle] URL open monitor active");`,
    },

    // ---- Utility (additional) ----
    {
        id: 'util-list-modules',
        name: 'List Loaded Frameworks',
        category: 'utility',
        description: 'List all loaded dynamic libraries and frameworks, separated by app vs system',
        tags: ['modules', 'dylib', 'framework', 'loaded', 'libraries'],
        code: `var mods = Module.enumerateModules();
var appMods = [];
var sysMods = 0;
mods.forEach(function(m) {
    var n = m.name || "";
    if (n.indexOf("/usr/") === -1 && n.indexOf("/System/") === -1 && n.indexOf("/Library/") === -1) {
        appMods.push(m);
    } else {
        sysMods++;
    }
});
console.log("[Modules] " + mods.length + " loaded (" + appMods.length + " app, " + sysMods + " system)");
console.log("");
console.log("[App Modules]:");
appMods.forEach(function(m) {
    var name = (m.name || "?").split("/").pop();
    console.log("  " + name + " @ " + (m.base || "?"));
});
console.log("");
console.log("[System] " + sysMods + " system frameworks (run Module.enumerateModules() for full list)");`,
    },
    {
        id: 'util-env-dump',
        name: 'Dump Process Environment',
        category: 'utility',
        description: 'Print key environment variables, process info, and main thread status',
        tags: ['environment', 'process', 'info', 'thread', 'debug'],
        code: `var bundle = ObjC.use("NSBundle").invoke("mainBundle");
var device = ObjC.use("UIDevice").invoke("currentDevice");
var screen = ObjC.use("UIScreen").invoke("mainScreen");
var mem = Performance.memory();

console.log("[Env] === Runtime Environment ===");
console.log("  Bundle:  " + (bundle.invoke("bundleIdentifier") || "?"));
console.log("  Device:  " + (device.invoke("model") || "?") + " / " + (device.invoke("systemName") || "?") + " " + (device.invoke("systemVersion") || "?"));
console.log("  Memory:  " + (mem.used / 1024 / 1024).toFixed(1) + " MB used");
console.log("  Sandbox: " + FileSystem.home);
var mods = Module.enumerateModules();
console.log("  Modules: " + mods.length + " loaded");`,
    },
];

export function resolveSnippet(snippet: ScriptSnippet, paramValues: Record<string, string>): string {
    let code = snippet.code;
    for (const [key, value] of Object.entries(paramValues)) {
        code = code.split(`{{${key}}}`).join(value);
    }
    return code;
}

export function searchSnippets(query: string, allSnippets: ScriptSnippet[] = BUILTIN_SNIPPETS): ScriptSnippet[] {
    const q = query.toLowerCase();
    return allSnippets.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(t => t.includes(q)) ||
        s.category.includes(q)
    );
}

// --- Import / Export ---

export interface SnippetExportPayload {
    version: 1;
    exportedAt: string;
    snippets: ScriptSnippet[];
}

export function exportSnippets(snippets: ScriptSnippet[]): string {
    const payload: SnippetExportPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        snippets,
    };
    return JSON.stringify(payload, null, 2);
}

export function importSnippets(raw: string): ScriptSnippet[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('Invalid JSON format');
    }

    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Invalid snippet file: expected an object');
    }

    const obj = parsed as Record<string, unknown>;

    let snippets: unknown[];
    if (Array.isArray(obj)) {
        snippets = obj;
    } else if (obj.version === 1 && Array.isArray(obj.snippets)) {
        snippets = obj.snippets as unknown[];
    } else if (Array.isArray(obj.snippets)) {
        snippets = obj.snippets as unknown[];
    } else {
        throw new Error('Invalid snippet file: missing "snippets" array');
    }

    return snippets.map((item, i) => validateSnippet(item, i));
}

function validateSnippet(raw: unknown, index: number): ScriptSnippet {
    if (typeof raw !== 'object' || raw === null) {
        throw new Error(`Snippet #${index}: expected an object`);
    }
    const obj = raw as Record<string, unknown>;

    if (typeof obj.name !== 'string' || !obj.name) {
        throw new Error(`Snippet #${index}: missing "name"`);
    }
    if (typeof obj.code !== 'string' || !obj.code) {
        throw new Error(`Snippet #${index}: missing "code"`);
    }

    const VALID_CATEGORIES: SnippetCategory[] = ['hook', 'runtime', 'network', 'ui', 'storage', 'performance', 'utility'];
    const category = (typeof obj.category === 'string' && VALID_CATEGORIES.includes(obj.category as SnippetCategory))
        ? obj.category as SnippetCategory
        : 'utility';

    const tags = Array.isArray(obj.tags)
        ? (obj.tags as unknown[]).filter((t): t is string => typeof t === 'string')
        : [];

    const params = Array.isArray(obj.params)
        ? (obj.params as unknown[]).filter((p): p is SnippetParam => {
            if (typeof p !== 'object' || p === null) { return false; }
            const po = p as Record<string, unknown>;
            return typeof po.name === 'string' && typeof po.placeholder === 'string' && typeof po.description === 'string';
          })
        : undefined;

    return {
        id: typeof obj.id === 'string' && obj.id ? obj.id : `custom-${Date.now()}-${index}`,
        name: obj.name,
        category,
        description: typeof obj.description === 'string' ? obj.description : '',
        tags,
        params: params && params.length > 0 ? params : undefined,
        code: obj.code,
    };
}
