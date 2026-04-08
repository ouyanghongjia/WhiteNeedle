# WhiteNeedle 疑难问题总结

本文档记录开发过程中遇到的典型疑难问题，包括根因分析、修复方案和经验教训。

---

## 1. JSManagedValue 导致 Hook 回调被 GC 回收

**文件**: `WNHookEngine.m`  
**严重程度**: 高  
**表现**: Hook 安装后前 2-3 次调用正常，之后 `onEnter`/`onLeave` 回调不再触发，但原始方法仍正常执行。重新 hook 可暂时恢复。

### 根因

`WNHookEntry` 使用 `JSManagedValue` 持有 JS 回调函数：

```objc
// 错误写法
entry.onEnter = [JSManagedValue managedValueWithValue:onEnter];
[context.virtualMachine addManagedReference:entry.onEnter withOwner:entry];
```

`JSManagedValue` 采用"条件性持有"机制：只有当 JS 值仍可从 JavaScript 堆中追踪到时才保持存活。`addManagedReference:withOwner:` 的语义是：当 owner（`WNHookEntry`）可从 JS 对象图中到达时，保留该 JS 值。

但 `WNHookEntry` 只存在于 ObjC 的 `g_hooks` 字典中，从未导出到 JavaScript。JSC 垃圾回收器无法从 JS 堆追踪到这个 owner，因此在某次 GC 周期后认为这些 JS 函数可被回收。

### 时序

1. 用户执行代码片段 → 创建 JS 闭包并 hook
2. 前几次调用正常 → GC 尚未触发
3. Hook 回调中创建大量 JSValue 对象 → 内存压力增加 → 触发 GC
4. GC 回收 `onEnter`/`onLeave` 函数 → `entry.onEnter.value` 返回 `nil`
5. 条件判断 `if (onEnterFn && ![onEnterFn isUndefined])` 失败 → 回调不再执行

### 修复

改用 `JSValue *` 直接强引用。由于 `WNHookEntry` 不会导出到 JS，引用链是单向的，不存在循环引用风险：

```
g_hooks(ObjC) → WNHookEntry(ObjC) → JSValue → JSContext
                     ↑ JS 不引用回 WNHookEntry，无循环
```

```objc
// 正确写法
@property (nonatomic, strong) JSValue *onEnter;
@property (nonatomic, strong) JSValue *onLeave;

// 赋值时直接持有
entry.onEnter = onEnter;
```

### 经验教训

- **`JSManagedValue` 只适用于 ObjC 对象被导出到 JS 的场景**（即 ObjC ↔ JS 双向引用可能产生循环引用时）。如果 ObjC 对象仅在 ObjC 侧使用，直接用 `JSValue *` 强引用更安全。
- GC 时机不确定，Bug 表现为间歇性失效，极难通过常规调试复现稳定路径。
- 判断是否为 GC 问题的关键信号：**功能正常 N 次后突然失效，重新创建后恢复**。

---

## 2. NSMutableSet 多线程并发访问导致状态损坏

**文件**: `WNHookEngine.m`  
**严重程度**: 中  
**表现**: 高并发场景下，hook 的重入检测可能错误判定为"正在重入"，导致跳过 JS 回调。

### 根因

`g_reentrancyGuard`（`NSMutableSet`）被多线程并发访问：

- 主线程：用户点击触发网络请求，进入 hook
- 后台线程：`NSURLSession` 完成回调触发 hook
- `NSMutableSet` 不是线程安全的，并发读写可能损坏内部哈希表

损坏后 `containsObject:` 可能错误返回 `YES`，导致后续所有调用都被当作重入而跳过。

### 修复

所有对 `g_reentrancyGuard` 的访问加 `@synchronized`：

```objc
@synchronized (g_reentrancyGuard) {
    isReentrant = [g_reentrancyGuard containsObject:guardKey];
}

// ...

@synchronized (g_reentrancyGuard) {
    [g_reentrancyGuard addObject:guardKey];
}

// @finally 中
@synchronized (g_reentrancyGuard) {
    [g_reentrancyGuard removeObject:guardKey];
}
```

### 经验教训

- Foundation 集合类（`NSMutableSet`、`NSMutableArray`、`NSMutableDictionary`）都不是线程安全的。
- `@synchronized` 是可重入的（同一线程可多次获取同一把锁），不会导致自死锁。
- 对于全局共享的可变集合，默认加锁是更安全的策略。

---

## 3. @catch 中重复调用原始方法

**文件**: `WNHookEngine.m`  
**严重程度**: 中  
**表现**: VS Code Logs 面板中出现重复的网络日志（每次请求显示两条）。

### 根因

`handleHookedInvocation:` 的 `@catch` 块无条件调用 alias 方法：

```objc
// 错误写法
@catch (NSException *exception) {
    [invocation setSelector:entry.aliasSelector];
    [invocation invoke];  // 如果之前已经调用过 alias，这里会重复执行
}
```

如果异常发生在 alias 方法调用之后（例如 `onLeave` 回调中），原始方法会被执行两次。对于网络请求意味着发送两次请求。

### 修复

引入 `aliasInvoked` 标志，`@catch` 中仅在未调用过时才调用：

```objc
BOOL aliasInvoked = NO;
@try {
    // ...
    [invocation invoke];
    aliasInvoked = YES;
    // ...
} @catch (NSException *exception) {
    if (!aliasInvoked) {
        [invocation setSelector:entry.aliasSelector];
        [invocation invoke];
    }
}
```

### 经验教训

- `@catch` 中的恢复逻辑必须考虑异常发生在 `@try` 块中哪个阶段。
- 使用状态标志追踪关键操作是否已执行，是 `@try/@catch` 中常见的防御模式。

