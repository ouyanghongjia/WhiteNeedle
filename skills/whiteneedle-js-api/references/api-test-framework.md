# WNTest — 自动化测试框架

`WNTest` 是 WhiteNeedle **内置模块**，集成 WhiteNeedle 后即可直接使用，无需额外安装。

```javascript
var WNTest = require('wn-test');
```

提供结构化的测试组织、丰富的断言方法、生命周期钩子和 JSON 结果输出，用于在设备端编写和运行自动化测试。

## 快速开始

```javascript
var WNTest = require('wn-test');

// 方式 1: 结构化测试
var suite = WNTest.create('Login Feature');

suite.describe('Login Form', function(ctx) {
    ctx.beforeEach(function() {
        // 每个测试前执行
    });

    ctx.it('should validate email', function(assert) {
        assert.ok(isValid, 'email is valid');
        assert.eq(result, 'success');
    });

    ctx.it('async network call', function(assert, done) {
        fetchData(function(data) {
            assert.isNotNil(data);
            done();
        });
    }, { timeout: 5000 });
});

suite.run();

// 方式 2: 快速测试
WNTest.quick('smoke_test', function(T) {
    T.ok(ObjC.available, 'ObjC runtime');
    T.eq(__wnEngine, 'JavaScriptCore');
});
```

## API

### WNTest.create(name)

创建一个测试套件。

- **name** `string` — 套件名称
- **返回** `Suite` — 套件对象

### WNTest.quick(name, fn)

快速运行模式，适合单文件测试，兼容旧版 inline harness 风格。

- **name** `string` — 套件名称
- **fn** `function(assert)` — 测试函数，接收 assert 对象
- **返回** `Report` — 测试报告

```javascript
WNTest.quick('api_check', function(T) {
    T.ok(ObjC.available, 'runtime ready');
    T.type(__wnVersion, 'string', 'version is string');
    T.gt(Process.arch.length, 0, 'arch is set');
});
```

### WNTest.runAll(suites, callback)

批量运行多个测试套件，汇总输出。

- **suites** `Array<Suite>` — 套件数组
- **callback** `function(summary)` — 全部完成后回调

```javascript
WNTest.runAll([suite1, suite2], function(summary) {
    console.log('Total:', summary.total, 'Failed:', summary.failed);
});
```

---

## Suite 对象

### suite.describe(groupName, setupFn)

注册一个测试组。

```javascript
suite.describe('User Module', function(ctx) {
    ctx.beforeAll(function() { /* 组内所有测试前执行一次 */ });
    ctx.afterAll(function() { /* 组内所有测试后执行一次 */ });
    ctx.beforeEach(function() { /* 每个测试前执行 */ });
    ctx.afterEach(function() { /* 每个测试后执行 */ });

    ctx.it('test name', function(assert) { ... });
    ctx.it('async test', function(assert, done) { ... }, { timeout: 5000 });
});
```

### suite.before(fn) / suite.after(fn)

全局钩子，在所有 describe 组之前/之后执行。

### suite.run(callback)

执行套件中的所有测试并输出结果。

- **callback** `function(report)` — 可选，测试完成后回调
- **返回** `Report` — 测试报告对象

---

## Assert 断言方法

每个 `it` 的回调函数接收一个 `assert` 对象，提供以下断言：

| 方法 | 说明 | 示例 |
|------|------|------|
| `ok(condition, msg)` | 布尔真值 | `assert.ok(x > 0)` |
| `eq(actual, expected, msg)` | 严格相等 `===` | `assert.eq(len, 5)` |
| `neq(actual, expected, msg)` | 严格不等 `!==` | `assert.neq(result, null)` |
| `deepEq(actual, expected, msg)` | 深度相等 | `assert.deepEq(arr, [1,2,3])` |
| `type(val, expectedType, msg)` | `typeof` 检查 | `assert.type(fn, 'function')` |
| `gt(a, b, msg)` | 大于 | `assert.gt(count, 0)` |
| `gte(a, b, msg)` | 大于等于 | `assert.gte(score, 60)` |
| `lt(a, b, msg)` | 小于 | `assert.lt(latency, 1000)` |
| `lte(a, b, msg)` | 小于等于 | `assert.lte(errors, 5)` |
| `contains(haystack, needle, msg)` | 字符串/数组包含 | `assert.contains(name, 'UI')` |
| `matches(str, regex, msg)` | 正则匹配 | `assert.matches(ver, /^\d+\.\d+/)` |
| `throws(fn, msg)` | 期望抛出异常 | `assert.throws(function() { ... })` |
| `noThrow(fn, msg)` | 期望不抛出 | `assert.noThrow(function() { ... })` |
| `isNil(val, msg)` | null 或 undefined | `assert.isNil(result)` |
| `isNotNil(val, msg)` | 不为 null/undefined | `assert.isNotNil(view)` |
| `isObjCClass(proxy, cls, msg)` | ObjC 类名检查 | `assert.isObjCClass(v, 'UILabel')` |
| `inRange(val, min, max, msg)` | 数值范围 | `assert.inRange(alpha, 0, 1)` |
| `skip(msg, reason)` | 标记跳过 | `assert.skip('flaky test')` |

---

## 异步测试

当 `it` 回调接受第二个参数（`done`）时，测试自动进入异步模式：

```javascript
ctx.it('network request', function(assert, done) {
    setTimeout(function() {
        assert.ok(true, 'timer fired');
        done(); // 必须调用，否则超时失败
    }, 100);
}, { timeout: 3000 });
```

默认超时 10 秒，可通过 `opts.timeout` 覆盖。

---

## 结果输出

测试结果以两种方式输出：

1. **Console 日志** — 带 ✓/✗ 图标的可读格式
2. **JSON 标记行** — `[RESULT_JSON] {...}` 可被 MCP 或自动化脚本解析

### Report 结构

```json
{
    "suite": "Login Feature",
    "groups": [
        {
            "name": "Login Form",
            "cases": [
                {
                    "name": "should validate email",
                    "status": "pass",
                    "duration": 12,
                    "assertions": 3,
                    "passed": 3,
                    "failed": 0,
                    "skipped": 0,
                    "errors": 0
                }
            ]
        }
    ],
    "total": 5,
    "passed": 4,
    "failed": 1,
    "skipped": 0,
    "errors": 0,
    "duration": 234,
    "failures": ["Login Form > async test: timeout exceeded 5000ms"]
}
```

### Summary（runAll）

```json
{
    "total": 15,
    "passed": 14,
    "failed": 1,
    "skipped": 0,
    "errors": 0,
    "duration": 567,
    "suites": [...],
    "allFailures": ["[Login Feature] Login Form > async test: ..."]
}
```

---

## 与旧版 test-scripts 的对比

| 特性 | 旧版 inline harness | WNTest |
|------|---------------------|--------|
| 测试组织 | 平铺 | describe/it 分组 |
| 断言方法 | 7 个 | 18+ 个 |
| 生命周期钩子 | 无 | beforeAll/afterAll/beforeEach/afterEach |
| 异步支持 | 手动 asyncStart/End | 自动 done + timeout |
| 结果格式 | 基础 JSON | 分组详细 JSON |
| 多套件运行 | 不支持 | runAll 汇总 |
| 深度相等 | 不支持 | deepEq |
| ObjC 特定断言 | 不支持 | isObjCClass |
