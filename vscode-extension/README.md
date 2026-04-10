# WhiteNeedle

**Remote iOS Runtime Debugging for VS Code / Cursor**

WhiteNeedle 让你在 VS Code 或 Cursor 中通过局域网直接连接 iOS 设备，实时注入 JavaScript 脚本、Hook Objective-C 方法、检查运行时状态——无需越狱，无需 Xcode。

---

## Features

### 🔍 设备发现与连接

- **Bonjour 自动发现** — 同一局域网内的 iOS 设备自动出现在侧边栏
- **手动 IP 连接** — 不支持 Bonjour 时可通过 IP + 端口直连
- **自动重连** — 重启编辑器时自动连接上次使用的设备

### 📜 脚本注入与调试

- **一键推送脚本** — 编辑器内按 `Cmd+Shift+R` 或点击 ▶️ 按钮，脚本即刻在设备端执行
- **保存自动重载** — 修改脚本后保存，设备端自动更新（可关闭）
- **双模式执行** — Single 模式（IIFE 复用上下文，快速迭代）和 Project 模式（全新 JSContext，自动推送依赖）
- **JS 模块管理** — 从 URL / 本地文件 / npm 安装 JS 模块到设备端，脚本中直接 `require()` 使用
- **DAP 断点调试** — 通过 `ios_webkit_debug_proxy` 支持完整的断点、单步、变量查看
- **JS API 智能补全** — 内置 TypeScript 类型声明，安装扩展即可获得 `ObjC.use()`、`Interceptor.attach()` 等 API 的自动补全

### 🛠 运行时检查面板

| 面板 | 说明 |
|------|------|
| **ObjC Runtime** | 浏览类层级、搜索类/方法、查看实例属性 |
| **Hook Manager** | 可视化管理活跃的 Method Hook，一键添加/移除 |
| **View Hierarchy** | 远程 UI 层级树，定位视图元素 |
| **Leak Detector** | 检测 ViewController 内存泄漏 |
| **Retain Graph** | 可视化对象引用关系图，定位循环引用 |

### 💾 数据检查面板

| 面板 | 说明 |
|------|------|
| **Cookies** | 查看/编辑 App 的 HTTP Cookie 存储 |
| **UserDefaults** | 浏览和修改 NSUserDefaults 键值对 |
| **Sandbox Files** | 远程文件浏览器，查看 App 沙盒目录结构 |
| **SQLite Browser** | 打开设备端 SQLite 数据库，执行 SQL 查询 |

### 🌐 网络调试

| 面板 | 说明 |
|------|------|
| **Network Monitor** | 实时抓取 HTTP/HTTPS 请求与响应 |
| **HTTP Mock Rules** | 配置 URL 匹配规则，返回自定义 Mock 响应 |
| **Host Mapping** | 类 SwitchHosts 的域名映射，配合代理服务器使用 |
| **Proxy Server** | 内置 HTTP/HTTPS 代理，一键启停 |

### 📦 JS 模块管理

| 功能 | 说明 |
|------|------|
| **Install from URL** | 通过 URL 下载 JS 模块到设备端 |
| **Install from File** | 选择 Mac 本地的 JS 文件安装 |
| **Install from npm** | 输入 npm 包名，通过 unpkg CDN 自动下载 |
| **Installed Modules** | 侧边栏面板查看已安装模块，右键卸载 |

### 📚 效率工具

| 功能 | 说明 |
|------|------|
| **Script Snippets** | 内置常用脚本片段库，快速插入 |
| **Team Snippets** | 团队共享脚本片段，通过 Git 同步 |
| **API Documentation** | 内置 API 文档面板，离线可用 |
| **Structured Logs** | 格式化的设备端日志输出 |

---

## Quick Start

