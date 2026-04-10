/**
 * WhiteNeedle Sample: UserDefaults API
 *
 * 演示 NSUserDefaults 的读写和审计：
 *   - UserDefaults.suites    → 列出所有偏好设置 suite
 *   - UserDefaults.getAll    → 获取所有键值对
 *   - UserDefaults.getAllApp → 仅获取 App 自定义键（过滤系统键）
 *   - UserDefaults.get/set   → 读写指定键
 *   - UserDefaults.remove    → 删除键
 */

// ── 1. 列出所有 Suite ──────────────────────────────────────
var suites = UserDefaults.suites();
console.log('[UD] Found ' + suites.length + ' suite(s):');
for (var i = 0; i < suites.length; i++) {
    console.log('  ' + suites[i].name + ' (' + suites[i].keyCount + ' keys)');
}

// ── 2. 获取仅 App 自定义的键值 ─────────────────────────────
var appKeys = UserDefaults.getAllApp();
console.log('[UD] App-only keys: ' + Object.keys(appKeys).length);
var keys = Object.keys(appKeys);
for (var j = 0; j < Math.min(keys.length, 10); j++) {
    var val = appKeys[keys[j]];
    var display = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (display.length > 80) display = display.substring(0, 80) + '...';
    console.log('  ' + keys[j] + ' = ' + display);
}

// ── 3. 读写示例 ────────────────────────────────────────────
UserDefaults.set('wn_demo_key', 'WhiteNeedle rocks!');
console.log('[UD] Set wn_demo_key');

var value = UserDefaults.get('wn_demo_key');
console.log('[UD] Get wn_demo_key = ' + value);

UserDefaults.remove('wn_demo_key');
console.log('[UD] Removed wn_demo_key');
