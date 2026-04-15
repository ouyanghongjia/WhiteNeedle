# 引擎与基础 API

## 全局变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `__wnVersion` | `string` | 引擎版本号，当前为 `"2.0.0"` |
| `__wnEngine` | `string` | 底层引擎名称，当前为 `"JavaScriptCore"` |
| `Process.platform` | `string` | 平台标识，固定为 `"ios"` |
| `Process.arch` | `string` | 架构标识，固定为 `"arm64"` |
| `rpc.exports` | `object` | 用于向外部暴露可调用接口的对象容器 |

```javascript
console.log(__wnVersion);     // "2.0.0"
console.log(Process.platform); // "ios"
console.log(Process.arch);     // "arm64"
```

---

## console — 控制台输出

提供与浏览器兼容的 `console` 对象，所有输出会通过 NSLog 输出到系统日志，同时可通过 `WNJSEngineDelegate` 回调接收。

### console.log(...args)

输出普通日志。

```javascript
console.log("Hello", 42, {key: "value"});
// [WhiteNeedle:JS] [log] Hello 42 { "key": "value" }
```

### console.warn(...args)

输出警告级别日志。

```javascript
console.warn("This is a warning");
```

### console.error(...args)

输出错误级别日志。

```javascript
console.error("Something went wrong:", err);
```

### console.info(...args)

输出信息级别日志。

```javascript
console.info("App started");
```

### console.debug(...args)

输出调试级别日志。

```javascript
console.debug("Debug data:", obj);
```

> 所有 console 方法支持任意数量的参数，对象类型会被 `JSON.stringify` 格式化。

---

## 定时器

提供与浏览器兼容的定时器 API，基于 `NSTimer` 运行在主线程 RunLoop 上。

### setTimeout(callback, delayMs)

延迟执行一次回调函数。

- **callback** `function` — 要执行的函数
- **delayMs** `number` — 延迟毫秒数
- **返回** `number` — 定时器 ID

```javascript
var id = setTimeout(function() {
    console.log("1 秒后执行");
}, 1000);
```

### setInterval(callback, intervalMs)

每隔固定时间重复执行回调函数。

- **callback** `function` — 要执行的函数
- **intervalMs** `number` — 间隔毫秒数
- **返回** `number` — 定时器 ID

```javascript
var count = 0;
var id = setInterval(function() {
    count++;
    console.log("执行次数:", count);
    if (count >= 5) clearInterval(id);
}, 500);
```

### clearTimeout(timerId)

取消由 `setTimeout` 创建的定时器。

- **timerId** `number` — `setTimeout` 返回的 ID

```javascript
var id = setTimeout(function() { /* ... */ }, 5000);
clearTimeout(id);
```

### clearInterval(timerId)

取消由 `setInterval` 创建的定时器。

- **timerId** `number` — `setInterval` 返回的 ID

```javascript
var id = setInterval(function() { /* ... */ }, 1000);
clearInterval(id);
```

---

## require() — 模块加载

实现 CommonJS 风格的模块系统，支持 `.js` 和 `.json` 文件。

### require(moduleName)

加载并返回模块的 `exports` 对象。

- **moduleName** `string` — 模块名称或相对路径
- **返回** `any` — 模块导出的内容

```javascript
var events = require("events");
var emitter = new events.EventEmitter();

emitter.on("data", function(msg) {
    console.log("收到:", msg);
});
emitter.emit("data", "hello");
```

### 模块搜索路径

模块按以下顺序搜索：

1. 内置模块（`events`、`util`）
2. `Library/wn_modules/` 目录
3. `Library/wn_installed_modules/` 目录
4. `App.bundle/wn_modules/` 目录

搜索时自动尝试以下后缀：无后缀 → `.js` → `.json` → `/index.js`

### 内置模块

#### events

```javascript
var events = require("events");
var emitter = new events.EventEmitter();

emitter.on("eventName", function(arg1, arg2) {
    console.log(arg1, arg2);
});

emitter.emit("eventName", "hello", 42);

emitter.off("eventName"); // 移除该事件的所有监听器
```

**EventEmitter 方法：**

| 方法 | 说明 |
|------|------|
| `on(event, fn)` | 注册事件监听器，返回 `this` |
| `emit(event, ...args)` | 触发事件，返回 `boolean`（是否有监听器） |
| `off(event, fn?)` | 移除监听器，`fn` 为空时移除该事件全部监听器 |

#### util

```javascript
var util = require("util");

var msg = util.format("Hello %s, you are %d", "Alice", 30);
// "Hello Alice, you are 30"

var json = util.inspect({name: "test"});
// 格式化输出对象的 JSON 字符串
```

**util 方法：**

| 方法 | 说明 |
|------|------|
| `format(fmt, ...args)` | 字符串格式化，支持 `%s`（字符串）和 `%d`（数字） |
| `inspect(obj)` | 返回 `JSON.stringify(obj, null, 2)` |

### Module.searchPaths

当前的模块搜索路径数组（只读）。

```javascript
console.log(Module.searchPaths);
```

### Module.addSearchPath(path)

添加额外的模块搜索路径。

- **path** `string` — 文件系统路径

```javascript
Module.addSearchPath("/var/mobile/Documents/my_modules");
```

### Module.clearCache()

