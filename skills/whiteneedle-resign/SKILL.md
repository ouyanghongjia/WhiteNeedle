# WhiteNeedle IPA Resign Skill

将 WhiteNeedle.dylib 注入 IPA 并重签名，使其可以安装到 iOS 设备上进行调试。本 skill 自包含——resign.sh 和 insert_dylib.c 均在同一目录下。

Use when the user asks to resign an IPA, inject WhiteNeedle dylib, re-sign an app, prepare an IPA for debugging, deploy WhiteNeedle to an app, or install a debug-enabled IPA.

Trigger phrases: "resign IPA", "re-sign", "inject dylib", "重签名", "注入 dylib", "签名 IPA", "resign app", "deploy IPA", "install WhiteNeedle", "prepare IPA", "打包调试", "安装到设备".

## Setup

All tools are bundled alongside this SKILL.md. Determine this skill's directory from the `fullPath` used to read this file.

```
<SKILL_DIR>/resign.sh      # IPA resign + inject script
<SKILL_DIR>/insert_dylib.c  # Mach-O patcher source
```

Where `<SKILL_DIR>` is the directory containing this SKILL.md.

**Prerequisites:**
- macOS with Xcode Command Line Tools installed (`xcode-select --install`)
- A valid Apple developer certificate (Development or Enterprise)
- A matching provisioning profile (.mobileprovision) containing the target device UDID
- WhiteNeedle.dylib (pre-built)
- Optional: `ios-deploy` or `ideviceinstaller` for device installation

## Workflow

**IMPORTANT**: This skill requires user-provided parameters. You MUST collect ALL required parameters before executing any commands. Use the AskQuestion tool or direct conversation to gather them.

### Step 0: Gather Parameters

Ask the user for the following parameters. For each parameter, validate the file exists before proceeding.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| IPA 路径 | ✅ | 原始 IPA 文件路径 | `~/Downloads/MyApp.ipa` |
| 签名证书 | ✅ | codesign 签名身份 | `Apple Development: dev@example.com (TEAMID)` |
| 描述文件 | ✅ | .mobileprovision 文件路径 | `~/profiles/dev.mobileprovision` |
| Dylib 路径 | ✅ | WhiteNeedle.dylib 文件路径 | `~/WhiteNeedle.dylib` |
| 输出路径 | ❌ | 输出 IPA 路径（默认: `<input>_whiteneedle.ipa`） | `~/Desktop/MyApp_debug.ipa` |
| 保留扩展 | ❌ | 是否保留 App Extensions（默认: 否） | `true` / `false` |

**How to find the signing certificate:**
```bash
security find-identity -v -p codesigning
```

**How to find provisioning profiles:**
```bash
ls ~/Library/MobileDevice/Provisioning\ Profiles/
# Or check a specific profile:
security cms -D -i /path/to/profile.mobileprovision | grep -A1 "Name"
```

### Step 1: Compile insert_dylib (if needed)

Check if `insert_dylib` binary exists in the skill directory. If not, compile it:

```bash
SKILL_DIR="<SKILL_DIR>"
if [ ! -x "$SKILL_DIR/insert_dylib" ]; then
    echo "Compiling insert_dylib..."
    clang -o "$SKILL_DIR/insert_dylib" "$SKILL_DIR/insert_dylib.c"
    chmod +x "$SKILL_DIR/insert_dylib"
fi
```

### Step 2: Prepare Dylib Directory

The resign.sh script expects WhiteNeedle.dylib in a directory. Create a temp payload directory and copy the dylib:

```bash
PAYLOAD_DIR=$(mktemp -d)/payload
mkdir -p "$PAYLOAD_DIR"
cp "<DYLIB_PATH>" "$PAYLOAD_DIR/WhiteNeedle.dylib"
```

### Step 3: Execute Resign

```bash
bash "$SKILL_DIR/resign.sh" \
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

If the user wants to install directly, ask for:
- Device UDID (optional, defaults to first connected device)
- Install tool preference: `ios-deploy` (default) or `ideviceinstaller`

```bash
# Using ios-deploy
ios-deploy --bundle "<OUTPUT_IPA>"

# Using ideviceinstaller
ideviceinstaller -i "<OUTPUT_IPA>"

# With specific device UDID
ios-deploy --bundle "<OUTPUT_IPA>" --id "<DEVICE_UDID>"
```

## Complete Example Session

Here's how a typical interaction should flow:

```
User: 帮我重签名一个 IPA

AI: 我需要以下信息来执行重签名：
    1. IPA 文件路径
    2. 签名证书（运行 security find-identity -v -p codesigning 查看可用证书）
    3. 描述文件路径 (.mobileprovision)
    4. WhiteNeedle.dylib 路径

User: IPA 在 ~/Downloads/MyApp.ipa，证书是 "Apple Development: test@dev.com (ABC123)"，
      描述文件在 ~/profiles/dev.mobileprovision，dylib 在 ~/WhiteNeedle.dylib

AI: [验证所有文件存在]
    [编译 insert_dylib（如需）]
    [执行 resign.sh]
    重签名完成！输出文件: ~/Downloads/MyApp_whiteneedle.ipa (25.3 MB)
    是否需要安装到设备？
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

**Q: "WhiteNeedle.dylib not found"**
确认提供的 dylib 路径正确，且文件存在。

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

## Installation

To install this skill:

1. Copy the entire `whiteneedle-resign/` directory to the target skills directory:
   - **Cursor**: `~/.cursor/skills/whiteneedle-resign/`
   - **Claude Code**: `~/.claude/skills/whiteneedle-resign/`
2. Ensure `resign.sh` has execute permission: `chmod +x resign.sh`
3. The `insert_dylib` binary will be auto-compiled on first use.
