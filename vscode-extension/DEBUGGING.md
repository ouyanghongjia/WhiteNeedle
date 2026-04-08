# WhiteNeedle 调试指南

完整的 Inspector 技术文档见：**[docs/inspector-vscode.md](../docs/inspector-vscode.md)**

---

## 怎么安装 / 运行扩展

### 方式 A：开发调试（Extension Development Host）

1. 用 **Cursor 或 VS Code** 打开 **`vscode-extension`** 目录
2. 终端执行 `npm install && npm run compile`
3. 左侧 **「运行和调试」** → 选 **「Run Extension」** → 按 **F5**
4. 新窗口（Extension Development Host）中侧边栏应有 **WhiteNeedle**

### 方式 B：打成 .vsix 安装

```bash
npm install -g @vscode/vsce
cd vscode-extension
vsce package
```

得到 `whiteneedle-0.1.0.vsix`，在扩展面板 → … → **从 VSIX 安装**。

---

## 两个端口

| 端口 | 用途 | 协议 |
|------|------|------|
| **27042** | 引擎控制：推脚本、evaluate、ObjC 运行时 | JSON-RPC over TCP |
| **9222** | ios_webkit_debug_proxy 本地端口（所有调试目标） | WebKit Inspector Protocol over WebSocket |

---

## 前提条件

```bash
# 安装 ios_webkit_debug_proxy（必须，用于 USB 调试通道）
brew install ios-webkit-debug-proxy
```

iPhone 上需开启：**设置 > Safari > 高级 > Web 检查器 = 开**

---

## 从零开始：连接 → 推脚本 → F5 调试

### 1. 确保设备就绪

- iPhone 用 **USB 线** 连接到 Mac
- 运行包含 WhiteNeedle 的 App
- Xcode 控制台应看到 `[WhiteNeedle] Ready for remote debugging on port 27042`

### 2. 连接设备

侧边栏 **WhiteNeedle → Devices** 点击设备，或 **WhiteNeedle: Connect by IP**（`手机IP:27042`）。

### 3. 推送脚本

打开 `.js` 文件，按 **Cmd+Shift+R**（Push & Run）。

### 4. 创建调试配置

`.vscode/launch.json`：

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

| 参数 | 说明 |
|------|------|
| `targetTitle` | 首选目标名称。匹配失败或有多个目标时弹出选择列表 |
| `inspectorPort` | ios_webkit_debug_proxy 的本地端口（默认 9222） |

### 5. 开始调试

1. 在编辑器中打断点（行号左侧点击）或代码中写 `debugger;`
2. 按 **F5**（或侧边栏 Run and Debug → 绿色三角）
3. 扩展自动启动 `ios_webkit_debug_proxy`，发现调试目标
4. 如果有多个目标（JSContext + WKWebView），弹出选择列表
5. 线程名显示 **WhiteNeedle JS**，支持变量查看、调用栈、单步

---

## 验证 Inspector 可用

```bash
# 在 vscode-extension 目录
node scripts/check-inspector.mjs [port]
```

该脚本连接 `ios_webkit_debug_proxy` 的本地端口，检查 `/json` 目标列表。

- **退出码 0**：目标可用，F5 可调试
- **ECONNREFUSED**：ios_webkit_debug_proxy 未启动或端口不对
- **目标数量为 0**：设备上没有可调试的 JSContext 或 WKWebView

---

## 调试目标类型

| 类型 | 标题示例 | 说明 |
|------|----------|------|
| JSContext | "WhiteNeedle" | WhiteNeedle 创建的脚本引擎 |
| WKWebView | 页面 URL | App 内 WKWebView 加载的网页 |

`WNWebViewProbe` 自动 hook `WKWebView` 设置 `inspectable = YES`（iOS 16.4+），无需 App 修改代码。

---

## 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| `ios_webkit_debug_proxy not found` | 未安装 | `brew install ios-webkit-debug-proxy` |
| `/json` 返回空列表 | 设备未连接或 App 未运行 | 确认 USB 连接，`idevice_id -l` 检查设备 |
| 断点不命中 | 脚本未推送到设备 | 先 Push & Run，再 F5 |
| 设备发现不到 | Bonjour 权限问题 | 确认 App 的 Info.plist 有 NSBonjourServices |
| 变量显示为空 | 未暂停在断点 | 先设断点再触发执行 |
| WKWebView 不出现 | iOS < 16.4 | `inspectable` 属性需 iOS 16.4+ |

---

## 设置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `whiteneedle.deviceHost` | `127.0.0.1` | 设备 IP，连接后自动更新 |
| `whiteneedle.inspectorPort` | `9222` | ios_webkit_debug_proxy 本地端口 |
| `whiteneedle.enginePort` | `27042` | 引擎 JSON-RPC 端口（参考） |
