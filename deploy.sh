#!/bin/bash
set -euo pipefail

# ============================================================================
# WhiteNeedle One-Click: Build dylib → Resign IPA → Install to device
#
# Usage:
#   ./deploy.sh                        # 完整流程
#   ./deploy.sh --build-only           # 仅编译 dylib
#   ./deploy.sh --skip-build           # 跳过编译，重签+安装
#   ./deploy.sh --install-only         # 仅安装已有 IPA（不编译不重签）
#   ./deploy.sh --install-only -i X.ipa  # 安装指定 IPA
# ============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_FILE="$ROOT_DIR/deploy.conf"
DYLIB_DIR="$ROOT_DIR/ios-dylib"
RESIGN_DIR="$ROOT_DIR/resign-tool"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${GREEN}[WN $(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[WN $(date +%H:%M:%S)]${NC} $*" >&2; }
err()  { echo -e "${RED}[WN $(date +%H:%M:%S)]${NC} $*" >&2; exit 1; }
step() { echo -e "\n${CYAN}━━━ Step $1: $2 ━━━${NC}"; }

# --- Defaults ---
IPA_PATH=""
SIGN_IDENTITY=""
PROVISION_PROFILE=""
DEVICE_UDID=""
KEEP_EXTENSIONS=false
INSTALL_TOOL="ios-deploy"
SKIP_BUILD=false
BUILD_ONLY=false
INSTALL_ONLY=false
OUTPUT_IPA=""

# --- Load config ---
if [[ -f "$CONF_FILE" ]]; then
    source "$CONF_FILE"
fi

# --- Parse CLI overrides ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        -i|--ipa)         IPA_PATH="$2"; shift 2 ;;
        -c|--cert)        SIGN_IDENTITY="$2"; shift 2 ;;
        -p|--profile)     PROVISION_PROFILE="$2"; shift 2 ;;
        -u|--udid)        DEVICE_UDID="$2"; shift 2 ;;
        -o|--output)      OUTPUT_IPA="$2"; shift 2 ;;
        --skip-build)     SKIP_BUILD=true; shift ;;
        --build-only)     BUILD_ONLY=true; shift ;;
        --install-only)   INSTALL_ONLY=true; shift ;;
        --keep-ext)       KEEP_EXTENSIONS=true; shift ;;
        -h|--help)
            cat <<EOF
Usage: $0 [options]

Modes:
  (default)              Full pipeline: build → resign → install
  --build-only           Only compile dylib
  --skip-build           Skip compilation, resign + install
  --install-only         Only install IPA (no build, no resign)

Options:
  -i, --ipa <path>       Input IPA (original for resign, or target for --install-only)
  -c, --cert <identity>  Signing identity
  -p, --profile <path>   Provisioning profile
  -u, --udid <udid>      Target device UDID
  -o, --output <path>    Output IPA path (resign output)
  --keep-ext             Keep app extensions during resign
  -h, --help             Show this help

Config file: $CONF_FILE
EOF
            exit 0
            ;;
        *) err "Unknown option: $1. Use -h for help." ;;
    esac
done

