# WhiteNeedle 分发包

基于 **JavaScriptCore** 的 iOS 远程调试工具套件 — 通过 VS Code / Cursor 实现局域网设备发现、脚本推送、JS 断点调试，以及 ObjC 运行时浏览。

## 分发包内容

```
dist/
├── WhiteNeedle.vsix                # VS Code / Cursor 扩展（含 JS API 类型声明，安装即可获得补全）
├── WhiteNeedle.dylib               # 预编译的 iOS 动态库 (arm64, iOS 15+)
├── mcp-server/                     # MCP Server（AI Agent 工具链）
├── skills/                         # Cursor Agent Skills
│   ├── whiteneedle-js-api/         #   JS API 文档与参考
│   └── whiteneedle-resign/         #   重签名工作流（含 dylib + resign.sh + insert_dylib.c）
├── cocoapods/WhiteNeedle/          # CocoaPods 私有库（源码集成方式）
│   ├── WhiteNeedle.podspec
│   └── Sources/
├── sample-scripts/                 # 示例脚本
└── docs/                           # 完整文档
```

## ⚠️ 首次使用必改项

在按照下面步骤操作之前，请先完成以下配置，否则对应功能无法正常工作：

- [ ] **CocoaPods 私有库 Git 地址**（仅使用 CocoaPods 集成时需要）：打开 `cocoapods/WhiteNeedle/WhiteNeedle.podspec`，将 `REPLACE_WITH_YOUR_GIT_URL` 替换为你们团队的内部 Git 仓库地址。
- [ ] **MCP Server 设备 IP**：在 Cursor MCP 配置中将 `WN_HOST` 设为目标 iPhone 的局域网 IP（不是 Mac 的 IP）。

---

## 环境要求

| 组件 | 版本要求 |
|------|---------|
| macOS | 12.0+ |
| Node.js | 18.0+ |
| VS Code / Cursor | 1.85+ |
| iOS 设备 | 15.0+ |
| 签名证书 | 开发者/企业证书 + Provisioning Profile |

---

## 快速开始

### 1. 安装 VS Code / Cursor 扩展

```bash
# 方式一：命令行安装
code --install-extension WhiteNeedle.vsix

# Cursor 用户
cursor --install-extension WhiteNeedle.vsix

# 方式二：手动安装
# 打开 VS Code → Extensions → ⋯ → Install from VSIX → 选择 WhiteNeedle.vsix
```

> **类型补全自动生效**：扩展内置了 WhiteNeedle JS API 的完整类型声明（`whiteneedle.d.ts`）。
> 安装扩展后，打开任意工作区会自动配置 `jsconfig.json`，新建脚本（`Cmd+Shift+P` → `WhiteNeedle: New Script`）自带 `/// <reference>` 指令，
> 编写脚本时即可获得 `ObjC.use()`、`Interceptor.attach()` 等全部 API 的代码补全与类型提示。

### 2. 集成 WhiteNeedle 到你的 App

有两种集成方式，选择其一即可。

> **⚠️ 设备发现前置要求（两种方式均需要）**
>
> 无论选择哪种集成方式，宿主 App 的 `Info.plist` 都需要添加以下条目才能被 VS Code / Cursor 通过局域网自动发现：
>
> ```xml
> <key>NSBonjourServices</key>
> <array>
>   <string>_whiteneedle._tcp</string>
> </array>
> <key>NSLocalNetworkUsageDescription</key>
> <string>WhiteNeedle debugging</string>
> ```
>
> - **重签名方式**：`resign.sh` 会自动注入这些条目，通常无需手动添加。
> - **CocoaPods 方式**：需要你手动在宿主工程的 `Info.plist` 中添加。
>
> 如果未添加，设备不会出现在 Devices 列表中，但仍然可以通过 **Connect by IP**（`192.168.x.x:27042`）手动连接。

#### 方式 A：重签名注入（推荐快速验证）

无需修改工程，将 dylib 注入到已有 IPA 中。

**Cursor 用户推荐：通过 Skill 自动完成**

