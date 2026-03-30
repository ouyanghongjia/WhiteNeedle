# WhiteNeedle 演进路线图

> 基于当前能力现状，从深度 iOS 调试用户视角出发的功能规划。
> 最后更新：2026-03-30

---

## 当前能力总览

| 模块 | 能力 |
|------|------|
| ObjC Runtime | 类浏览、方法列举、对象创建与调用、方法 Hook（onEnter/onLeave） |
| 脚本引擎 | JS 推送 & 热重载、表达式求值、RPC 导出 |
| Cookie | 查看 / 新增 / 删除 / 按域名过滤 |
| UserDefaults | 查看 / 编辑 / 删除 / 多 Suite 支持 |
| 文件系统 | 浏览 / 读取 / 写入 / 删除 / 下载（含文件夹递归） |
| 调试器 | 断点、单步、变量查看（WebKit Inspector Protocol） |
| 主线程调度 | `dispatch.main()` / `dispatch.mainAsync()` / `dispatch.after()` |
| VS Code 集成 | Bonjour 发现、手动 IP 连接、侧边栏 TreeView × 6、脚本编辑器 |

---

## 一、高价值新能力

### 1.1 网络请求监控 `[P0]`

**痛点**：目前依赖 Charles / Proxyman 等外部代理工具，配置繁琐、无法查看 App 内部视角（如被 SSL Pinning 保护的请求），且需要在 IDE 外频繁切换窗口。

**方案**：

- **iOS 侧**：新增 `WNNetworkBridge`，hook `NSURLSession` 的 `dataTaskWithRequest:completionHandler:` 等关键方法，捕获请求/响应元数据
- **传输**：通过现有 TCP JSON-RPC 通道以 notification 推送 `networkRequest` 和 `networkResponse` 事件
- **VS Code 侧**：新增 Webview 面板展示请求列表

**功能清单**：

- [ ] 实时请求列表（URL、Method、Status Code、耗时、大小）
- [ ] 请求详情面板（Request Headers / Body / Response Headers / Body）
- [ ] 按域名、状态码、关键词过滤
- [ ] 请求时间线可视化
- [ ] cURL 命令导出（方便复现）
- [ ] Response Mock（拦截并修改返回数据）

---

### 1.2 视图层级检查器 `[P0]`

**痛点**：Xcode 的 Debug View Hierarchy 需要暂停进程；Reveal 功能强但收费且需额外配置。无法在 VS Code 中完成 UI 检查。

**方案**：

- **iOS 侧**：新增 `WNViewHierarchyBridge`，递归遍历 `UIWindow` 的视图树，序列化每个 view 的关键属性
- **VS Code 侧**：TreeView 展示层级 + Webview 展示可视化布局

**功能清单**：

- [ ] 树形展示完整视图层级（类名、frame、tag）
- [ ] 选中节点显示详细属性（backgroundColor、alpha、hidden、constraints）
- [ ] 实时修改属性（改颜色、frame、hidden、alpha）
- [ ] 设备端高亮选中视图（添加彩色边框）
- [ ] 按类名搜索视图
- [ ] 截图叠加视图边界线
- [ ] 查看当前 ViewController 层级栈

---

### 1.3 SQLite / CoreData 数据库浏览器 `[P1]`

**痛点**：查看 App 数据库需要先下载 `.db` 文件，再用 DB Browser for SQLite 等外部工具打开，流程冗长。

**方案**：

- **iOS 侧**：新增 `WNSQLiteBridge`，封装 `sqlite3` C API，支持执行任意 SQL
- **VS Code 侧**：自动发现沙盒内数据库文件，提供查询面板

**功能清单**：

- [ ] 自动扫描沙盒中的 `.db` / `.sqlite` / `.sqlite3` 文件
- [ ] 列出所有表和表结构（columns、types、indexes）
- [ ] SQL 查询编辑器（带语法高亮）
- [ ] 表格化展示查询结果
- [ ] 基本 CRUD 操作（插入行、编辑单元格、删除行）
- [ ] 查询历史记录

---

### 1.4 Keychain 访问 `[P2]`

**痛点**：调试登录态、Token 刷新时，需要查看 Keychain 中的存储值，目前没有便捷手段。

**方案**：

- **iOS 侧**：新增 `WNKeychainBridge`，封装 Security.framework 的 `SecItemCopyMatching` 等 API
- **VS Code 侧**：TreeView 展示，按 service / account 分组

**功能清单**：

- [ ] 列出 App 可访问的所有 Keychain 条目
- [ ] 查看条目详情（service、account、data、accessGroup）
- [ ] 编辑 / 删除条目
- [ ] 新增 Keychain 条目
- [ ] 按 service、account、label 过滤

---

## 二、现有能力优化

### 2.1 结构化日志系统 `[P1]`

**痛点**：所有日志混在一个 OutputChannel 中，高频 hook 时有用信息被淹没，无法过滤和搜索。

**优化方案**：