---

## 4. Hook `-[NSObject class]` 导致无限递归崩溃

**文件**: `WNHookEngine.m`（重写前）  
**严重程度**: 致命（崩溃）  
**表现**: "Run All" 测试运行到 hook 相关测试时崩溃，堆栈显示 `NSStringFromSelector` 处 EXC_BAD_ACCESS。

### 根因

旧 hook 引擎使用 `_objc_msgForward` + `forwardInvocation:` 机制。当 hook `-[NSObject class]` 时：

1. 方法被替换为 `_objc_msgForward`
2. ObjC runtime 转发消息时需要调用 `[target class]` 来查找 `forwardInvocation:` 实现
3. 而 `[target class]` 本身已被 hook → 再次转发 → 无限递归 → 栈溢出崩溃

### 修复

使用 `libffi` 闭包完全替代 `_objc_msgForward` 机制：

- `ffi_closure` 直接替换方法的 IMP
- 闭包回调中直接通过保存的 `originalIMP` 调用原始实现
- 不依赖 ObjC 消息转发机制，避免了所有与 `class`、`methodSignatureForSelector:`、`forwardInvocation:` 相关的递归问题

### 经验教训

- ObjC 消息转发机制在 hook 场景下有不可避免的自引用问题，特别是对 `NSObject` 根类方法。
- `libffi` 闭包是更底层、更安全的 hook 实现方式，不依赖 ObjC runtime 的消息转发路径。
- 重入保护（`g_forwardingDepth`）作为最后的安全网，防止任何残留的递归路径。

---

## 5. Hook 回调中 ObjC 对象缺少 `.invoke()` 方法

**文件**: `WNHookEngine.m`  
**严重程度**: 中  
**表现**: 网络监控代码片段执行时报 `TypeError: req.invoke is not a function`。

### 根因

Hook 的 `onEnter` 回调接收的参数中，ObjC 对象（如 `NSURLRequest`）通过 `WNTypeConversion` 转换后被包装为 `WNBoxing`（通用包装器），而不是 `WNObjCBridge` 代理。`WNBoxing` 没有 `.invoke()` 方法。

### 修复

在参数转换循环中，对 ObjC 对象类型（type encoding 以 `@` 开头但不是 `@?` block）显式创建 `WNObjCBridge` 实例代理：

```objc
if (clean[0] == '@' && clean[1] != '?') {
    __unsafe_unretained id obj = (__bridge id)(*(void **)buf);
    jsArg = obj ? [WNObjCBridge createInstanceProxy:obj inContext:ctx]
                : [JSValue valueWithNullInContext:ctx];
}
```

### 经验教训

- Hook 回调中传递给 JS 的 ObjC 对象必须是可交互的代理，而非纯数据包装。
- Type encoding 中 `@` 表示 ObjC 对象，`@?` 表示 block，需要区分处理。

---

## 6. `dispatch.main` 中 JS 异常被 exceptionHandler 吞掉

**文件**: `WNJSEngine.m`  
**严重程度**: 中  
**表现**: `dispatch.main` 内抛出的异常无法被外层 `try/catch` 捕获，测试报 "no error propagated"。

### 根因

`JSContext.exceptionHandler` 是一个全局拦截器——当 JS 代码抛出未捕获异常时，runtime 会先调用 `exceptionHandler`，然后清除异常状态。这意味着即使调用方用 `try/catch` 包裹，异常也会被 `exceptionHandler` 消费掉，`catch` 块永远不会执行。

```javascript
try {
    dispatch.main(function() { throw new Error("test"); });
} catch (e) {
    // 永远不会到达这里，因为 exceptionHandler 已经处理了异常
}
```

### 修复

在 `dispatch.main` 的同步执行路径中，临时替换 `exceptionHandler` 来捕获异常，执行完毕后恢复原始 handler 并重新设置 `ctx.exception`：

```objc
void (^savedHandler)(JSContext *, JSValue *) = ctx.exceptionHandler;
__block JSValue *thrownException = nil;
ctx.exceptionHandler = ^(JSContext *c, JSValue *exc) {
    thrownException = exc;
};
JSValue *result = [fn callWithArguments:@[]];
ctx.exceptionHandler = savedHandler;
if (thrownException) {
    ctx.exception = thrownException;
}
```

### 经验教训

- `JSContext.exceptionHandler` 会拦截所有未捕获异常，包括那些应该由 JS `try/catch` 处理的异常。
- 在需要让异常传播给 JS 调用方时，必须临时禁用 `exceptionHandler`。
- 设置 `ctx.exception = value` 可以将异常重新注入到 JSC 的异常传播链中。

---

## 通用经验

1. **间歇性 Bug 优先排查 GC 和线程安全**：如果功能"有时正常有时失效"，首先考虑垃圾回收时机和多线程竞争。
2. **ObjC ↔ JS 桥接中的内存管理**：`JSValue *` 强引用会阻止 GC，`JSManagedValue` 是条件性持有。选择哪种取决于是否存在循环引用风险。
3. **`@try/@catch` 中的状态恢复**：始终用标志追踪关键操作是否已完成，`@catch`/`@finally` 中的逻辑必须感知异常发生的阶段。
4. **ObjC Runtime Hook 的递归陷阱**：消息转发机制本身依赖目标类的某些方法，hook 这些方法时极易产生无限递归。
5. **Type encoding 是 ObjC bridge 的核心**：正确解析和区分 `@`（对象）、`@?`（block）、`{` （struct）等类型编码，是构建可靠桥接层的基础。
