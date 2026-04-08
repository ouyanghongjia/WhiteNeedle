# FileSystem — 沙盒文件操作

`FileSystem` 命名空间提供对应用沙盒目录的文件操作能力。沙盒根为 `NSHomeDirectory()`（与只读属性 `FileSystem.home` 一致）。

## 路径解析（与实现一致）

实现见 `WNFileSystemBridge.m` 中的 `WNFSAbsolutePath`：

1. **空路径**：视为沙盒根（标准化后的 `NSHomeDirectory()`）。
2. **已是沙盒内的绝对路径**：若标准化后的路径以沙盒根为前缀，则直接使用（不二次拼接）。
3. **以 `/` 开头的路径**：去掉首字符 `/` 后，拼在沙盒根后面。即 **`/Documents/foo` 表示沙盒下的 `Documents/foo`**，不是文件系统根目录。
4. **不以 `/` 开头的路径**：相对沙盒根拼接（如 `Documents/foo`）。

因此：`FileSystem.read("Documents/x")` 与 `FileSystem.read("/Documents/x")` 通常指向同一文件。

## API

### `FileSystem.home`

沙盒根目录的绝对路径（只读属性）。

```javascript
console.log("Sandbox:", FileSystem.home);
// → /var/mobile/Containers/Data/Application/XXXXXXXX-...
```

### `FileSystem.list(path?)`

列出目录内容及文件属性。

```javascript
var docs = FileSystem.list("Documents");
docs.forEach(function(f) {
    console.log(f.name, f.isDir ? "[DIR]" : f.size + " bytes");
});

// 列出沙盒根目录
var root = FileSystem.list();
```

**返回值**：`FileEntry[]`

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 文件/目录名 |
| `path` | string | 相对路径 |
| `isDir` | boolean | 是否为目录 |
| `size` | number | 文件大小（字节） |
| `mtime` | number | 修改时间（毫秒时间戳） |
| `ctime` | number | 创建时间（毫秒时间戳） |

### `FileSystem.read(path)`

以 UTF-8 编码读取文件内容。

```javascript
var content = FileSystem.read("Documents/config.json");
if (content) {
    var config = JSON.parse(content);
    console.log("Config:", config);
}
```

**返回值**：`string | null`

### `FileSystem.readBytes(path)`

以 Base64 编码读取文件内容，适用于二进制文件。

```javascript
var b64 = FileSystem.readBytes("Documents/image.png");
```

**返回值**：`string | null`（Base64 编码）

### `FileSystem.write(path, content)`

将 UTF-8 文本写入文件，自动创建中间目录。

```javascript
FileSystem.write("Documents/log.txt", "Hello from WhiteNeedle");
FileSystem.write("Documents/deep/nested/file.json", JSON.stringify({key: "value"}));
```

**返回值**：`boolean`

### `FileSystem.exists(path)`

检查路径是否存在。

```javascript
var info = FileSystem.exists("Documents/config.json");
console.log("Exists:", info.exists, "Is dir:", info.isDir);
```

**返回值**：`{ exists: boolean, isDir: boolean }`

### `FileSystem.stat(path)`

获取文件/目录的详细属性。

```javascript
var s = FileSystem.stat("Documents/data.db");
if (s) {
    console.log("Size:", s.size, "Type:", s.type);
}
```

**返回值**：`FileStat | null`

| 字段 | 类型 | 说明 |
|------|------|------|
| `size` | number | 字节大小 |
| `type` | string | NSFileType（如 "NSFileTypeRegular"） |
| `mtime` | number | 修改时间（毫秒时间戳） |
| `ctime` | number | 创建时间（毫秒时间戳） |
| `owner` | string | 文件所有者 |
| `permissions` | string | POSIX 权限（如 "644"） |

### `FileSystem.remove(path)`

删除文件或空目录。

```javascript
FileSystem.remove("Documents/temp.txt");
```

**返回值**：`boolean`

### `FileSystem.mkdir(path)`

创建目录，含中间目录。

```javascript
FileSystem.mkdir("Documents/cache/images");
```

**返回值**：`boolean`
