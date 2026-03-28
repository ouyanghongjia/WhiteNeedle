# WhiteNeedle 任务跟踪

> 最后更新: 2026-03-24
>
> 状态说明: ⬜ 未开始 | 🔧 进行中 | ✅ 已完成 | ⏸️ 暂停 | ❌ 取消

---

## Phase 1: 基础设施 (预计 3-4 周)

### 1.1 iOS 动态库 (WhiteNeedle.dylib)

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 1.1.1 | 创建动态库工程，配置 iOS 15+ 最低部署目标 | ✅ | Makefile 方式构建，arm64 |
| 1.1.2 | 实现 `__attribute__((constructor))` 入口函数 | ✅ | WhiteNeedle.m |
| 1.1.3 | 通过 `dlopen` 加载 FridaGadget.dylib | ✅ | 从 mainBundle.privateFrameworksPath 加载 |
| 1.1.4 | 编写 FridaGadget.config (listen 模式，端口 27042) | ✅ | Vendor/FridaGadget.config |
| 1.1.5 | 实现 Bonjour/NSNetService 服务广播 | ✅ | WNBonjourAdvertiser，广播 bundleId/device/systemVersion |
| 1.1.6 | 下载适配 iOS arm64 的 FridaGadget.dylib | ✅ | v17.8.2 universal (arm64+arm64e)，37MB |
| 1.1.7 | 真机验证: dylib 加载 + Gadget 启动 + Bonjour 可被发现 | ⬜ | 需要真机 + 重签名后的 IPA |

### 1.2 重签名工具

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 1.2.1 | 获取/编译 `insert_dylib` 工具 | ✅ | 自行编写 insert_dylib.c 并编译 |
| 1.2.2 | 编写 resign.sh 主脚本 (IPA 解包/注入/重签/打包) | ✅ | 支持 -i/-c/-p/-o/-d 参数 |
| 1.2.3 | 支持开发者证书签名 (需指定 Provisioning Profile) | ✅ | 通过 --cert + --profile 参数 |
| 1.2.4 | 支持企业证书签名 | ✅ | 同上，传入企业证书即可 |
| 1.2.5 | 自动提取原 IPA 的 entitlements | ✅ | security cms + PlistBuddy 提取 |
| 1.2.6 | 端到端测试: 重签名后的 IPA 在真机安装并运行 | ⬜ | 需要真机测试 |

### 1.3 VSCode 插件脚手架

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 1.3.1 | 初始化 VSCode Extension 工程 | ✅ | TypeScript，手动搭建 |
| 1.3.2 | 配置 package.json: 命令、视图容器、菜单 | ✅ | 6 个命令 + 2 个视图 + 快捷键 + 配置项 |
| 1.3.3 | 实现 Bonjour/mDNS 设备发现 (bonjour-service npm) | ✅ | bonjourDiscovery.ts |
| 1.3.4 | 实现设备列表 TreeView 侧边栏 | ✅ | deviceTreeView.ts，显示设备详情 |
| 1.3.5 | 设备上下线实时刷新 | ✅ | EventEmitter 驱动 TreeView 刷新 |
| 1.3.6 | 联调验证: VSCode 能发现真机上运行的注入 App | ⬜ | 需要真机测试 |

---

## Phase 2: 脚本管理 (预计 2-3 周)

### 2.1 Sidecar 桥接进程

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 2.1.1 | 创建 sidecar Node.js 工程，安装 frida-node | ✅ | frida v16.5.0 已安装 |
| 2.1.2 | 实现 JSON-RPC over stdio 协议 | ✅ | bridge.js，7 个方法 |
| 2.1.3 | 实现设备连接 (frida.getDevice / attach) | ✅ | handleConnect: addRemoteDevice + attach |
| 2.1.4 | 实现 Script 生命周期管理 (create/load/unload) | ✅ | handleLoadScript / handleUnloadScript |
| 2.1.5 | 实现 console.log 消息转发 | ✅ | script.message + logHandler -> notify |
| 2.1.6 | 实现 RPC 调用转发 (script.exports) | ✅ | handleRpcCall |
| 2.1.7 | 错误处理与自动重连 | ⬜ | 需要实现连接断开后的重试逻辑 |

### 2.2 脚本推送与执行

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 2.2.1 | VSCode Extension 中实现 SidecarManager (进程启停) | ✅ | sidecarManager.ts，JSON-RPC + 超时 |
| 2.2.2 | 实现 "推送并运行脚本" 命令 | ✅ | Cmd+Shift+R 快捷键 |
| 2.2.3 | 实现 Output Channel 控制台面板 | ✅ | WhiteNeedle Output Channel |
| 2.2.4 | 实现脚本热重载 (保存时自动重新加载) | ✅ | onDidSaveTextDocument + autoReload 配置 |
| 2.2.5 | 内置 Frida 脚本模板/snippets (方法 Hook、类列举等) | ✅ | 4 个示例脚本 + newScript 模板 |
| 2.2.6 | 联调验证: 从 VSCode 推送脚本到真机并看到输出 | ⬜ | 需要真机测试 |

---

## Phase 3: JS 断点调试 (预计 3-4 周)

### 3.1 V8 Inspector 集成

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 3.1.1 | Sidecar 中实现 script.enableDebugger(port) 调用 | ✅ | handleEnableDebugger / handleDisableDebugger |
| 3.1.2 | 实现 Inspector 端口动态分配与传递 | ⬜ | |
| 3.1.3 | 验证: Chrome DevTools 能连上并调试 Frida 脚本 | ⬜ | 先用 Chrome 验证 Inspector 可用性 |

