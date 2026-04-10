/**
 * WhiteNeedle Sample: ObjC Bridge
 *
 * 综合演示 ObjC 运行时桥接能力：
 *   - ObjC.use             → 获取类代理，调用类方法
 *   - ObjC.getClassNames   → 按前缀过滤类名
 *   - invoke('getMethods')  → 获取方法列表
 *   - respondsToSelector    → 检查方法是否存在
 *   - 常见单例探测           → sharedInstance / defaultManager 等
 *   - rpc.exports           → 暴露 RPC 供远程调用
 */

// ── 1. 查看类信息 ──────────────────────────────────────────
var TARGET = 'UIViewController';
var cls = ObjC.use(TARGET);
if (cls) {
    var superCls = cls.invoke('superclass');
    var methods = cls.invoke('getMethods');
    console.log('[ObjC] Class:       ' + TARGET);
    console.log('[ObjC] Superclass:  ' + (superCls ? superCls.invoke('description') : 'none'));
    console.log('[ObjC] Methods:     ' + methods.length);
    console.log('[ObjC] First 5:     ' + methods.slice(0, 5).join(', '));
}

// ── 2. 按前缀过滤类名 ─────────────────────────────────────
var prefix = 'UI';
var matched = ObjC.getClassNames(prefix);
console.log('[ObjC] Classes with "' + prefix + '" prefix: ' + matched.length);

// ── 3. 检查方法是否存在 ────────────────────────────────────
var responds = cls.invoke('respondsToSelector', ['viewDidLoad']);
console.log('[ObjC] UIViewController responds to viewDidLoad? ' + responds);

// ── 4. RPC：远程查询 ──────────────────────────────────────
rpc.exports = {
    /** 获取类信息（类名、父类、方法数） */
    classInfo: function (className) {
        var c = ObjC.use(className);
        if (!c) return { error: 'Class not found: ' + className };
        var sup = c.invoke('superclass');
        return {
            name: className,
            superclass: sup ? sup.invoke('description').toString() : null,
            methodCount: c.invoke('getMethods').length
        };
    },

    /** 检查类是否响应指定选择器 */
    hasMethod: function (className, selector) {
        var c = ObjC.use(className);
        if (!c) return { error: 'Class not found: ' + className };
        return { className: className, selector: selector, responds: c.invoke('respondsToSelector', [selector]) };
    },

    /** 探测常见单例 */
    findSingleton: function (className) {
        var c = ObjC.use(className);
        if (!c) return { error: 'Class not found: ' + className };

        var selectors = [
            'sharedInstance', 'shared', 'defaultManager', 'sharedManager',
            'currentDevice', 'sharedApplication', 'defaultCenter', 'generalPasteboard'
        ];
        for (var i = 0; i < selectors.length; i++) {
            try {
                var inst = c.invoke(selectors[i]);
                if (inst) return { className: className, selector: selectors[i], description: inst.invoke('description').toString() };
            } catch (e) { /* skip */ }
        }
        return { className: className, singleton: null };
    }
};

console.log('[ObjC] RPC ready:');
console.log('  rpcCall("classInfo", ["UIView"])');
console.log('  rpcCall("hasMethod", ["UIView", "setFrame:"])');
console.log('  rpcCall("findSingleton", ["NSFileManager"])');
