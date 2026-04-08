# 原生桥接 API

提供低级别的 C 层能力：模块与符号查找、内存读写、结构体定义与实例化、C 函数 Hook。

---

## Module — 模块与符号查找

基于 `dyld` 和 `dlsym` 实现的动态库模块枚举和符号地址查找。

### Module.findExportByName(moduleName, symbolName)

在指定模块中查找导出符号的地址。

- **moduleName** `string | null` — 模块名（库名/路径）。传 `null` 搜索所有已加载模块
- **symbolName** `string` — 符号名称（C 函数名或全局变量名）
- **返回** `number | undefined` — 符号地址（数值形式），未找到返回 `undefined`

```javascript
// 查找 C 函数地址
var mallocAddr = Module.findExportByName(null, "malloc");
console.log("malloc @", mallocAddr);

// 在指定库中查找
var objcAddr = Module.findExportByName("libobjc.A.dylib", "objc_msgSend");
console.log("objc_msgSend @", objcAddr);
```

### Module.enumerateModules()

枚举所有已加载的 dyld 镜像（动态库、主程序）。

- **返回** `Array<object>` — 模块信息列表

每个模块对象包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 模块完整路径 |
| `base` | `string` | 基地址（十六进制字符串，如 `"0x100000000"`） |
| `slide` | `number` | ASLR 偏移量 |

```javascript
var modules = Module.enumerateModules();
modules.forEach(function(mod) {
    console.log(mod.name, "base:", mod.base, "slide:", mod.slide);
});
```

### Module.enumerateExports(moduleName)

查找指定模块名对应的 dyld 镜像信息。

- **moduleName** `string` — 模块名称（可以是部分路径或库名）
- **返回** `Array<object>` — 匹配的模块信息

```javascript
var info = Module.enumerateExports("UIKit");
if (info.length > 0) {
    console.log("UIKit path:", info[0].path);
    console.log("UIKit index:", info[0].index);
}
```

---

## $pointer — 内存读写

直接读写进程内存地址，支持多种数据类型。

### $pointer.read(address, type, count?)

从内存地址读取数据。

- **address** `number` — 内存地址
- **type** `string` — 数据类型
- **count** `number` (可选) — 读取数量，默认为 `1`。对 `bytes` 类型表示字节数
- **返回** `any` — 读取的值。`count > 1` 时返回数组

**支持的 type 值：**

| type | 大小 | 说明 |
|------|------|------|
| `int8` | 1B | 有符号 8 位整数 |
| `uint8` | 1B | 无符号 8 位整数 |
| `bool` | 1B | 布尔值（同 `uint8`） |
| `int16` | 2B | 有符号 16 位整数 |
| `uint16` | 2B | 无符号 16 位整数 |
| `int32` | 4B | 有符号 32 位整数 |
| `uint32` | 4B | 无符号 32 位整数 |
| `float` | 4B | 32 位浮点数 |
| `int64` | 8B | 有符号 64 位整数 |
| `uint64` | 8B | 无符号 64 位整数 |
| `double` | 8B | 64 位浮点数 |
| `pointer` | 8B | 指针（64 位地址） |
| `utf8` | 变长 | 以 `\0` 结尾的 UTF-8 字符串 |
| `bytes` | 变长 | 原始字节数组（需配合 `count` 使用） |

```javascript
// 读取单个 int32
var value = $pointer.read(address, "int32");

// 读取 UTF-8 字符串
var str = $pointer.read(strAddr, "utf8");

// 读取 10 个字节
var bytes = $pointer.read(bufAddr, "bytes", 10);
console.log("字节:", bytes); // [72, 101, 108, ...]

// 读取 4 个连续 float
var floats = $pointer.read(arrayAddr, "float", 4);
```

### $pointer.write(address, type, value)

向内存地址写入数据。

- **address** `number` — 内存地址
- **type** `string` — 数据类型（同 `read` 支持的类型）
- **value** `any` — 要写入的值

