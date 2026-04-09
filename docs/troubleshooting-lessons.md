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

---

## VS Code 扩展：团队 Script Snippets（工作区 JSON）

WhiteNeedle 扩展支持在**仓库内**维护共享片段，避免每人手动导入导出 JSON。

### 约定

- 默认路径：工作区根目录下的 `.whiteneedle/team-snippets.json`（可通过设置 `whiteneedle.snippets.teamFile` 修改）。
- 格式：与扩展导出一致，`version: 1` 与 `snippets` 数组（或直接为片段数组）。
- 建议团队片段的 `id` 使用 `team-` 前缀；若与**内置**片段 `id` 冲突，同步时会跳过该条并提示警告。
- **本地自定义**片段（在面板里「+ New」或 Import 的）若与团队片段 **id 相同**，以本地为准（团队同名条目会被隐藏）。

### 协作流程

1. 在仓库中编辑 `team-snippets.json`，走 Code Review / PR 合并。
2. 成员执行 `git pull` 拉取最新文件。
3. 在 VS Code 中打开 **WhiteNeedle → Script Snippets**，点击 **Sync team**（或命令面板执行 **WhiteNeedle: Sync Team Script Snippets**）。保存 JSON 时若已打开片段面板，也会自动重新加载。
4. 多根工作区时，每个根目录下都会按相对路径尝试读取并合并（靠后的根若出现重复 `id` 会跳过并警告）。

### 相关命令与配置

- 命令：`whiteneedle.syncTeamSnippets`
- 配置：`whiteneedle.snippets.teamFile`

---

## 7. iOS 17+ WKWebView 调试报 `'Debugger' domain was not found`

**文件**: `debugAdapter.ts`, `cdpClient.ts`  
**严重程度**: 高（完全无法调试 WKWebView）  
**表现**: 选择 WKWebView 目标后，`Inspector.enable` 立即失败，报 `'Inspector' domain was not found`，后续 `Debugger.enable` 同样失败。但 Safari Web Inspector 可以正常连接同一目标。

### 根因

`ios_webkit_debug_proxy` 在 iOS 17+ 设备上暴露的 WebSocket 端点采用 **Target-based 多路复用协议**。该端点不直接支持 `Inspector`、`Debugger` 等域命令——所有内部域命令必须包装在 `Target.sendMessageToTarget` 中发送，响应通过 `Target.dispatchMessageFromTarget` 事件返回。

协议层次：

```
客户端 ──WebSocket──▶ ios_webkit_debug_proxy 端点
                      │
                      ├─ 支持: Target.getTargets / Target.sendMessageToTarget (顶层)
                      │
                      └─ 不支持: Inspector.enable / Debugger.enable (直接发送会报 domain not found)
                         ↓
                    必须包装在 Target.sendMessageToTarget({ targetId, message }) 中
```

### 排查过程

1. **首先怀疑端口/URL 问题** — 确认 `curl http://127.0.0.1:9222/json` 返回正确的 WKWebView 目标且 `webSocketDebuggerUrl` 可达
2. **确认 Safari 可以连接** — 排除了 WebKit Inspector 本身被禁用的可能
3. **尝试直接发送 `Inspector.enable`** — 返回 `'Inspector' domain was not found`，这是 Target-based 协议的典型信号
4. **研究 WebKit 源码和 ios_webkit_debug_proxy 行为** — 发现 iOS 17+ 使用 Target multiplexing

### 修复

在 `debugAdapter.ts` 中实现两阶段协议检测：

```
enableInspectorDomains(target):
  1. 先尝试直接 Inspector.enable (兼容旧版 WIP)
  2. 若失败且报 "domain not found" → 切换到 setupTargetBasedProtocol()
```

在 `cdpClient.ts` 中实现 Target 消息包装：

- `enableTargetWrapping(targetId)`: 启用后所有 `send()` 自动包装为 `Target.sendMessageToTarget`
- `sendRaw()`: 发送顶层 Target 域命令（不包装）
- `handleMessage()`: 拦截 `Target.dispatchMessageFromTarget`，解包内部消息并分发给对应的 pending Promise

### 经验教训

- **不要假设 WebSocket 端点就是标准 CDP** — `ios_webkit_debug_proxy` 的协议随 iOS 版本变化，需要做协议能力检测。
- **"domain not found" 是 Target multiplexing 的关键信号** — 遇到此错误时，应检查是否需要通过 Target 域进行间接通信。
- **保持向后兼容** — 先尝试直接协议，失败后再降级到 Target-based，支持新旧 iOS 版本。

---

## 8. Target-based 协议中 `Missing target for given targetId`

**文件**: `debugAdapter.ts`  
**严重程度**: 高  
**表现**: 进入 Target-based 协议后，`Target.sendMessageToTarget` 返回 `"Missing target for given targetId"`，内部域命令全部失败。

### 根因

最初从 `webSocketDebuggerUrl` 路径（如 `/devtools/page/2`）直接提取 `"2"` 作为 `targetId`。但实际的 inner targetId 格式与 URL 路径中的编号不一致——可能是 `"page-8"`、`"page-1"` 等格式，需要通过 Target 域动态发现。

### 修复

实现三级 targetId 发现策略：

```
setupTargetBasedProtocol(target):
  策略 1: Target.getTargets → 获取已知目标列表
  策略 2: Target.setDiscoverTargets({discover:true}) → 等待 Target.targetCreated 事件
  策略 3: probeTargetId() → 暴力探测常见 targetId 格式
```

