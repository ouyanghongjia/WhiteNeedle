# WhiteNeedle IPA Resign Skill

将 WhiteNeedle 注入 IPA 并重签名，使其可以安装到 iOS 设备上进行调试。本 skill 自包含——所有工具、配置和产物均按子目录归类。

Use when the user asks to resign an IPA, inject WhiteNeedle, re-sign an app, prepare an IPA for debugging, deploy WhiteNeedle to an app, or install a debug-enabled IPA.

Trigger phrases: "resign IPA", "re-sign", "inject WhiteNeedle", "重签名", "注入 WhiteNeedle", "签名 IPA", "resign app", "deploy IPA", "install WhiteNeedle", "prepare IPA", "打包调试", "安装到设备".

## Setup

All tools are bundled alongside this SKILL.md. Determine this skill's directory from the `fullPath` used to read this file.

```
<SKILL_DIR>/
├── SKILL.md                    # Skill definition (this file)
├── bin/                        # Executables
│   ├── resign.sh               #   IPA resign + inject script
│   ├── insert_dylib            #   Mach-O patcher binary (pre-compiled)
│   └── insert_dylib.c          #   Mach-O patcher source (for cross-arch build)
├── config/                     # User configuration
│   └── deploy.conf             #   Signing cert, profile, device, etc.
└── payload/                    # Bundled artifacts
    └── WhiteNeedle.framework/  #   Pre-built framework
```

Where `<SKILL_DIR>` is the directory containing this SKILL.md.

**Prerequisites:**
- macOS with Xcode Command Line Tools installed (`xcode-select --install`)
- A valid Apple developer certificate (Development or Enterprise)
- A matching provisioning profile (.mobileprovision) containing the target device UDID
- WhiteNeedle.framework (pre-built)
- Optional: `ios-deploy` or `ideviceinstaller` for device installation

## Workflow

### Step 0: Load & Validate Saved Configuration

**Before asking the user for anything**, check `<SKILL_DIR>/config/deploy.conf` for pre-configured values. Only prompt for parameters that are missing or invalid.

#### 0a. Read deploy.conf

```bash
SKILL_DIR="<SKILL_DIR>"
CONF_FILE="$SKILL_DIR/config/deploy.conf"

# Source the config to get: SIGN_IDENTITY, PROVISION_PROFILE, DEVICE_UDID, KEEP_EXTENSIONS, INSTALL_TOOL
if [ -f "$CONF_FILE" ]; then
    source "$CONF_FILE"
fi
```

#### 0b. Validate signing certificate

If `SIGN_IDENTITY` is set in config, verify it exists in the keychain:

```bash
if [ -n "$SIGN_IDENTITY" ]; then
    security find-identity -v -p codesigning | grep -F "$SIGN_IDENTITY" > /dev/null 2>&1
    # Exit code 0 = valid, non-zero = not found or expired
fi
```

If valid, report to user: "已从配置中读取签名证书: `<SIGN_IDENTITY>` ✓"
If invalid or missing, mark as **needs input**.

#### 0c. Validate provisioning profile

If `PROVISION_PROFILE` is set, check:
1. File exists
2. Not expired

```bash
if [ -n "$PROVISION_PROFILE" ] && [ -f "$PROVISION_PROFILE" ]; then
    PROFILE_TMP=$(mktemp)
    security cms -D -i "$PROVISION_PROFILE" > "$PROFILE_TMP" 2>/dev/null

    # Extract profile name and expiry
    PROFILE_NAME=$(/usr/libexec/PlistBuddy -c "Print :Name" "$PROFILE_TMP" 2>/dev/null)
    EXPIRY_DATE=$(/usr/libexec/PlistBuddy -c "Print :ExpirationDate" "$PROFILE_TMP" 2>/dev/null)

    # Check expiry (compare with current date)
    EXPIRY_EPOCH=$(date -jf "%a %b %d %T %Z %Y" "$EXPIRY_DATE" "+%s" 2>/dev/null || echo 0)
    NOW_EPOCH=$(date "+%s")

    rm -f "$PROFILE_TMP"

    if [ "$EXPIRY_EPOCH" -gt "$NOW_EPOCH" ]; then
        echo "Profile valid: $PROFILE_NAME (expires: $EXPIRY_DATE)"
    else
        echo "Profile EXPIRED: $PROFILE_NAME"
    fi
fi
```

