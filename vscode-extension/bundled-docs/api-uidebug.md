# UIDebug — UI 调试工具

`UIDebug` 命名空间提供视图层级检查、截图和 ViewController 导航等 UI 调试能力。所有 UI 操作均在主线程同步执行。

## API

### `UIDebug.keyWindow()`

获取当前 Key Window 的基本信息。

```javascript
var win = UIDebug.keyWindow();
if (win) {
    console.log("Window:", win.class, win.frame);
}
```

**返回值**：`{ class, frame, address } | null`

### `UIDebug.viewHierarchy()`

获取完整的视图层级树（递归，最大深度 20）。

```javascript
var tree = UIDebug.viewHierarchy();
console.log(JSON.stringify(tree, null, 2));
```

树节点结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| `class` | string | 视图类名 |
| `address` | string | 内存地址 |
| `frame` | string | CGRect 描述 |
| `hidden` | boolean | 是否隐藏 |
| `alpha` | number | 透明度 |
| `text` | string | UILabel 的文本（仅 UILabel） |
| `title` | string | UIButton 的标题（仅 UIButton） |
| `imageSize` | string | UIImageView 图片尺寸（仅 UIImageView） |
| `subviews` | ViewNode[] | 子视图数组 |

### `UIDebug.screenshot()`

截取 Key Window 的完整屏幕截图。

```javascript
var png = UIDebug.screenshot();
if (png) {
    console.log("Screenshot size:", png.length, "chars (base64)");
    // 可通过远程接口传回 PC 查看
}
```

**返回值**：`string | null`（Base64 编码的 PNG）

### `UIDebug.screenshotView(address)`

截取指定视图的截图。地址可从 `viewHierarchy()` 获取。

```javascript
var tree = UIDebug.viewHierarchy();
var addr = tree.subviews[0].address;
var viewPng = UIDebug.screenshotView(addr);
```

**返回值**：`string | null`（Base64 编码的 PNG）

### `UIDebug.bounds(address)`

获取指定视图的布局信息。

```javascript
var info = UIDebug.bounds("0x1234abcd");
if (info) {
    console.log("Frame:", info.frame);
    console.log("Hidden:", info.hidden, "Alpha:", info.alpha);
}
```

**返回值**：`{ frame, bounds, center, hidden, alpha } | null`

### `UIDebug.viewControllers()`

获取当前的 ViewController 层级列表，包含 UINavigationController、UITabBarController、presented VC 的递归展开。

```javascript
var vcs = UIDebug.viewControllers();
vcs.forEach(function(vc) {
    var indent = "  ".repeat(vc.depth);
    console.log(indent + vc.class, vc.title ? "(" + vc.title + ")" : "");
});
```

**返回值**：`ViewControllerInfo[]`

| 字段 | 类型 | 说明 |
|------|------|------|
| `class` | string | VC 类名 |
| `title` | string | 导航标题 |
| `address` | string | 内存地址 |
| `depth` | number | 层级深度（0 为根） |

## 安全说明

- `screenshotView(address)` 和 `bounds(address)` 接受内存地址参数，请确保传入的地址指向有效的 `UIView` 对象
- 所有 UI 操作通过 `dispatch_sync(dispatch_get_main_queue())` 在主线程执行
