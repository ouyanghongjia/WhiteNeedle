# Cookies — HTTP Cookie 管理

`Cookies` 命名空间提供对 `NSHTTPCookieStorage` 的读写操作，适用于调试 WebView、网络请求中的 Cookie 状态。

## API

### `Cookies.getAll(domain?)`

获取所有 Cookie，可按域名后缀过滤。

```javascript
var all = Cookies.getAll();
console.log("Cookie count:", all.length);

var google = Cookies.getAll(".google.com");
```

**返回值**：`CookieInfo[]`

### `Cookies.get(name, domain?)`

获取指定名称的单个 Cookie。

```javascript
var session = Cookies.get("session_id", ".example.com");
if (session) {
    console.log("Session:", session.value);
}
```

**返回值**：`CookieInfo | null`

### `Cookies.set(properties)`

添加或更新一个 Cookie。

```javascript
Cookies.set({
    name: "debug_token",
    value: "abc123",
    domain: ".example.com",
    path: "/",
    isSecure: false,
    expires: Date.now() / 1000 + 86400  // 1 天后过期
});
```

**参数**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | Cookie 名称 |
| `value` | string | ✅ | Cookie 值 |
| `domain` | string | ✅ | 所属域名 |
| `path` | string | ❌ | 路径，默认 `"/"` |
| `isSecure` | boolean | ❌ | 仅 HTTPS |
| `isHTTPOnly` | boolean | ❌ | 仅 HTTP 访问 |
| `expires` | number | ❌ | 过期时间（Unix 时间戳，秒） |
| `sameSite` | string | ❌ | SameSite 策略（iOS 13+） |

**返回值**：`boolean`

### `Cookies.remove(name, domain)`

删除指定的 Cookie。

```javascript
Cookies.remove("debug_token", ".example.com");
```

**返回值**：`boolean`

### `Cookies.clear()`

清除所有 Cookie。

```javascript
Cookies.clear();
```

## CookieInfo 结构

```typescript
{
    name: string;
    value: string;
    domain: string;
    path: string;
    isSecure: boolean;
    isHTTPOnly: boolean;
    isSessionOnly: boolean;
    expires?: number;      // Unix 时间戳（秒）
    sameSite?: string;     // iOS 13+
}
```
