#!/bin/bash
set -euo pipefail

# ============================================================================
# WhiteNeedle IPA Re-signing Tool
# Injects WhiteNeedle.dylib into an IPA and re-signs it.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR=""

usage() {
    cat <<EOF
Usage: $0 [options]

Required:
  -i, --ipa <path>            Input IPA file
  -c, --cert <identity>       Signing identity (e.g., "Apple Development: xxx")
  -p, --profile <path>        Provisioning profile (.mobileprovision)

Optional:
  -o, --output <path>         Output IPA path (default: <input>_whiteneedle.ipa)
  -d, --dylib-dir <path>      Directory containing WhiteNeedle.dylib
                               (default: script's payload/ dir)
  -b, --bundle-id <id>        Override CFBundleIdentifier (required if profile AppID
                               differs from the IPA's original bundle ID)
  -e, --keep-extensions       Keep and re-sign app extensions instead of removing them.
                               Requires a wildcard provisioning profile (TeamID.*)
                               or per-extension profiles in --ext-profile-dir.
  --ext-profile <path>        Provisioning profile for extensions (wildcard profile).
                               Defaults to the main --profile if not specified.
  --ext-profile-dir <path>    Directory of per-extension profiles, named by bundle ID.
                               e.g., "com.example.app.share-ext.mobileprovision"
                               Takes precedence over --ext-profile for matched extensions.
  -h, --help                  Show this help message

Examples:
  # Basic: remove extensions (default, most reliable)
  $0 -i MyApp.ipa -c "Apple Development: dev@example.com" -p dev.mobileprovision

  # Keep extensions with a wildcard profile
  $0 -i MyApp.ipa -c "Apple Development: dev@example.com" -p dev.mobileprovision \\
     -e --ext-profile wildcard.mobileprovision

  # Keep extensions with per-extension profiles
  $0 -i MyApp.ipa -c "Apple Development: dev@example.com" -p dev.mobileprovision \\
     -e --ext-profile-dir ./profiles/
EOF
    exit 0
}

cleanup() {
    if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
        rm -rf "$WORK_DIR"
    fi
}
trap cleanup EXIT

log() { echo "[WhiteNeedle] $*"; }
warn() { echo "[WhiteNeedle] WARNING: $*" >&2; }
err() { echo "[WhiteNeedle] ERROR: $*" >&2; exit 1; }

# --- Parse arguments ---
INPUT_IPA=""
SIGN_IDENTITY=""
PROVISION_PROFILE=""
OUTPUT_IPA=""
DYLIB_DIR="$SKILL_ROOT/payload"
KEEP_EXTENSIONS=false
EXT_PROFILE=""
EXT_PROFILE_DIR=""
BUNDLE_ID_OVERRIDE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -i|--ipa)             INPUT_IPA="$2"; shift 2 ;;
        -c|--cert)            SIGN_IDENTITY="$2"; shift 2 ;;
        -p|--profile)         PROVISION_PROFILE="$2"; shift 2 ;;
        -o|--output)          OUTPUT_IPA="$2"; shift 2 ;;
        -d|--dylib-dir)       DYLIB_DIR="$2"; shift 2 ;;
        -b|--bundle-id)       BUNDLE_ID_OVERRIDE="$2"; shift 2 ;;
        -e|--keep-extensions) KEEP_EXTENSIONS=true; shift ;;
        --ext-profile)        EXT_PROFILE="$2"; shift 2 ;;
        --ext-profile-dir)    EXT_PROFILE_DIR="$2"; shift 2 ;;
        -h|--help)            usage ;;
        *)                    err "Unknown option: $1" ;;
    esac
done

[[ -z "$INPUT_IPA" ]] && err "Missing required: --ipa"
[[ -z "$SIGN_IDENTITY" ]] && err "Missing required: --cert"
[[ -z "$PROVISION_PROFILE" ]] && err "Missing required: --profile"
[[ -f "$INPUT_IPA" ]] || err "IPA not found: $INPUT_IPA"
[[ -f "$PROVISION_PROFILE" ]] || err "Profile not found: $PROVISION_PROFILE"

if [[ -z "$OUTPUT_IPA" ]]; then
    OUTPUT_IPA="${INPUT_IPA%.ipa}_whiteneedle.ipa"
fi

if [[ -z "$EXT_PROFILE" ]]; then
    EXT_PROFILE="$PROVISION_PROFILE"
fi

