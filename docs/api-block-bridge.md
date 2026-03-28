# Block 桥接 API

提供 JavaScript 函数与 Objective-C Block 之间的双向桥接，支持最多 6 个参数的 Block 创建和调用。

---

## $block(fn, typeEncoding) — 创建 ObjC Block

将一个 JavaScript 函数包装为真正的 Objective-C Block 对象，可传递给任何期望 Block 参数的 ObjC API。

- **fn** `function` — JavaScript 回调函数
- **typeEncoding** `string` — Block 的 ObjC 类型编码
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
// 创建无参 Block
var block = $block(function() {
    console.log("Block 被调用!");
}, "v@?");

// 创建带参数的 Block
var blockWithArg = $block(function(str) {
    console.log("收到:", str);
}, "v@?@");

// 创建有返回值的 Block
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

### 支持的参数数量

| 参数数量 | 支持 |
|----------|------|
| 0 | ✅ |
| 1 | ✅ |
| 2 | ✅ |
| 3 | ✅ |
| 4 | ✅ |
| 5 | ✅ |
| 6 | ✅ |
| 7+ | ❌ |

> 超过 6 个参数的 Block 不受支持。对于浮点参数（`float`/`double`），当前支持 1-2 个参数的常见组合。

---

## $callBlock(block, typeEncoding, ...args) — 调用 ObjC Block

从 JavaScript 调用一个 ObjC Block。

- **block** `BoxedBlock` — 由 `$block()` 创建的 Block 对象，或从 ObjC 方法获取的 Block
- **typeEncoding** `string` — Block 的类型编码
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
// 模拟 dispatch_after 的 Block 回调
var callback = $block(function() {
    console.log("延迟后执行");
}, "v@?");

// 传递给需要 Block 参数的 ObjC 方法
// ...
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

---

## 注意事项

1. **类型编码必须正确**：`$block` 会根据类型编码决定使用哪个 Block 模板。编码错误会导致参数传递异常或崩溃。
2. **Block 生命周期**：创建的 Block 会被 copy 到堆上，通过 `WNBoxing` 引用管理生命周期，只要 JS 持有引用就不会释放。
3. **参数自动转换**：ObjC 对象参数（`@` 类型）会自动转换为 JS 值（字符串、数字、数组等），JS 返回值也会自动转回 ObjC 类型。
4. **浮点参数限制**：包含 `float`/`double` 参数的 Block 目前仅支持部分签名组合（1 个浮点参数、2 个参数中包含浮点等）。
