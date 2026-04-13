# WhiteNeedle

WhiteNeedle is an iOS dynamic scripting engine built on **JavaScriptCore**. It exposes ObjC runtime manipulation, method hooking, Block bridging, and native memory helpers **without JIT or RWX memory**, so it can run on **non-jailbroken** devices when integrated appropriately.

## Repository layout

| Path | Description |
|------|-------------|
| `ios-dylib/` | WhiteNeedle framework source and `Makefile` |
| `ios-example/` | Example Xcode app (CocoaPods) for local debugging |
| `docs/` | JavaScript API reference (Markdown) |
| `vscode-extension/` | VS Code / Cursor extension (TypeScript) |
| `mcp-server/` | Optional MCP server (Node.js) for editor/agent tooling |
| `sample-scripts/` | User-facing sample scripts (API demos & usage examples) |
| `test-scripts/` | API stability tests (for ios-example integration testing) |
| `skills/` | Cursor Agent Skills (includes resign workflow + JS API docs) |

## Documentation

Start with **[docs/README.md](docs/README.md)** for the full API index and quick start snippets.

## Requirements

- iOS **15.0+** (arm64)
- macOS with Xcode / iOS SDK to build the framework
- Node.js **18+** for the extension and MCP server

## Build the framework

```bash
cd ios-dylib && make
# Output: ios-dylib/build/WhiteNeedle.framework/
```

## Example app

```bash
cd ios-example/WhiteNeedleExample
pod install
open WhiteNeedleExample.xcworkspace
```

## VS Code extension

```bash
cd vscode-extension
npm install
npm run compile
```

Package with [`vsce`](https://github.com/microsoft/vscode-vsce) when ready to distribute.

## MCP server

```bash
cd mcp-server
npm install
npm run build
```

## License

[MIT](LICENSE)