清除已缓存的模块，下次 `require` 将重新加载。

```javascript
Module.clearCache();
```

### Module.listCached()

列出所有已缓存的模块。

- **返回** `Array<{name: string, loaded: boolean}>` — 已缓存模块列表

```javascript
var cached = Module.listCached();
console.log(cached);
// [{"name": "events", "loaded": true}, ...]
```

---

## dispatch — 线程调度

提供主线程调度能力。在 JS 脚本中访问 UIKit 对象（获取 view、设置颜色、修改 frame 等）时，必须在 App 的主线程上执行。`dispatch` 命名空间提供了同步和异步两种调度方式。

### dispatch.main(fn)

在主线程上**同步**执行函数，阻塞当前执行直到完成，返回函数的返回值。如果已在主线程则直接执行（不会死锁）。

- **fn** `function` — 要在主线程执行的函数
- **返回** — fn 的返回值

```javascript
// 同步获取 key window（需要主线程）
var window = dispatch.main(function() {
    var UIApp = ObjC.use("UIApplication");
    var app = UIApp.invoke("sharedApplication");
    var keyWindow = app.invoke("keyWindow");
    return keyWindow;
});
console.log("Key Window:", window);
```

### dispatch.mainAsync(fn)

在主线程上**异步**执行函数，立即返回不等待完成。适用于只需要修改 UI 而不需要返回值的场景。

- **fn** `function` — 要在主线程执行的函数

```javascript
// 异步修改视图颜色（不需要返回值）
dispatch.mainAsync(function() {
    var UIColor = ObjC.use("UIColor");
    var red = UIColor.invoke("redColor");
    someView.invoke("setBackgroundColor:", [red]);
});
```

### dispatch.after(delayMs, fn)

延迟指定毫秒后在主线程上执行函数。

- **delayMs** `number` — 延迟时间（毫秒）
- **fn** `function` — 要执行的函数

```javascript
// 1秒后在主线程执行
dispatch.after(1000, function() {
    console.log("1秒后的主线程操作");
    var alert = ObjC.use("UIAlertController").invoke(
        "alertControllerWithTitle:message:preferredStyle:",
        ["提示", "Hello from WhiteNeedle!", 1]
    );
    // ...
});
```

### dispatch.isMainThread()

检查当前代码是否运行在主线程上。

- **返回** `boolean`

```javascript
if (dispatch.isMainThread()) {
    console.log("当前在主线程");
} else {
    console.log("当前不在主线程");
}
```

### 使用场景示例

```javascript
// 在 hook 回调中安全地操作 UI
Interceptor.attach("-[MyViewController viewDidAppear:]", {
    onEnter: function(self, sel, args) {
        // hook 回调可能不在主线程，用 dispatch.mainAsync 保证安全
        dispatch.mainAsync(function() {
            var UIColor = ObjC.use("UIColor");
            var color = UIColor.invoke("colorWithRed:green:blue:alpha:", [0.2, 0.6, 1.0, 1.0]);
            self.invoke("view").invoke("setBackgroundColor:", [color]);
        });
    }
});

// 同步获取 ViewController 栈
var vcStack = dispatch.main(function() {
    var UIApp = ObjC.use("UIApplication");
    var app = UIApp.invoke("sharedApplication");
    var window = app.invoke("keyWindow");
    var rootVC = window.invoke("rootViewController");
    return rootVC.className();
});
console.log("Root VC:", vcStack);
```

---

## Debug — 调试工具

提供程序化调试辅助功能，配合 Safari Web Inspector 使用效果最佳。

### Debug.breakpoint()

触发 JavaScript `debugger` 语句，在连接了 Safari Web Inspector 时会暂停执行。

```javascript
Debug.breakpoint();
```

### Debug.log(level, message)

带级别的结构化日志输出。

- **level** `string` — 日志级别（自定义字符串）
- **message** `any` — 日志内容

```javascript
Debug.log("network", "Request sent to /api/users");
```

### Debug.trace()

打印当前 JavaScript 调用栈并返回栈信息。

- **返回** `string` — 调用栈字符串

```javascript
var stack = Debug.trace();
console.log(stack);
```

### Debug.time(label)

开始一个命名计时器。

- **label** `string` — 计时器名称（可选，默认 `"default"`）

```javascript
Debug.time("myOperation");
// ... 执行一些操作 ...
var elapsed = Debug.timeEnd("myOperation");
console.log("耗时:", elapsed, "ms");
```

### Debug.timeEnd(label)

结束命名计时器并输出耗时。

- **label** `string` — 计时器名称
- **返回** `number` — 经过的毫秒数

```javascript
Debug.time("fetch");
// ... 耗时操作 ...
var ms = Debug.timeEnd("fetch"); // 输出: [WNDebugSupport] fetch: 123.45ms
```

### Debug.heapSize()

获取当前进程的内存使用信息。

- **返回** `{residentSize: number, virtualSize: number}` — 内存大小（字节）

```javascript
var mem = Debug.heapSize();
console.log("驻留内存:", mem.residentSize);
console.log("虚拟内存:", mem.virtualSize);
```

---

## __wnLog(message)

底层日志函数，直接输出到 NSLog。

- **message** `string` — 日志内容

```javascript
__wnLog("直接日志输出");
```
