# Block 桥接 API

提供 JavaScript 函数与 Objective-C Block 之间的双向桥接。基于 libffi 动态创建 Block，**参数数量和类型组合不受限制**。

---

## ObjC 风格签名（`$blockSig`）

可不记类型编码，直接用接近 ObjC 源码的写法生成 **`返回类型 + @? + 参数列表`** 的字符串。

### `$blockSig(signature)`

- **signature** `string` — 如 `void (^)(id, double)`、`void(^)(BOOL)`
- **返回** `string | null` — 成功时为编码（如 `v@?@d`），解析失败为 `null`（控制台会打印原因）

### 与 `$block` / `$callBlock` 连用

若第二参字符串里包含 **`(^)`**，`$block` 与 `$callBlock` 会先按 ObjC 风格解析，**失败则不再回退**（返回 `null`）。不含 `(^)` 时仍视为**原始类型编码**（如 `v@?@`）。

### 语法要点

- 形式：**`返回类型 (^)(参数列表)`**；括号、`^` 周围空格可有可无（如 `void(^)(id,double)`）
- 无参：**`void (^)()`** 或 **`void (^)(void)`**
- **`NSString *`、`NSDate *` 等**对象请写 **`id`**
- **嵌套 block**：内层写完整签名，例如 `void (^)(id, void (^)(double))`；编码上嵌套的 block 形参仍对应 **`@?`**（与白盒简化编码一致，内层签名不展开进编码串）

### 支持的类型名

| 类型名 | 说明 |
|--------|------|
| `void`, `id`, `BOOL`, `bool` | |
| `int`, `short`, `long`, `char`, `float`, `double` | |
| `NSInteger`, `NSUInteger`, `CGFloat` | 与当前架构 `@encode` 一致 |
| `unsigned int` / `unsigned long` / `unsigned long long` / `unsigned short` / `unsigned char` | |
| `long long` | |
| `Class`, `SEL` | |
| `CGRect`, `CGPoint`, `CGSize` | struct 类型 |
| 嵌套 block | 上述形式的子表达式 |

---

## $block(fn, typeEncoding) — 创建 ObjC Block

将一个 JavaScript 函数包装为真正的 Objective-C Block 对象，可传递给任何期望 Block 参数的 ObjC API。

- **fn** `function` — JavaScript 回调函数
- **typeEncoding** `string` — Block 的 ObjC 类型编码，**或** ObjC 风格签名（须含 `(^)`，见上一节）
- **返回** `BoxedBlock` — 封装后的 Block 对象（可传给 `invoke` 或 `$callBlock`）

### 类型编码格式

Block 类型编码遵循 ObjC 标准，格式为 `返回类型 + @? + 参数类型列表`：

| 编码 | Block 签名 | 说明 |
|------|-----------|------|
| `v@?` | `void (^)(void)` | 无参无返回值 |
| `v@?@` | `void (^)(id)` | 1 个 id 参数 |
| `v@?@@` | `void (^)(id, id)` | 2 个 id 参数 |
| `v@?B` | `void (^)(BOOL)` | 1 个 BOOL 参数 |
| `@@?@` | `id (^)(id)` | 1 个 id 参数，返回 id |
| `v@?@d` | `void (^)(id, double)` | 1 个 id + 1 个 double 参数 |
| `v@?d` | `void (^)(double)` | 1 个 double 参数 |
| `d@?d` | `double (^)(double)` | 1 个 double 参数，返回 double |

### 常用类型编码字符

| 字符 | 类型 |
|------|------|
| `v` | `void` |
| `@` | `id`（任何 ObjC 对象） |
| `@?` | Block（固定位于参数列表开头，代表 Block 本身） |
| `B` | `BOOL` |
| `i` | `int` |
| `I` | `unsigned int` |
| `q` | `long long` |
| `Q` | `unsigned long long` |
| `d` | `double` |
| `f` | `float` |
| `#` | `Class` |
| `:` | `SEL` |
| `^` | 指针 |

### 基本用法

```javascript
// ObjC 风格（推荐）
var block = $block(function () {
    console.log("Block 被调用!");
}, "void (^)()");

// 与原始编码等价
var same = $blockSig("void (^)()"); // "v@?"

// 带参数与嵌套 block 参数
var nested = $block(function (x, completion) {
    /* completion 为 BoxedBlock */
}, "void (^)(id, void (^)(double))");
```

```javascript
// 原始类型编码
var block = $block(function() {
    console.log("Block 被调用!");
}, "v@?");

var blockWithArg = $block(function(str) {
    console.log("收到:", str);
}, "v@?@");

var blockWithReturn = $block(function(input) {
    return "处理后: " + input;
}, "@@?@");
```

### 传递给 ObjC 方法

```javascript
// 示例：使用 NSArray 的排序 Block
var array = ObjC.use("NSMutableArray").invoke("arrayWithArray:", [["banana", "apple", "cherry"]]);

var comparator = $block(function(str1, str2) {
    // NSComparisonResult: -1 = ascending, 0 = same, 1 = descending
    if (str1 < str2) return -1;
    if (str1 > str2) return 1;
    return 0;
}, "q@?@@");

array.invoke("sortUsingComparator:", [comparator]);
```

