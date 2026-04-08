# WhiteNeedle Inspector — 在 VS Code 中按 F5 调试 iOS JS

## 架构概述

WhiteNeedle 采用**统一调试架构**：

- **JSContext** 通过 `_setRemoteInspectionEnabled:YES` 向系统 `RemoteInspector` 注册，名称为 "WhiteNeedle"
- **WKWebView** 由 `WNWebViewProbe` 自动 hook，设置 `inspectable = YES`
- Mac 端通过 `ios_webkit_debug_proxy` 连接 USB 设备，统一发现和调试所有目标

| 端口 | 用途 | 协议 |
|------|------|------|
| **27042** | 引擎控制（推脚本、evaluate、ObjC 运行时） | JSON-RPC over TCP |
| **9222** | ios_webkit_debug_proxy 本地端口（所有调试目标） | WebKit Inspector Protocol over WebSocket |

---

## 快速开始

### 前提条件

```bash
# 安装 ios_webkit_debug_proxy（必须）
brew install ios-webkit-debug-proxy
```

### 1. 准备设备

- 用 USB 线连接 iPhone 到 Mac
- iPhone: 设置 > Safari > 高级 > Web 检查器 = 开
- 运行包含 WhiteNeedle 的 App

### 2. 验证可用

```bash
# ios_webkit_debug_proxy 由 VS Code 扩展自动启动
# 也可手动测试：
ios_webkit_debug_proxy -F &
curl -sS "http://localhost:9222/json"
```

成功输出示例：

```json
[{
  "title": "WhiteNeedle",
  "url": "",
  "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/page/1",
  "appId": "PID:79937"
}]
```

如果 App 中有 WKWebView，也会出现在列表中。

### 3. 按 F5 开始调试

1. 打开一个 `.js` 脚本文件
2. 在代码行号左侧点击添加断点
3. 按 **F5**（或菜单 Run → Start Debugging）
4. 选择 **WhiteNeedle: Debug Script**
5. 如果有多个调试目标（JSContext + WKWebView），扩展会弹出选择列表

### 4. launch.json 配置

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "whiteneedle",
      "request": "launch",
      "name": "WhiteNeedle: Debug",
      "host": "127.0.0.1",
      "inspectorPort": 9222,
      "targetTitle": "WhiteNeedle",
      "script": "${file}"
    }
  ]
}
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `host` | `127.0.0.1` | 连接地址（USB 模式下固定为 localhost） |
| `inspectorPort` | `9222` | ios_webkit_debug_proxy 本地端口 |
| `targetTitle` | `WhiteNeedle` | 首选目标名称，自动匹配。未指定或未匹配时弹出选择列表 |
| `script` | `${file}` | 当前文件（仅用于参考） |

---

## 调试目标

### WhiteNeedle JSContext

WhiteNeedle 创建的 `JSContext` 通过 `WNDebugSupport` 向系统注册，名称为 **"WhiteNeedle"**。

### WKWebView 页面

`WNWebViewProbe` hook 了 `WKWebView` 的初始化方法，自动设置 `inspectable = YES`（iOS 16.4+）。App 中所有 WKWebView 都会出现在目标列表中。

### 多目标选择

当 `/json` 列表中有多个目标时，VS Code 会弹出 QuickPick 列表让用户选择。如果 `targetTitle` 匹配到某个目标，会自动选中。

---

## 支持的调试功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 断点（行断点） | ✅ | `Debugger.setBreakpointByUrl` |
| 继续执行 | ✅ | `Debugger.resume` |
| 单步跳过 | ✅ | `Debugger.stepOver` |
| 单步进入 | ✅ | `Debugger.stepInto` |
| 单步跳出 | ✅ | `Debugger.stepOut` |
| 调用栈查看 | ✅ | `Debugger.paused` 事件 |
| 变量查看 | ✅ | `Runtime.getProperties` |
| 表达式求值 | ✅ | `Runtime.evaluate` / `Debugger.evaluateOnCallFrame` |
| 控制台输出 | ✅ | `Console.messageAdded` → Debug Console |
| 异常断点 | ❌ | 计划中 |
| 条件断点 | ❌ | 计划中 |

---

## 技术细节

### 统一调试通道

```
VS Code ←→ ios_webkit_debug_proxy ←→ usbmuxd ←→ lockdownd
                                                    ↓
                                           com.apple.webinspector
                                                    ↓
                                             webinspectord
                                                    ↓
                                     Inspector::RemoteInspector::singleton()
                                           ↙                ↘
                                  JSContext               WKWebView
                                 (WhiteNeedle)          (WebContent process)
```

### WebKit Inspector Protocol (WIP) vs Chrome DevTools Protocol (CDP)

两者非常相似：
- 相同点：JSON-RPC over WebSocket、`/json` HTTP 发现端点、核心域名相同（`Debugger`、`Runtime`、`Console`）
- 差异点：
  - WIP 使用 `Console.messageAdded`，CDP 使用 `Runtime.consoleAPICalled`（扩展已自动转换）
  - WIP 的 `scriptParsed` 有时用 `sourceURL` 而非 `url`（扩展已处理）

---

## 故障排查

### ios_webkit_debug_proxy 启动失败

```bash
brew install ios-webkit-debug-proxy
idevice_id -l   # 确认 iPhone 已连接
```

### `curl localhost:9222/json` 无响应

- 确认 App 已在设备上运行
- 确认 iPhone 已通过 USB 连接
- 确认 Safari > Web Inspector 已开启
- 手动测试：`ios_webkit_debug_proxy -F` 然后 `curl http://localhost:9222/json`

### 目标列表为空

- JSContext：确认 `WNDebugSupport enableInspectorForContext:` 已执行
- WKWebView：需要 iOS 16.4+

### 断点不命中

- 确认先通过 "Push & Run" 推送脚本到设备
- 检查脚本 URL 是否与断点文件名匹配

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `ios-dylib/WhiteNeedle/Sources/WNWebViewProbe.m` | Hook WKWebView 设置 inspectable |
| `ios-dylib/WhiteNeedle/Sources/WNDebugSupport.m` | JSContext RemoteInspector 注册 |
| `vscode-extension/src/debugging/webKitProxy.ts` | ios_webkit_debug_proxy 管理 |
| `vscode-extension/src/debugging/cdpClient.ts` | Inspector 协议客户端 |
| `vscode-extension/src/debugging/debugAdapter.ts` | DAP 调试适配器 + 目标选择 |
| `vscode-extension/src/debugging/debugAdapterFactory.ts` | 调试配置解析 |
