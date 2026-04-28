#!/bin/bash
set -euo pipefail

# ============================================================================
# WhiteNeedle Distribution Builder
#
# Assembles all deliverables into dist/:
#   - WhiteNeedle.vsix                # VS Code / Cursor extension
#   - WhiteNeedle.framework/          # pre-built iOS framework (arm64, iOS 15+)
#   - mcp-server/                     # compiled MCP server
#   - skills/                         # Cursor agent skills
#   - cocoapods/WhiteNeedle/          # CocoaPods private pod (framework distribution)
#   - sample-scripts/                 # example scripts for users
#   - test-scripts/                   # API stability tests, not for distribution
#   - builtin-js/                     # 内置 JS 源码副本（来自 ios-dylib/.../BuiltinModules，单一来源）
#   - docs/                           # API & usage documentation
#   - README.md                       # distribution guide
#
# Usage:
#   ./build-dist.sh                      # full build + package
#   ./build-dist.sh --skip-build         # skip framework compile; use existing build
#   ./build-dist.sh --vsix-only          # only vscode-extension → dist/WhiteNeedle.vsix
#   ./build-dist.sh --skip-vsix          # full dist without packaging the VS Code extension
# ============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
EXT_DIR="$ROOT_DIR/vscode-extension"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[dist $(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[dist $(date +%H:%M:%S)]${NC} $*" >&2; }
err()  { echo -e "${RED}[dist $(date +%H:%M:%S)]${NC} $*" >&2; exit 1; }
step() { echo -e "\n${CYAN}━━━ Step $1: $2 ━━━${NC}"; }

# Prefer global vsce; otherwise npx @vscode/vsce (no global install required).
package_white_needle_vsix() {
    local out_vsix="$1"
    log "Packaging .vsix -> $(basename "$out_vsix") ..."
    (
        cd "$EXT_DIR"
        npm install --no-audit --no-fund 2>&1 | tail -1
        cp -f "$ROOT_DIR/LICENSE" "$EXT_DIR/LICENSE" 2>/dev/null || true
        if command -v vsce >/dev/null 2>&1; then
            echo 'y' | vsce package -o "$out_vsix"
        else
            warn "vsce not in PATH; using npx @vscode/vsce (first run may download)"
            echo 'y' | npx --yes @vscode/vsce package -o "$out_vsix"
        fi
    )
}

build_vscode_extension_tree() {
    cd "$EXT_DIR"
    npm install --no-audit --no-fund 2>&1 | tail -1
    npm run compile
    log "TypeScript compiled"
    cd "$ROOT_DIR"
}

SKIP_BUILD=false
VSIX_ONLY=false
SKIP_VSIX=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-build) SKIP_BUILD=true; shift ;;
        --skip-dylib) SKIP_BUILD=true; shift ;; # deprecated alias
        --vsix-only) VSIX_ONLY=true; shift ;;
        --skip-vsix) SKIP_VSIX=true; shift ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo "  --skip-build   Skip framework compilation; use existing build/WhiteNeedle.framework"
            echo "  --vsix-only    Only build vscode-extension and write dist/WhiteNeedle.vsix"
            echo "  --skip-vsix    Full dist build but skip .vsix packaging"
            exit 0 ;;
        *) err "Unknown option: $1" ;;
    esac
done

if [[ "$VSIX_ONLY" == true && "$SKIP_VSIX" == true ]]; then
    err "Cannot use --vsix-only together with --skip-vsix"
fi

# ============================================================================
# VSIX-only fast path (does not wipe dist/)
# ============================================================================
if [[ "$VSIX_ONLY" == true ]]; then
    step "VSIX" "Build & package VS Code extension only"
    mkdir -p "$DIST_DIR"
    build_vscode_extension_tree
    package_white_needle_vsix "$DIST_DIR/WhiteNeedle.vsix"
    [[ -f "$DIST_DIR/WhiteNeedle.vsix" ]] || err "vsix packaging failed"
    log "-> $DIST_DIR/WhiteNeedle.vsix"
    echo ""
    echo -e "${GREEN}=== VSIX build complete! ===${NC}"
    exit 0
fi

# ============================================================================
# Clean dist
# ============================================================================
step 0 "Clean dist directory"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
log "Created $DIST_DIR"

# ============================================================================
# Step 1: Build WhiteNeedle.framework
# ============================================================================
step 1 "Build WhiteNeedle.framework"

FW_SRC="$ROOT_DIR/ios-dylib"
FW_OUT="$FW_SRC/build/WhiteNeedle.framework"

if [[ "$SKIP_BUILD" == true ]]; then
    if [[ -d "$FW_OUT" ]]; then
        log "Skipping build, using existing: $FW_OUT"
    else
        err "No pre-built framework found at $FW_OUT. Run without --skip-build."
    fi