```javascript
// 写入 int32
$pointer.write(address, "int32", 42);

// 写入 double
$pointer.write(address, "double", 3.14159);

// 写入字符串（自动追加 \0）
$pointer.write(bufAddr, "utf8", "Hello");
```

### $pointer.alloc(size)

在堆上分配指定大小的内存（使用 `calloc`，内存初始化为零）。

- **size** `number` — 分配的字节数
- **返回** `object` — 分配结果

返回对象字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `address` | `number` | 分配的内存地址 |
| `size` | `number` | 分配的大小 |
| `_box` | `BoxedPointer` | 内部引用（用于生命周期管理） |

```javascript
var mem = $pointer.alloc(256);
console.log("分配地址:", mem.address, "大小:", mem.size);

// 使用分配的内存
$pointer.write(mem.address, "int32", 100);
var val = $pointer.read(mem.address, "int32");
console.log("读回:", val); // 100

// 使用完毕后释放
$pointer.free(mem.address);
```

### $pointer.free(address)

释放之前通过 `$pointer.alloc` 分配的内存。

- **address** `number` — 要释放的内存地址

```javascript
var mem = $pointer.alloc(64);
// ... 使用内存 ...
$pointer.free(mem.address);
```

> ⚠️ **警告**：只释放通过 `$pointer.alloc` 分配的内存，释放其他地址会导致崩溃。释放后不要再访问该地址。

---

## $struct — 结构体定义与操作

定义 C 结构体的内存布局，并创建、读写结构体实例。

### $struct(name, fields) — 定义结构体

注册一个结构体类型定义。

- **name** `string` — 结构体名称
- **fields** `Array<{name: string, type: string}>` — 字段定义数组
- **返回** `StructConstructor` — 结构体构造函数

**字段 type 取值：** 与 `$pointer` 的 `type` 参数相同（`int8`, `uint8`, `bool`, `int16`, `uint16`, `int32`, `uint32`, `int64`, `uint64`, `float`, `double`, `pointer`）。

**注意**：不支持 `int`、`long` 等别名，必须使用精确位宽类型名。

```javascript
// 定义 CGPoint 结构体
var CGPoint = $struct("CGPoint", [
    {name: "x", type: "double"},
    {name: "y", type: "double"}
]);

console.log("CGPoint size:", CGPoint.size);     // 16
console.log("CGPoint fields:", CGPoint.fields); // [{name:"x",type:"double"}, ...]
```

### StructConstructor 属性

构造函数自身携带的元信息：

| 属性 | 类型 | 说明 |
|------|------|------|
| `size` | `number` | 结构体总字节大小 |
| `fields` | `Array` | 字段定义数组 |

### StructConstructor(initValues?) — 创建实例

调用构造函数创建结构体实例。

- **initValues** `object` (可选) — 初始值对象，键为字段名
- **返回** `StructInstance` — 结构体实例

```javascript
var point = CGPoint({x: 100.5, y: 200.3});
console.log("x:", point.x); // 100.5
console.log("y:", point.y); // 200.3
```

### StructInstance 属性和方法

实例对象可直接通过字段名访问值：

| 属性/方法 | 类型 | 说明 |
|-----------|------|------|
| `fieldName` | `number` | 直接读取字段值（只读快照） |
| `_ptr` | `BoxedPointer` | 底层内存指针 |
| `_structName` | `string` | 结构体类型名 |
| `_size` | `number` | 结构体字节大小 |
| `toPointer()` | `function` | 获取底层指针对象 |
| `update(values)` | `function` | 更新字段值 |

### instance.toPointer()

获取结构体底层内存的指针。

- **返回** `BoxedPointer` — 指向结构体内存的指针

```javascript
var point = CGPoint({x: 10, y: 20});
var ptr = point.toPointer();
// ptr 可传给需要指针参数的 ObjC/C 方法
```

### instance.update(values)

更新结构体字段值（直接写入底层内存）。

- **values** `object` — 要更新的字段值对象

```javascript
var point = CGPoint({x: 0, y: 0});
point.update({x: 50, y: 100});
```

### 完整示例

