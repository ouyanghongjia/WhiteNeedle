# WhiteNeedle 任务跟踪

> 最后更新: 2026-04-02
>
> 基于 [CODE-REVIEW.md](docs/CODE-REVIEW.md) 深度评审结果制定
>
> 状态说明: ⬜ 未开始 | 🔧 进行中 | ✅ 已完成 | ⏸️ 暂停 | ❌ 取消

---

## Phase 0: 问题修复 — 代码缺陷与技术债清理

> 优先级最高，阻塞后续迭代的基础问题

### 0.1 死代码清理

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 0.1.1 | 删除 `views/cookieTreeView.ts` | ✅ | 功能已由 `panels/cookiePanel.ts` 替代 |
| 0.1.2 | 删除 `views/userDefaultsTreeView.ts` | ✅ | 功能已由 `panels/userDefaultsPanel.ts` 替代 |
| 0.1.3 | 删除 `views/fileSystemTreeView.ts` | ✅ | 功能已由 `panels/sandboxPanel.ts` 替代 |
| 0.1.4 | 删除 `views/objcTreeView.ts` | ✅ | 功能已由 `panels/objcPanel.ts` 替代 |
| 0.1.5 | 删除 `out/views/` 下对应的编译产物 | ✅ | 4 个 `.js` 文件已清理 |

### 0.2 依赖声明修复

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 0.2.1 | MCP Server `package.json` 显式添加 `zod` 依赖 | ✅ | 添加 `"zod": "^3.25 \|\| ^4.0"` |

### 0.3 命令注册补全

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 0.3.1 | 在 `package.json` `contributes.commands` 中注册 `whiteneedle.evaluate` | ✅ | 已注册 |
| 0.3.2 | 在 `package.json` `contributes.commands` 中注册 `whiteneedle.listHooks` | ✅ | 已注册 |

### 0.4 安全漏洞修复

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 0.4.1 | `inspect_object` 输入转义/沙箱化 | ✅ | 使用 `JSON.stringify` + `eval` 安全模式 |
| 0.4.2 | `trace_method` 输入转义 | ✅ | 使用 `JSON.stringify` 安全转义 |

### 0.5 文档修正

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 0.5.1 | 重写 `TASKS.md` 反映当前 JSC 架构 | ✅ | 本文档即为重写结果 |
| 0.5.2 | 移除对不存在的 `FRIDA-API-GUIDE.md` 的引用 | ✅ | 全库搜索确认：无实际链接引用，仅 TASKS.md 和 CODE-REVIEW.md 中有元描述 |

---

## Phase 1: 脚本共享与片段库

> 降低新用户上手门槛，提升脚本复用效率（用户提优先级）

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 1.1 | 设计脚本片段库数据结构（分类、元数据、参数模板） | ✅ | `snippets/snippetLibrary.ts` |
| 1.2 | 内置常用脚本片段（方法 Hook、类枚举、网络监控、UI 遍历等） | ✅ | 6 个内置片段，覆盖 hook/runtime/network/ui |
| 1.3 | VS Code 侧边栏脚本片段浏览面板 | ✅ | `panels/snippetPanel.ts`，支持搜索/过滤/插入/运行 |
| 1.4 | 脚本参数化模板（用户填参后生成完整脚本） | ✅ | `resolveSnippet()` 参数替换 |
| 1.5 | 脚本导入/导出功能 | ✅ | JSON 格式导入/导出，自定义片段持久化至 globalState |
| 1.6 | 脚本执行历史与收藏 | ✅ | globalState 持久化历史（50 条上限）和收藏，Webview 三标签页 Snippets/Favorites/History |

---

## Phase 2: 连接稳定性强化

> ROADMAP P1 优先级，当前断线需手动重连，严重影响日常使用

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 2.1 | TCP 断线检测（心跳机制） | ✅ | TcpBridge 15s 心跳 + 10s 超时，TCP KeepAlive |
| 2.2 | 指数退避自动重连 | ✅ | 最多 10 次，退避 1s→30s 上限 |
| 2.3 | 重连后恢复脚本和 Hook 状态 | ✅ | `restoreSessionState()` 自动重载最近脚本 |
| 2.4 | 状态栏连接指示器完善 | ✅ | 已连接/断线重连中(⟳)/已断开 三态切换 |
| 2.5 | 断线时 UI 优雅降级 | ✅ | connectionOverlay 共享模块，7 个面板集成断线/重连浮层 |

---

## Phase 3: 测试与 CI/CD 基础设施