else
    cd "$FW_SRC"
    make clean >/dev/null 2>&1 || true
    make
    [[ -d "$FW_OUT" ]] || err "framework build failed"
    cd "$ROOT_DIR"
fi

cp -R "$FW_OUT" "$DIST_DIR/WhiteNeedle.framework"
log "→ dist/WhiteNeedle.framework/"

# ============================================================================
# Step 2: Build & Package VS Code Extension (.vsix)
# ============================================================================
if [[ "$SKIP_VSIX" != true ]]; then
    step 2 "Build VS Code extension"
    build_vscode_extension_tree
    package_white_needle_vsix "$DIST_DIR/WhiteNeedle.vsix"
    [[ -f "$DIST_DIR/WhiteNeedle.vsix" ]] || err "vsix packaging failed"
    log "→ dist/WhiteNeedle.vsix"
else
    warn "Skipping VS Code extension (.vsix) — dist/ will not contain WhiteNeedle.vsix"
fi

# ============================================================================
# Step 3: Build MCP Server
# ============================================================================
step 3 "Build MCP server"

cd "$ROOT_DIR/mcp-server"
npm install --no-audit --no-fund 2>&1 | tail -1
npm run build
log "MCP server compiled"

mkdir -p "$DIST_DIR/mcp-server"
cp -R dist/ "$DIST_DIR/mcp-server/dist/"
cp package.json "$DIST_DIR/mcp-server/"
cp package-lock.json "$DIST_DIR/mcp-server/"
log "→ dist/mcp-server/"
cd "$ROOT_DIR"

# ============================================================================
# Step 4: Copy Skills
# ============================================================================
step 4 "Copy Cursor skills"

mkdir -p "$DIST_DIR/skills"
cp -R "$ROOT_DIR/skills/whiteneedle-js-api" "$DIST_DIR/skills/"
cp -R "$ROOT_DIR/skills/whiteneedle-resign" "$DIST_DIR/skills/"

# Build universal insert_dylib (arm64 + x86_64) so it works on any Mac
RESIGN_SKILL="$DIST_DIR/skills/whiteneedle-resign"
INSERT_SRC="$RESIGN_SKILL/bin/insert_dylib.c"
if [[ -f "$INSERT_SRC" ]]; then
    log "Compiling insert_dylib (universal binary) ..."
    clang -arch arm64 -arch x86_64 -O2 -o "$RESIGN_SKILL/bin/insert_dylib" "$INSERT_SRC"
    rm -f "$INSERT_SRC"
    log "Compiled insert_dylib, removed source"
fi

# Place the freshly-built framework into the resign skill's payload
rm -rf "$RESIGN_SKILL/payload/WhiteNeedle.framework"
cp -R "$DIST_DIR/WhiteNeedle.framework" "$RESIGN_SKILL/payload/"
log "→ dist/skills/"

# ============================================================================
# Step 5: Prepare CocoaPods Private Pod
# ============================================================================
step 5 "Prepare CocoaPods private pod"

POD_DIR="$DIST_DIR/cocoapods/WhiteNeedle"
mkdir -p "$POD_DIR"

# Copy framework and podspec
cp -R "$DIST_DIR/WhiteNeedle.framework" "$POD_DIR/WhiteNeedle.framework"

# Builtin JS → WhiteNeedleBuiltins.bundle（与 ios-dylib 源码 Pod 一致，供 require('wn-test') 等）
mkdir -p "$POD_DIR/BuiltinModules"
cp "$ROOT_DIR/ios-dylib/WhiteNeedle/BuiltinModules/"*.js "$POD_DIR/BuiltinModules/"

