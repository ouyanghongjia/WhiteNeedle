#!/usr/bin/env bash
# 唯一源码在 ios-dylib/WhiteNeedle/BuiltinModules/；本脚本仅做存在性检查。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B="$ROOT/ios-dylib/WhiteNeedle/BuiltinModules"
REQUIRED=(events.js util.js wn-test.js wn-auto.js)
for f in "${REQUIRED[@]}"; do
  if [[ ! -f "$B/$f" ]]; then
    echo "error: missing builtin module: $B/$f" >&2
    exit 1
  fi
done
echo "verify-builtin-modules: ok (${#REQUIRED[@]} files)"
