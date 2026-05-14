# WhiteNeedle 线程与队列契约

本文档补充 `WNJSEngine`、`WNObjCBridge`、`WNHookEngine`、UIDebug/Block 桥、`WNRemoteServer` 中的**线程约束**，供脚本与 native 扩展作者对照。

> **2026-05-14 更新**：修复 Main ↔ JS 死锁，三层防护体系就位。

## 1. JS 执行线程

- `JSVirtualMachine` / `JSContext` 的创建与 `evaluateScript:` **必须**在同一条专用线程（`WhiteNeedle.JSExecution`）上执行。
- 通过 `-[WNJSEngine performOnJSThread:waitUntilDone:]` 在该线程上调度工作。

## 2. `ObjC` 的 `dispatch.main` / `global` / `none`

- **语义**：通过 `WNSetInvokeTargetQueue` 设置的是 **后续纯 ObjC 调用（invoke / KVC）** 所**投递**的 GCD 队列，**不是**把当前 JavaScript 逻辑切到主线程执行。
- JS 代码本身仍在 JS 线程解释执行；只有 `ObjC.use(...).invoke(...)`、`getProperty`/`setProperty` 中落在 native 的那部分会按目标队列 hop。
- 需要"先上主线程再回 JS"的用法，请使用引擎提供的 `mainAsync` / `after` 等 API（见 `WNJSEngine.m` 中注册内容）。

## 3. Main ↔ JS 死锁防护（三层防线）

### 3.1 根因层：RPC 不再占主线程

- `WNRemoteServer.handleRequest:` 派发到 **专用串行队列** `com.whiteneedle.rpc`（非 main queue）。
- RPC 队列同步等待 JS 线程（`evaluateScript` → `performOnJSThread:waitUntilDone:YES`），主线程始终**自由**。
- JS 线程内部通过 `dispatch_sync(main)` 执行 UIKit 操作时，主线程可立即响应。
- Socket 写回通过 `dispatch_async(main)` 完成（NSStream 在 mainRunLoop 上）。

### 3.2 ObjC 桥防御层

- `WNObjCBridge.m` 中 `invoke`、`getProperty`、`setProperty` 的 `dispatch_sync(main)` **增加死锁检测**：
  - 当 `WNShouldAvoidSynchronousMainFromJSThread()` 为 `YES` 时，降级为 `dispatch_async(main)` + `wakeJSThread`。
  - **代价**：降级路径下返回值为 `undefined`（getProperty/invoke）或 fire-and-forget（setProperty）。
  - 此降级仅在主线程被其他路径阻塞于 JS 时触发（正常 RPC 路径因 §3.1 不会触发）。

### 3.3 Hook 引擎层

- `WNHookEngine.forwardInvocation:` 的死锁检测条件：
  ```
  wouldDeadlock = [NSThread isMainThread]
      && (WNIsInvokeMainThreadHopActive() || WNIsExternalThreadWaitingOnJSThread())
  ```
- 覆盖两种场景：
  1. JS invoke 正在 main-hop 中（`_wnInvokeMainHopCounter > 0`）
  2. 其他线程（如 RPC 队列）正同步等待 JS 线程（`s_wnJSThreadExternalWaitCount > 0`）
- 处理策略不变：void → 异步转 JS 线程；非 void → 回退 original。

## 4. 队列职责对照

| 队列 / 线程 | 职责 | 可阻塞等待 |
|---|---|---|
| `com.whiteneedle.rpc` (serial) | RPC 业务逻辑 + evaluateScript | JS 线程 |
| `WhiteNeedle.JSExecution` | JSCore evaluate | main queue (sync) |
| Main queue | UIKit、NSStream 写回 | **不可**等待 JS 线程 |

## 5. Hook 全局状态

- `g_hooks` / `g_hookContext` 由 `os_unfair_lock` 保护；`Interceptor.*` 与远程 RPC 对 hook 的查询/修改均经同一把锁。不要在持锁时执行 JS 回调（当前实现已避免）。

## 6. 已知限制

- **降级路径丢返回值**：当 ObjC 桥检测到死锁风险、降级为 async 时，`invoke()`/`getProperty()` 返回 `undefined`。脚本层应对 UIKit 调用的返回值做 null-check。
- **Hook + 长 evaluate 竞争**：若 RPC 正在 evaluate 一段长脚本，同时 Hook 在主线程触发且返回值为非 void，Hook 会回退 original（§3.3）。这是有意设计的安全降级。

---

*与审计 `docs/audit-whiteneedle-2026-04-26.md` 中 [H1] 与 [M1] 建议对应。*