if [[ -n "$EXT_PROFILE_DIR" && ! -d "$EXT_PROFILE_DIR" ]]; then
    err "Extension profile directory not found: $EXT_PROFILE_DIR"
fi

WN_DYLIB="$DYLIB_DIR/WhiteNeedle.dylib"

[[ -f "$WN_DYLIB" ]] || err "WhiteNeedle.dylib not found in: $DYLIB_DIR"

# --- Check for insert_dylib ---
INSERT_DYLIB=""
if [[ -x "$SCRIPT_DIR/insert_dylib" ]]; then
    INSERT_DYLIB="$SCRIPT_DIR/insert_dylib"
elif command -v insert_dylib &>/dev/null; then
    INSERT_DYLIB="insert_dylib"
else
    err "insert_dylib not found. Place it in $SCRIPT_DIR/ or install it globally.
    Build from source: clang -o insert_dylib insert_dylib.c"
fi

# ---------------------------------------------------------------------------
# Helper: extract entitlements plist from a provisioning profile
# Usage: extract_entitlements <profile_path> <output_plist_path>
# ---------------------------------------------------------------------------
extract_entitlements() {
    local profile="$1" output="$2"
    local tmp_profile
    tmp_profile=$(mktemp)
    security cms -D -i "$profile" > "$tmp_profile" 2>/dev/null
    /usr/libexec/PlistBuddy -x -c "Print :Entitlements" "$tmp_profile" > "$output"
    rm -f "$tmp_profile"
}

# ---------------------------------------------------------------------------
# Helper: find the best provisioning profile for an extension
# Priority: per-extension profile dir > shared ext profile
# Usage: resolve_ext_profile <extension_bundle_id>
# Returns the path via stdout
# ---------------------------------------------------------------------------
resolve_ext_profile() {
    local bundle_id="$1"
    if [[ -n "$EXT_PROFILE_DIR" ]]; then
        local candidate="$EXT_PROFILE_DIR/${bundle_id}.mobileprovision"
        if [[ -f "$candidate" ]]; then
            echo "$candidate"
            return
        fi
    fi
    echo "$EXT_PROFILE"
}

# ---------------------------------------------------------------------------
# Helper: re-sign a single .appex or .app bundle
# Usage: resign_bundle <bundle_path> <profile_path> <identity>
# ---------------------------------------------------------------------------
resign_bundle() {
    local bundle_path="$1" profile="$2" identity="$3"
    local ent_file
    ent_file=$(mktemp)

    extract_entitlements "$profile" "$ent_file"

    cp "$profile" "$bundle_path/embedded.mobileprovision"

    # Sign frameworks/dylibs inside this bundle
    if [[ -d "$bundle_path/Frameworks" ]]; then
        find "$bundle_path/Frameworks" -maxdepth 1 \( -name "*.dylib" -o -name "*.framework" \) 2>/dev/null | while read -r item; do
            codesign --force --sign "$identity" "$item"
        done
    fi

    codesign --force --sign "$identity" --entitlements "$ent_file" "$bundle_path"
    rm -f "$ent_file"
}

# --- Step 1: Unzip IPA ---
WORK_DIR=$(mktemp -d)
log "Extracting IPA to $WORK_DIR ..."
unzip -q "$INPUT_IPA" -d "$WORK_DIR"

APP_PATH=$(find "$WORK_DIR/Payload" -maxdepth 1 -name "*.app" -type d | head -1)
[[ -d "$APP_PATH" ]] || err "No .app found in IPA"
APP_NAME=$(basename "$APP_PATH" .app)
log "Found app: $APP_NAME"

APP_BINARY="$APP_PATH/$APP_NAME"
[[ -f "$APP_BINARY" ]] || APP_BINARY=$(plutil -extract CFBundleExecutable raw "$APP_PATH/Info.plist" 2>/dev/null | xargs -I{} echo "$APP_PATH/{}")
[[ -f "$APP_BINARY" ]] || err "Cannot find app binary"

# --- Step 2: Copy dylibs ---
FRAMEWORKS_DIR="$APP_PATH/Frameworks"
mkdir -p "$FRAMEWORKS_DIR"

log "Copying WhiteNeedle.dylib ..."
cp "$WN_DYLIB" "$FRAMEWORKS_DIR/"

# --- Step 3: Inject load command ---
log "Injecting load command into $APP_NAME ..."
"$INSERT_DYLIB" "@rpath/WhiteNeedle.dylib" "$APP_BINARY" --inplace

