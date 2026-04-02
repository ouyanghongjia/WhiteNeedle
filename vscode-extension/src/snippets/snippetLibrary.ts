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
            console.log("[VC] " + self.invoke("class").invoke("description") + " " + sel);
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
    var methods = cls.$methods;
    console.log("[Trace] Hooking " + methods.length + " methods on {{CLASS_NAME}}");
    methods.forEach(function(m) {
        try {
            Interceptor.attach(m, {
                onEnter: function(self) {
                    console.log("[Trace] " + m);
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
var allClasses = ObjC.enumerateLoadedClasses();
var matched = allClasses.filter(function(name) {
    return name.indexOf(filter) !== -1;
});

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
    var methods = cls.$methods;
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
        code: `var cls = ObjC.use("{{CLASS_NAME}}");
if (!cls) {
    console.error("[Hierarchy] Class not found: {{CLASS_NAME}}");
} else {
    var chain = [];
    var current = cls;
    while (current) {
        chain.push(current.invoke("description").toString());
        current = current.invoke("superclass");
    }
    console.log("[Hierarchy] {{CLASS_NAME}} inheritance chain:");
    chain.forEach(function(name, i) {
        console.log("  " + "  ".repeat(i) + name);
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
        code: `Interceptor.attach("-[NSURLSession dataTaskWithRequest:completionHandler:]", {
    onEnter: function(self, sel, args) {
        var req = args[0];
        var url = req.invoke("URL").invoke("absoluteString").toString();
        var method = req.invoke("HTTPMethod").toString();
        console.log("[NET] " + method + " " + url);
    }
});

Interceptor.attach("-[NSURLSession dataTaskWithURL:completionHandler:]", {
    onEnter: function(self, sel, args) {
        var url = args[0].invoke("absoluteString").toString();
        console.log("[NET] GET " + url);
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
        code: `Interceptor.attach("-[NSURLSession dataTaskWithRequest:completionHandler:]", {
    onEnter: function(self, sel, args) {
        var req = args[0];
        var url = req.invoke("URL").invoke("absoluteString").toString();
        var method = req.invoke("HTTPMethod").toString();
        var headers = req.invoke("allHTTPHeaderFields");
        console.log("[NET] " + method + " " + url);
        if (headers) {
            console.log("[NET] Headers: " + headers.invoke("description").toString());
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
        code: `Interceptor.attach("-[NSURLSession dataTaskWithRequest:completionHandler:]", {
    onEnter: function(self, sel, args) {
        var req = args[0];
        var url = req.invoke("URL").invoke("absoluteString").toString();
        if (url.indexOf("{{DOMAIN}}") !== -1) {
            var method = req.invoke("HTTPMethod").toString();
            console.log("[NET] " + method + " " + url);
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
        description: 'Print the full view hierarchy from the key window',
        tags: ['ui', 'view', 'hierarchy', 'dump'],
        code: `function dumpView(view, depth) {
    var indent = "";
    for (var i = 0; i < depth; i++) indent += "  ";
    var cls = view.invoke("class").invoke("description").toString();
    var hidden = view.invoke("isHidden") ? " [hidden]" : "";
    console.log(indent + cls + hidden);
    var subs = view.invoke("subviews");
    var count = subs.invoke("count");
    for (var i = 0; i < count && i < 50; i++) {
        dumpView(subs.invoke("objectAtIndex:", i), depth + 1);
    }
}

var app = ObjC.use("UIApplication").invoke("sharedApplication");
var keyWindow = app.invoke("keyWindow");
if (keyWindow) {
    console.log("[UI] View hierarchy from keyWindow:");
    dumpView(keyWindow, 0);
} else {
    console.log("[UI] No keyWindow found");
}`,
    },
    {
        id: 'ui-find-viewcontrollers',
        name: 'List All ViewControllers',
        category: 'ui',
        description: 'Find all active UIViewControllers in the window hierarchy',
        tags: ['ui', 'viewcontroller', 'list'],
        code: `var app = ObjC.use("UIApplication").invoke("sharedApplication");
var keyWindow = app.invoke("keyWindow");

function findVCs(responder, depth) {
    if (!responder) return;
    var cls = responder.invoke("class").invoke("description").toString();
    if (cls.indexOf("ViewController") !== -1 || cls.indexOf("Controller") !== -1) {
        var indent = "";
        for (var i = 0; i < depth; i++) indent += "  ";
        console.log(indent + cls);
    }
    if (responder.invoke("respondsToSelector:", "childViewControllers")) {
        var children = responder.invoke("childViewControllers");
        var count = children.invoke("count");
        for (var i = 0; i < count; i++) {
            findVCs(children.invoke("objectAtIndex:", i), depth + 1);
        }
    }
}

var rootVC = keyWindow ? keyWindow.invoke("rootViewController") : null;
if (rootVC) {
    console.log("[UI] Active ViewControllers:");
    findVCs(rootVC, 0);
} else {
    console.log("[UI] No rootViewController found");
}`,
    },

    // ---- Storage ----
    {
        id: 'storage-userdefaults-dump',
        name: 'Dump UserDefaults',
        category: 'storage',
        description: 'Print all key-value pairs in NSUserDefaults standardUserDefaults',
        tags: ['userdefaults', 'dump', 'storage'],
        code: `var defaults = ObjC.use("NSUserDefaults").invoke("standardUserDefaults");
var dict = defaults.invoke("dictionaryRepresentation");
var keys = dict.invoke("allKeys");
var count = keys.invoke("count");
console.log("[Storage] NSUserDefaults — " + count + " keys:");
for (var i = 0; i < count; i++) {
    var key = keys.invoke("objectAtIndex:", i).toString();
    var val = dict.invoke("objectForKey:", keys.invoke("objectAtIndex:", i));
    console.log("  " + key + " = " + (val ? val.invoke("description").toString() : "nil"));
}`,
    },
    {
        id: 'storage-keychain-read',
        name: 'Read Keychain Items (Query)',
        category: 'storage',
        description: 'Query Keychain items for a given service name',
        tags: ['keychain', 'security', 'credentials'],
        params: [
            { name: 'SERVICE', placeholder: 'com.myapp.auth', description: 'Keychain service identifier' },
        ],
        code: `var query = ObjC.use("NSMutableDictionary").invoke("alloc").invoke("init");
query.invoke("setObject:forKey:",
    ObjC.use("NSString").invoke("stringWithString:", "{{SERVICE}}"),
    $bridge.constant("kSecAttrService"));
query.invoke("setObject:forKey:",
    $bridge.constant("kSecClassGenericPassword"),
    $bridge.constant("kSecClass"));
query.invoke("setObject:forKey:",
    $bridge.constant("kCFBooleanTrue"),
    $bridge.constant("kSecReturnAttributes"));
query.invoke("setObject:forKey:",
    $bridge.constant("kSecMatchLimitAll"),
    $bridge.constant("kSecMatchLimit"));

var result = $bridge.ref();
var status = $bridge.call("SecItemCopyMatching", query, result);
console.log("[Keychain] Status:", status, "(0 = success)");
if (status === 0 && result.value) {
    console.log("[Keychain] Items:", result.value.invoke("description").toString());
}`,
    },

    // ---- Performance ----
    {
        id: 'perf-memory-snapshot',
        name: 'Memory Usage Snapshot',
        category: 'performance',
        description: 'Report current app memory usage via Mach APIs',
        tags: ['memory', 'performance', 'monitor'],
        code: `var info = Performance.memoryInfo();
console.log("[Perf] Memory Snapshot:");
console.log("  Resident: " + (info.resident / 1024 / 1024).toFixed(1) + " MB");
console.log("  Virtual:  " + (info.virtual / 1024 / 1024).toFixed(1) + " MB");
console.log("  Physical: " + (info.physical / 1024 / 1024).toFixed(1) + " MB free");`,
    },
    {
        id: 'perf-fps-monitor',
        name: 'FPS Monitor',
        category: 'performance',
        description: 'Start a continuous FPS monitoring loop',
        tags: ['fps', 'performance', 'render', 'monitor'],
        code: `Performance.startFPSMonitoring(function(fps) {
    if (fps < 55) {
        console.warn("[FPS] Drop detected: " + fps + " fps");
    }
});

console.log("[WhiteNeedle] FPS monitor active — warnings below 55 fps");`,
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
            bundleId: bundle.invoke("bundleIdentifier").toString(),
            version: bundle.invoke("objectForInfoDictionaryKey:", "CFBundleShortVersionString").toString(),
            build: bundle.invoke("objectForInfoDictionaryKey:", "CFBundleVersion").toString()
        };
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
        description: 'Display the running app bundle ID, version, and build number',
        tags: ['app', 'info', 'bundle', 'version'],
        code: `var bundle = ObjC.use("NSBundle").invoke("mainBundle");
var bundleId = bundle.invoke("bundleIdentifier").toString();
var version = bundle.invoke("objectForInfoDictionaryKey:", "CFBundleShortVersionString").toString();
var build = bundle.invoke("objectForInfoDictionaryKey:", "CFBundleVersion").toString();
var name = bundle.invoke("objectForInfoDictionaryKey:", "CFBundleDisplayName");

console.log("[App] Bundle ID: " + bundleId);
console.log("[App] Name:      " + (name ? name.toString() : "N/A"));
console.log("[App] Version:   " + version + " (" + build + ")");`,
    },
    {
        id: 'util-device-info',
        name: 'Print Device Info',
        category: 'utility',
        description: 'Display current device model, OS version, and name',
        tags: ['device', 'info', 'ios'],
        code: `var device = ObjC.use("UIDevice").invoke("currentDevice");
console.log("[Device] Name:       " + device.invoke("name").toString());
console.log("[Device] Model:      " + device.invoke("model").toString());
console.log("[Device] System:     " + device.invoke("systemName").toString() + " " + device.invoke("systemVersion").toString());
console.log("[Device] Identifier: " + device.invoke("identifierForVendor").invoke("UUIDString").toString());`,
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