If valid and not expired, report: "已从配置中读取描述文件: `<PROFILE_NAME>` (到期: `<EXPIRY_DATE>`) ✓"
If expired, warn: "配置的描述文件已过期，需要提供新的描述文件。"
If missing, mark as **needs input**.

#### 0d. Detect or validate device

For install-to-device scenarios, check device availability in this order:

1. **Auto-detect connected devices:**
```bash
# Try ios-deploy first
CONNECTED_DEVICES=$(ios-deploy -c --timeout 3 2>/dev/null | grep -oE '[0-9a-f]{40}' || true)

# Fallback to idevice_id
if [ -z "$CONNECTED_DEVICES" ]; then
    CONNECTED_DEVICES=$(idevice_id -l 2>/dev/null || true)
fi
```

2. **If device(s) detected**: use the first one (or let user pick if multiple)
3. **If no device detected but `DEVICE_UDID` in config**: use the configured UDID, warn that device is not currently connected
4. **If neither**: prompt user to provide device UDID, or skip installation

Report device status to user:
- "检测到已连接设备: `<UDID>` ✓"
- "未检测到设备，将使用配置中的设备 ID: `<UDID>` (注意: 设备当前未连接，安装时需连接)"
- "未检测到设备且未配置设备 ID，请提供目标设备 UDID 或连接设备后重试。"

#### 0e. Summary & gap-fill

After validation, present a summary table to the user showing what was loaded vs what's missing:

```
配置状态:
  签名证书:    ✓ Apple Development: dev@example.com (ABC123)
  描述文件:    ✓ MyApp Dev Profile (expires 2026-12-01)
  设备 ID:     ✓ 已连接: abc123...
  IPA 路径:    ✗ 未配置 — 请提供
  Framework:   ✓ 自动使用编译产物
```

Only use AskQuestion or direct conversation to collect the **missing** parameters. Do NOT re-ask for parameters that are already configured and valid.

**Important: If ANY parameter is missing or invalid**, append a friendly tip after the summary:

```
💡 提示: 您可以直接编辑配置文件预设这些参数，之后重签名将自动使用，无需再次提供:
   <SKILL_DIR的实际绝对路径>/config/deploy.conf
```

Use the **actual absolute path** resolved from `<SKILL_DIR>` so the user can directly click/open it. This tip should only appear when there are missing parameters, not when everything is already configured.

### Step 0.5: Save Configuration

After successful resign, **automatically** save the user-provided values (cert, profile, device) to `<SKILL_DIR>/config/deploy.conf` and inform the user:

```
已将本次使用的配置保存到:
   <SKILL_DIR的实际绝对路径>/config/deploy.conf

下次重签名将自动使用这些配置，无需再次提供。如需修改，直接编辑该文件即可。
```

Implementation:

```bash
CONF_FILE="$SKILL_DIR/config/deploy.conf"
# Only update the fields that the user provided new values for, preserve other values
```

Do NOT overwrite values the user did not change. For example, if the user only provided a new IPA path but cert/profile were already configured, only update `IPA_PATH`.

### Step 0.9: Validate All Parameters Before Execution

After collecting all parameters (from config + user input), validate **every** parameter before proceeding. If any validation fails, report the specific error and ask the user to correct it. **Do NOT proceed to resign until all validations pass.**

#### IPA file validation

```bash
# 1. File exists
if [ ! -f "$IPA_PATH" ]; then
    echo "❌ IPA 文件不存在: $IPA_PATH"
fi

# 2. Is a valid IPA (zip with Payload/*.app)
if ! unzip -l "$IPA_PATH" 2>/dev/null | grep -q "Payload/.*\.app/"; then
    echo "❌ 不是有效的 IPA 文件（缺少 Payload/*.app 结构）: $IPA_PATH"
fi

# 3. Check if already injected
TMPDIR_CHECK=$(mktemp -d)
unzip -q "$IPA_PATH" -d "$TMPDIR_CHECK" 2>/dev/null
APP_CHECK=$(find "$TMPDIR_CHECK/Payload" -maxdepth 1 -name "*.app" | head -1)
if [ -n "$APP_CHECK" ] && ls "$APP_CHECK/Frameworks/" 2>/dev/null | grep -qi whiteneedle; then
    echo "⚠️ 该 IPA 似乎已注入过 WhiteNeedle，重复注入可能导致问题。是否继续？"
fi
rm -rf "$TMPDIR_CHECK"
```