- [ ] 日志分类标签（Console / Hook / Network / Error）
- [ ] 日志级别过滤（log / warn / error / debug）
- [ ] 关键词搜索、正则匹配过滤
- [ ] 日志条目时间戳
- [ ] 点击日志跳转到对应 hook 定义位置
- [ ] 日志导出为文件
- [ ] 日志数量上限 & 自动清理

---

### 2.2 Hook 管理面板 `[P1]`

**痛点**：Hook 只能通过编写脚本创建和管理，缺乏可视化操作。想禁用某个 hook 必须修改脚本重新推送。

**优化方案**：

- [ ] 侧边栏展示所有活跃 Hook 列表
- [ ] 单个 Hook 启用 / 禁用开关（不需要重新 push 脚本）
- [ ] 显示每个 Hook 的触发次数、最近触发时间
- [ ] 从 ObjC Runtime 浏览器一键添加 Hook（弹出回调模板选择）
- [ ] Hook 模板预设（仅打印参数 / 打印返回值 / 修改返回值 / 计时）
- [ ] Hook 分组管理（按脚本 / 按类名）

---

### 2.3 脚本片段库 `[P2]`

**痛点**：常用调试操作每次都要手写脚本，新用户上手成本高。

**优化方案**：

- [ ] 内置常用片段：
  - 打印当前 ViewController 栈
  - 列出所有网络请求配置
  - 查找包含指定文本的 UILabel
  - 导出所有 Keychain 数据
  - 监控内存警告
  - 打印 App 启动参数
  - 查看 App 签名信息
- [ ] 片段分类（Runtime / UI / Network / Storage / Debug）
- [ ] 用户自定义片段保存与管理
- [ ] 一键执行（不需要创建文件）
- [ ] 片段参数化（如类名、方法名作为变量）

---

### 2.4 沙盒文件浏览增强 `[P2]`

**优化方案**：

- [ ] plist 文件结构化树形展示（而非纯 XML 文本）
- [ ] 图片文件缩略图预览（Webview 渲染 base64）
- [ ] 文件大小变化监控（适合调试缓存增长问题）
- [ ] 从本地上传文件到设备沙盒（反向传输）
- [ ] 文件内容搜索（在设备端 grep）
- [ ] 文件对比（本地文件 vs 设备文件）

---

## 三、开发体验提升

### 3.1 连接稳定性 & 状态指示 `[P1]`

- [ ] TCP 断线自动重连（指数退避策略）
- [ ] VS Code 状态栏持续显示连接状态（绿色/红色指示灯 + 设备名）
- [ ] 重连后自动恢复已加载脚本
- [ ] 连接超时可配置
- [ ] 多设备同时连接支持

---

### 3.2 脚本智能提示增强 `[P2]`

- [ ] 连接设备后，自动补全当前 App 的 ObjC 类名
- [ ] `ObjC.use('ClassName')` 的 ClassName 参数自动补全
- [ ] Hook 回调中 `args` 参数的类型推断提示
- [ ] 方法签名自动补全（基于 getMethods 数据）
- [ ] Bridge API 的参数校验提示

---

### 3.3 性能监控仪表盘 `[P3]`

- [ ] 实时 FPS 计数器
- [ ] CPU / Memory 使用率曲线
- [ ] 主线程卡顿检测（超过 16ms 的 RunLoop 迭代）
- [ ] 方法耗时统计（配合 Hook 自动计时）
- [ ] 内存泄漏检测（Weak Reference 监控）

---

## 优先级总览

| 优先级 | 功能 | 价值 | 预估工作量 |
|--------|------|------|-----------|
| **P0** | 网络请求监控 | 替代 Charles/Proxyman，几乎每次调试必用 | 大 |
| **P0** | 视图层级检查器 | 替代 Reveal，UI 调试核心工具 | 大 |
| **P1** | 结构化日志系统 | 解决当前最大体验痛点 | 中 |
| **P1** | Hook 管理面板 | 让 Hook 操作从写代码变为点按钮 | 中 |
| **P1** | SQLite 浏览器 | 数据调试高频场景 | 中 |
| **P1** | 连接稳定性 | 基础体验保障 | 小 |
| **P2** | Keychain 访问 | 登录态/安全调试刚需 | 小 |
| **P2** | 脚本片段库 | 降低使用门槛，提升效率 | 小 |
| **P2** | 沙盒浏览增强 | 完善现有功能体验 | 小 |
| **P2** | 脚本智能提示 | 提升脚本编写效率 | 中 |
| **P3** | 性能监控仪表盘 | 性能优化场景专用 | 大 |

---

## 里程碑规划（建议）

### v0.2 — 调试体验基础优化
- 结构化日志系统
- Hook 管理面板
- 连接稳定性 & 状态栏指示
- 沙盒文件上传

### v0.3 — 核心调试工具
- 网络请求监控
- 视图层级检查器

### v0.4 — 数据调试套件
- SQLite 浏览器
- Keychain 访问
- plist 结构化预览

### v0.5 — 效率提升
- 脚本片段库
- 脚本智能提示
- 性能监控仪表盘
