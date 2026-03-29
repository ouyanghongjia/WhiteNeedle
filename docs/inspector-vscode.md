# WhiteNeedle Inspector — 在 VS Code 中按 F5 调试 iOS JSContext

## 架构概述

WhiteNeedle 在 iOS 设备上运行两个服务：

| 端口 | 用途 | 协议 |
|------|------|------|
| **27042** | 引擎控制（推脚本、evaluate、ObjC 运行时） | JSON-RPC over TCP |
| **9222** | Inspector 调试（断点、单步、变量查看） | WebKit Inspector Protocol over WebSocket |

VS Code 扩展通过 USB 隧道连接设备端口 9222 的 WebSocket，实现 F5 断点调试。

---

## 快速开始

### 前提条件

```bash
# 安装 USB 隧道工具（必须）
brew install libimobiledevice
```

### 1. 连接 iPhone

用 USB 线连接 iPhone 到 Mac，并在设备上运行包含 WhiteNeedle 的 App。

### 2. 验证 Inspector 可用

```bash
# 启动 USB 隧道（扩展会自动启动，也可手动测试）
iproxy 9222 9222 &

# 检查 Inspector 端点
curl -sS "http://localhost:9222/json"
```

成功输出示例：

```json
[{
  "title": "WhiteNeedle JSContext",
  "type": "page",
  "webSocketDebuggerUrl": "ws://localhost:9222/inspector"
}]
```

### 3. 按 F5 开始调试

1. 打开一个 `.js` 脚本文件
2. 在代码行号左侧点击添加断点
3. 按 **F5**（或菜单 Run → Start Debugging）
4. 选择 **WhiteNeedle: Debug Script**

扩展会 **自动启动 iproxy USB 隧道** 并连接设备上的 Inspector。

### 4. launch.json 配置

如果需要自定义，在 `.vscode/launch.json` 中：

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
      "useUSB": true,
      "script": "${file}"
    }
  ]
}
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `host` | `127.0.0.1` | 连接地址（USB 模式下固定为 localhost） |
| `inspectorPort` | `9222` | Inspector 端口 |
| `useUSB` | `true` | 自动启动 iproxy USB 隧道 |
| `script` | `${file}` | 当前文件（仅用于参考） |

---

## 连接方式

### USB 隧道（推荐，默认）

- 无需 Wi-Fi 网络，不受 AP 隔离影响
- 延迟低、稳定可靠
- 扩展自动管理 `iproxy` 进程的生命周期
- 调试结束后自动清理隧道

### Wi-Fi 直连（备选）

如果设备与 Mac 在同一 Wi-Fi 且没有 AP 隔离：

```json
{
  "type": "whiteneedle",
  "request": "launch",
  "name": "WhiteNeedle: Debug (Wi-Fi)",
  "host": "192.168.1.10",
  "inspectorPort": 9222,
  "useUSB": false,
  "script": "${file}"
}
```

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

### WebKit Inspector Protocol (WIP) vs Chrome DevTools Protocol (CDP)

WhiteNeedle 的 Inspector 使用的是 JavaScriptCore 原生的 **WebKit Inspector Protocol**，而非 V8 的 CDP。两者非常相似：

- 相同点：JSON-RPC over WebSocket、`/json` HTTP 发现端点、核心域名相同（`Debugger`、`Runtime`、`Console`）
- 差异点：
  - WIP 使用 `Console.messageAdded`，CDP 使用 `Runtime.consoleAPICalled`（扩展已自动转换）
  - WIP 的 `scriptParsed` 有时用 `sourceURL` 而非 `url`（扩展已处理）

### USB 隧道原理

`iproxy` 是 `libimobiledevice` 工具集的一部分，通过 USB（usbmuxd 协议）将 Mac 的本地端口映射到 iOS 设备端口：

```
VS Code ← localhost:9222 ← iproxy ← USB ← iPhone:9222
```

这与 Safari Web Inspector、Xcode 调试使用的是相同的底层机制。

### Inspector 服务器实现

Inspector 服务器（`WNInspectorServer`）基于 GCD dispatch_source 实现：

1. **TCP 监听**：POSIX socket + GCD dispatch_source 监听端口 9222
2. **HTTP 发现**：`GET /json` 和 `GET /json/version` 返回调试目标信息
3. **WebSocket 升级**：RFC 6455 握手（SHA1 + Base64）
4. **帧编解码**：支持文本帧和 Ping/Pong
5. **Inspector 桥接**：通过 C++ 层接入 JavaScriptCore 的内部 `RemoteControllableTarget`

### C++ 桥接层

使用 `dlsym` 动态解析 WebKit 私有符号，通过 ARM64/x86_64 指令分析确定运行时偏移量，确保跨 iOS 版本兼容性。

> **注意**：使用了 WebKit 私有 API，仅适用于调试阶段，不应提交到 App Store。

---

## 故障排查

### iproxy 启动失败

```bash
# 安装 / 更新 libimobiledevice
brew install libimobiledevice

# 确认 iPhone 已通过 USB 连接
idevice_id -l
```

### `curl localhost:9222/json` 无响应

- 确认 App 已在设备上运行（Xcode 控制台有 `[WNInspector:WS] Inspector server listening on port 9222`）
- 确认 iPhone 已通过 USB 连接
- 手动测试隧道：`iproxy 9222 9222`，然后 `curl -v http://localhost:9222/json`

### 调试时断点不命中

- 确认先通过 "Push & Run" 推送脚本到设备
- 检查脚本 URL 是否与断点文件名匹配（Inspector 通过 URL 匹配断点位置）

### `socket hang up` 错误

- 确认连接的是 Inspector 端口 **9222**，而非引擎端口 **27042**
- 确认 `useUSB: true`（默认值）

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `ios-dylib/WhiteNeedle/Sources/Inspector/WNInspectorServer.m` | WebSocket Inspector 服务器 |
| `ios-dylib/WhiteNeedle/Sources/Inspector/WNInspectorBridge.mm` | ObjC++ ↔ JSC 桥接 |
| `ios-dylib/WhiteNeedle/Sources/Inspector/WNInspectorCAPI.cpp` | C API 层 |
| `vscode-extension/src/debugging/usbTunnel.ts` | USB 隧道管理（iproxy） |
| `vscode-extension/src/debugging/cdpClient.ts` | VS Code 侧 Inspector 客户端 |
| `vscode-extension/src/debugging/debugAdapter.ts` | DAP 调试适配器 |
| `vscode-extension/src/debugging/debugAdapterFactory.ts` | 调试配置解析 |