Error messages:
- "❌ IPA 文件不存在: `<path>`，请检查路径是否正确。"
- "❌ 文件不是有效的 IPA 格式，请确认提供的是 .ipa 文件而非 .app 或 .xcarchive。"
- "⚠️ 该 IPA 已包含 WhiteNeedle，重复注入可能导致问题。是否仍然继续？"

#### Signing certificate validation

```bash
# Verify the cert exists in keychain (for both config-loaded and user-provided)
CERT_MATCH=$(security find-identity -v -p codesigning | grep -F "$SIGN_IDENTITY")
if [ -z "$CERT_MATCH" ]; then
    echo "❌ 签名证书未找到: $SIGN_IDENTITY"
    echo "可用证书列表:"
    security find-identity -v -p codesigning
fi
```

Error messages:
- "❌ 签名证书 `<identity>` 未在钥匙串中找到。可能已过期、被撤销或未安装。"
- Then list available certificates and ask user to select again.

#### Provisioning profile validation

```bash
# 1. File exists and is readable
if [ ! -f "$PROVISION_PROFILE" ]; then
    echo "❌ 描述文件不存在: $PROVISION_PROFILE"
fi

# 2. Is a valid mobileprovision
PROFILE_TMP=$(mktemp)
if ! security cms -D -i "$PROVISION_PROFILE" > "$PROFILE_TMP" 2>/dev/null; then
    echo "❌ 无法解析描述文件，可能不是有效的 .mobileprovision 格式"
fi

# 3. Not expired
EXPIRY_DATE=$(/usr/libexec/PlistBuddy -c "Print :ExpirationDate" "$PROFILE_TMP" 2>/dev/null)
EXPIRY_EPOCH=$(date -jf "%a %b %d %T %Z %Y" "$EXPIRY_DATE" "+%s" 2>/dev/null || echo 0)
NOW_EPOCH=$(date "+%s")
if [ "$EXPIRY_EPOCH" -le "$NOW_EPOCH" ]; then
    echo "❌ 描述文件已过期 ($EXPIRY_DATE)，请从 Apple Developer Portal 重新下载"
fi

# 4. Contains the signing certificate
PROFILE_CERTS=$(/usr/libexec/PlistBuddy -c "Print :DeveloperCertificates" "$PROFILE_TMP" 2>/dev/null)
# Note: exact cert matching requires extracting and comparing — at minimum warn if profile team differs

# 5. Contains device UDID (for dev profiles, not enterprise/app-store)
PROFILE_TYPE=$(/usr/libexec/PlistBuddy -c "Print :ProvisionsAllDevices" "$PROFILE_TMP" 2>/dev/null || echo "false")
if [ "$PROFILE_TYPE" != "true" ] && [ -n "$DEVICE_UDID" ]; then
    DEVICES_IN_PROFILE=$(/usr/libexec/PlistBuddy -c "Print :ProvisionedDevices" "$PROFILE_TMP" 2>/dev/null || echo "")
    if ! echo "$DEVICES_IN_PROFILE" | grep -qi "$DEVICE_UDID"; then
        echo "⚠️ 描述文件中未包含目标设备 UDID ($DEVICE_UDID)，安装时可能失败"
    fi
fi
rm -f "$PROFILE_TMP"
```

Error messages:
- "❌ 描述文件不存在: `<path>`，请检查路径。"
- "❌ 文件不是有效的描述文件格式，请确认提供的是 .mobileprovision 文件。"
- "❌ 描述文件已过期 (`<date>`)，请从 Apple Developer Portal 重新下载或通过 Xcode 自动管理。"
- "⚠️ 描述文件中未包含目标设备 `<UDID>`，安装后可能无法运行。如果是企业证书则可忽略。"

