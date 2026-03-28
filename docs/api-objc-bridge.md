# ObjC 桥接 API

所有 Objective-C 交互统一在 `ObjC` 命名空间下。

---

## ObjC.use(className)

通过类名获取 ObjC 类的代理对象（Class Proxy）。

- **className** `string` — ObjC 类名
- **返回** `Proxy` — 类代理对象，可调用类方法

```javascript
var UIApp = ObjC.use("UIApplication");
var app = UIApp.invoke("sharedApplication");
console.log(app.className()); // "UIApplication"
```

如果类不存在，返回 `null`。

```javascript
var cls = ObjC.use("NonExistentClass"); // null
```

---

## ObjC.instance(object)

将**任意已有实例**（本质是 `NSObject` 子类的对象）包装成实例代理，以便在脚本里统一使用 `.invoke()` / `.getProperty()` 等。与是否 UIKit 无关——`NSString`、`NSArray`、网络层对象、`ObjC.choose` 回调里拿到的实例等，只要桥接层能给出原生引用，都可以走这条路径。

- **object** `any` — 原生对象、`WNBoxing` 包装的对象，或 **表示对象指针的十六进制字符串**
- **返回** `Proxy | null` — 实例代理；无法包装或地址校验失败时返回 `null`

### 已有对象引用（常规用法）

常见于：`ObjC.choose` 的 `onMatch`、`invoke` 的返回值、其它 API 回传的 Boxing 对象等。

```javascript
var proxy = ObjC.instance(someNativeObject);
proxy.invoke("doSomething");
```

### 十六进制地址字符串

当参数为**仅含指针字面量的字符串**时（可选 `0x` / `0X` 前缀，前后可空白），会解析为地址，在校验通过后包装为代理。适用于日志里的 `%p`、调试工具导出的地址、**`UIDebug.viewHierarchy()` / `viewControllers()` 等返回的 `address` 字段**等——只是典型来源举例，并不要求对象与 UI 相关。

```javascript
// 示例：仅演示「从 address 恢复代理」；换成任意合法 NSObject 地址字符串同理
var node = UIDebug.viewHierarchy(); // 或任意带 address 的调试信息
var view = ObjC.instance(node.address);
if (view) view.invoke("setAlpha:", [0.5]);
```

```javascript
// 另一例：从 VC 列表里选一项（UI 场景举例；非 UI 对象只要地址有效同样可用）
var vcs = UIDebug.viewControllers();
var item = vcs[0];
var vc = item ? ObjC.instance(item.address) : null;
```

格式要求：解析完十六进制后**不能再有其它字符**（否则按普通字符串走 `toObject` 路径，通常得不到可用代理）。与 `printf("%p", ptr)` 常见输出形式一致。

### 地址校验（降低崩溃风险）

对纯十六进制地址会先作**尽力而为**的校验（不调用 `object_getClass` 等会按 isa 解引用的运行时 API）：

- 指针已对齐、落在**可读**的 VM 区域内  
- 可用 `vm_read_overwrite` 读出至少一个 ObjC 对象头（含 `isa`）  
- 若 `malloc_size(address) > 0`，视为典型**堆上的 NSObject 实例**，通过  
- 否则再检查「剥离/对齐后的 isa 所指区域」是否可读（覆盖部分非 malloc 场景）

校验失败时返回 `null`，不会把明显非法地址包装成代理。

> **局限**：仍无法从数学上证明一定是合法 NSObject。野指针若仍映射或内存形态碰巧通过检查，后续 `invoke` 仍可能崩溃。取得地址后应尽快使用。若操作 **UIKit 等必须在主线程使用的类**，仍需保证调用发生在主线程，这与 `ObjC.instance` 本身是否通用无关。

---

## Proxy 对象方法

`ObjC.use()` 和 `ObjC.instance()` 返回的代理对象拥有以下方法：

### proxy.invoke(selector, [args])

调用 ObjC 方法（支持类方法和实例方法），使用 NSInvocation 实现完整参数传递。

- **selector** `string` — ObjC 选择器名称
- **args** `Array` — 参数数组（可选），每个参数对应选择器中的一个冒号
- **返回** `any` — 方法返回值（自动转换为 JS 类型）

**无参数方法：**

```javascript
var app = ObjC.use("UIApplication").invoke("sharedApplication");
var bundle = ObjC.use("NSBundle").invoke("mainBundle");
```

**单参数方法：**

```javascript
var str = ObjC.use("NSString").invoke("stringWithString:", ["Hello World"]);
```

**多参数方法：**

```javascript
var dict = ObjC.use("NSDictionary").invoke("dictionaryWithObject:forKey:", ["value", "key"]);
```

**返回值自动转换规则：**

| ObjC 返回类型 | JS 类型 |
|---------------|---------|
| `NSString` | `string` |
| `NSNumber` | `number` |
| `BOOL` | `boolean` |
| `int` / `float` / `double` 等 | `number` |
| 其他 `NSObject` 子类 | `Proxy`（自动包装为实例代理） |
| `void` | `undefined` |

### proxy.getProperty(name)

通过 KVC（`valueForKey:`）读取 ObjC 属性。

- **name** `string` — 属性名
- **返回** `any` — 属性值

```javascript
var bundle = ObjC.use("NSBundle").invoke("mainBundle");
var bundleId = bundle.getProperty("bundleIdentifier");
console.log("Bundle ID:", bundleId);
```

### proxy.setProperty(name, value)

通过 KVC（`setValue:forKey:`）设置 ObjC 属性。

- **name** `string` — 属性名
- **value** `any` — 要设置的值