> 零测试覆盖是最大工程风险，需要逐步建立

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 3.1 | VS Code 扩展配置 Vitest 测试框架 | ✅ | vitest.config.ts + snippetLibrary 15 个用例 |
| 3.2 | MCP Server 配置 Vitest 测试框架 | ✅ | vitest.config.ts + tcpClient 8 个 + security 9 个用例 |
| 3.3 | TCP Bridge Mock Server | ✅ | tcpClient.test.ts 中包含 mock TCP server |
| 3.4 | DeviceManager 单元测试 | ✅ | 32 个用例：连接/断开/重连/RPC 转发/Hook/View/Network/状态管理 |
| 3.5 | MCP Server 工具调用测试 | ✅ | 代码注入安全测试 (trace/inspect/heap) |
| 3.6 | 配置 GitHub Actions CI | ✅ | .github/workflows/ci.yml — 双 job 编译+测试 |
| 3.7 | iOS dylib XCTest 单元测试 | ⬜ | Hook Engine 边界情况测试 |

---

## Phase 4: 中期功能扩展

> 代码评审建议的 v0.4-v0.5 功能

### 4.1 数据调试套件

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 4.1.1 | SQLite 数据库浏览器 | ⬜ | 自动发现 .db 文件、SQL 编辑器、表格化结果 |
| 4.1.2 | Keychain 查看器 | ⬜ | Security.framework 封装 |
| 4.1.3 | plist 结构化预览 | ⬜ | 树形展示而非 XML 文本 |

### 4.2 网络能力增强

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 4.2.1 | Response Mock（自定义响应注入） | ⬜ | |
| 4.2.2 | cURL 命令一键导出 | ⬜ | |
| 4.2.3 | HAR 格式导出 | ⬜ | |
| 4.2.4 | WKWebView 请求捕获 | ⬜ | NSURLProtocol + 私有 API |

### 4.3 ObjC.choose 堆扫描完整实现

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 4.3.1 | 基于 VM regions 遍历 + isa 匹配的真正堆扫描 | ⬜ | 当前为 stub 实现，MCP `heap_search` 依赖此底层 |

---

## Phase 5: 长期愿景

> v1.0+ 方向性规划

| # | 方向 | 状态 | 备注 |
|---|------|------|------|
| 5.1 | AI 智能诊断 Agent | ⬜ | 描述 bug 现象 → AI 自动 Hook 分析 |
| 5.2 | 多设备同时连接 | ⬜ | |
| 5.3 | Webview Panel 框架升级 (React/Svelte) | ⬜ | 当前 HTML 字符串拼接不可持续 |
| 5.4 | 脚本智能补全（运行时感知） | ⬜ | 连接设备后类名/方法名自动补全 |
| 5.5 | Android 跨平台支持 | ❌ | 基于 V8/QuickJS + JNI bridge |
| 5.6 | 协作调试（多人共享会话） | ⬜ | |

---

## 里程碑

| 里程碑 | 包含阶段 | 目标 | 状态 |
|--------|---------|------|------|
| M0: 代码健康 | Phase 0 | 清理技术债、修复已知缺陷 | ✅ |
| M1: 脚本共享 | Phase 1 | 内置脚本片段库上线 | ✅ |
| M2: 稳定连接 | Phase 2 | 自动重连、状态恢复 | ✅ |
| M3: 质量门禁 | Phase 3 | 测试覆盖 + CI/CD | 🔧 |
| M4: 数据增强 | Phase 4 | SQLite/Keychain/网络增强 | ⬜ |
| M5: v1.0 | Phase 5 | AI Agent + 跨平台 | ⬜ |

---

## 变更记录

| 日期 | 变更内容 |
|------|---------|
| 2026-03-24 | 初始化任务跟踪文档（基于 Frida 架构，已废弃） |
| 2026-04-02 | 基于 CODE-REVIEW.md 深度评审重写全部任务计划，反映当前 JSC 自研引擎架构 |
| 2026-04-02 | Phase 0 全部完成：死代码清理、zod 依赖、命令注册、代码注入修复 |
| 2026-04-02 | Phase 1 核心完成：脚本片段库数据模型 + 浏览面板 + 参数化模板 |
| 2026-04-02 | Phase 2 核心完成：TcpBridge 心跳检测、指数退避重连(10次/30s上限)、脚本状态恢复 |
| 2026-04-02 | Phase 3 基础完成：Vitest 配置、32 个测试用例(17 MCP + 15 扩展)、GitHub Actions CI |
| 2026-04-02 | 额外修复：heap_search 代码注入漏洞(JSON.stringify 转义) |