### 3.2 DAP 适配器

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 3.2.1 | 实现 DebugAdapterDescriptorFactory | ✅ | debugAdapterFactory.ts (InlineImplementation) |
| 3.2.2 | 实现 launch/attach 请求处理 | ✅ | debugAdapter.ts launchRequest |
| 3.2.3 | 桥接 DAP setBreakpoints -> CDP Debugger.setBreakpoint | ✅ | setBreakPointsRequest via CDP |
| 3.2.4 | 桥接 DAP continue/next/stepIn/stepOut -> CDP 对应命令 | ✅ | continueRequest/nextRequest/stepInRequest/stepOutRequest |
| 3.2.5 | 桥接 DAP variables/scopes -> CDP Runtime.getProperties | ✅ | scopesRequest + variablesRequest |
| 3.2.6 | 实现 Call Stack 展示 | ✅ | stackTraceRequest, Debugger.paused 事件 |
| 3.2.7 | 实现 Watch 表达式求值 | ✅ | evaluateRequest (hover + REPL) |
| 3.2.8 | 实现 Debug Console REPL | ✅ | evaluateRequest context=repl |
| 3.2.9 | 配置 launch.json 模板 (contributes.debuggers) | ✅ | package.json debuggers + configurationSnippets |
| 3.2.10 | 联调验证: 在 VSCode 中断点调试 Frida 脚本全流程 | ⬜ | 需要真机测试 |

---

## Phase 4: ObjC 运行时检查 (预计 2-3 周)

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 4.1 | 编写 ObjC 类枚举脚本 (ObjC.classes) | ✅ | sample-scripts/objc-class-dump.js |
| 4.2 | 编写实例搜索脚本 (ObjC.choose) | ✅ | sample-scripts/instance-search.js (RPC: searchInstances + getInstanceProperties) |
| 4.3 | 编写方法签名提取脚本 | ✅ | sample-scripts/method-signatures.js (RPC: getMethodSignatures + getClassHierarchy) |
| 4.4 | 编写实例属性/ivar 读取脚本 | ✅ | instance-search.js getInstanceProperties (读取 $ivars) |
| 4.5 | 编写方法调用追踪脚本 (Interceptor.attach) | ✅ | sample-scripts/method-tracer.js |
| 4.6 | VSCode TreeView: 类浏览器 (支持搜索过滤) | ✅ | objcTreeView.ts, 分组+搜索过滤+方法展开 |
| 4.7 | VSCode TreeView: 实例属性查看器 | ✅ | 集成在 ObjC TreeView 中 |
| 4.8 | VSCode Panel: 方法追踪实时日志 | ✅ | 右键 Trace Method -> Output Channel |
| 4.9 | 联调验证: 从 VSCode 浏览真机 App 的 ObjC 运行时 | ⬜ | |

---

## Phase 5: 体验优化 (预计 2 周)

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 5.1 | Frida API TypeScript 类型定义 (intellisense) | ✅ | frida-api/frida-gum.d.ts + jsconfig.json |
| 5.2 | 多设备同时连接与管理 | ⬜ | |
| 5.3 | 脚本收藏夹 / 执行历史 | ⬜ | |
| 5.4 | 网络请求监控脚本 (NSURLSession Hook) | ✅ | sample-scripts/network-inspector.js |
| 5.5 | UI 层级查看脚本 | ✅ | sample-scripts/ui-hierarchy.js |
| 5.6 | 错误提示与用户引导优化 | ⬜ | |
| 5.7 | Windows 平台兼容性测试与修复 | ⬜ | 重点: frida-node 编译、mDNS |
| 5.8 | 编写 GETTING-STARTED.md 使用文档 | ✅ | 含快速开始、项目结构、FAQ |
| 5.9 | 编写 FRIDA-API-GUIDE.md 脚本编写指南 | ✅ | 含 ObjC/Hook/RPC/内存/UI/调试技巧 |

---

## 里程碑

| 里程碑 | 包含阶段 | 目标日期 | 状态 |
|--------|---------|---------|------|
| M1: 能跑通 | Phase 1 | - | 🔧 差真机验证 |
| M2: 能用起来 | Phase 1 + 2 | - | 🔧 差真机验证 |
| M3: MVP 可调试 | Phase 1 + 2 + 3 | - | 🔧 差真机验证 |
| M4: 功能完整 | Phase 1-4 | - | 🔧 差真机验证 |
| M5: 正式发布 | Phase 1-5 | - | ⬜ |

---

## 变更记录

| 日期 | 变更内容 |
|------|---------|
| 2026-03-24 | 初始化任务跟踪文档 |
| 2026-03-24 | Phase 1 代码完成 (1.1.1-1.1.6, 1.2.1-1.2.5, 1.3.1-1.3.5)；Phase 2 代码完成 (2.1.1-2.1.6, 2.2.1-2.2.5)；Phase 3 V8 Inspector sidecar 侧完成 (3.1.1)；Phase 4/5 示例脚本完成 4 个 |
| 2026-03-24 | Phase 3 DAP 完成: CDP Client (cdpClient.ts) + 完整 DAP 适配器 (debugAdapter.ts) + launch.json 模板。Phase 4 ObjC 运行时: 实例搜索/方法签名脚本 + ObjC TreeView 类浏览器 + Trace 命令。Phase 5: Frida API 类型定义 (frida-gum.d.ts) |
