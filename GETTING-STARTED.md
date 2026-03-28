# WhiteNeedle 使用指南

基于 Frida 的 iOS 远程调试工具，通过 VSCode 插件实现局域网设备发现、脚本推送、JS 断点调试和 ObjC 运行时检查。

## 环境要求

| 组件 | 版本要求 |
|------|---------|
| macOS | 12.0+ |
| Node.js | 18.0+ |
| Xcode Command Line Tools | 已安装 |
| VSCode | 1.85+ |
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

### 4. 安装 VSCode 插件

```bash
cd vscode-extension

# 安装依赖
npm install
cd sidecar && npm install && cd ..

# 编译
npm run compile

# 调试运行 (在 VSCode 中按 F5)
```

### 5. 连接设备

1. 打开 VSCode 侧边栏的 **WhiteNeedle** 面板
2. 在 **Devices** 列表中找到你的设备（确保 Mac 和 iPhone 在同一局域网）
3. 点击设备名称或使用命令面板 `WhiteNeedle: Connect to Device`

### 6. 推送脚本

1. 打开或新建一个 `.js` 文件
2. 编写 Frida 脚本（参考 `sample-scripts/` 目录）
3. 按 `Cmd+Shift+R` 推送并运行
4. 在 **Output** 面板查看 `WhiteNeedle` 通道的输出

### 7. 断点调试

1. 创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "whiteneedle",
      "request": "launch",
      "name": "Debug Frida Script",
      "host": "192.168.1.xxx",
      "inspectorPort": 9229,
      "script": "${file}"
    }
  ]
}
```

2. 在 JS 脚本中设置断点
3. 按 F5 启动调试
4. 支持：断点、单步执行、变量查看、Watch 表达式、调试控制台

### 8. ObjC 运行时浏览

1. 连接设备后，在侧边栏打开 **ObjC Runtime** 面板
2. 点击下载图标加载所有 ObjC 类
3. 使用搜索图标过滤类名
4. 展开类查看方法列表
5. 右键方法 -> **Trace Method** 可实时追踪方法调用

## 项目结构

```
WhiteNeedle/
├── ios-dylib/           # iOS 动态库源码
│   ├── WhiteNeedle/     # WhiteNeedle.dylib 源码
│   ├── Vendor/          # FridaGadget.dylib + config
│   └── Makefile
├── resign-tool/         # IPA 重签名工具
│   ├── resign.sh        # 重签名脚本
│   ├── insert_dylib.c   # Mach-O 注入工具
│   └── payload/         # 预构建的 dylib 集合
├── vscode-extension/    # VSCode 插件
│   ├── src/             # TypeScript 源码
│   │   ├── debugging/   # DAP 调试适配器 + CDP 客户端
│   │   ├── device/      # 设备管理
│   │   ├── discovery/   # Bonjour 设备发现
│   │   ├── scripting/   # 脚本推送
│   │   └── views/       # TreeView 视图
│   ├── sidecar/         # frida-node 桥接进程
│   └── frida-api/       # Frida API 类型定义 (IntelliSense)
└── sample-scripts/      # 示例 Frida 脚本
```

## 常见问题

**Q: 设备列表中看不到设备？**
确保 Mac 和 iPhone 在同一 WiFi 网络下，且 App 已启动。

**Q: 重签名后安装失败？**
检查 Provisioning Profile 是否包含目标设备的 UDID，证书是否有效。

**Q: 脚本推送报错 "Not connected"？**
先在设备列表中连接设备，确认状态为已连接。

**Q: 断点不生效？**
确保使用 `debugger;` 语句或在 launch.json 中正确配置了 Inspector 端口。