#### Device UDID validation (if provided)

```bash
# Basic format check: 40 hex chars (older) or 25 chars with dash (newer)
if [ -n "$DEVICE_UDID" ]; then
    if ! echo "$DEVICE_UDID" | grep -qE '^[0-9a-fA-F-]{25,40}$'; then
        echo "⚠️ 设备 UDID 格式异常: $DEVICE_UDID（通常为 25 或 40 位十六进制字符）"
    fi
fi
```

Error messages:
- "⚠️ 设备 UDID 格式可能不正确: `<udid>`。正常 UDID 为 25 位（新设备, 如 `00008030-001234560A12002E`）或 40 位十六进制字符。请确认 UDID 是否正确。"

#### Validation summary

After all checks, present results:

```
参数验证:
  IPA 文件:     ✓ MyApp.ipa (12.3 MB)
  签名证书:     ✓ Apple Development: dev@example.com
  描述文件:     ✓ MyApp Dev Profile (expires 2026-12-01)
  目标设备:     ⚠️ 描述文件中未包含该设备 UDID，安装后可能无法运行
```

- `✓` = 验证通过
- `⚠️` = 有风险但可继续（需用户确认）
- `❌` = 必须修正后才能继续

If there are `❌` errors, list them with the config file path tip:

```
请修正以上标记为 ❌ 的问题后重试。
    💡 提示: 常用配置可以保存到: <SKILL_DIR的实际绝对路径>/config/deploy.conf
```

If there are only `⚠️` warnings, ask user whether to proceed.

### Step 1: Compile insert_dylib (if needed)

Check if `insert_dylib` binary exists in `<SKILL_DIR>/bin/`. If not, compile from source:

```bash
SKILL_DIR="<SKILL_DIR>"
if [ ! -x "$SKILL_DIR/bin/insert_dylib" ]; then
    echo "Compiling insert_dylib..."
    clang -o "$SKILL_DIR/bin/insert_dylib" "$SKILL_DIR/bin/insert_dylib.c"
    chmod +x "$SKILL_DIR/bin/insert_dylib"
fi
```

### Step 2: Prepare Payload Directory

The resign.sh script expects WhiteNeedle.framework/ in a directory. Create a temp payload directory and copy:

```bash
PAYLOAD_DIR=$(mktemp -d)/payload
mkdir -p "$PAYLOAD_DIR"
cp -R "<FRAMEWORK_PATH>" "$PAYLOAD_DIR/WhiteNeedle.framework"
```

### Step 3: Execute Resign

```bash
bash "$SKILL_DIR/bin/resign.sh" \
  -i "<IPA_PATH>" \
  -c "<SIGN_IDENTITY>" \
  -p "<PROVISION_PROFILE>" \
  -d "$PAYLOAD_DIR" \
  -o "<OUTPUT_PATH>"
```

Add `-e` flag if the user wants to keep app extensions.

### Step 4: Report Results

After successful resign, report:
- Output IPA path and file size
- Number of frameworks signed
- Whether extensions were kept or removed

### Step 5 (Optional): Install to Device

Use the device ID resolved in Step 0d. If no device is available and the user wants to install:

```bash
# Using ios-deploy (preferred)
ios-deploy --bundle "<OUTPUT_IPA>" --id "<DEVICE_UDID>"

# Using ideviceinstaller
ideviceinstaller -i "<OUTPUT_IPA>" -u "<DEVICE_UDID>"

# Without specific UDID (first connected device)
ios-deploy --bundle "<OUTPUT_IPA>"
```

If the device is not connected, remind the user to connect it first.

## Complete Example Sessions

### Session 1: First-time use (no config)

