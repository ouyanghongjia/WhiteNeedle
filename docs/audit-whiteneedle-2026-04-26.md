# WhiteNeedle 源码审计记录（2026-04-26）

本记录针对 `ios-dylib/WhiteNeedle` 做只读审计，目标是评估：

- 代码清晰度与规范性
- 架构分层与职责边界
- 线程模型一致性与潜在隐患
- 可维护性风险与改进优先级

> 说明：本次仅记录，不包含代码修改。

---

## 结论概览

- **总体评价**：架构主干清晰（`WNJSEngine` 作为编排中枢、Bridge 分层明确、模块系统完整），但存在若干 **跨线程隐式约束** 与 **全局状态并发风险**，会在复杂链路下放大。
- **可维护性**：中等偏上。日常迭代可控，但在 Hook/RemoteServer/多线程交互场景仍有“知识依赖型”复杂度。
- **优先级建议**：先收口线程与并发风险（高），再拆分 `WNRemoteServer` 职责（中），最后完善文档/目录一致性（中低）。

---

## 分层与职责审计

### 1) 入口层（初始化编排）

- 入口在 `WhiteNeedle.m`，通过 constructor 初始化引擎、加载 bootstrap、启动远程服务与 Bonjour 广播。
- 优点：启动路径集中，便于排查。
- 风险：入口承担职责较多（引擎 + 远程 + 监控 + 广播），副作用半径大。

证据：

- `ios-dylib/WhiteNeedle/Sources/WhiteNeedle.m`

### 2) 核心执行层（JSC 引擎）

- `WNJSEngine` 已明确 JS 专用线程模型：创建 `JSVirtualMachine/JSContext` 与 `evaluateScript` 在同一线程。
- 使用 `performOnJSThread` + runloop 保活，模型方向正确。

证据：

- `ios-dylib/WhiteNeedle/Sources/WNJSEngine.m`

### 3) Bridge 层（ObjC/Hook/Native/Block/Module）

- `WNObjCBridge`、`WNHookEngine`、`WNNativeBridge`、`WNBlockBridge` 职责总体明确。
- 但 `WNNativeBridge` 与 `WNHookEngine` 体量/能力较集中，后续维护需要更强文档约束。

证据：

- `ios-dylib/WhiteNeedle/Sources/WNObjCBridge.h`
- `ios-dylib/WhiteNeedle/Sources/WNHookEngine.m`
- `ios-dylib/WhiteNeedle/Sources/WNNativeBridge.m`

### 4) 远程控制层（RemoteServer）

- `WNRemoteServer` 同时处理脚本管理、Hook 管理、类内省、UI/网络调试、文件操作等。
- 问题：单类职责过重，分支巨大，跨域耦合高。

证据：

- `ios-dylib/WhiteNeedle/Sources/WNRemoteServer.m`

### 5) JS 模块层（BuiltinModules，单一来源）

- 内置模块仅以 `ios-dylib/WhiteNeedle/BuiltinModules/*.js` 为权威源；仓库内已移除重复的 `lib/*.js`（原 M3 漂移问题已收敛）。

证据：

- `ios-dylib/WhiteNeedle/BuiltinModules/wn-auto.js` 等

---

## 风险清单（按严重度）

## 高风险

- **[H1] 主线程与 JS 线程互等死锁仍有边缘面**
  - 背景：虽然已加入部分死锁规避策略，但并非所有“主线程 sync 等 JS / JS 再 sync 主线程”的路径都统一防护。
  - 典型触发点：Hook 回调、UI 调试桥、主线程触发链路中的同步切换。
  - 影响：测试流程卡死、UI 无响应、调试会话中断。
  - 证据：`WNHookEngine.m`、`WNObjCBridge.m`、`WNUIDebugBridge.m`

- **[H2] Hook 全局状态并发访问风险**
  - 背景：`g_hooks` 等全局可变状态的读写在多入口线程下可能出现竞态（JS 线程与主线程 RPC 混用场景）。
  - 影响：Hook 状态不一致、偶现崩溃或逻辑错乱。
  - 证据：`WNHookEngine.m`、`WNRemoteServer.m`

## 中风险

- **[M1] `WNRemoteServer` 过度集中，耦合高**
  - 现象：一个调度函数覆盖太多功能域（脚本、hook、内省、文件、网络等）。
  - 影响：改动影响面大、回归测试成本高。
  - 证据：`WNRemoteServer.m`

- **[M2] 非主队列语义依赖约定**
  - 现象：`dispatch.main/global` 是“设置 invoke 目标队列语义”，JS 本身仍在 JS 线程执行，容易被误解为“代码切线程执行”。
  - 影响：脚本作者误用导致线程错误或性能抖动。
  - 证据：`WNJSEngine.m`、`WNObjCBridge.m`

- **[M3] ~~双份 JS 源带来同步漂移~~（已处理）**
  - 原现象：`lib` 与 `BuiltinModules` 曾并行维护。
  - 现状态：仅保留 `BuiltinModules`；CI 脚本 `verify-builtin-modules.sh` 做存在性检查；`build-dist` 输出 `dist/builtin-js/` 副本供查阅。
  - 证据：`ios-dylib/WhiteNeedle/BuiltinModules/`

## 低风险

- **[L1] 启动/就绪过程存在小粒度 busy-wait**
  - 影响：可忽略的 CPU 抖动，主要是工程洁净度问题。
  - 证据：`WNJSEngine.m`

- **[L2] 部分错误降级仅日志可见，业务侧无结构化反馈**
  - 影响：定位效率受限，不影响主流程正确性。
  - 证据：`WNHookEngine.m`、`WNObjCBridge.m`

---

## 清晰度与规范性评价

- **命名**：`WN*` 前缀总体统一，Bridge/Engine/Monitor 分层命名可读性较好。
- **注释质量**：线程模型相关注释明显改善（尤其 JSC 同线程约束与 sleep/runloop 语义）。
- **代码风格**：ObjC 风格一致，异常捕获与兜底路径基本具备。
- **不足**：关键“隐式合同”仍主要存在于代码注释与团队口头共识，缺少统一的“线程/队列契约文档”。

---

## 后续改进建议（不改行为语义）

1. **补线程契约文档（优先）**
   - 单独新增 `docs/threading-contract.md`，明确：
     - JS 线程唯一所有权
     - `dispatch.main/global` 语义（“设置 ObjC invoke 目标队列”，非“JS 线程迁移”）
     - Hook/RemoteServer 的线程入口与禁止模式

2. **给 Hook 全局状态加统一并发策略（优先）**
   - 选型：串行队列或统一锁策略，减少主/JS 并发读写窗口。

3. **拆分 RemoteServer handler（中期）**
   - 按域拆分：Engine/Hook/Introspect/File/Monitor。
   - 保留统一路由层，但将业务逻辑下沉到独立 handler。

4. **~~收敛 JS 模块单一来源~~（已完成）**
   - 权威路径：`ios-dylib/WhiteNeedle/BuiltinModules/`；分发包见 `dist/builtin-js/`。

5. **增强可观测性（中期）**
   - 增加关键线程切换与降级路径的可开关日志（避免默认噪声）。

---

## 审计范围

- `ios-dylib/WhiteNeedle/Sources/*`
- `ios-dylib/WhiteNeedle/BuiltinModules/*`

