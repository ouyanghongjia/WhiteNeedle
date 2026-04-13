# WhiteNeedle MCP 工具与设备 JSON-RPC 对照

MCP Server（`mcp-server`，stdio）通过 TCP 调用设备上的 `WNRemoteServer` JSON-RPC。下表为 **MCP 工具名** ↔ **RPC 方法名**（`method` 字段，camelCase）及主要参数。

## 连接（本地，不经 RPC）

| MCP 工具 | 说明 |
|----------|------|
| `connect` | `host`、`port`（默认 `127.0.0.1:27042`） |
| `disconnect` | 关闭 TCP |

## 脚本与求值

| MCP 工具 | RPC 方法 | 参数 | 返回要点 |
|----------|----------|------|----------|
| `load_script` | `loadScript` | `name`, `code` | `{ success }` |
| `unload_script` | `unloadScript` | `name` | `{ success }` |
| `list_scripts` | `listScripts` | — | `{ scripts: string[] }` |
| `evaluate` | `evaluate` | `code` | **`{ value: string }`**（JSC `toString()`） |
| `rpc_call` | `rpcCall` | `method`, `args?` | 任意 JSON 或可序列化结果 |

`inspect_object`、`heap_search`、`trace_method` 在 MCP 侧通过 `loadScript` / `evaluate` 组合实现，不对应单独 RPC。

## ObjC / 模块

| MCP 工具 | RPC 方法 | 参数 | 返回要点 |
|----------|----------|------|----------|
| `list_classes` | `getClassNames` | `filter`（可空字符串） | `{ classes: string[] }` |
| `get_methods` | `getMethods` | `className` | **`{ instanceMethods, classMethods }`**（均为字符串数组）；未知类两者为空数组 |
| `list_modules` | `listModules` | — | `{ modules }`（来自 `Module.enumerateModules()`） |

## Hook

| MCP 工具 | RPC 方法 | 参数 | 返回要点 |
|----------|----------|------|----------|
| `list_hooks` | `listHooks` | — | `{ hooks: string[] }` |
| `list_hooks_detailed` | `listHooksDetailed` | — | `{ hooks: ... }` |
| `pause_hook` | `pauseHook` | `selector` | `{ success }` |
| `resume_hook` | `resumeHook` | `selector` | `{ success }` |

## 网络监控

| MCP 工具 | RPC 方法 | 参数 | 返回要点 |
|----------|----------|------|----------|
| `list_network_requests` | `listNetworkRequests` | — | `{ requests }` |
| `get_network_request` | `getNetworkRequest` | `id` | 详情字典或 null |
| `clear_network_requests` | `clearNetworkRequests` | — | `{ success }` |
| `set_network_capture` | `setNetworkCapture` | `enabled` | `{ capturing }` |

## UI 调试

| MCP 工具 | RPC 方法 | 参数 | 返回要点 |
|----------|----------|------|----------|
| `get_view_hierarchy` | `getViewHierarchy` | — | `{ tree }` |
| `get_view_controllers` | `getViewControllers` | — | `{ tree }` |
| `get_vc_detail` | `getVCDetail` | `address` | 字典或 null |
| `get_view_detail` | `getViewDetail` | `address` | 字典或 null |
| `set_view_property` | `setViewProperty` | `address`, `key`, `value` | `{ success }` |
| `highlight_view` | `highlightView` | `address` | `{ success }` |
| `clear_highlight` | `clearHighlight` | — | `{ success }` |
| `search_views` | `searchViews` | `className` | `{ views }` |
| `search_views_by_text` | `searchViewsByText` | `text` | `{ views }` — 按文本内容搜索（UILabel.text、UIButton.title、UITextField.text/placeholder、UITextView.text、UISegmentedControl segment title），大小写不敏感 |
| `get_screenshot` | `getScreenshot` | — | `{ base64 }` |

## HTTP Mock

| MCP 工具 | RPC 方法 | 参数 | 返回要点 |
|----------|----------|------|----------|
| `list_mock_rules` | `listMockRules` | — | `{ rules }` |
| `add_mock_rule` | `addMockRule` | 规则字段（含 `urlPattern` 等） | 规则字典 |
| `update_mock_rule` | `updateMockRule` | **`ruleId`** + 可选字段 | `{ success }` |
| `remove_mock_rule` | `removeMockRule` | `ruleId` | `{ success }` |
| `remove_all_mock_rules` | `removeAllMockRules` | — | `{ success }` |
| `enable_mock_interceptor` | `enableMockInterceptor` | — | `{ success, installed }` |
| `disable_mock_interceptor` | `disableMockInterceptor` | — | `{ success, installed }` |
| `get_mock_interceptor_status` | `getMockInterceptorStatus` | — | `{ installed, ruleCount }` |

## Context 与模块

| MCP 工具 | RPC 方法 | 参数 | 返回要点 |
|----------|----------|------|----------|
| `reset_context` | `resetContext` | — | `{ success }` — 重置 JSContext（清理所有 Hook、变量、模块缓存、FPS 监控） |
| `list_installed_modules` | `listInstalledJsModules` | — | `{ modules: [{ name, size }] }` — 设备端 `Documents/wn_installed_modules/` 中已安装的 JS 模块列表 |

## 沙盒文件操作

| MCP 工具 | RPC 方法 | 参数 | 返回要点 |
|----------|----------|------|----------|
| `write_file` | `writeFile` | `path`（Documents/ 下相对路径）, `content` | `{ success }` — 自动创建中间目录 |
| `mkdir` | `mkdir` | `path`（Documents/ 下相对路径） | `{ success }` |
| `remove_dir` | `removeDir` | `path`（Documents/ 下相对路径） | `{ success }` — 删除文件或目录 |

## 编写设备端 JS 时的注意点

- **`evaluate` 的返回值**：始终按 `{ value: string }` 解析；不要用已废弃的单一 `methods` 字段理解 `getMethods`。
- **堆搜索**：使用 **`ObjC.choose(className, { onMatch, onComplete })`**；运行时无 `ObjC.chooseSync`。
- 完整 JS API：仓库内见 `docs/api-*.md`；**独立分发的** Cursor skill 使用自带副本 `skills/whiteneedle-js-api/references/api-*.md`（不依赖本仓库 `docs/`）。