1. **安装扩展** — 双击 `.vsix` 文件或通过命令面板 `Extensions: Install from VSIX...`
2. **集成 WhiteNeedle** — 将 `WhiteNeedle.dylib` 注入目标 App（重签名或 CocoaPods 集成）
3. **连接设备** — 在侧边栏 WhiteNeedle 面板中点击发现的设备，或使用 `Connect by IP`
4. **编写脚本** — 使用 `WhiteNeedle: New Script` 命令创建脚本，享受完整的 API 补全
5. **推送执行** — `Cmd+Shift+R` 将脚本推送到设备端运行

---

## Commands

所有命令均可通过 `Cmd+Shift+P` 命令面板访问，输入 `WhiteNeedle` 即可筛选：

| 命令 | 快捷键 | 说明 |
|------|--------|------|
| `WhiteNeedle: Push & Run Script` | `Cmd+Shift+R` | 推送当前脚本到设备执行 |
| `WhiteNeedle: Stop Script` | — | 停止设备端运行的脚本 |
| `WhiteNeedle: New WhiteNeedle Script` | — | 创建新脚本（含类型引用） |
| `WhiteNeedle: Connect by IP Address` | — | 手动输入 IP 连接设备 |
| `WhiteNeedle: Refresh Devices` | — | 刷新 Bonjour 设备列表 |
| `WhiteNeedle: Evaluate Expression` | — | 在设备端执行单行 JS 表达式 |
| `WhiteNeedle: Toggle Proxy Server` | — | 启停内置代理服务器 |
| `WhiteNeedle: Install JS Module` | — | 安装 JS 模块到设备端（URL / 本地文件 / npm） |
| `WhiteNeedle: Uninstall JS Module` | — | 卸载设备端已安装的 JS 模块 |
| `WhiteNeedle: Refresh Installed Modules` | — | 刷新已安装模块列表 |

---

## Settings

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `whiteneedle.autoReload` | `true` | 保存时自动重载脚本 |
| `whiteneedle.autoConnect` | `true` | 启动时自动连接上次设备 |
| `whiteneedle.enginePort` | `27042` | 设备端引擎监听端口 |
| `whiteneedle.proxyPort` | `8899` | 代理服务器端口 |
| `whiteneedle.scriptMode` | `single` | 脚本执行模式：`single`（IIFE 复用上下文）或 `project`（全新 JSContext + 依赖推送） |
| `whiteneedle.inspectorPort` | `9222` | Web Inspector 代理端口 |

---

## Debugging (DAP)

WhiteNeedle 支持通过 Debug Adapter Protocol 进行断点调试。

在 `.vscode/launch.json` 中添加：

```json
{
    "type": "whiteneedle",
    "request": "launch",
    "name": "WhiteNeedle: Debug",
    "host": "127.0.0.1",
    "inspectorPort": 9222
}
```

前置要求：安装 `ios_webkit_debug_proxy`（`brew install ios-webkit-debug-proxy`）。

---

## Type Completion

扩展内置了完整的 WhiteNeedle JS API 类型声明文件。安装扩展后：

- 工作区的 `jsconfig.json` 会自动配置（如不存在则自动创建）
- 通过 `New WhiteNeedle Script` 创建的脚本自动包含 `/// <reference>` 指令
- `ObjC.use()`、`Interceptor.attach()`、`rpc.exports` 等 API 均有完整的参数提示和文档注释

---

## Requirements

- VS Code 1.85+ 或 Cursor
- iOS 设备与 Mac 处于同一局域网
- 目标 App 已集成 WhiteNeedle.dylib
- （可选）`ios_webkit_debug_proxy` — 用于 DAP 断点调试

---

## 配套资源

以下资源位于 WhiteNeedle 分发包中（与本扩展一同分发）：

- 📖 **`docs/USAGE-GUIDE.md`** — 新手使用指南，从零开始的详细操作步骤与截图
- 📚 **`docs/api-*.md`** — 各模块 JS API 参考文档
- 🤖 **`skills/`** — Cursor Agent Skills（JS API 文档 + IPA 重签名）
- 🔌 **`mcp-server/`** — MCP Server，AI Agent 工具服务器

---

**WhiteNeedle** — 让 iOS 运行时调试像写前端一样简单。