# --- Step 3.5: Override Bundle ID if requested ---
if [[ -n "$BUNDLE_ID_OVERRIDE" ]]; then
    OLD_BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP_PATH/Info.plist" 2>/dev/null || echo "")
    log "Overriding Bundle ID: $OLD_BUNDLE_ID -> $BUNDLE_ID_OVERRIDE"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID_OVERRIDE" "$APP_PATH/Info.plist"
fi

# --- Step 4: Handle App Extensions ---
if [[ "$KEEP_EXTENSIONS" == true ]]; then
    # Re-sign all extensions
    EXT_OK=0
    EXT_FAIL=0
    if [[ -d "$APP_PATH/PlugIns" ]]; then
        log "Re-signing app extensions ..."
        for ext in "$APP_PATH/PlugIns/"*.appex; do
            [[ -d "$ext" ]] || continue
            ext_name=$(basename "$ext")
            ext_bundle_id=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$ext/Info.plist" 2>/dev/null || echo "")
            if [[ -z "$ext_bundle_id" ]]; then
                warn "Skipping $ext_name: cannot read bundle ID"
                EXT_FAIL=$((EXT_FAIL + 1))
                continue
            fi

            ext_prof=$(resolve_ext_profile "$ext_bundle_id")
            if [[ ! -f "$ext_prof" ]]; then
                warn "Skipping $ext_name: no profile for $ext_bundle_id"
                rm -rf "$ext"
                EXT_FAIL=$((EXT_FAIL + 1))
                continue
            fi

            log "  Signing: $ext_name ($ext_bundle_id)"
            if resign_bundle "$ext" "$ext_prof" "$SIGN_IDENTITY"; then
                EXT_OK=$((EXT_OK + 1))
            else
                warn "  Failed to sign $ext_name, removing it"
                rm -rf "$ext"
                EXT_FAIL=$((EXT_FAIL + 1))
            fi
        done
        log "Extensions: $EXT_OK signed, $EXT_FAIL removed"
    fi

    # Handle Watch app (rarely needed, remove if present)
    if [[ -d "$APP_PATH/Watch" ]]; then
        log "Removing Watch app (not supported for re-signing) ..."
        rm -rf "$APP_PATH/Watch"
    fi
else
    # Default: remove all extensions for maximum compatibility
    if [[ -d "$APP_PATH/PlugIns" ]]; then
        EXT_COUNT=$(find "$APP_PATH/PlugIns" -maxdepth 1 -name "*.appex" | wc -l | tr -d ' ')
        log "Removing $EXT_COUNT app extensions (use -e to keep them) ..."
        rm -rf "$APP_PATH/PlugIns"
    fi
    if [[ -d "$APP_PATH/Watch" ]]; then
        log "Removing Watch app ..."
        rm -rf "$APP_PATH/Watch"
    fi
fi

# --- Step 5: Extract entitlements for main app ---
log "Extracting entitlements ..."
ENTITLEMENTS_FILE="$WORK_DIR/entitlements.plist"
extract_entitlements "$PROVISION_PROFILE" "$ENTITLEMENTS_FILE"

# --- Step 6: Replace provisioning profile ---
log "Embedding provisioning profile ..."
cp "$PROVISION_PROFILE" "$APP_PATH/embedded.mobileprovision"

# --- Step 7: Re-sign main app ---
log "Signing dylibs and frameworks ..."
find "$FRAMEWORKS_DIR" -maxdepth 1 \( -name "*.dylib" -o -name "*.framework" \) | while read -r item; do
    codesign --force --sign "$SIGN_IDENTITY" "$item"
done

find "$FRAMEWORKS_DIR" -mindepth 2 \( -name "*.framework" -o -name "*.dylib" \) 2>/dev/null | while read -r item; do
    codesign --force --sign "$SIGN_IDENTITY" "$item"
done

log "Signing app bundle ..."
codesign --force --sign "$SIGN_IDENTITY" \
    --entitlements "$ENTITLEMENTS_FILE" \
    "$APP_PATH"

# --- Step 8: Repack IPA ---
log "Repacking IPA ..."
if [[ "$OUTPUT_IPA" != /* ]]; then
    OUTPUT_IPA="$(pwd)/$OUTPUT_IPA"
fi
mkdir -p "$(dirname "$OUTPUT_IPA")"
(cd "$WORK_DIR" && zip -qr "$OUTPUT_IPA" Payload)

log "======================================"
log "Done! Output: $OUTPUT_IPA"
log "======================================"
