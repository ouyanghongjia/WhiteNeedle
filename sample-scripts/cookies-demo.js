/**
 * WhiteNeedle Sample: Cookies API
 *
 * 演示 NSHTTPCookieStorage 操作：
 *   - Cookies.getAll  → 获取所有 Cookie（可按域名过滤）
 *   - Cookies.get     → 获取单个 Cookie
 *   - Cookies.set     → 设置 Cookie
 *   - Cookies.remove  → 删除 Cookie
 *   - Cookies.clear   → 清除所有 Cookie
 */

// ── 1. 列出所有 Cookie ─────────────────────────────────────
var all = Cookies.getAll();
console.log('[Cookies] Total: ' + all.length);
for (var i = 0; i < Math.min(all.length, 10); i++) {
    var c = all[i];
    console.log('  ' + c.domain + ' | ' + c.name + ' = ' + c.value.substring(0, 40));
}

// ── 2. 按域名过滤 ──────────────────────────────────────────
var domain = '.apple.com';
var filtered = Cookies.getAll(domain);
console.log('[Cookies] Domain "' + domain + '": ' + filtered.length + ' cookie(s)');

// ── 3. 设置和读取 Cookie ───────────────────────────────────
Cookies.set({
    name: 'wn_demo',
    value: 'hello_whiteneedle',
    domain: '.example.com',
    path: '/',
    secure: false,
    httpOnly: false
});
console.log('[Cookies] Set wn_demo on .example.com');

var demo = Cookies.get('wn_demo', '.example.com');
console.log('[Cookies] Get wn_demo = ' + (demo ? demo.value : 'not found'));

// ── 4. 清理 ────────────────────────────────────────────────
Cookies.remove('wn_demo', '.example.com');
console.log('[Cookies] Removed wn_demo');
