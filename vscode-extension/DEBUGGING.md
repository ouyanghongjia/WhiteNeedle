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
| **9222** | Inspector 调试：断点、单步、变量 | WebKit Inspector Protocol over WebSocket |

---

## 从零开始：连接 → 推脚本 → F5 调试

### 1. 确保设备就绪

- iPhone 与 Mac 在同一 Wi-Fi
- 运行包含 WhiteNeedle 的 App
- Xcode 控制台应看到 `[WhiteNeedle] Inspector server on port 9222`

### 2. 连接设备

侧边栏 **WhiteNeedle → Devices** 点击设备，或 **WhiteNeedle: Connect by IP**（`手机IP:27042`）。

连接后扩展自动设置 `whiteneedle.deviceHost` 和 `whiteneedle.inspectorPort`。

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
      "host": "${config:whiteneedle.deviceHost}",
      "inspectorPort": 9222,
      "script": "${file}"
    }
  ]
}
```

### 5. 开始调试

1. 在编辑器中打断点（行号左侧点击）或代码中写 `debugger;`
2. 按 **F5**（或侧边栏 Run and Debug → 绿色三角）
3. 线程名显示 **WhiteNeedle JS**，支持变量查看、调用栈、单步

---

## 验证 Inspector 可用

```bash
# 在 vscode-extension 目录
node scripts/check-inspector.mjs 192.168.1.10 9222
```

- **退出码 0**：Inspector 正常，F5 可用
- **ECONNREFUSED**：App 未运行或端口不对
- **非 JSON 响应**：可能误连了引擎端口 27042

---

## 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| `socket hang up` | 连接了错误端口 | 确认 inspectorPort=9222，不是 27042 |
| 断点不命中 | 脚本未推送到设备 | 先 Push & Run，再 F5 |
| 设备发现不到 | Bonjour 权限问题 | 确认 App 的 Info.plist 有 NSBonjourServices |
| 变量显示为空 | 未暂停在断点 | 先设断点再触发执行 |

---

## 设置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `whiteneedle.deviceHost` | `127.0.0.1` | 设备 IP，连接后自动更新 |
| `whiteneedle.inspectorPort` | `9222` | Inspector WebSocket 端口 |
| `whiteneedle.enginePort` | `27042` | 引擎 JSON-RPC 端口（参考） |
