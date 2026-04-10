# Change Log

## [0.2.0] — 2026-04-10

### Added

- 双模式脚本执行：Single 模式（IIFE 复用上下文，快速迭代）和 Project 模式（全新 JSContext，自动推送本地依赖）
- JS 模块管理：从 URL / 本地文件 / npm 安装模块到设备端，侧边栏 Installed Modules 面板管理
- `whiteneedle.scriptMode` 设置项（`single` / `project`）
- Project 模式下自动分析 `require('./...')` 相对路径依赖并推送到设备临时目录
- Project 模式下 JSContext 重置时自动回放 Hook Manager 中已设置的 Hook 代码
- `whiteneedle.installModule` / `whiteneedle.uninstallModule` / `whiteneedle.refreshModules` 命令
- 侧边栏新增 Installed Modules 树视图面板
- iOS 端新增 `resetContext`、`writeFile`、`mkdir`、`removeDir`、`listInstalledJsModules` RPC 方法
- `WNModuleLoader` 新增 `wn_installed_modules` 默认搜索路径、`clearAllCache`、`resetSearchPaths` 类方法

## [0.1.0] — 2025-04-09

### Added

- Bonjour 局域网自动设备发现
- 手动 IP 地址连接
- 脚本推送与一键执行（`Cmd+Shift+R`）
- 保存时自动重载脚本
- DAP 断点调试（基于 `ios_webkit_debug_proxy`）
- 内置 JS API 类型声明，安装即享智能补全
- ObjC Runtime 浏览器
- Hook Manager 可视化管理
- View Hierarchy 远程 UI 检查
- Leak Detector 内存泄漏检测
- Retain Graph 循环引用可视化
- Cookies / UserDefaults / Sandbox Files / SQLite Browser 数据面板
- Network Monitor 实时抓包
- HTTP Mock Rules 自定义响应
- Host Mapping 域名映射
- 内置 HTTP/HTTPS Proxy Server
- Script Snippets 脚本片段库
- Team Snippets 团队共享片段（Git 同步）
- 内置 API Documentation 面板
- Structured Logs 格式化日志
