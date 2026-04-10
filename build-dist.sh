#!/bin/bash
set -euo pipefail

# ============================================================================
# WhiteNeedle Distribution Builder
#
# Assembles all deliverables into dist/:
#   - WhiteNeedle.vsix          (VS Code / Cursor extension, includes typings)
#   - mcp-server/               (compiled MCP server)
#   - skills/                   (Cursor agent skills)
#   - WhiteNeedle.dylib         (pre-built dynamic library)
#   - cocoapods/WhiteNeedle/    (CocoaPods private pod source + podspec)
#   - sample-scripts/           (example scripts for users)
#   - test-scripts/            (API stability tests, not for distribution)
#   - docs/                     (API & usage documentation)
#   - README.md                 (distribution guide)
#
# Usage:
#   ./build-dist.sh                  # full build + package (dylib, .vsix, mcp, skills, docs)
#   ./build-dist.sh --skip-dylib     # skip dylib compile; use ios-dylib/build/WhiteNeedle.dylib
#   ./build-dist.sh --vsix-only      # only vscode-extension → dist/WhiteNeedle.vsix
#   ./build-dist.sh --skip-vsix      # full dist without packaging the VS Code extension
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
        if command -v vsce >/dev/null 2>&1; then
            vsce package --no-dependencies -o "$out_vsix"
        else
            warn "vsce not in PATH; using npx @vscode/vsce (first run may download)"
            npx --yes @vscode/vsce package --no-dependencies -o "$out_vsix"
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

SKIP_DYLIB=false
VSIX_ONLY=false
SKIP_VSIX=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-dylib) SKIP_DYLIB=true; shift ;;
        --vsix-only) VSIX_ONLY=true; shift ;;
        --skip-vsix) SKIP_VSIX=true; shift ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo "  --skip-dylib   Skip dylib compilation; use existing build/WhiteNeedle.dylib"
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
# Step 1: Build WhiteNeedle.dylib
# ============================================================================
step 1 "Build WhiteNeedle.dylib"

DYLIB_SRC="$ROOT_DIR/ios-dylib"
DYLIB_OUT="$DYLIB_SRC/build/WhiteNeedle.dylib"

if [[ "$SKIP_DYLIB" == true ]]; then
    if [[ -f "$DYLIB_OUT" ]]; then
        log "Skipping build, using existing: $DYLIB_OUT"
    elif [[ -f "$DYLIB_SRC/WhiteNeedle.dylib" ]]; then
        DYLIB_OUT="$DYLIB_SRC/WhiteNeedle.dylib"
        log "Skipping build, using existing: $DYLIB_OUT"
    else
        err "No pre-built dylib found. Run without --skip-dylib."
    fi
else
    cd "$DYLIB_SRC"
    make clean >/dev/null 2>&1 || true
    make
    [[ -f "$DYLIB_OUT" ]] || err "dylib build failed"
    cd "$ROOT_DIR"
fi

cp "$DYLIB_OUT" "$DIST_DIR/WhiteNeedle.dylib"
log "→ dist/WhiteNeedle.dylib"

# ============================================================================
# Step 2: Build & Package VS Code Extension (.vsix)
#   The extension bundles typings/whiteneedle.d.ts and auto-configures
#   jsconfig.json on activation — no manual type setup needed.
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

# Place the freshly-built dylib into the resign skill's payload
cp "$DIST_DIR/WhiteNeedle.dylib" "$RESIGN_SKILL/payload/WhiteNeedle.dylib"
log "→ dist/skills/"

# ============================================================================
# Step 5: Prepare CocoaPods Private Pod
# ============================================================================
step 5 "Prepare CocoaPods private pod"

POD_DIR="$DIST_DIR/cocoapods/WhiteNeedle"
mkdir -p "$POD_DIR"

cp -R "$DYLIB_SRC/WhiteNeedle/Sources" "$POD_DIR/Sources"
cp "$ROOT_DIR/cocoapods-dist/WhiteNeedle/WhiteNeedle.podspec" "$POD_DIR/WhiteNeedle.podspec"

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
# Step 8: Generate dist README
# ============================================================================
step 8 "Generate distribution README"

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