cat > "$POD_DIR/WhiteNeedle.podspec" <<'PODSPEC'
Pod::Spec.new do |s|
  s.name             = 'WhiteNeedle'
  s.version          = '2.0.0'
  s.summary          = 'WhiteNeedle JavaScriptCore engine, TCP/Bonjour bridge, and hook utilities for iOS.'
  s.description      = <<-DESC
    WhiteNeedle is an iOS dynamic scripting engine built on JavaScriptCore.
    This pod distributes a pre-built framework — no source compilation needed.
  DESC
  s.homepage         = 'https://github.com/user/WhiteNeedle'
  s.license          = { :type => 'MIT' }
  s.author           = { 'WhiteNeedle Team' => 'whiteneedle@example.com' }

  # ── Source Configuration ──────────────────────────────────────────────
  # Option A: Private git repo
  #   s.source = { :git => 'git@your-server.com:ios/WhiteNeedle.git', :tag => s.version.to_s }
  #
  # Option B: Local path
  #   pod 'WhiteNeedle', :path => '/path/to/dist/cocoapods/WhiteNeedle'
  # ─────────────────────────────────────────────────────────────────────
  s.source           = { :git => 'REPLACE_WITH_YOUR_GIT_URL', :tag => s.version.to_s }

  s.platform         = :ios, '15.0'
  s.requires_arc     = true

  # ── Binary distribution ─────────────────────────────────────────────
  s.vendored_frameworks = 'WhiteNeedle.framework'

  # 内置 JS（events / util / wn-test / wn-auto）→ App 内 WhiteNeedleBuiltins.bundle，与 WNModuleLoader 约定一致
  s.resource_bundles = {
    'WhiteNeedleBuiltins' => ['BuiltinModules/*.js']
  }

  s.frameworks       = 'Foundation', 'UIKit', 'JavaScriptCore', 'Security', 'WebKit'
  s.libraries        = 'c++', 'sqlite3'

  # ── Bonjour / Local Network permissions ──────────────────────────────
  # Add to your Podfile:
  #
  #   require_relative 'Pods/WhiteNeedle/Scripts/cocoapods_hook'
  #   post_install do |installer|
  #     whiteneedle_inject_permissions(installer)
  #   end
  # ─────────────────────────────────────────────────────────────────────
end
PODSPEC

# Copy hook helper script
mkdir -p "$POD_DIR/Scripts"
cp "$ROOT_DIR/ios-dylib/WhiteNeedle/Scripts/cocoapods_hook.rb" "$POD_DIR/Scripts/"

log "→ dist/cocoapods/WhiteNeedle/"

# ============================================================================
# Step 6: Copy Sample Scripts (user-facing examples only; test scripts stay in repo)
# ============================================================================
step 6 "Copy sample scripts"

mkdir -p "$DIST_DIR/sample-scripts"
cp "$ROOT_DIR/sample-scripts/"*.js "$DIST_DIR/sample-scripts/" 2>/dev/null || true
if [[ -d "$ROOT_DIR/sample-scripts/.vscode" ]]; then
    cp -R "$ROOT_DIR/sample-scripts/.vscode" "$DIST_DIR/sample-scripts/.vscode"
fi
log "→ dist/sample-scripts/ ($(ls "$DIST_DIR/sample-scripts/"*.js 2>/dev/null | wc -l | tr -d ' ') scripts)"

# ============================================================================
# Step 7: Copy Documentation
# ============================================================================
step 7 "Copy documentation"

mkdir -p "$DIST_DIR/docs"
cp "$ROOT_DIR/docs/"api-*.md "$DIST_DIR/docs/"
cp "$ROOT_DIR/docs/inspector-vscode.md" "$DIST_DIR/docs/" 2>/dev/null || true
cp "$ROOT_DIR/docs/USAGE-GUIDE.md" "$DIST_DIR/docs/" 2>/dev/null || true
if [[ -d "$ROOT_DIR/docs/guide-images" ]]; then
    cp -R "$ROOT_DIR/docs/guide-images" "$DIST_DIR/docs/guide-images"
fi
log "→ dist/docs/ (api-*.md + USAGE-GUIDE.md + guide-images/)"

# ============================================================================
# Step 8: Copy builtin JS modules (canonical: ios-dylib/WhiteNeedle/BuiltinModules)
# ============================================================================
step 8 "Copy builtin JS modules"

BUILTIN_SRC="$ROOT_DIR/ios-dylib/WhiteNeedle/BuiltinModules"
mkdir -p "$DIST_DIR/builtin-js"
cp "$BUILTIN_SRC/"*.js "$DIST_DIR/builtin-js/"
log "→ dist/builtin-js/ ($(ls "$DIST_DIR/builtin-js/"*.js 2>/dev/null | wc -l | tr -d ' ') files)"

# ============================================================================
# Step 9: Generate dist README
# ============================================================================
step 9 "Generate distribution README"

cp "$ROOT_DIR/dist-README.md" "$DIST_DIR/README.md" 2>/dev/null || {
    warn "dist-README.md not found, will be generated separately"
}

# ============================================================================
# Summary
# ============================================================================
echo ""
echo -e "${CYAN}━━━ Distribution Contents ━━━${NC}"
echo ""

du -sh "$DIST_DIR"/* 2>/dev/null | while read -r size path; do
    name=$(basename "$path")
    echo -e "  ${GREEN}$size${NC}\t$name"
done

echo ""
TOTAL=$(du -sh "$DIST_DIR" | cut -f1)
log "Total: $TOTAL"
log "Output: $DIST_DIR/"
echo ""
echo -e "${GREEN}━━━ Build complete! ━━━${NC}"
