# Hybrid Automation: WhiteNeedle + WebDriverAgent

双引擎自动化架构，结合 WhiteNeedle（进程内）和 WebDriverAgent（系统级）的优势。

## 架构

```
Mac 端 (MCP Server / Cursor)
├── WhiteNeedle Client  ──TCP──►  设备端 WhiteNeedle (App 进程内)
├── WDA Client          ──HTTP──► 设备端 WDA (XCUITest 进程)
└── Coordinator                   智能路由
```

- **WhiteNeedle**：App 内精准操作（ObjC runtime、hook、数据库、文件）
- **WDA**：系统级操作（跨 App、系统弹窗、推送、设置）
- **Coordinator**：根据操作类型自动路由到最佳引擎

## 快速开始

### 1. 安装 WebDriverAgent（一次性）

```bash
# 自动检测开发者 Team ID 并配置签名
./tools/setup-wda.sh

# 或手动指定 Team ID
./tools/setup-wda.sh --team YOUR_TEAM_ID
```

### 2. 启动 WDA

```bash
# 连接 iOS 设备后执行（自动检测设备、端口转发）
./tools/start-wda.sh
```

WDA 启动后监听 `http://localhost:8100`。

### 3. 使用 MCP 工具

在 Cursor 中通过 MCP 自然语言调用：

```
# 查看双引擎状态
→ auto_status

# 同时连接两个引擎
→ auto_connect_all

# 智能点击（自动选引擎）
→ auto_tap selector:"登录" engine:"auto"

# 强制用 WDA（系统级）
→ wda_tap label:"允许"

# 强制用 WhiteNeedle（App 内）
→ evaluate code:"ObjC.use('LoginVC').invoke('loginButton').invoke('sendActionsForControlEvents:', [64])"
```

## 何时用哪个引擎

| 操作 | 引擎 | 原因 |
|------|------|------|
| 点击 App 内按钮 | WhiteNeedle | 进程内直接调用，零延迟 |
| 处理"允许通知"弹窗 | WDA | 系统弹窗在 SpringBoard 进程 |
| 读写 App 数据库 | WhiteNeedle | 直接访问 sandbox |
| 打开系统设置 | WDA | 需要启动其他 App |
| Hook 网络请求 | WhiteNeedle | 需要 method swizzling |
| 获取整屏 Accessibility 树 | WDA | Accessibility 跨进程查询 |
| 修改 App 内存状态 | WhiteNeedle | 直接操作 ObjC 运行时 |
| 从通知栏点击推送 | WDA | SpringBoard 交互 |

## MCP 工具列表

### WhiteNeedle (wn_*) — 已有工具
`connect`, `evaluate`, `list_classes`, `get_methods`, `load_script`, `get_view_hierarchy`, `search_views_by_text`, ...

### WDA (wda_*) — 新增工具
- `wda_connect` / `wda_disconnect` / `wda_status`
- `wda_tap` / `wda_type` / `wda_swipe`
- `wda_find_element` / `wda_find_elements`
- `wda_accept_alert` / `wda_dismiss_alert` / `wda_get_alert_text`
- `wda_launch_app` / `wda_activate_app` / `wda_terminate_app` / `wda_press_home`
- `wda_screenshot` / `wda_page_source` / `wda_device_info`

### Coordinator (auto_*) — 新增工具
- `auto_status` — 双引擎连接状态
- `auto_connect_all` — 同时连接两个引擎
- `auto_tap` — 智能路由点击

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WN_HOST` | `127.0.0.1` | WhiteNeedle 设备 IP |
| `WN_PORT` | `27042` | WhiteNeedle TCP 端口 |
| `WDA_HOST` | `127.0.0.1` | WDA 地址（iproxy 转发后是 localhost） |
| `WDA_PORT` | `8100` | WDA HTTP 端口 |

## 前置条件

- macOS + Xcode（构建 WDA 需要）
- `libimobiledevice`（端口转发）：`brew install libimobiledevice`
- iOS 设备通过 USB 连接并信任此电脑
- App 已集成 WhiteNeedle（CocoaPods）
