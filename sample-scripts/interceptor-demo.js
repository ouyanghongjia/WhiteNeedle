/**
 * WhiteNeedle Sample: Interceptor (Method Hook)
 *
 * 综合演示 ObjC 方法拦截：
 *   - Interceptor.attach   → 拦截方法（onEnter / onLeave）
 *   - Interceptor.detach   → 取消拦截
 *   - Interceptor.list     → 查看当前已拦截列表
 *   - Interceptor.detachAll → 移除所有拦截
 *
 * 包含两个实用场景：ViewController 生命周期追踪 + 网络请求监控。
 */

// ── 场景 1: ViewController 生命周期 ─────────────────────────
Interceptor.attach('-[UIViewController viewDidAppear:]', {
    onEnter: function (self) {
        var name = self.invoke('class').invoke('description').toString();
        console.log('[Hook] → viewDidAppear: ' + name);
    }
});

Interceptor.attach('-[UIViewController viewDidDisappear:]', {
    onEnter: function (self) {
        var name = self.invoke('class').invoke('description').toString();
        console.log('[Hook] ← viewDidDisappear: ' + name);
    }
});

// ── 场景 2: 网络请求监控 ───────────────────────────────────
Interceptor.attach('-[NSURLSession dataTaskWithRequest:completionHandler:]', {
    onEnter: function (self) {
        console.log('[Hook] 🌐 NSURLSession dataTaskWithRequest: called');
    }
});

Interceptor.attach('-[NSURLSession dataTaskWithURL:completionHandler:]', {
    onEnter: function (self) {
        console.log('[Hook] 🌐 NSURLSession dataTaskWithURL: called');
    }
});

// ── 状态查看 ───────────────────────────────────────────────
var hooks = Interceptor.list();
console.log('[Hook] Active hooks (' + hooks.length + '):');
for (var i = 0; i < hooks.length; i++) {
    console.log('  ' + hooks[i]);
}

console.log('[Hook] To remove one:  Interceptor.detach("-[UIViewController viewDidAppear:]")');
console.log('[Hook] To remove all:  Interceptor.detachAll()');
