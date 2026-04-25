#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# WhiteNeedle — Start WebDriverAgent on a connected iOS device
# Usage:  ./tools/start-wda.sh [--udid DEVICE_UDID] [--port 8100]
#
# What it does:
#   1. Detects connected iOS device (or uses --udid)
#   2. Builds & runs WDA via xcodebuild test
#   3. Forwards device port 8100 → localhost:8100 via iproxy
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WDA_DIR="$PROJECT_ROOT/.wda"
WDA_PORT=8100
DEVICE_UDID=""

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
while [[ $# -gt 0 ]]; do
    case "$1" in
        --udid) DEVICE_UDID="$2"; shift 2 ;;
        --port) WDA_PORT="$2"; shift 2 ;;
        *) fail "Unknown option: $1" ;;
    esac
done

# ---- Check WDA is set up ----
[[ -d "$WDA_DIR/WebDriverAgent.xcodeproj" ]] || fail "WDA not set up. Run:  ./tools/setup-wda.sh"

# Load config
if [[ -f "$WDA_DIR/.wda-config" ]]; then
    source "$WDA_DIR/.wda-config"
fi

# ---- Detect device ----
if [[ -z "$DEVICE_UDID" ]]; then
    info "Detecting connected iOS devices..."

    # Try xcrun xctrace first (works with modern Xcode)
    if command -v xcrun >/dev/null 2>&1; then
        DEVICE_UDID=$(xcrun xctrace list devices 2>/dev/null \
            | grep -v "Simulator" \
            | grep -oE '[A-Fa-f0-9-]{24,}' \
            | head -1 || true)
    fi

    # Fallback to instruments
    if [[ -z "$DEVICE_UDID" ]]; then
        DEVICE_UDID=$(instruments -s devices 2>/dev/null \
            | grep -v "Simulator" \
            | grep -oE '\[([A-Fa-f0-9-]{24,})\]' \
            | tr -d '[]' \
            | head -1 || true)
    fi

    if [[ -z "$DEVICE_UDID" ]]; then
        fail "No iOS device detected. Connect a device via USB and trust this computer."
    fi
fi

ok "Using device: $DEVICE_UDID"

# ---- Start iproxy (port forwarding) ----
cleanup() {
    info "Cleaning up..."
    [[ -n "${IPROXY_PID:-}" ]] && kill "$IPROXY_PID" 2>/dev/null || true
    [[ -n "${XCODEBUILD_PID:-}" ]] && kill "$XCODEBUILD_PID" 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

if command -v iproxy >/dev/null 2>&1; then
    info "Starting port forwarding (localhost:$WDA_PORT → device:$WDA_PORT)..."
    iproxy "$WDA_PORT" "$WDA_PORT" --udid "$DEVICE_UDID" &
    IPROXY_PID=$!
    ok "iproxy started (PID $IPROXY_PID)"
else
    warn "iproxy not found. Install with: brew install libimobiledevice"
    warn "WDA will only be reachable via device IP (WiFi), not localhost."
    warn "  Install:  brew install libimobiledevice"
fi

# ---- Build & Run WDA ----
info "Building and running WebDriverAgent on device..."
info "This may take a minute on first build..."
echo ""

DESTINATION="id=$DEVICE_UDID"

xcodebuild test \
    -project "$WDA_DIR/WebDriverAgent.xcodeproj" \
    -scheme WebDriverAgentRunner \
    -destination "$DESTINATION" \
    -allowProvisioningUpdates \
    USE_PORT="$WDA_PORT" \
    2>&1 | while IFS= read -r line; do
        # Show key status lines, suppress verbose build output
        if echo "$line" | grep -qiE '(ServerURLHere|error:|fail|started|listening|BUILD)'; then
            echo -e "${GREEN}[WDA]${NC} $line"
        fi
        # Detect the WDA server URL
        if echo "$line" | grep -q "ServerURLHere"; then
            echo ""
            ok "========================================="
            ok "  WDA is running!"
            ok "========================================="
            echo ""
            echo "  WDA endpoint:  http://localhost:$WDA_PORT"
            echo "  Device UDID:   $DEVICE_UDID"
            echo ""
            echo "  Press Ctrl+C to stop."
            echo ""
        fi
    done &
XCODEBUILD_PID=$!

wait "$XCODEBUILD_PID" 2>/dev/null || true
cleanup
