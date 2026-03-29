# WhiteNeedle 使用指南

基于 **JavaScriptCore** 的 iOS 远程调试：通过 VS Code / Cursor 扩展实现局域网设备发现、脚本推送、（在 Inspector 可用时）JS 断点调试，以及 ObjC 运行时浏览。

## 环境要求

| 组件 | 版本要求 |
|------|---------|
| macOS | 12.0+ |
| Node.js | 18.0+ |
| Xcode Command Line Tools | 已安装 |
| VS Code / Cursor | 1.85+ |
| iOS 设备 | 15.0+ |
| 签名证书 | 开发者/企业证书 + Provisioning Profile |

## 快速开始

### 1. 构建 WhiteNeedle.dylib

```bash
cd ios-dylib
make
# 输出: build/WhiteNeedle.dylib
```

### 2. 重签名你的 IPA

```bash
cd resign-tool

# 确保 insert_dylib 已编译
cc -o insert_dylib insert_dylib.c
chmod +x insert_dylib

# 重签名
./resign.sh \
  -i YourApp.ipa \
  -c "Apple Development: your@email.com (TEAMID)" \
  -p /path/to/your.mobileprovision
```

输出文件: `YourApp_whiteneedle.ipa`

### 3. 安装到设备

使用 Xcode、`ios-deploy`、Apple Configurator 或 MDM 安装重签名后的 IPA：

```bash
# 使用 ios-deploy
ios-deploy --bundle YourApp_whiteneedle.ipa
```

### 4. 安装 VS Code 扩展

```bash
cd vscode-extension

npm install
npm run compile

# 在本仓库用 F5 调试扩展，或 vsce package 生成 .vsix 后安装
```

更细的 **连接设备、launch.json、DAP 与 Inspector 端口说明** 见：[vscode-extension/DEBUGGING.md](vscode-extension/DEBUGGING.md)。

### 5. 连接设备

1. 打开侧边栏 **WhiteNeedle** 面板  
2. 在 **Devices** 列表中选择设备（Mac 与 iPhone 同一局域网），或 **Connect by IP**，格式：`192.168.x.x:27042`  
3. 连接成功后，扩展会将 **`whiteneedle.deviceHost`** 设为该 IP，便于调试配置使用

### 6. 推送脚本

1. 打开或新建 `.js`  
2. 编写脚本（可参考 `sample-scripts/`）  
3. `Cmd+Shift+R` 推送并运行  
4. 在 **Output → WhiteNeedle** 查看日志

### 7. 断点调试（DAP）

1. 按 [DEBUGGING.md](vscode-extension/DEBUGGING.md) 配置 `.vscode/launch.json`  
2. 确认 **`inspectorPort`** 上能访问 CDP 风格的 `/json`（常为 9229 或经 USB 转发后的本地端口）  
3. 在脚本中设断点，F5 启动 **WhiteNeedle** 调试配置  

若无法连上 Inspector，可使用 **Safari → 开发** 连接设备上的 JSContext 进行调试。

### 8. ObjC 运行时浏览

1. 连接设备后打开 **ObjC Runtime**  
2. 加载类列表、过滤、展开方法  
3. 右键方法 → **Trace Method** 可注入追踪脚本  

## 项目结构

```
WhiteNeedle/
├── ios-dylib/           # iOS 动态库源码（JSC 引擎 + TCP 27042）
├── resign-tool/         # IPA 重签名与注入
├── vscode-extension/    # VS Code 扩展（Bonjour、推脚本、DAP）
│   ├── src/
│   │   ├── debugging/   # DAP + CDP 客户端
│   │   ├── device/
│   │   ├── discovery/
│   │   ├── scripting/
│   │   └── views/
│   └── DEBUGGING.md     # 调试与端口说明
└── sample-scripts/      # 示例脚本
```

## 常见问题

**Q: 设备列表中看不到设备？**  
确保同一 Wi-Fi，且 App 已启动（Bonjour 会广播 `_whiteneedle._tcp`）。自 iOS 14 起，宿主 App 的 **Info.plist** 必须包含 **`NSBonjourServices`**（含 `_whiteneedle._tcp`）和 **`NSLocalNetworkUsageDescription`**，否则系统会拒绝发布服务（日志里常见 **`NSNetServicesErrorCode = -72008`**），扩展侧永远扫不到设备。示例工程已配置；自建 IPA 请同样添加。首次运行须在 iPhone 上允许「本地网络」权限。Mac 端若仍扫不到，在 **系统设置 → 隐私与安全性 → 本地网络** 中为 **Cursor / VS Code** 开启权限。

**Q: 重签名后安装失败？**  
检查描述文件是否包含设备 UDID、证书是否有效。

**Q: 脚本推送报错 "Not connected"？**  
先在 Devices 中连接，端口为 **27042**（引擎端口）。

**Q: F5 调试立刻失败 / 连不上 CDP？**  
引擎 **27042** 不等于 Inspector。请阅读 **DEBUGGING.md**，检查 `http://host:inspectorPort/json`，或使用 Safari 开发菜单调试同一 JSContext。