# --- Resolve helper ---
resolve_path() {
    local p="$1"
    if [[ "$p" != /* ]]; then
        p="$(cd "$(dirname "$p")" 2>/dev/null && pwd)/$(basename "$p")"
    fi
    echo "$p"
}

# ============================================================================
# Mode: --install-only
# ============================================================================
if [[ "$INSTALL_ONLY" == true ]]; then
    # Determine which IPA to install
    INSTALL_IPA=""
    if [[ -n "$OUTPUT_IPA" && -f "$OUTPUT_IPA" ]]; then
        INSTALL_IPA="$OUTPUT_IPA"
    elif [[ -n "$IPA_PATH" && -f "$IPA_PATH" ]]; then
        INSTALL_IPA="$IPA_PATH"
    else
        # Try the default _whiteneedle.ipa
        if [[ -n "$IPA_PATH" ]]; then
            CANDIDATE="${IPA_PATH%.ipa}_whiteneedle.ipa"
            [[ -f "$CANDIDATE" ]] && INSTALL_IPA="$CANDIDATE"
        fi
    fi

    [[ -n "$INSTALL_IPA" && -f "$INSTALL_IPA" ]] || err "No IPA to install. Pass -i <path> or -o <path>"
    INSTALL_IPA="$(resolve_path "$INSTALL_IPA")"

    step 1 "Install IPA to device (--install-only)"
    log "IPA:    $INSTALL_IPA"
    log "Device: ${DEVICE_UDID:-"(first connected)"}"

    if [[ "$INSTALL_TOOL" == "ios-deploy" ]]; then
        command -v ios-deploy &>/dev/null || err "ios-deploy not found. Install: brew install ios-deploy"
        DEPLOY_ARGS=(--bundle "$INSTALL_IPA")
        [[ -n "$DEVICE_UDID" ]] && DEPLOY_ARGS+=(--id "$DEVICE_UDID")
        ios-deploy "${DEPLOY_ARGS[@]}"
    elif [[ "$INSTALL_TOOL" == "ideviceinstaller" ]]; then
        command -v ideviceinstaller &>/dev/null || err "ideviceinstaller not found. Install: brew install ideviceinstaller"
        DEPLOY_ARGS=(-i "$INSTALL_IPA")
        [[ -n "$DEVICE_UDID" ]] && DEPLOY_ARGS+=(-u "$DEVICE_UDID")
        ideviceinstaller "${DEPLOY_ARGS[@]}"
    else
        err "Unknown INSTALL_TOOL: $INSTALL_TOOL"
    fi

    echo ""
    log "Install complete!"
    exit 0
fi

# ============================================================================
# Step 1: Build dylib
# ============================================================================
if [[ "$SKIP_BUILD" == false ]]; then
    step 1 "Build WhiteNeedle.dylib"

    cd "$DYLIB_DIR"
    make clean >/dev/null 2>&1 || true
    make

    BUILT_DYLIB="$DYLIB_DIR/build/WhiteNeedle.dylib"
    [[ -f "$BUILT_DYLIB" ]] || err "Build failed: $BUILT_DYLIB not found"

    mkdir -p "$RESIGN_DIR/payload"
    cp "$BUILT_DYLIB" "$RESIGN_DIR/payload/WhiteNeedle.dylib"
    log "dylib → resign-tool/payload/"

    cd "$ROOT_DIR"
else
    log "Skipping build (--skip-build)"
fi

if [[ "$BUILD_ONLY" == true ]]; then
    log "Build complete (--build-only)."
    exit 0
fi

# ============================================================================
# Step 2: Validate resign parameters
# ============================================================================
step 2 "Validate configuration"

[[ -n "$IPA_PATH" ]]          || err "IPA_PATH not set. Edit deploy.conf or pass -i <path>"
[[ -f "$IPA_PATH" ]]          || err "IPA not found: $IPA_PATH"
[[ -n "$SIGN_IDENTITY" ]]     || err "SIGN_IDENTITY not set. Edit deploy.conf or pass -c <identity>"
[[ -n "$PROVISION_PROFILE" ]] || err "PROVISION_PROFILE not set. Edit deploy.conf or pass -p <path>"
[[ -f "$PROVISION_PROFILE" ]] || err "Profile not found: $PROVISION_PROFILE"

IPA_PATH="$(resolve_path "$IPA_PATH")"
PROVISION_PROFILE="$(resolve_path "$PROVISION_PROFILE")"

log "IPA:      $IPA_PATH"
log "Cert:     $SIGN_IDENTITY"
log "Profile:  $PROVISION_PROFILE"
log "Device:   ${DEVICE_UDID:-"(first connected)"}"

# Show profile info for debugging
PROFILE_TMP=$(mktemp)
security cms -D -i "$PROVISION_PROFILE" > "$PROFILE_TMP" 2>/dev/null || true
PROFILE_BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :Entitlements:application-identifier" "$PROFILE_TMP" 2>/dev/null || echo "unknown")
PROFILE_TEAM=$(/usr/libexec/PlistBuddy -c "Print :TeamIdentifier:0" "$PROFILE_TMP" 2>/dev/null || echo "unknown")
PROFILE_NAME=$(/usr/libexec/PlistBuddy -c "Print :Name" "$PROFILE_TMP" 2>/dev/null || echo "unknown")
PROFILE_EXPIRY=$(/usr/libexec/PlistBuddy -c "Print :ExpirationDate" "$PROFILE_TMP" 2>/dev/null || echo "unknown")
PROFILE_DEV_COUNT=$(/usr/libexec/PlistBuddy -c "Print :ProvisionedDevices" "$PROFILE_TMP" 2>/dev/null | grep -c '^\s' || echo "0")
rm -f "$PROFILE_TMP"
log "Profile → Name: $PROFILE_NAME"
log "Profile → AppID: $PROFILE_BUNDLE_ID  Team: $PROFILE_TEAM"
log "Profile → Expiry: $PROFILE_EXPIRY  Devices: $PROFILE_DEV_COUNT"

# ============================================================================
# Step 3: Resign IPA
# ============================================================================
step 3 "Resign IPA with WhiteNeedle.dylib"

RESIGN_ARGS=(
    -i "$IPA_PATH"
    -c "$SIGN_IDENTITY"
    -p "$PROVISION_PROFILE"
)

if [[ -n "$OUTPUT_IPA" ]]; then
    OUTPUT_IPA="$(resolve_path "$OUTPUT_IPA")"
else
    OUTPUT_IPA="${IPA_PATH%.ipa}_whiteneedle.ipa"
fi
RESIGN_ARGS+=(-o "$OUTPUT_IPA")

if [[ "$KEEP_EXTENSIONS" == true ]]; then
    RESIGN_ARGS+=(-e)
fi

bash "$RESIGN_DIR/resign.sh" "${RESIGN_ARGS[@]}"

[[ -f "$OUTPUT_IPA" ]] || err "Resign failed: output IPA not found"

# ============================================================================
# Step 4: Install to device
# ============================================================================
step 4 "Install to device"

if [[ "$INSTALL_TOOL" == "ios-deploy" ]]; then
    command -v ios-deploy &>/dev/null || err "ios-deploy not found. Install: brew install ios-deploy"
    DEPLOY_ARGS=(--bundle "$OUTPUT_IPA")
    [[ -n "$DEVICE_UDID" ]] && DEPLOY_ARGS+=(--id "$DEVICE_UDID")
    log "Installing via ios-deploy ..."
    ios-deploy "${DEPLOY_ARGS[@]}"
elif [[ "$INSTALL_TOOL" == "ideviceinstaller" ]]; then
    command -v ideviceinstaller &>/dev/null || err "ideviceinstaller not found. Install: brew install ideviceinstaller"
    DEPLOY_ARGS=(-i "$OUTPUT_IPA")
    [[ -n "$DEVICE_UDID" ]] && DEPLOY_ARGS+=(-u "$DEVICE_UDID")
    log "Installing via ideviceinstaller ..."
    ideviceinstaller "${DEPLOY_ARGS[@]}"
else
    err "Unknown INSTALL_TOOL: $INSTALL_TOOL"
fi

# ============================================================================
# Done
# ============================================================================
echo ""
log "========================================="
log " Deploy complete!"
log " IPA: $OUTPUT_IPA"
log "========================================="
