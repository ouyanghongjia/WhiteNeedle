# WhiteNeedle 线程与队列契约

本文档补充 `WNJSEngine`、`WNObjCBridge`、`WNHookEngine`、`WNBlockBridge`、`WNRemoteServer` 中的**线程约束**，供脚本与 native 扩展作者对照。

> **2026-05-15 v3 更新**：Run-loop pumping 架构 — 消除所有 dispatch_sync 死锁，所有场景完美运行。

## 1. 核心架构：Run-loop Pumping

**JS 线程从不使用 `dispatch_sync` 到任何外部队列。** 取而代之的是 `dispatch_async` + pump 自身 run loop。

```
JS 线程                              Main 线程
  │                                     │
  ├─ dispatch_async(main, work) ──────► │ 执行 ObjC 调用
  │                                     │ （可能触发 hook）
  ├─ pump JS run loop ◄────────────────── hook 转发到 JS
  │  ├─ 处理 hook 回调（VM 锁递归）     │
  │  │  ├─ dispatch_async(main, ...) ──► │ 处理 hook 中的 main 调用
  │  │  └─ pump ... (嵌套)              │
  │  └─ hookDone = YES ──────────────► │ pump 退出
  │                                     │ work 完成
  ├─ done = YES ◄──────────────────────── wakeJSThread
  └─ pump 退出，继续执行
```

**为什么安全**：

1. JSCore VM 锁是**递归锁**（`pthread_mutex_t` + `PTHREAD_MUTEX_RECURSIVE`），同一线程可多次获取
2. JS 线程 pump 期间处理 hook 回调时，VM 锁递归获取 → 完全合法
3. CFRunLoop 支持嵌套进入 → 任意深度的 `dispatch.main()` / hook 嵌套均可工作
4. `g_forwardingDepth`（`_Thread_local`）阻止同线程 hook 递归 → 无无限循环风险

## 2. JS 执行线程

- `JSVirtualMachine` / `JSContext` 的创建与 `evaluateScript:` **必须**在同一条专用线程（`WhiteNeedle.JSExecution`）上执行。
- 通过 `-[WNJSEngine performOnJSThread:waitUntilDone:]` 在该线程上调度工作。

## 3. ObjC invoke 的线程控制

- **默认行为**：TLS (`WNSetInvokeTargetQueue`) 为 `NULL`，ObjC 调用就地在 JS 线程执行。
- `dispatch.main(fn)` — 在 fn 内的 ObjC 调用通过 **pump 模式** 在主线程执行，**同步返回结果**。
- `dispatch.global(fn)` — 在 fn 内的 ObjC 调用通过 **pump 模式** 在全局队列执行，同步返回结果。
- `dispatch.none(fn)` — 清除队列设置（等价于默认行为）。
- `dispatch.mainAsync(fn)` / `dispatch.after(ms, fn)` — 异步变体，不阻塞 JS 线程。

### UIKit 安全提示

对 UIKit 对象的非主线程访问会打印 Warning 日志。脚本编写者应使用 `dispatch.main()` 确保 UIKit 操作在主线程执行。

## 4. `WNDispatchToQueuePumpingJSRunLoop`

核心 helper 函数，所有从 JS 线程到外部队列的调度均通过它：

```objc
void WNDispatchToQueuePumpingJSRunLoop(dispatch_queue_t queue, dispatch_block_t block);
```

| 调用线程 | 行为 |
|---|---|
| JS 线程 | `dispatch_async(queue, block)` + pump JS run loop 直到完成 |
| 其他线程 | 回退到 `dispatch_sync(queue, block)` |

**使用场景**：ObjC Bridge（invoke/getProperty/setProperty）、Block Bridge（$callBlock）、WNRunOnMainFromAnyThread。

## 5. RPC → JS 路径

### 5.1 异步 RPC

- `loadScript` / `unloadScript` / `evaluate` 使用 `performOnJSThread:waitUntilDone:NO`。
- RPC 队列不阻塞，`s_wnJSThreadExternalWaitCount` 在脚本执行期间为 **0**。

### 5.2 同步 RPC（rpcCall / listModules）

- 使用 `evaluateScript:` → `waitUntilDone:YES`，RPC 队列阻塞但不影响 main。
- 被评估的 JS 代码中使用 `dispatch.main()` **正常工作**（pump 模式）。

## 6. Hook 引擎线程策略

| 触发线程 | 返回类型 | 策略 |
|---|---|---|
| Main | void | `performOnJSThread:waitUntilDone:NO` 异步转发 |
| Main | non-void | `performOnJSThread:waitUntilDone:NO` + pump main run loop（2s 超时兜底） |
| 非 Main/JS | 任意 | `performOnJSThread:waitUntilDone:YES` 同步等待 |
| JS | 任意 | 就地执行（已在 JS 线程） |

### Hook + dispatch.main() 完美协作

1. Hook 在 main 触发 → 转发到 JS（pump main）
2. JS 处理 hook 回调 → 回调中使用 `dispatch.main()` → ObjC bridge dispatch_async(main) → pump JS
3. Main 的 pump 处理来自 JS 的 dispatch_async → ObjC 调用在 main 执行
4. 完成后 JS pump 退出 → hook 回调继续 → hookDone = YES → main pump 退出

### re-entrancy 保护

- `g_forwardingDepth`（`_Thread_local`）：pump 期间 main 上的嵌套 hook 直接调用 original IMP
- `g_reentrancyGuard`：防止同一 selector 的 JS hook 回调递归

## 7. Block 桥线程策略

`$callBlock` 调用 ObjC block 时通过 `WNRunOnMainFromAnyThread` 统一处理：

| 调用线程 | 行为 | 返回值 |
|---|---|---|
| JS 线程 | `WNDispatchToQueuePumpingJSRunLoop(main, block)` | **正确返回**（pump 等待完成） |
| 非 JS/Main | `dispatch_sync(main, block)` | 正确返回 |
| Main | 直接执行 | 正确返回 |

**non-void block 从 JS 线程调用现在可以正确获取返回值。**

## 8. 队列职责对照

| 队列 / 线程 | 职责 | 阻塞行为 |
|---|---|---|
| `com.whiteneedle.rpc` (serial) | RPC 业务逻辑 | JS 线程（仅 rpcCall/listModules） |
| `WhiteNeedle.JSExecution` | JSCore evaluate、hook 回调 | 从不 dispatch_sync，仅 dispatch_async + pump |
| Main queue | UIKit、hook pump | pump 等待 JS（hook non-void） |

## 9. 已知限制

1. **Hook pump 超时**：非 void hook 在 main 触发时，如果 JS 线程长时间忙碌（> 2s），pump 超时后回退到 original IMP。这是安全兜底，正常情况不会触发。

2. **void hook 异步特性**：main 上触发的 void hook 异步转发到 JS，调用者不等待 hook 回调完成。这意味着 void hook 的副作用（如修改全局状态）可能滞后于 ObjC 方法返回。

---

*与审计 `docs/audit-whiteneedle-2026-04-26.md` 中 [H1] 与 [M1] 建议对应。*
