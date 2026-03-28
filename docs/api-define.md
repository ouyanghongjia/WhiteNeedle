# 运行时类创建 API

## ObjC.define(spec) — 动态创建 ObjC 类

在运行时动态创建新的 Objective-C 类，支持自定义方法、属性和协议。

- **spec** `object` — 类定义规范
- **返回** `Proxy` — 新创建类的类代理对象

### spec 参数说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | ✅ | 类名（必须唯一） |
| `super` | `string` | ❌ | 父类名，默认 `"NSObject"` |
| `protocols` | `Array<string>` | ❌ | 要遵循的协议名称列表 |
| `properties` | `object` | ❌ | 属性定义，键为属性名，值为类型（目前均为 `id` 类型） |
| `methods` | `object` | ❌ | 方法定义，键为选择器名称，值为 JS 回调函数 |

### 方法定义规则

**选择器名称**：直接使用 ObjC 选择器格式，**不要**加 `"-"` 或 `"+"` 前缀。

```javascript
// ✅ 正确
"greeting": function(self, args) { ... }
"addA:toB:": function(self, args) { ... }

// ❌ 错误 — 不要加前缀
"- greeting": function(self, args) { ... }
"+ addA:toB:": function(self, args) { ... }
```

**回调函数签名**：`function(self, args)`

- **self** `Proxy` — 当前实例的代理对象
- **args** `Array` — 方法参数数组

```javascript
"doSomethingWith:and:": function(self, args) {
    var param1 = args[0]; // 第一个参数
    var param2 = args[1]; // 第二个参数
    console.log("参数:", param1, param2);
}
```

### 基本用法

```javascript
var MyClass = ObjC.define({
    name: "MyHelper",
    super: "NSObject",
    methods: {
        "greeting": function(self, args) {
            console.log("Hello from MyHelper!");
        },
        "addA:toB:": function(self, args) {
            var result = args[0] + args[1];
            console.log("计算结果:", result);
        }
    }
});

// 实例化
var obj = MyClass.invoke("new");

// 调用无参方法
obj.invoke("greeting");

// 调用带参方法
obj.invoke("addA:toB:", [10, 20]);
```

### 类型编码自动推导

`ObjC.define` 会根据选择器中的冒号数量自动生成正确的 ObjC 类型编码：

| 选择器 | 冒号数 | 自动编码 | 含义 |
|--------|--------|----------|------|
| `greeting` | 0 | `v@:` | `void (self, _cmd)` |
| `doWork:` | 1 | `v@:@` | `void (self, _cmd, id)` |
| `addA:toB:` | 2 | `v@:@@` | `void (self, _cmd, id, id)` |
| `setX:y:z:` | 3 | `v@:@@@` | `void (self, _cmd, id, id, id)` |

> 注意：自动生成的类型编码默认返回值为 `void`，参数类型为 `id`。如果方法覆盖了已有方法（如 `NSObject` 的方法），则使用原方法的类型编码。

### 状态管理

在 `ObjC.define` 方法中管理对象状态时，推荐使用 **JavaScript 闭包**而非 `setProperty`/`getProperty`。

```javascript
// ✅ 推荐 — 使用闭包管理状态
var stateStore = {};

var Person = ObjC.define({
    name: "WNPerson",
    super: "NSObject",
    methods: {
        "setName:": function(self, args) {
            stateStore.name = args[0];
        },
        "getName": function(self, args) {
            return stateStore.name;
        },
        "greet": function(self, args) {
            console.log("Hello, " + (stateStore.name || "unknown") + "!");
        }
    }
});

var person = Person.invoke("new");
person.invoke("setName:", ["Alice"]);
person.invoke("greet"); // "Hello, Alice!"
```

```javascript
// ⚠️ 避免 — 在 ObjC.define 方法中使用 setProperty/getProperty 操作同名属性
// 可能导致 KVC → msgForward → JS → KVC 递归
var Bad = ObjC.define({
    name: "BadExample",
    super: "NSObject",
    methods: {
        "setName:": function(self, args) {
            self.setProperty("name", args[0]); // ⚠️ 可能递归
        }
    }
});
```

### 添加协议

```javascript
var MyDelegate = ObjC.define({
    name: "MyTableDelegate",
    super: "NSObject",
    protocols: ["UITableViewDelegate", "UITableViewDataSource"],
    methods: {
        "tableView:numberOfRowsInSection:": function(self, args) {
            return 10;
        },
        "tableView:cellForRowAtIndexPath:": function(self, args) {
            // ...
        }
    }
});
```

### 添加属性

```javascript
var Model = ObjC.define({
    name: "DataModel",
    super: "NSObject",
    properties: {
        "title": "@",   // id 类型
        "count": "@"
    },
    methods: {
        "initialize": function(self, args) {
            console.log("DataModel initialized");
        }
    }
});
```

### 已存在类的扩展

如果 `name` 指定的类已经存在，`ObjC.define` 不会重新创建类，而是将 `methods` 中的方法添加到已有类上。

```javascript
// 为已有类添加方法
ObjC.define({
    name: "NSObject",
    methods: {
        "myCustomMethod": function(self, args) {
            console.log("自定义方法被调用, class:", self.className());
        }
    }
});

// 所有 NSObject 子类的实例都可以调用
var obj = ObjC.use("NSObject").invoke("new");
obj.invoke("myCustomMethod");
```

---

## ObjC.delegate(spec) — 协议代理构建器

快速创建遵循指定协议的代理对象实例。内部基于 `ObjC.define` 实现，自动生成唯一类名并返回已实例化的对象。

- **spec** `object` — 代理定义规范
- **返回** `Proxy` — 已实例化的代理对象

### spec 参数说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `protocols` | `Array<string>` | ✅ | 要遵循的协议名称列表 |
| `methods` | `object` | ✅ | 协议方法实现 |

### 基本用法

```javascript
var delegate = ObjC.delegate({
    protocols: ["UITableViewDelegate"],
    methods: {
        "tableView:didSelectRowAtIndexPath:": function(self, args) {
            var tableView = args[0];
            var indexPath = args[1];
            console.log("选中行:", indexPath.invoke("row"));
        },
        "tableView:heightForRowAtIndexPath:": function(self, args) {
            return 44.0;
        }
    }
});

// 将代理设置给 tableView
tableView.invoke("setDelegate:", [delegate]);
```

### 与 ObjC.define 的区别

| 特性 | ObjC.define | ObjC.delegate |
|------|-------------|---------------|
| 返回值 | 类代理（需手动 `invoke("new")`） | 已实例化的对象代理 |
| 类名 | 手动指定 | 自动生成（`WNDelegate_1`, `WNDelegate_2`, ...） |
| 用途 | 创建可复用的类 | 快速创建一次性代理对象 |

### 完整示例：设置 UIAlertController 的 Action

```javascript
// 创建 AlertController
var alert = ObjC.use("UIAlertController").invoke(
    "alertControllerWithTitle:message:preferredStyle:",
    ["提示", "这是一条消息", 1]
);

// 使用 ObjC.delegate 不适用于 block 回调场景
// 对于需要 block 回调的场景，请使用 $block API
// 参见 api-block-bridge.md
```
