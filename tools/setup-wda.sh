#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# WhiteNeedle — WebDriverAgent one-click setup
# Usage:  ./tools/setup-wda.sh [--team TEAM_ID]
#
# What it does:
#   1. Clones appium/WebDriverAgent into .wda/ (skips if already present)
#   2. Detects your Apple Development Team ID (or uses --team)
#   3. Patches WDA signing settings so it can build without manual Xcode config
#   4. Prints the command to start WDA on your device
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WDA_DIR="$PROJECT_ROOT/.wda"
WDA_REPO="https://github.com/appium/WebDriverAgent.git"
WDA_BRANCH="master"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[WDA]${NC} $*"; }
ok()    { echo -e "${GREEN}[WDA]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WDA]${NC} $*"; }
fail()  { echo -e "${RED}[WDA]${NC} $*" >&2; exit 1; }

# ---- Parse args ----
TEAM_ID=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --team) TEAM_ID="$2"; shift 2 ;;
        *) fail "Unknown option: $1" ;;
    esac
done

# ---- Prerequisites ----
info "Checking prerequisites..."
command -v xcodebuild >/dev/null 2>&1 || fail "xcodebuild not found. Install Xcode and Command Line Tools."
command -v git >/dev/null 2>&1 || fail "git not found."

XCODE_VER=$(xcodebuild -version 2>/dev/null | head -1)
ok "Found $XCODE_VER"

# ---- Clone WDA ----
if [[ -d "$WDA_DIR/WebDriverAgent.xcodeproj" ]]; then
    info "WebDriverAgent already exists at $WDA_DIR, skipping clone."
    info "To re-download, remove .wda/ and run again."
else
    info "Cloning WebDriverAgent..."
    rm -rf "$WDA_DIR"
    git clone --depth 1 --branch "$WDA_BRANCH" "$WDA_REPO" "$WDA_DIR"
    ok "Cloned WebDriverAgent to $WDA_DIR"
fi

# ---- Detect Team ID ----
if [[ -z "$TEAM_ID" ]]; then
    info "Detecting Apple Development Team ID..."

    # Try to find from the user's existing iOS project
    EXAMPLE_PBXPROJ="$PROJECT_ROOT/ios-example/WhiteNeedleExample/WhiteNeedleExample.xcodeproj/project.pbxproj"
    if [[ -f "$EXAMPLE_PBXPROJ" ]]; then
        TEAM_ID=$(grep -m1 'DEVELOPMENT_TEAM' "$EXAMPLE_PBXPROJ" | sed 's/.*= *\(.*\);/\1/' | tr -d ' "' || true)
    fi

    # Try any .xcodeproj in the project root's parent
    if [[ -z "$TEAM_ID" ]]; then
        for pbx in $(find "$PROJECT_ROOT/.." -maxdepth 4 -name "project.pbxproj" 2>/dev/null | head -5); do
            TEAM_ID=$(grep -m1 'DEVELOPMENT_TEAM' "$pbx" | sed 's/.*= *\(.*\);/\1/' | tr -d ' "' || true)
            [[ -n "$TEAM_ID" ]] && break
        done
    fi

    if [[ -z "$TEAM_ID" ]]; then
        warn "Could not auto-detect Team ID."
        echo ""
        echo "  Please re-run with:  ./tools/setup-wda.sh --team YOUR_TEAM_ID"
        echo ""
        echo "  Find your Team ID in Xcode → Signing & Capabilities → Team,"
        echo "  or run:  grep -r DEVELOPMENT_TEAM *.xcodeproj/project.pbxproj"
        exit 1
    fi
fi

ok "Using Team ID: $TEAM_ID"

# ---- Patch WDA signing ----
info "Patching WDA code signing..."

WDA_PBXPROJ="$WDA_DIR/WebDriverAgent.xcodeproj/project.pbxproj"
if [[ ! -f "$WDA_PBXPROJ" ]]; then
    fail "project.pbxproj not found at $WDA_PBXPROJ"
fi

# Set development team for all targets
sed -i '' "s/DEVELOPMENT_TEAM = \"\"/DEVELOPMENT_TEAM = \"$TEAM_ID\"/g" "$WDA_PBXPROJ" 2>/dev/null || true
sed -i '' "s/DEVELOPMENT_TEAM = .*;/DEVELOPMENT_TEAM = $TEAM_ID;/g" "$WDA_PBXPROJ" 2>/dev/null || true

# Use automatic signing
sed -i '' 's/CODE_SIGN_IDENTITY = ".*"/CODE_SIGN_IDENTITY = "Apple Development"/g' "$WDA_PBXPROJ" 2>/dev/null || true
sed -i '' 's/ProvisioningStyle = Manual/ProvisioningStyle = Automatic/g' "$WDA_PBXPROJ" 2>/dev/null || true

# Change bundle ID to avoid collision (Apple restricts com.facebook.*)
UNIQUE_SUFFIX=$(echo "$TEAM_ID" | tr '[:upper:]' '[:lower:]' | head -c 8)
sed -i '' "s/com\.facebook\.WebDriverAgentRunner/com.wn.WebDriverAgentRunner.${UNIQUE_SUFFIX}/g" "$WDA_PBXPROJ" 2>/dev/null || true
sed -i '' "s/com\.facebook\.WebDriverAgentLib/com.wn.WebDriverAgentLib.${UNIQUE_SUFFIX}/g" "$WDA_PBXPROJ" 2>/dev/null || true

ok "Signing configured (automatic signing, Team: $TEAM_ID)"

# ---- Save config ----
cat > "$WDA_DIR/.wda-config" <<EOF
TEAM_ID=$TEAM_ID
UNIQUE_SUFFIX=$UNIQUE_SUFFIX
EOF

ok "Config saved to .wda/.wda-config"

# ---- Add to .gitignore ----
if ! grep -q "^\.wda/" "$PROJECT_ROOT/.gitignore" 2>/dev/null; then
    echo -e "\n# WebDriverAgent (auto-setup)\n.wda/" >> "$PROJECT_ROOT/.gitignore"
    ok "Added .wda/ to .gitignore"
fi

# ---- Done ----
echo ""
ok "========================================="
ok "  WebDriverAgent setup complete!"
ok "========================================="
echo ""
info "Next steps:"
echo ""
echo "  1. Connect your iOS device via USB"
echo "  2. Run:  ./tools/start-wda.sh"
echo "     (or:  ./tools/start-wda.sh --udid YOUR_DEVICE_UDID)"
echo ""
echo "  WDA will start an HTTP server on the device (port 8100)."
echo "  The start script auto-forwards it to localhost:8100."
echo ""