```
User: 帮我重签名一个 IPA

AI: [读取 deploy.conf — 发现证书、描述文件均未配置]

    配置状态:
      签名证书:    ✗ 未配置
      描述文件:    ✗ 未配置
      设备 ID:     — 检测中...
      IPA 路径:    ✗ 需要提供

    [运行 security find-identity 列出可用证书]
    [运行 ls ~/Library/MobileDevice/Provisioning\ Profiles/ 列出描述文件]

    检测到以下可用证书:
    1) Apple Development: dev@example.com (ABC123)
    2) Apple Distribution: company@example.com (XYZ789)

    请提供:
    1. IPA 文件路径
    2. 选择签名证书（上面的编号）
    3. 描述文件路径

    💡 提示: 您也可以直接编辑下面的配置文件预设这些参数，之后重签名将自动使用，无需再次提供:
       /Users/you/.cursor/skills/whiteneedle-resign/config/deploy.conf

User: ~/Downloads/MyApp.ipa，用第1个证书，描述文件在 ~/profiles/dev.mobileprovision

AI: [验证文件 + 执行重签名]
    重签名完成！

    已将本次使用的配置保存到:
       /Users/you/.cursor/skills/whiteneedle-resign/config/deploy.conf

    下次重签名将自动使用这些配置，无需再次提供证书和描述文件。
```

### Session 2: Config already set

```
User: 重签名这个 IPA: ~/Downloads/NewApp.ipa

AI: [读取 deploy.conf]

    配置状态:
      签名证书:    ✓ Apple Development: dev@example.com (ABC123)
      描述文件:    ✓ MyApp Dev Profile (expires 2026-12-01)
      设备 ID:     ✓ 已连接: 00008030-001234560A12002E

    所有签名参数已就绪，开始重签名...
    [直接执行，无需额外询问]
```

### Session 3: Install but no device connected

```
User: 重签名并安装到设备

AI: [读取 deploy.conf — 证书、描述文件有效]
    [检测设备 — 未发现已连接设备]
    [deploy.conf 中 DEVICE_UDID 也为空]

    签名配置已就绪，但未检测到已连接的 iOS 设备。
    请选择:
    1. 连接设备后重试
    2. 手动输入设备 UDID
    3. 仅重签名，稍后安装
```

### Session 4: User provides incorrect information

```
User: 重签名 ~/Downloads/MyApp.zip，用证书 "iPhone Developer: test"，
      描述文件 ~/profiles/old.mobileprovision

AI: [验证参数]

    参数验证:
      IPA 文件:     ❌ 文件不是有效的 IPA 格式（提供的是 .zip 文件，请确认是否为 .ipa）
      签名证书:     ❌ "iPhone Developer: test" 未在钥匙串中找到
      描述文件:     ❌ 描述文件已过期 (2024-03-15)

    可用的签名证书:
    1) Apple Development: dev@example.com (ABC123)
    2) Apple Distribution: company@example.com (XYZ789)

    请修正以上问题:
    1. 提供正确的 .ipa 文件路径
    2. 从上面列表中选择有效的证书
    3. 提供未过期的描述文件

    💡 提示: 常用配置可以保存到:
       /Users/you/.cursor/skills/whiteneedle-resign/config/deploy.conf
```

### Session 5: Config has stale values

```
User: 重签名 ~/Downloads/NewApp.ipa

AI: [读取 deploy.conf — 发现已有配置]
    [验证配置...]

    配置状态:
      签名证书:    ❌ 配置的证书 "Apple Development: old@example.com" 已不在钥匙串中
                      (可能已过期或被删除)
      描述文件:    ⚠️ 描述文件有效但将于 7 天内过期 (2026-04-14)
      设备 ID:     ✓ 已连接: 00008030-001234560A12002E
      IPA 路径:    ✓ ~/Downloads/NewApp.ipa

    需要重新选择签名证书。当前可用:
    1) Apple Development: new@example.com (DEF456)

    💡 提示: 更新后的证书会自动保存到:
       /Users/you/.cursor/skills/whiteneedle-resign/config/deploy.conf

User: 用第 1 个

AI: [更新证书 + 验证通过 + 执行重签名]
    重签名完成！

    已更新配置文件中的签名证书:
       /Users/you/.cursor/skills/whiteneedle-resign/config/deploy.conf
    ⚠️ 提醒: 描述文件将于 2026-04-14 过期，届时需要更新。
```

## deploy.conf Reference