```javascript
// 定义 CGRect
var CGPoint = $struct("CGPoint", [
    {name: "x", type: "double"},
    {name: "y", type: "double"}
]);

var CGSize = $struct("CGSize", [
    {name: "width", type: "double"},
    {name: "height", type: "double"}
]);

// 创建实例
var origin = CGPoint({x: 0, y: 64});
var size = CGSize({width: 375, height: 667});

console.log("Origin:", origin.x, origin.y);
console.log("Size:", size.width, "x", size.height);

// 更新值
origin.update({x: 10, y: 20});
```

### 自定义结构体

```javascript
// 定义网络包头结构体
var PacketHeader = $struct("PacketHeader", [
    {name: "magic",   type: "uint32"},
    {name: "version", type: "uint16"},
    {name: "flags",   type: "uint16"},
    {name: "length",  type: "uint32"},
    {name: "checksum",type: "uint32"}
]);

console.log("PacketHeader size:", PacketHeader.size); // 16

var header = PacketHeader({
    magic: 0xDEADBEEF,
    version: 1,
    flags: 0,
    length: 1024,
    checksum: 0
});

console.log("magic:", header.magic);
console.log("version:", header.version);
```

---

## Interceptor（C 函数 Hook）

通过 fishhook 库实现 GOT/Lazy Symbol 重绑定，可以 Hook 系统 C 函数。

> 此处的 `Interceptor` 与 ObjC Hook 的 `Interceptor` 共享同一命名空间。

### Interceptor.rebindSymbol(symbolName)

解析 C 符号的原始地址。

- **symbolName** `string` — C 函数符号名
- **返回** `number | undefined` — 函数原始地址，符号不存在返回 `undefined`

```javascript
var mallocAddr = Interceptor.rebindSymbol("malloc");
console.log("malloc original:", mallocAddr);
```

### Interceptor.hookCFunction(symbolName, replacementAddress)

通过 fishhook 将 C 函数符号重绑定到另一个函数指针。

- **symbolName** `string` — 要 Hook 的 C 函数名
- **replacementAddress** `number` — 替换函数的地址（必须是编译后的函数指针）
- **返回** `object | false` — 成功时返回结果对象，失败返回 `false`

返回对象字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `boolean` | 是否成功 |
| `original` | `number` | 原始函数地址 |

```javascript
// 注意：replacementAddress 必须是已编译的 native 函数指针
// 不能直接传入 JS 函数，需要配合其他机制
var result = Interceptor.hookCFunction("open", replacementFnAddr);
if (result && result.success) {
    console.log("Hook 成功, 原始地址:", result.original);
}
```

> ⚠️ **限制**：`hookCFunction` 的 `replacementAddress` 必须是一个编译后的原生函数指针。JavaScript 函数不能直接作为 C 函数的替换实现。如需用 JS 拦截 C 调用，考虑在原生层编写桥接函数。

---

## 完整示例

```javascript
// 1. 枚举已加载的模块
var mods = Module.enumerateModules();
console.log("已加载", mods.length, "个模块");
mods.slice(0, 5).forEach(function(m) {
    var parts = m.name.split("/");
    console.log(" -", parts[parts.length - 1], "base:", m.base);
});

// 2. 查找符号地址
var nslogAddr = Module.findExportByName(null, "NSLog");
console.log("NSLog 地址:", nslogAddr);

// 3. 分配内存并读写
var buf = $pointer.alloc(32);
$pointer.write(buf.address, "double", 3.14159);
$pointer.write(buf.address + 8, "int32", 42);

var pi = $pointer.read(buf.address, "double");
var num = $pointer.read(buf.address + 8, "int32");
console.log("pi =", pi, "num =", num);

$pointer.free(buf.address);

// 4. 定义和使用结构体
var Vec3 = $struct("Vec3", [
    {name: "x", type: "float"},
    {name: "y", type: "float"},
    {name: "z", type: "float"}
]);

var v = Vec3({x: 1.0, y: 2.0, z: 3.0});
console.log("Vec3:", v.x, v.y, v.z, "size:", Vec3.size);
```
