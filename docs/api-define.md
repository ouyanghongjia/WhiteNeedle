# 运行时类创建 API

## ObjC.define(spec) — 动态创建 ObjC 类

在运行时动态创建新的 Objective-C 类，支持自定义方法、属性和协议。

- **spec** `object` — 类定义规范
- **返回** `Proxy` — 新创建类的类代理对象

### spec 参数说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | ✅ | 类名。若同名类已存在，仅追加 `methods`（不会重建类） |
| `super` | `string` | ❌ | 父类名，默认 `"NSObject"`（仅新建类时生效） |
| `protocols` | `Array<string>` | ❌ | 要遵循的协议名称列表（仅新建类时生效） |
| `properties` | `Record<string, string>` | ❌ | 属性定义，键为属性名，值为可读类型名（仅新建类时生效） |
| `methods` | `object` | ❌ | 方法定义，键为选择器名称，值为 `{type, func}` 对象 |

> ⚠️ 当 `name` 指定的类已存在时，`protocols` 和 `properties` 会被忽略，仅 `methods` 生效。

### 方法定义规则

**选择器名称**：直接使用 ObjC 选择器格式，**不要**加 `"-"` 或 `"+"` 前缀。

```javascript
// ✅ 正确
"greeting": { type: "void", func: function(self, args) { ... } }
"addA:toB:": { type: "int (int, int)", func: function(self, args) { ... } }

// ❌ 错误 — 不要加前缀
"- greeting": { ... }
"+ addA:toB:": { ... }
```

**方法值格式**：每个方法必须是 `{ type, func }` 对象。

- **type** `string` — 类型签名，格式：`returnType (paramType1, paramType2, ...)`
- **func** `function(self, args)` — JS 回调函数

```javascript
"doWork:": {
    type: "void (NSString *)",
    func: function(self, args) {
        console.log(args[0]); // args[0] 是 NSString
    }
}
```

#### type 格式

与 block 签名格式类似，但**不含 `(^)`**。支持的类型与 `$block` 的 `blockSig` 相同：

| 类型 | 说明 | 类型 | 说明 |
|------|------|------|------|
| `void` | 无返回值 | `id` | 任意 ObjC 对象 |
| `NSString *` | 字符串 | `BOOL` / `bool` | 布尔 |
| `int` | 整型 | `float` / `double` | 浮点 |
| `CGFloat` | 平台浮点 | `NSInteger` / `NSUInteger` | 平台整型 |
| `long long` | 64 位整型 | `CGRect` / `CGPoint` / `CGSize` | 结构体 |

无参方法的写法：

```javascript
"greeting": { type: "void", func: function(self, args) { ... } }
"greeting": { type: "void ()", func: function(self, args) { ... } }
"greeting": { type: "void (void)", func: function(self, args) { ... } }
```

#### func 回调

- **self** `Proxy` — 当前实例的代理对象
- **args** `Array` — 方法参数数组，按 `type` 中声明的类型自动转换

### 基本用法

```javascript
var MyClass = ObjC.define({
    name: "MyHelper",
    super: "NSObject",
    methods: {
        "greeting": {
            type: "void",
            func: function(self, args) {
                console.log("Hello from MyHelper!");
            }
        },
        "addA:toB:": {
            type: "int (int, int)",
            func: function(self, args) {
                return args[0] + args[1];
            }
        }
    }
});

var obj = MyClass.invoke("new");
obj.invoke("greeting");
obj.invoke("addA:toB:", [10, 20]); // ObjC 端也可安全调用：[obj addA:10 toB:20]
```

### 状态管理

在 `ObjC.define` 方法中管理对象状态时，推荐使用 **JavaScript 闭包**而非 `setProperty`/`getProperty`。

```javascript
// ✅ 推荐 — 使用闭包管理状态
var stateStore = {};

var Person = ObjC.define({
    name: "WNPerson",
    super: "NSObject",
    methods: {
        "setName:": {
            type: "void (NSString *)",
            func: function(self, args) {
                stateStore.name = args[0];
            }
        },
        "getName": {
            type: "id",
            func: function(self, args) {
                return stateStore.name;
            }
        },
        "greet": {
            type: "void",
            func: function(self, args) {
                console.log("Hello, " + (stateStore.name || "unknown") + "!");
            }
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
        "setName:": {
            type: "void (NSString *)",
            func: function(self, args) {
                self.setProperty("name", args[0]); // ⚠️ 可能递归
            }
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
        "tableView:numberOfRowsInSection:": {
            type: "NSInteger (id, NSInteger)",
            func: function(self, args) {
                return 10;
            }
        },
        "tableView:cellForRowAtIndexPath:": {
            type: "id (id, id)",
            func: function(self, args) {
                // ...
            }
        }
    }
});
```

### 添加属性

属性值支持**可读类型名**，会自动转换为对应的 ObjC 类型编码：

| 类型写法 | 编码 | 说明 |
|----------|------|------|
| `"id"` 或 `"@"` | `@` | 通用对象 |
| `"NSString *"` 或 `"NSString"` | `@"NSString"` | 具体 ObjC 类（带或不带 `*`） |
| `"int"` | `i` | 整型 |
| `"BOOL"` / `"bool"` | `B` | 布尔 |
| `"float"` / `"double"` | `f` / `d` | 浮点 |
| `"CGFloat"` | `d`(64-bit) | CGFloat |
| `"NSInteger"` / `"NSUInteger"` | `q` / `Q`(64-bit) | 平台整型 |
| `"CGRect"` / `"CGPoint"` / `"CGSize"` | struct 编码 | 常用结构体 |
| `"long long"` / `"char"` / `"short"` | `q` / `c` / `s` | 基础 C 类型 |

对象类型（编码以 `@` 开头）的属性自动添加 `retain` 语义（`&` 属性标记），同时为每个属性创建 `_<propName>` ivar。

> ⚠️ `properties` 只会添加属性元数据和 ivar，**不会自动生成 getter/setter 方法**。如需从 ObjC 访问属性，请在 `methods` 中手动实现 getter/setter 并用闭包管理状态。

```javascript
var Model = ObjC.define({
    name: "DataModel",
    super: "NSObject",
    properties: {
        "title": "NSString *",   // 具体类类型
        "count": "int",           // 基础类型
        "frame": "CGRect"         // 结构体类型
    },
    methods: {
        "initialize": {
            type: "void",
            func: function(self, args) {
                console.log("DataModel initialized");
            }
        }
    }
});
```

### 已存在类的扩展

如果 `name` 指定的类已经存在，`ObjC.define` 不会重新创建类，而是将 `methods` 中的方法添加到已有类上。此时 `protocols` 和 `properties` 会被**忽略**。

```javascript
// 为已有类添加方法
ObjC.define({
    name: "NSObject",
    methods: {
        "myCustomMethod": {
            type: "void",
            func: function(self, args) {
                console.log("自定义方法被调用, class:", self.className());
            }
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
        "tableView:didSelectRowAtIndexPath:": {
            type: "void (id, id)",
            func: function(self, args) {
                var tableView = args[0];
                var indexPath = args[1];
                console.log("选中行:", indexPath.invoke("row"));
            }
        },
        "tableView:heightForRowAtIndexPath:": {
            type: "CGFloat (id, id)",
            func: function(self, args) {
                return 44.0;
            }
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
