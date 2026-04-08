# UserDefaults — 偏好设置管理

`UserDefaults` 命名空间提供对 `NSUserDefaults` 的完整读写能力，支持多 Suite 管理，适用于调试应用配置和持久化数据。

## API

### `UserDefaults.suites()`

列出沙盒 `Library/Preferences` 目录下所有可用的 plist 套件。

```javascript
var suites = UserDefaults.suites();
suites.forEach(function(s) {
    console.log(s.suiteName, s.keyCount + " keys", s.isDefault ? "(default)" : "");
});
```

**返回值**：`SuiteInfo[]`

| 字段 | 说明 |
|------|------|
| `suiteName` | plist 文件名（不含 `.plist`） |
| `name` | 与 `suiteName` 相同 |
| `isDefault` | 是否为当前 App 的 bundleId 对应套件 |
| `keyCount` | plist 根级键数量（读取失败时为 `0`） |

### `UserDefaults.getAll(suiteName?)`

获取指定套件的所有键值对（**包含** Apple/系统内部键）。省略 `suiteName` 则使用 `standardUserDefaults`。

```javascript
var all = UserDefaults.getAll();
console.log("Keys:", Object.keys(all).length);

var appGroup = UserDefaults.getAll("group.com.example.shared");
```

**返回值**：`Record<string, any>`

### `UserDefaults.getAllApp(suiteName?)`

获取指定套件中 **仅属于应用** 的键值对。自动过滤 `Apple*`、`NS*`、`WebKit*`、`com.apple.*` 等系统内部键前缀，让你只看到业务相关的数据。

```javascript
var appData = UserDefaults.getAllApp();
console.log("App keys:", Object.keys(appData).length);
```

**返回值**：`Record<string, any>`

### `UserDefaults.systemKeyPrefixes()`

返回当前使用的系统键前缀过滤列表。

```javascript
var prefixes = UserDefaults.systemKeyPrefixes();
// ["Apple", "NS", "AK", "com.apple.", "WebKit", ...]
```

**返回值**：`string[]`

### `UserDefaults.isSystemKey(key)`

判断一个键是否被视为系统键。

```javascript
UserDefaults.isSystemKey("AppleLanguages");  // true
UserDefaults.isSystemKey("user_token");      // false
```

**返回值**：`boolean`

### `UserDefaults.get(key, suiteName?)`

读取单个键的值。

```javascript
var token = UserDefaults.get("auth_token");
var theme = UserDefaults.get("theme", "com.example.settings");
```

**返回值**：键对应的值，不存在返回 `null`

### `UserDefaults.set(key, value, suiteName?)`

写入值。传 `null` 或 `undefined` 等同于 `remove`。

```javascript
UserDefaults.set("debug_enabled", true);
UserDefaults.set("api_url", "https://staging.example.com");
UserDefaults.set("custom_key", "value", "com.example.custom");
```

**返回值**：`boolean`

### `UserDefaults.remove(key, suiteName?)`

删除指定键。

```javascript
UserDefaults.remove("debug_enabled");
```

**返回值**：`boolean`

### `UserDefaults.clear(suiteName?)`

清空指定套件的所有键值。

```javascript
UserDefaults.clear("com.example.temp");
```

## 注意事项

- `NSData` 类型的值会显示为 `"<NSData N bytes>"` 字符串
- `NSDate` 类型的值会转为日期描述字符串
- `suiteName` 参数省略时默认为应用的 `bundleIdentifier`
- `getAllApp()` 过滤的系统键前缀包括：`Apple`、`NS`、`AK`、`com.apple.`、`WebKit`、`PK`、`IN`、`MultiPath`、`_`、`LS`、`CK`、`MF`、`MT`、`SB`、`UIKit`、`MSV`
- 如需查看完整数据（含系统键），使用 `getAll()`；面板中可通过 "Hide system keys" 复选框切换