### struct 参数与返回值

基于 libffi，`$block` 完整支持 struct 类型作为参数和返回值，且可与其他任何类型自由组合。

```javascript
// CGRect 参数 + CGRect 返回
var insetBlock = $block(function(rect) {
    return {x: rect.x + 10, y: rect.y + 10,
            width: rect.width - 20, height: rect.height - 20};
}, "CGRect (^)(CGRect)");

// struct + float/double 混用
var scaleBlock = $block(function(point, scale) {
    return {x: point.x * scale, y: point.y * scale};
}, "CGPoint (^)(CGPoint, double)");

// 多个 struct 参数
var unionBlock = $block(function(r1, r2) {
    /* ... */
}, "CGRect (^)(CGRect, CGRect)");
```

已注册的 struct 类型：

| 类型 | 说明 |
|------|------|
| `CGRect` | `{x, y, width, height}` (4 × double) |
| `CGPoint` | `{x, y}` (2 × double) |
| `CGSize` | `{width, height}` (2 × double) |
| `CGVector` | `{dx, dy}` (2 × double) |
| `NSRange` | `{location, length}` (2 × uint64) |
| `UIEdgeInsets` | `{top, left, bottom, right}` (4 × double) |
| `CGAffineTransform` | (6 × double) |

### 参数数量

使用 libffi 动态生成 block，**参数数量没有硬性上限**。

---

## $callBlock(block, typeEncoding, ...args) — 调用 ObjC Block

从 JavaScript 调用一个 ObjC Block。

- **block** `BoxedBlock` — 由 `$block()` 创建的 Block 对象，或从 ObjC 方法获取的 Block
- **typeEncoding** `string` — Block 的类型编码，**或** ObjC 风格签名（须含 `(^)`）
- **...args** `any` — 传递给 Block 的参数（可变参数）
- **返回** `any` — Block 的返回值（如果返回 `void` 则为 `undefined`）

### 基本用法

```javascript
// 创建并调用 Block
var block = $block(function(x) {
    console.log("值:", x);
}, "v@?@");

$callBlock(block, "v@?@", "hello");
// 输出: 值: hello
```

### 调用有返回值的 Block

```javascript
var doubler = $block(function(n) {
    return n * 2;
}, "d@?d");

var result = $callBlock(doubler, "d@?d", 21.0);
console.log("结果:", result); // 42.0
```

### 多参数调用

```javascript
var adder = $block(function(a, b) {
    console.log("a =", a, "b =", b);
}, "v@?@@");

$callBlock(adder, "v@?@@", "参数1", "参数2");
```

---

## 完整示例

### 示例 1：延迟执行回调

```javascript
var callback = $block(function() {
    console.log("延迟后执行");
}, "v@?");
```

### 示例 2：创建并立即调用

```javascript
var greeting = $block(function(name) {
    return "Hello, " + name + "!";
}, "@@?@");

var msg = $callBlock(greeting, "@@?@", "WhiteNeedle");
console.log(msg); // "Hello, WhiteNeedle!"
```

### 示例 3：BOOL 参数

```javascript
var checker = $block(function(flag) {
    if (flag) {
        console.log("Flag is YES");
    } else {
        console.log("Flag is NO");
    }
}, "v@?B");

$callBlock(checker, "v@?B", true);
$callBlock(checker, "v@?B", false);
```

### 示例 4：struct 参数与返回值

```javascript
var transform = $block(function(rect, scale) {
    return {
        x: rect.x * scale,
        y: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale
    };
}, "CGRect (^)(CGRect, double)");

var result = $callBlock(transform, "CGRect (^)(CGRect, double)",
    {x: 0, y: 0, width: 100, height: 200}, 2.0);
console.log(result); // {x: 0, y: 0, width: 200, height: 400}
```

---

## 实现原理

`$block` 内部使用 **libffi** 动态创建 Block：

1. 解析类型编码为 `ffi_type` 数组（包括 struct 类型）
2. 通过 `ffi_prep_cif` 描述函数调用接口
3. 用 `ffi_prep_closure_loc` 创建 closure，绑定通用 interpreter
4. 构造符合 Block ABI 的结构体（含 descriptor、signature），`Block_copy` 到堆上

通用 interpreter (`WNBlockInterpreter`) 在 Block 被调用时：
- 从 `void **args` 中按类型编码读取每个参数
- 通过 `WNTypeConversion` 转为 `JSValue`
- 调用 JS 函数
- 将 JS 返回值按返回类型编码写入 `ret` 缓冲区

---

## 注意事项

1. **类型编码必须正确**：编码错误会导致参数传递异常或崩溃。
2. **Block 生命周期**：创建的 Block 会被 copy 到堆上，通过 `WNBoxing` 引用管理生命周期，只要 JS 持有引用就不会释放。
3. **参数自动转换**：ObjC 对象参数（`@` 类型）会自动转换为 JS 值（字符串、数字、数组等），JS 返回值也会自动转回 ObjC 类型。
4. **未注册的 struct**：如果遇到不在内置列表中的 struct 类型编码，会打印警告并返回 `nil`。可通过扩展 `wn_struct_ffi_map()` 添加新类型。
