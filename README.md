# WhiteNeedle

WhiteNeedle is an iOS dynamic scripting engine built on **JavaScriptCore**. It exposes ObjC runtime manipulation, method hooking, Block bridging, and native memory helpers **without JIT or RWX memory**, so it can run on **non-jailbroken** devices when integrated appropriately.

## Repository layout

| Path | Description |
|------|-------------|
| `ios-dylib/` | WhiteNeedle framework source, `Makefile`, and built-in JS in `WhiteNeedle/BuiltinModules/*.js` (single copy; no `lib/` duplicate) |
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

## Build the distribution package

`build-dist.sh` assembles all deliverables into a self-contained `dist/` directory:

```
dist/
├── WhiteNeedle.vsix                # VS Code / Cursor extension
├── WhiteNeedle.framework/          # pre-built iOS framework (arm64, iOS 15+)
├── mcp-server/                     # compiled MCP server
├── skills/                         # Cursor agent skills
├── cocoapods/WhiteNeedle/          # CocoaPods private pod (framework distribution)
├── sample-scripts/                 # example scripts for users
├── docs/                           # API & usage documentation
└── README.md                       # distribution guide (from dist-README.md)
```

Full build (compile framework → package VSIX → build MCP → copy assets):

```bash
./build-dist.sh
```

Common options:

```bash
./build-dist.sh --skip-build    # skip framework compilation; reuse existing build
./build-dist.sh --vsix-only     # only produce dist/WhiteNeedle.vsix (fast path)
./build-dist.sh --skip-vsix     # full dist without packaging the .vsix
```

The script requires the same toolchain listed in [Requirements](#requirements) plus `vsce` (or it will fall back to `npx @vscode/vsce`). On completion it prints a size summary of every artifact in `dist/`.

See **[dist-README.md](dist-README.md)** for the end-user guide included in the distribution package.

## License

[MIT](LICENSE)
