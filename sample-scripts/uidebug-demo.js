/**
 * WhiteNeedle Sample: UIDebug
 *
 * 综合演示 UI 调试工具集：
 *   - UIDebug.keyWindow       → 获取当前 keyWindow 信息
 *   - UIDebug.viewHierarchy   → 完整视图树（含 frame / alpha / hidden）
 *   - UIDebug.viewControllers → ViewController 层级
 *   - UIDebug.bounds          → 查询指定视图的位置信息
 *   - UIDebug.screenshot      → 全屏截图（Base64 PNG）
 *   - UIDebug.screenshotView  → 单个视图截图
 *   - rpc.exports             → 远程调用视图树遍历
 */

// ── 1. Key Window 信息 ─────────────────────────────────────
var win = UIDebug.keyWindow();
console.log('[UIDebug] Key window: ' + win.class + ' (' + win.address + ')');
console.log('[UIDebug] Frame: ' + JSON.stringify(win.frame));

// ── 2. ViewController 层级 ─────────────────────────────────
var vcs = UIDebug.viewControllers();
console.log('[UIDebug] ViewController stack (' + vcs.length + '):');
for (var i = 0; i < vcs.length; i++) {
    var indent = '';
    for (var d = 0; d < vcs[i].depth; d++) indent += '  ';
    console.log('  ' + indent + vcs[i].class + ' (' + vcs[i].address + ')');
}

// ── 3. 视图树（前 3 层） ───────────────────────────────────
var tree = UIDebug.viewHierarchy();
function printTree(node, depth) {
    if (!node || depth > 2) return;
    var pad = '';
    for (var p = 0; p < depth; p++) pad += '  ';
    console.log('  ' + pad + node.class + (node.hidden ? ' [hidden]' : ''));
    if (node.children) {
        for (var c = 0; c < Math.min(node.children.length, 5); c++) {
            printTree(node.children[c], depth + 1);
        }
        if (node.children.length > 5) {
            console.log('  ' + pad + '  ... +' + (node.children.length - 5) + ' more');
        }
    }
}
console.log('[UIDebug] View hierarchy (top 3 levels):');
if (tree && tree.length > 0) printTree(tree[0], 0);

// ── 4. 全屏截图 ────────────────────────────────────────────
var base64 = UIDebug.screenshot();
if (base64) {
    console.log('[UIDebug] Screenshot captured: ' + (base64.length / 1024).toFixed(0) + ' KB (Base64 PNG)');
} else {
    console.log('[UIDebug] Screenshot not available');
}

// ── 5. RPC：远程遍历视图树 ─────────────────────────────────
rpc.exports = {
    /** 导出完整视图树 */
    dumpUI: function (maxDepth) {
        maxDepth = maxDepth || 10;
        return dispatch.main(function () {
            var app = ObjC.use('UIApplication').invoke('sharedApplication');
            var windows = app.invoke('windows');
            var count = windows.invoke('count');
            var result = [];
            for (var i = 0; i < count; i++) {
                var w = windows.invoke('objectAtIndex:', [i]);
                result.push(walkView(w, 0, maxDepth));
            }
            return result;
        });
    },

    /** 获取所有已连接的 UIScene 信息 */
    sceneInfo: function () {
        return dispatch.main(function () {
            var app = ObjC.use('UIApplication').invoke('sharedApplication');
            var scenes = app.invoke('connectedScenes');
            return scenes ? scenes.invoke('description').toString() : 'no scenes';
        });
    }
};

function walkView(view, depth, maxDepth) {
    if (depth >= maxDepth) return { truncated: true };
    var cls = view.invoke('class').invoke('description').toString();
    var info = { class: cls, hidden: !!view.invoke('isHidden'), depth: depth };
    var subs = view.invoke('subviews');
    var n = subs.invoke('count');
    if (n > 0) {
        info.children = [];
        for (var i = 0; i < n && i < 50; i++) {
            info.children.push(walkView(subs.invoke('objectAtIndex:', [i]), depth + 1, maxDepth));
        }
    }
    return info;
}

console.log('[UIDebug] RPC ready:');
console.log('  rpcCall("dumpUI")        — full view tree');
console.log('  rpcCall("dumpUI", [3])   — max depth 3');
console.log('  rpcCall("sceneInfo")     — connected scenes');