```bash
# WhiteNeedle deploy configuration
# 修改下面的值以匹配你的环境

# 原始 IPA 路径（未注入的原版）
IPA_PATH=

# 签名证书 (security find-identity -v -p codesigning 查看可用证书)
SIGN_IDENTITY=

# 描述文件路径
PROVISION_PROFILE=

# 目标设备 UDID（留空则安装到第一个连接的设备）
DEVICE_UDID=""

# 是否保留 App Extensions（true/false）
KEEP_EXTENSIONS=false

# 安装工具: "ios-deploy" 或 "ideviceinstaller"
INSTALL_TOOL="ios-deploy"
```

## Helper Commands

### List available signing certificates
```bash
security find-identity -v -p codesigning
```

### Inspect a provisioning profile
```bash
security cms -D -i "<PROFILE_PATH>" 2>/dev/null | /usr/libexec/PlistBuddy -c "Print :Name" /dev/stdin
security cms -D -i "<PROFILE_PATH>" 2>/dev/null | /usr/libexec/PlistBuddy -c "Print :Entitlements:application-identifier" /dev/stdin
security cms -D -i "<PROFILE_PATH>" 2>/dev/null | /usr/libexec/PlistBuddy -c "Print :ExpirationDate" /dev/stdin
```

### List connected devices
```bash
# via ios-deploy
ios-deploy -c --timeout 3

# via idevice_id (libimobiledevice)
idevice_id -l

# via Xcode instruments
xcrun xctrace list devices
```

### Check if IPA already contains WhiteNeedle
```bash
TMPDIR=$(mktemp -d)
unzip -q "<IPA_PATH>" -d "$TMPDIR"
APP=$(find "$TMPDIR/Payload" -maxdepth 1 -name "*.app" | head -1)
ls "$APP/Frameworks/" | grep -i whiteneedle && echo "Already injected" || echo "Not injected"
rm -rf "$TMPDIR"
```

## Troubleshooting

**Q: "WhiteNeedle.framework not found"**
确认 payload 目录中存在 WhiteNeedle.framework/，且内部包含 WhiteNeedle 可执行文件。

**Q: "insert_dylib not found"**
运行 Step 1 编译 insert_dylib。如果编译失败，确认已安装 Xcode Command Line Tools：
```bash
xcode-select --install
```

**Q: "No space for new load command"**
原 binary 的 Mach-O header 没有足够空间。insert_dylib 会尝试移除 LC_CODE_SIGNATURE 来腾出空间。如果仍然不够，需要使用其他工具（如 optool）或重新编译目标 app。

**Q: 重签名后安装失败 "Unable to install"**
- 检查描述文件是否包含目标设备 UDID
- 检查证书是否有效未过期
- 检查描述文件的 Bundle ID 是否匹配（或使用通配符 `*`）
- 尝试删除设备上的旧版本后重新安装

**Q: 保留 Extensions 失败**
App Extensions 需要单独的描述文件。使用 `-e` + `--ext-profile` 指定通配符描述文件，或使用 `--ext-profile-dir` 指定每个 extension 的独立描述文件。

**Q: 描述文件已过期**
重新从 Apple Developer Portal 下载或通过 Xcode 自动管理。更新后修改 `<SKILL_DIR>/config/deploy.conf` 中的 `PROVISION_PROFILE` 路径。

## Installation

To install this skill:

1. Copy the entire `whiteneedle-resign/` directory to the target skills directory:
   - **Cursor**: `~/.cursor/skills/whiteneedle-resign/`
   - **Claude Code**: `~/.claude/skills/whiteneedle-resign/`
2. Ensure scripts have execute permission: `chmod +x bin/resign.sh bin/insert_dylib`
3. Edit `config/deploy.conf` to fill in your signing certificate, provisioning profile, and device UDID
4. The `insert_dylib` binary will be auto-compiled from `bin/insert_dylib.c` on first use if missing

The complete directory structure:

```
whiteneedle-resign/
├── SKILL.md                    # Skill definition (this file)
├── bin/                        # Executables
│   ├── resign.sh               #   IPA resign + inject script
│   ├── insert_dylib            #   Mach-O patcher binary (pre-compiled)
│   └── insert_dylib.c          #   Mach-O patcher source (for cross-arch build)
├── config/                     # User configuration
│   └── deploy.conf             #   Signing cert, profile, device, etc.
└── payload/                    # Bundled artifacts
    └── WhiteNeedle.framework/  #   Pre-built framework
```
