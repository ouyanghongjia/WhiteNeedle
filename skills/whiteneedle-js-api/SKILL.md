---
name: whiteneedle-js-api
description: WhiteNeedle iOS 上 JavaScript 调试运行时 API（ObjC、Interceptor、FileSystem、Hook、SQLite 等）。编写或审查 WhiteNeedle 脚本、MCP evaluate、类/方法列举、堆扫描时使用；以 skill 内 references/ 下文档为准。
---

# WhiteNeedle JS API（Cursor Skill）

## 权威文档（自包含）

本 skill **自带** API 说明，路径相对于本 skill 根目录：

- **索引**：`references/README.md`
- **分主题**：`references/api-*.md`（与 MCP、文件系统、ObjC、Hook 等一一对应）

**不要**依赖其它仓库路径下的 `docs/`；单独分发本 skill 时只需保留 `SKILL.md` 与 `references/` 目录。

若某台设备上引擎行为与文档不符，以**当前运行的 dylib** 为准。

## 快速索引

| 主题 | 文件 |
|------|------|
| ObjC 桥、`ObjC.choose`、实例代理 | `references/api-objc-bridge.md` |
| Hook / Interceptor | `references/api-hook-engine.md` |
| 文件系统 | `references/api-filesystem.md` |
| SQLite | `references/api-sqlite.md` |
| UserDefaults | `references/api-userdefaults.md` |
| Cookies | `references/api-cookies.md` |
| UI 调试 | `references/api-uidebug.md` |
| 引擎 / Module | `references/api-engine.md` |
| Native / C | `references/api-native-bridge.md` |
| `ObjC.define` 等 | `references/api-define.md` |
| Block | `references/api-block-bridge.md` |
| 性能 API | `references/api-performance.md` |
| MCP 工具 ↔ JSON-RPC | `references/api-mcp-tools.md` |

## 易错点（设备与 MCP）

1. **JSON-RPC `evaluate`**：成功时返回 **`{ value: string }`**（JavaScriptCore `toString()`），不是裸 JSON。
2. **`getMethods`**：返回 **`instanceMethods`** 与 **`classMethods`** 两个字符串数组；未知类二者均为 `[]`。不要使用已废弃的单一 `methods` 字段。
3. **堆扫描**：使用 **`ObjC.choose('ClassName', { onMatch, onComplete })`**。不存在 `ObjC.chooseSync`。
4. **FileSystem 路径**：以 `/` 开头表示「沙盒根下的子路径」，不是 Unix 根目录。详见 `references/api-filesystem.md`「路径解析」。
5. **MCP**：工具名 snake_case，RPC 方法名 camelCase；对照表见 `references/api-mcp-tools.md`。

## 推荐工作流

- 先 MCP `list_classes` / `get_methods`，或脚本中 `ObjC.use`，并对照 `references/` 中对应章节确认符号。
- 复杂逻辑用 `load_script` + `rpc.exports`，避免超长单行 `evaluate`。
- C 符号与 Hook 并用时，同时查阅 `references/api-hook-engine.md` 与 `references/api-native-bridge.md`。
