# WhiteNeedle JavaScript API（Skill 内置副本）

本目录随 **whiteneedle-js-api** Cursor Skill 分发，**不依赖**仓库根目录下的 `docs/`。编写或核对 WhiteNeedle 设备端脚本时，以这里的 `api-*.md` 为 API 说明来源。

- 引擎版本：**2.0.0**（以你实际注入的 dylib 为准）
- 最低支持：**iOS 15.0** · 架构：**arm64**

## API 索引

| 文档 | 说明 |
|------|------|
| [api-engine.md](api-engine.md) | `console`、定时器、`require()`、`Debug` 等 |
| [api-objc-bridge.md](api-objc-bridge.md) | `ObjC.use`、`ObjC.instance`、`ObjC.choose` 等 |
| [api-define.md](api-define.md) | `ObjC.define`、`ObjC.delegate` |
| [api-hook-engine.md](api-hook-engine.md) | `Interceptor` |
| [api-block-bridge.md](api-block-bridge.md) | `$block`、`$callBlock` |
| [api-native-bridge.md](api-native-bridge.md) | `Module`、`$pointer`、`$struct`、C Hook |
| [api-cookies.md](api-cookies.md) | `Cookies` |
| [api-userdefaults.md](api-userdefaults.md) | `UserDefaults` |
| [api-filesystem.md](api-filesystem.md) | `FileSystem` |
| [api-performance.md](api-performance.md) | `Performance` |
| [api-uidebug.md](api-uidebug.md) | `UIDebug` |
| [api-sqlite.md](api-sqlite.md) | SQLite |
| [api-mcp-tools.md](api-mcp-tools.md) | MCP 工具名与设备 JSON-RPC 对照 |

## 与真实运行时不一致时

若文档与当前 App 内注入的 WhiteNeedle 行为不一致，**以运行时行为为准**，并可向 WhiteNeedle 项目反馈以便更新本 skill 副本。

## 维护说明（仅 WhiteNeedle monorepo 贡献者）

在完整仓库中开发时，根目录 `docs/api-*.md` 通常先更新；发布或更新本 skill 前，请将 `docs/api-*.md` **覆盖复制**到本 `references/` 目录，保持 skill 自包含副本与主文档一致。

```bash
# 在仓库根目录执行
cp docs/api-*.md skills/whiteneedle-js-api/references/
```

VS Code 扩展内置的离线文档从本目录同步（发布前在 `vscode-extension` 下执行 `npm run sync-bundled-docs`）。