如果你使用 Cursor 且已安装 `whiteneedle-resign` skill（见下方 [Cursor Skills](#cursor-skills) 章节），只需在对话中说：

```
重签名这个 IPA: ~/Downloads/YourApp.ipa
```

Skill 会自动处理证书选择、描述文件验证、dylib 注入、设备安装等全部流程。首次使用时会引导你配置签名参数，后续自动复用。

**手动命令行方式：**

```bash
cd skills/whiteneedle-resign

# 编译 insert_dylib 工具（仅首次）
cc -o insert_dylib insert_dylib.c
chmod +x insert_dylib

# 重签名注入
./resign.sh \
  -i /path/to/YourApp.ipa \
  -c "Apple Development: your@email.com (TEAMID)" \
  -p /path/to/your.mobileprovision

# 输出: YourApp_whiteneedle.ipa
```

安装到设备：

```bash
brew install ios-deploy  # 如未安装
ios-deploy --bundle YourApp_whiteneedle.ipa
```

#### 方式 B：CocoaPods 源码集成（推荐长期使用）

适合团队内正式集成，支持源码级调试。需要手动在宿主工程 `Info.plist` 中添加上述 Bonjour 设备发现条目。

**本地路径引用（快速体验）：**

```ruby
# Podfile
pod 'WhiteNeedle', :path => '/path/to/dist/cocoapods/WhiteNeedle'
```

**私有 Git 仓库（团队推荐）：**

1. 将 `cocoapods/WhiteNeedle/` 目录推送到内部 Git 仓库：

```bash
cd cocoapods/WhiteNeedle
git init
git add .
git commit -m "WhiteNeedle 2.0.0"
git tag 2.0.0
git remote add origin git@your-server.com:ios/WhiteNeedle.git
git push -u origin main --tags
```

2. 修改 `WhiteNeedle.podspec` 中的 `s.source` 为你的 Git 仓库地址。

3. 在你的项目 Podfile 中添加：

```ruby
# 方式 1：直接引用 Git
pod 'WhiteNeedle', :git => 'git@your-server.com:ios/WhiteNeedle.git', :tag => '2.0.0'

# 方式 2：使用私有 Spec Repo
# 先添加私有 repo（仅首次）：
#   pod repo add my-specs git@your-server.com:ios/specs.git
# 然后在 Podfile 顶部：
#   source 'git@your-server.com:ios/specs.git'
#   source 'https://cdn.cocoapods.org/'
pod 'WhiteNeedle', '~> 2.0'
```

4. 执行 `pod install`。

> CocoaPods 以源码编译，宿主 App 需满足 iOS 15+，C++17。

### 3. 连接设备

1. 确保 Mac 与 iPhone 在同一 Wi-Fi 网络（或通过 USB 热点共享）
2. 在设备上运行集成了 WhiteNeedle 的 App
3. 打开 VS Code / Cursor 侧边栏 **WhiteNeedle** 面板
4. 在 **Devices** 列表选择设备（需要 Bonjour 发现配置），或 **Connect by IP**（格式 `192.168.x.x:27042`）

> WhiteNeedle dylib 在 App 启动后会在设备端监听 TCP **27042** 端口。
> 该端口是 dylib 内置的默认值，VS Code 扩展和 MCP Server 均默认连接此端口。

### 4. 推送脚本

1. 打开或新建 `.js` 文件（推荐使用 `Cmd+Shift+P` → `WhiteNeedle: New Script`，自带类型声明）
2. 编写脚本（参考 `sample-scripts/` 中的示例）
3. `Cmd+Shift+R` 推送并运行
4. 在 **Output → WhiteNeedle** 查看日志

### 5. 断点调试（DAP）

详见 `docs/inspector-vscode.md`。

---

## MCP Server（AI Agent 工具链）

MCP Server 让 Cursor 等 AI 编辑器直接与设备交互（执行脚本、查询运行时、浏览文件系统等）。它通过 TCP 连接到运行了 WhiteNeedle 的 iOS 设备，协议与 VS Code 扩展完全一致。

### 安装

```bash
cd mcp-server
npm install --production
```

### 配置 Cursor MCP

在 Cursor 设置（`~/.cursor/mcp.json` 或项目 `.cursor/mcp.json`）中添加 MCP Server：

```json
{
  "mcpServers": {
    "whiteneedle": {
      "command": "node",
      "args": ["/path/to/dist/mcp-server/dist/index.js"],
      "env": {
        "WN_HOST": "192.168.1.100",
        "WN_PORT": "27042"
      }
    }
  }
}
```

**环境变量说明：**

| 变量 | 含义 | 默认值 | 说明 |
|------|------|--------|------|
| `WN_HOST` | iOS 设备的 IP 地址 | `127.0.0.1` | 运行 WhiteNeedle App 的 iPhone/iPad 在局域网中的 IP。可在 **设置 → Wi-Fi → 当前网络 → IP 地址** 查看。与 VS Code 扩展中 Connect by IP 填写的是同一个地址。 |
| `WN_PORT` | WhiteNeedle 引擎监听端口 | `27042` | dylib 在设备端启动时默认监听 27042。除非你修改了 dylib 源码中的端口配置，否则保持默认值即可。此端口与 VS Code 扩展连接设备使用的端口一致。 |

> **提示**：`WN_HOST` 和 `WN_PORT` 也可以不在 `env` 中配置。MCP Server 提供了 `connect` 工具，Agent 可以在对话中动态连接到指定设备，例如通过扩展的 Devices 面板看到设备 IP 后，让 Agent 执行 `connect` 命令连接。

---

## Cursor Skills

将 `skills/` 目录中的内容复制到 Cursor 的 skills 目录：

```bash
# macOS
cp -R skills/whiteneedle-js-api ~/.cursor/skills/
cp -R skills/whiteneedle-resign ~/.cursor/skills/
```

安装后的能力：

| Skill | 功能 | 触发方式 |
|-------|------|----------|
| `whiteneedle-js-api` | 提供完整的 JS API 文档，Agent 编写脚本时自动参考 | 编写 WhiteNeedle 脚本时自动激活 |
| `whiteneedle-resign` | 自动化 IPA 重签名：证书选择、描述文件验证、dylib 注入、设备安装 | 对话中说「重签名 IPA」「resign」「注入 dylib」等 |

`whiteneedle-resign` 首次使用会引导配置签名证书和描述文件，之后自动复用，实现「给一个 IPA 路径就能一键完成」的体验。

---

## 常见问题

**Q: 设备列表中看不到设备？**
确保同一 Wi-Fi。宿主 App 的 Info.plist 需要 `NSBonjourServices`（含 `_whiteneedle._tcp`）和 `NSLocalNetworkUsageDescription`。首次运行须在 iPhone 上允许「本地网络」权限。Mac 端在 **系统设置 → 隐私与安全性 → 本地网络** 为 Cursor / VS Code 开启权限。如果 Bonjour 不可用，可以用 **Connect by IP** 手动连接。

**Q: 没有代码补全？**
扩展会在首次打开工作区时自动创建或更新 `jsconfig.json`。如果仍然没有补全，手动新建脚本（`WhiteNeedle: New Script` 命令）或重新加载窗口（`Cmd+Shift+P` → `Reload Window`）。

**Q: 重签名安装失败？**
检查描述文件是否包含设备 UDID、证书是否有效。

**Q: CocoaPods 集成编译报错？**
确认 Xcode Command Line Tools 已安装，项目最低部署版本 ≥ iOS 15.0，C++ 标准设为 C++17。

**Q: 脚本推送报 "Not connected"？**
先在 Devices 面板连接设备。WhiteNeedle 引擎默认监听 TCP 27042 端口。

**Q: MCP Server 连接不上设备？**
确认 `WN_HOST` 填的是 iPhone 的局域网 IP（不是 Mac 的 IP），`WN_PORT` 为 27042（默认）。可以先用 VS Code 扩展的 Connect by IP 测试 `<IP>:27042` 能否连通，确认通了之后 MCP 用同样的地址即可。

---

## 文档索引

| 文档 | 说明 |
|------|------|
| `docs/api-*.md` | 各模块 API 参考 |
| `docs/inspector-vscode.md` | DAP 调试配置 |

---

## 版本

- **WhiteNeedle.dylib**: 2.0.0 (arm64, iOS 15+)
- **VS Code Extension**: 0.1.0
- **MCP Server**: 0.2.0

> **dylib 版本对齐**：分发包内的 `WhiteNeedle.dylib`、`cocoapods/WhiteNeedle/Sources/`、以及 `skills/whiteneedle-resign/payload/WhiteNeedle.dylib` 均由 `build-dist.sh` 统一从源码构建产出，版本始终一致。请勿手动替换单个 dylib 文件。