```javascript
var view = ObjC.use("UIView").invoke("new");
view.setProperty("alpha", 0.5);
```

### proxy.className()

获取对象的类名。

- **返回** `string` — 类名

```javascript
var app = ObjC.use("UIApplication").invoke("sharedApplication");
console.log(app.className()); // "UIApplication"
```

### proxy.superclass()

获取对象的父类名。

- **返回** `string | null` — 父类名

```javascript
var obj = ObjC.use("NSMutableArray").invoke("new");
console.log(obj.superclass()); // "NSArray"
```

### proxy.respondsToSelector(selector)

检查对象是否响应指定选择器。

- **selector** `string` — 选择器名称
- **返回** `boolean`

```javascript
var app = ObjC.use("UIApplication").invoke("sharedApplication");
console.log(app.respondsToSelector("delegate")); // true
console.log(app.respondsToSelector("nonexistent")); // false
```

### proxy.getMethods()

列出对象所属类的所有方法（含类型编码）。

- **返回** `Array<string>` — 格式为 `"selectorName (typeEncoding)"` 的数组

```javascript
var obj = ObjC.use("NSString").invoke("new");
var methods = obj.getMethods();
methods.forEach(function(m) {
    console.log(m);
});
// "length (q16@0:8)"
// "characterAtIndex: (S24@0:8Q16)"
// ...
```

---

## 类枚举与堆扫描

### ObjC.available

始终为 `true`，表示 ObjC Runtime 可用。

```javascript
if (ObjC.available) {
    console.log("ObjC Runtime 可用");
}
```

### ObjC.classes

返回一个包含所有已注册 ObjC 类名的对象。

- **返回** `object` — 键和值均为类名字符串

```javascript
var classes = ObjC.classes;
if (classes["UIViewController"]) {
    console.log("UIViewController 已注册");
}
```

> 注意：首次调用会遍历所有已注册的类，在大型应用中可能较慢。

### ObjC.getClassNames(filter?)

获取已注册的类名列表，支持可选过滤。

- **filter** `string | undefined` — 过滤字符串（大小写不敏感的包含匹配）
- **返回** `Array<string>` — 排序后的类名数组

```javascript
var all = ObjC.getClassNames();
console.log("总类数:", all.length);

var vcs = ObjC.getClassNames("ViewController");
vcs.forEach(function(name) {
    console.log(name);
});
```

### ObjC.enumerateLoadedClasses(callbacks)

异步枚举所有已注册的 ObjC 类。

- **callbacks** `object`
  - **onMatch(className)** `function` — 每匹配到一个类时调用
  - **onComplete()** `function` — 枚举完成时调用

```javascript
var count = 0;
ObjC.enumerateLoadedClasses({
    onMatch: function(className) {
        count++;
    },
    onComplete: function() {
        console.log("共有", count, "个类");
    }
});
```

### ObjC.choose(className, callbacks)

在堆中搜索指定类的实例（heap scan）。

- **className** `string` — 要搜索的类名
- **callbacks** `object`
  - **onMatch(instance)** `function` — 找到实例时调用
  - **onComplete()** `function` — 搜索完成时调用

```javascript
ObjC.choose("UIViewController", {
    onMatch: function(instance) {
        console.log("找到:", instance);
    },
    onComplete: function() {
        console.log("搜索完成");
    }
});
```

> 注意：当前实现为最佳努力搜索，在非越狱设备上可能无法发现所有实例。

---

## 运行时类创建

### ObjC.define(spec)

在运行时动态创建新的 Objective-C 类。详见 [运行时类创建 API](api-define.md)。

### ObjC.delegate(spec)

快速创建遵循指定协议的代理对象实例。详见 [运行时类创建 API](api-define.md)。

---

## 完整示例

```javascript
// 获取应用信息
var bundle = ObjC.use("NSBundle").invoke("mainBundle");
var bundleId = bundle.getProperty("bundleIdentifier");
console.log("Bundle ID:", bundleId);

// 创建和操作集合
var arr = ObjC.use("NSMutableArray").invoke("new");
arr.invoke("addObject:", ["item1"]);
arr.invoke("addObject:", ["item2"]);

var count = arr.invoke("count");
console.log("数组元素数:", count);

// 字符串操作
var nsStr = ObjC.use("NSString").invoke("stringWithFormat:", ["Hello %@", "World"]);
console.log("字符串:", nsStr);

// 日期操作
var date = ObjC.use("NSDate").invoke("date");
console.log("当前日期:", date.invoke("description"));

// 检查类继承
var obj = ObjC.use("NSMutableDictionary").invoke("new");
console.log("类名:", obj.className());
console.log("父类:", obj.superclass());
console.log("支持 count?", obj.respondsToSelector("count"));

// 创建自定义类
var MyClass = ObjC.define({
    name: "MyHelper",
    super: "NSObject",
    methods: {
        "greet": function(self, args) {
            console.log("Hello!");
        }
    }
});
var helper = MyClass.invoke("new");
helper.invoke("greet");
```

---

## ObjC 命名空间速查

| API | 说明 |
|-----|------|
| `ObjC.use(className)` | 获取类代理 |
| `ObjC.instance(obj)` | 包装实例代理 |
| `ObjC.define(spec)` | 创建/扩展类 |
| `ObjC.delegate(spec)` | 创建协议代理实例 |
| `ObjC.available` | Runtime 可用性 |
| `ObjC.classes` | 所有类名字典 |
| `ObjC.getClassNames(filter?)` | 过滤类名列表 |
| `ObjC.enumerateLoadedClasses(cb)` | 枚举类 |
| `ObjC.choose(className, cb)` | 堆扫描 |