`probeTargetId` 生成候选列表（`page-1`...`page-10`、`1`...`10`、从 URL 推导的变体），对每个候选发送 `Runtime.evaluate("1")`，第一个不报 "Missing target" 错误的即为正确 targetId。

匹配到多个候选时，优先选择 title/URL 与所选调试目标匹配的。

### 经验教训

- **targetId 格式没有标准规范** — 不同 WebKit 版本和 proxy 实现可能使用不同格式（`"page-N"`、`"N"`、`"N.N"` 等）。
- **动态发现优于硬编码猜测** — 优先用 `Target.getTargets` / `Target.targetCreated`，暴力探测作为最后手段。
- **探测时选择无副作用的命令** — `Runtime.evaluate("1")` 是安全的探测手段。

---

## 9. 调试器变量面板中 `window = unknown`、`NaN = null`

**文件**: `debugAdapter.ts`  
**严重程度**: 中  
**表现**: 断点暂停后，变量面板中 `NaN` 显示为 `null`、`Infinity` 显示为 `null`、`window`/`document`/`navigator` 等 DOM 全局对象显示为 `unknown` 且不可展开。

### 根因 (NaN / Infinity)

JSON 无法表示 `NaN` 和 `Infinity`。WebKit Inspector Protocol 对这些特殊数值的 RemoteObject 表示为：

```json
{ "type": "number", "value": null, "description": "NaN" }
{ "type": "number", "value": null, "description": "Infinity" }
```

原始 `formatValue` 直接使用 `val.value`，对 `null` 值返回了 `"null"` 字符串。

### 根因 (window / document = unknown)

WKWebView 全局对象（Window）的大量属性（`window`、`document`、`location`、`navigator` 等）是**访问器属性（getter/setter）**。`Runtime.getProperties` 返回这些属性时：

- **没有 `value` 字段** — 只有 `get`（getter 函数的 RemoteObject）
- `isAccessor` 可能不一定被设置

原始代码 `const val = prop.value || {}` 将它们处理为空对象，最终在 `formatValue` 中匹配不到任何条件，返回 `"unknown"`。

### 修复

**NaN / Infinity**: 在 `formatValue` 中，`type === 'number'` 且 `value === null` 时优先使用 `description` 字段：

```typescript
if (val.type === 'number') {
    if (val.value === null || val.value === undefined) {
        return val.description ?? 'NaN';
    }
    return String(val.value);
}
```

**访问器属性**: 实现 getter 懒求值机制：

1. 遍历属性时，检测到有 `prop.get`（getter）但无 `prop.value` 的属性，标记为 getter 并创建特殊的 `getterHandle`
2. 变量面板显示 `window = (...)` 并带有展开箭头
3. 用户点击展开时，通过 `Runtime.callFunctionOn` 在父对象上调用 getter 获取实际值：
   ```typescript
   Runtime.callFunctionOn({
       objectId: parentObjectId,
       functionDeclaration: `function(){ return this["window"]; }`,
       generatePreview: true,
   })
   ```
4. 如果返回对象，进一步获取其 `ownProperties` 直接展示，避免多余的嵌套层级

### 经验教训

- **JSON 序列化会丢失特殊数值语义** — 处理 RemoteObject 时，`description` 字段比 `value` 更可靠。
- **WebKit 对 DOM 宿主对象大量使用 accessor properties** — `Runtime.getProperties` 返回的不一定都有 `value`，必须处理 `get`/`set` 描述符。
- **懒求值是调试器的标准模式** — 避免在列出属性时触发所有 getter（可能有副作用或性能开销），改为用户展开时按需求值。

---

## 10. Debug Console 协议日志过多干扰正常输出

**文件**: `debugAdapter.ts`, `cdpClient.ts`  
**严重程度**: 低  
**表现**: Debug Console 输出大量 `[CDPClient] ← {...}` 和 `[CDPClient] → {...}` 的协议日志，淹没了用户的 `console.log` 输出和应用日志。

### 根因

`cdpClient.ts` 的 `onProtocolLog` 回调在调试会话中始终被设置，将每条 WebSocket 收发消息都转发到 Debug Console。对于周期性输出的 WKWebView 页面（如定时器日志），每条 console.log 会产生 3 行日志（Target 包装、内部解包、实际内容）。

### 修复

在 `WhiteNeedleLaunchArgs` 接口中添加 `verbose?: boolean` 选项，仅当 `args.verbose === true` 时才设置 `onProtocolLog` 回调：

```typescript
if (args.verbose) {
    this.cdp.onProtocolLog = (msg: string) => {
        this.sendEvent(new OutputEvent(`${msg}\n`, 'console'));
    };
}
```

launch.json 中按需开启：
```json
{ "type": "whiteneedle", "verbose": true }
```

### 经验教训

- **调试工具的调试日志应默认关闭** — 面向用户的 Debug Console 应只显示应用输出，协议级日志属于插件开发者的诊断工具。
- **提供显式开关而非全量输出** — 用户可以在需要时快速开启，不影响日常使用体验。

---

## 通用经验（补充）

6. **iOS WebKit Inspector Protocol 不等于 Chrome DevTools Protocol** — 虽然结构相似，但存在 Target multiplexing、accessor property 表示、特殊数值编码等差异，不能直接复用 Chrome 调试器的假设。
7. **协议能力检测优于版本号判断** — 先尝试标准路径，根据错误响应动态切换策略，比判断 iOS 版本号更可靠。
8. **调试器的变量展示需要处理所有 RemoteObject 变体** — 包括无 type 的宿主对象、value 为 null 的特殊数值、只有 getter 的访问器属性等边界情况。
