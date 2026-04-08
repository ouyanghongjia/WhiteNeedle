# 方法 Hook API（ObjC）

基于 `_objc_msgForward` + `forwardInvocation:` 实现 ObjC 方法拦截，无需 JIT/RWX 内存权限，可在非越狱设备上使用。所有参数和返回值通过 `NSInvocation` 完整传递。

---

## Interceptor.attach(selectorKey, callbacks)

拦截 ObjC 方法调用，在原方法执行前后插入 JavaScript 回调。

- **selectorKey** `string` — ObjC 方法标识，格式为 `"-[ClassName method:]"`（实例方法）或 `"+[ClassName method:]"`（类方法）
- **callbacks** `object` — 拦截回调

### callbacks 参数说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `onEnter` | `function(self, sel, args)` | 原方法执行**前**调用 |
| `onLeave` | `function(retval)` | 原方法执行**后**调用 |

#### onEnter(self, sel, args)

- **self** `Proxy` — 被调用对象的实例代理
- **sel** `string` — 选择器名称
- **args** `Array` — 方法参数数组

#### onLeave(retval)

- **retval** `any` — 原方法返回值
- **返回** `any | undefined` — 返回非 `undefined` 值可修改原方法的返回值

### 基本用法

```javascript
Interceptor.attach("-[UIViewController viewDidLoad]", {
    onEnter: function(self, sel, args) {
        console.log("viewDidLoad 被调用:", self.className());
    },
    onLeave: function(retval) {
        console.log("viewDidLoad 执行完毕");
    }
});
```

### 监控带参数的方法

```javascript
Interceptor.attach("-[UIViewController presentViewController:animated:completion:]", {
    onEnter: function(self, sel, args) {
        console.log("正在 present:", args[0].className());
        console.log("animated:", args[1]);
    }
});
```

### 修改返回值

```javascript
Interceptor.attach("-[MyClass computeValue]", {
    onLeave: function(retval) {
        console.log("原始返回值:", retval);
        return 42; // 修改返回值为 42
    }
});
```

### Hook 类方法

```javascript
Interceptor.attach("+[NSBundle mainBundle]", {
    onEnter: function(self, sel, args) {
        console.log("mainBundle 被调用");
    }
});
```

---

## Interceptor.replace(selectorKey, replacement)

完全替换 ObjC 方法的实现。原方法不会被调用。

- **selectorKey** `string` — ObjC 方法标识，格式同 `attach`
- **replacement** `function(self, args)` — 替换函数

### replacement 函数签名

- **self** `Proxy` — 被调用对象的实例代理
- **args** `Array` — 方法参数数组
- **返回** `any` — 方法返回值

### 基本用法

```javascript
Interceptor.replace("-[NSObject description]", function(self, args) {
    return "[WhiteNeedle] " + self.className();
});

var obj = ObjC.use("NSObject").invoke("new");
var desc = obj.invoke("description");
console.log(desc); // "[WhiteNeedle] NSObject"
```

### 替换带参数的方法

```javascript
Interceptor.replace("-[MyService fetchData:]", function(self, args) {
    console.log("原始参数:", args[0]);
    return "mocked response";
});
```

---

## Interceptor.detach(selectorKey)

移除指定方法上的 Hook，恢复原始实现。

- **selectorKey** `string` — 之前 Hook 的方法标识

```javascript
Interceptor.attach("-[UIViewController viewDidLoad]", {
    onEnter: function(self, sel, args) {
        console.log("hooked!");
    }
});

// 稍后移除 Hook
Interceptor.detach("-[UIViewController viewDidLoad]");
```

---

## Interceptor.detachAll()

移除所有已注册的 ObjC 方法 Hook。

```javascript
Interceptor.detachAll();
```

---

## Interceptor.list()

列出所有当前活跃的 Hook。

- **返回** `Array<string>` — 活跃 Hook 的 selectorKey 列表

```javascript
var hooks = Interceptor.list();
hooks.forEach(function(key) {
    console.log("活跃 Hook:", key);
});
```

---

## selectorKey 格式说明

selectorKey 遵循标准的 ObjC 方法签名格式：

```
-[ClassName selectorName:]     // 实例方法
+[ClassName selectorName:]     // 类方法
```

**示例：**

| ObjC 方法 | selectorKey |
|-----------|-------------|
| `[UIView setAlpha:]` | `"-[UIView setAlpha:]"` |
| `[NSObject description]` | `"-[NSObject description]"` |
| `[NSBundle mainBundle]` | `"+[NSBundle mainBundle]"` |
| `[UIViewController presentViewController:animated:completion:]` | `"-[UIViewController presentViewController:animated:completion:]"` |

---

## 注意事项

1. **重复 Hook**：对同一个方法再次调用 `attach` 或 `replace`，会自动先 `detach` 之前的 Hook。
2. **类继承**：Hook 会影响目标类及其所有子类的方法调用。
3. **线程安全**：Hook 的 JavaScript 回调在 JavaScriptCore 的线程上执行。
4. **性能**：Hook 基于消息转发机制，相比直接方法调用有一定开销，不建议 Hook 高频调用的方法。

---

## 完整示例

```javascript
// 监控所有 ViewController 的生命周期
Interceptor.attach("-[UIViewController viewDidLoad]", {
    onEnter: function(self, sel, args) {
        console.log("[生命周期] viewDidLoad:", self.className());
    }
});

Interceptor.attach("-[UIViewController viewWillAppear:]", {
    onEnter: function(self, sel, args) {
        console.log("[生命周期] viewWillAppear:", self.className(), "animated:", args[0]);
    }
});

Interceptor.attach("-[UIViewController viewDidDisappear:]", {
    onEnter: function(self, sel, args) {
        console.log("[生命周期] viewDidDisappear:", self.className());
    }
});

// 查看活跃 Hook
console.log("活跃 Hook:", Interceptor.list());

// 清理
// Interceptor.detachAll();
```
