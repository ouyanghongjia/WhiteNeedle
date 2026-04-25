# WhiteNeedle JavaScript API 文档

WhiteNeedle 是一个基于 JavaScriptCore 的 iOS 动态化引擎，提供 ObjC Runtime 操控、方法 Hook、Block 桥接、原生内存操作等能力，无需 JIT/RWX 内存权限，可在非越狱设备上运行。

## 版本

- 引擎版本：**2.0.0**
- 最低支持：**iOS 15.0**
- 架构：**arm64**

## 其它

| 文档 | 说明 |
|------|------|
| [Inspector 与 VS Code 断点](inspector-vscode.md) | 如何验证设备是否有 CDP `/json`、与 Safari 的差异、纯 VS Code F5 所需能力 |

## API 索引

| 文档 | 说明 |
|------|------|
| [引擎与基础 API](api-engine.md) | `console`、`setTimeout`/`setInterval`、全局变量、`require()` 模块加载、`Debug` 工具 |
| [ObjC 桥接](api-objc-bridge.md) | `ObjC.use()`、`ObjC.instance()`、类代理、方法调用、属性访问、类枚举、堆扫描 |
| [运行时类创建](api-define.md) | `ObjC.define()` 动态创建 ObjC 类、`ObjC.delegate()` 协议代理构建器 |
| [方法 Hook](api-hook-engine.md) | `Interceptor.attach()`、`Interceptor.replace()`、`Interceptor.detach()` |
| [Block 桥接](api-block-bridge.md) | `$block()` 创建 ObjC Block、`$callBlock()` 调用 Block |
| [原生桥接](api-native-bridge.md) | `Module`（模块/符号查找）、`$pointer`（内存读写）、`$struct`（结构体）、C 函数 Hook |
| [Cookie 管理](api-cookies.md) | `Cookies.getAll()`、`Cookies.set()`、`Cookies.remove()` — HTTP Cookie 读写 |
| [UserDefaults](api-userdefaults.md) | `UserDefaults.getAll()`、`UserDefaults.set()`、`UserDefaults.suites()` — 偏好设置管理 |
| [文件系统](api-filesystem.md) | `FileSystem.list()`、`FileSystem.read()`、`FileSystem.write()` — 沙盒文件操作 |
| [性能监控](api-performance.md) | `Performance.memory()`、`Performance.cpu()`、`Performance.fps()` — 实时性能指标 |
| [UI 调试](api-uidebug.md) | `UIDebug.viewHierarchy()`、`UIDebug.screenshot()`、`UIDebug.viewControllers()` — 视图检查 |
| [SQLite](api-sqlite.md) | 沙盒内 SQLite 打开、执行、查询 |
| [MCP 工具与 JSON-RPC](api-mcp-tools.md) | Cursor MCP 工具名与设备端 RPC 方法对照 |
| [测试框架 WNTest](api-test-framework.md) | `WNTest.create()`、describe/it 结构化测试、断言库、异步测试、JSON 结果输出 |
| [UI 自动化 WNAuto](api-ui-automation.md) | `WNAuto.tap()`、`WNAuto.type()`、`WNAuto.scroll()` — 基于直接方法调用的 UI 自动化 |

## Cursor Skill（独立分发）

`skills/whiteneedle-js-api` 为**自包含** skill：API 正文在 **`skills/whiteneedle-js-api/references/`** 内，不引用本目录。单独分发该 skill 时只需打包该文件夹。

仓库维护者更新 `docs/api-*.md` 后，请同步覆盖 `skills/whiteneedle-js-api/references/`（见 skill 内 `references/README.md` 底部命令）。

## 快速开始

```javascript
// 获取 ObjC 类
var UIApp = ObjC.use("UIApplication");
var app = UIApp.invoke("sharedApplication");

// 读取属性
var bundle = ObjC.use("NSBundle").invoke("mainBundle");
var bundleId = bundle.getProperty("bundleIdentifier");
console.log("Bundle ID:", bundleId);

// Hook 方法
Interceptor.attach("-[UIViewController viewDidLoad]", {
    onEnter: function(self, sel, args) {
        console.log("viewDidLoad:", self.className());
    }
});

// 创建自定义类
var MyClass = ObjC.define({
    name: "MyHelper",
    super: "NSObject",
    methods: {
        "doWork:": function(self, args) {
            console.log("Working with:", args[0]);
        }
    }
});
var obj = MyClass.invoke("new");
obj.invoke("doWork:", ["some data"]);
```

## 约定说明

- **统一命名空间**：ObjC 相关操作统一在 `ObjC` 命名空间下（`ObjC.use`、`ObjC.instance`、`ObjC.define`、`ObjC.delegate`、`ObjC.choose` 等）。
- **invoke 参数格式**：所有通过 `invoke()` 传递的参数必须包裹在数组中，例如 `invoke("method:", [arg1])`、`invoke("method:with:", [arg1, arg2])`。无参数时直接 `invoke("method")`。
- **类型编码**：ObjC 类型编码遵循 Apple 标准，如 `@` = id、`v` = void、`B` = BOOL、`:` = SEL、`i` = int 等。
- **代理对象（Proxy）**：`ObjC.use()` 和 `ObjC.instance()` 返回的是代理对象，非原生 ObjC 对象，需通过 `.invoke()`、`.getProperty()`、`.setProperty()` 等方法操作。
