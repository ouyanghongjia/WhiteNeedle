# WhiteNeedle 线程与队列契约

本文档补充 `WNJSEngine`、`WNObjCBridge`、`WNHookEngine`、UIDebug/Block 桥中的**隐式约束**，供脚本与 native 扩展作者对照。

## 1. JS 执行线程

- `JSVirtualMachine` / `JSContext` 的创建与 `evaluateScript:` **必须**在同一条专用线程（`WhiteNeedle.JSExecution`）上执行。
- 通过 `-[WNJSEngine performOnJSThread:waitUntilDone:]` 在该线程上调度工作。

## 2. `ObjC` 的 `dispatch.main` / `global` / `none`

- **语义**：通过 `WNSetInvokeTargetQueue` 设置的是 **后续纯 ObjC 调用（invoke / KVC）** 所**投递**的 GCD 队列，**不是**把当前 JavaScript 逻辑切到主线程执行。
- JS 代码本身仍在 JS 线程解释执行；只有 `ObjC.use(...).invoke(...)`、`getProperty`/`setProperty` 中落在 native 的那部分会按目标队列 hop。
- 需要“先上主线程再回 JS”的用法，请使用引擎提供的 `mainAsync` / `after` 等 API（见 `WNJSEngine.m` 中注册内容）。

## 3. Main ↔ JS 死锁（禁止双端 `sync` 互等）

- 典型死锁：线程 A 在 `performOnJSThread:… waitUntilDone:YES` 上**阻塞**等待 JS，而 JS 线程又 `dispatch_sync` 到 `main`（或主队列）等待 A 能推进主队列。
- **策略**（实现见 `WNRunOnMainFromAnyThread`、`WNIsExternalThreadWaitingOnJSThread`、`WNIsInvokeMainThreadHopActive`）：
  - 当检测到在 JS 线程上且**不应**对 main 做同步等待时，改为 `dispatch_async` 到主队列并 `wakeJSThread`；**不保证**与调用点同步的返回值（UIDebug/部分 block 会表现为 `null`/`undefined`）。
  - Hook 路径在“主线程 + 与 JS invoke 的 main-hop 叠套”时，对 void 方法异步转 JS 线程，对非 void 回退到 original（见 `WNHookEngine`）。

## 4. Hook 全局状态

- `g_hooks` / `g_hookContext` 由 `os_unfair_lock` 保护；`Interceptor.*` 与远程 RPC 对 hook 的查询/修改均经同一把锁。不要在持锁时执行 JS 回调（当前实现已避免）。

## 5. 远程 JSON-RPC

- 部分方法在 JS 线程执行，部分在主队列执行（见 `shouldRunRequestOnJSThread:`），与上述契约一致；勿假设所有 RPC 都在同一线程。

---

*与审计 `docs/audit-whiteneedle-2026-04-26.md` 中“线程契约文档”建议对应。*
