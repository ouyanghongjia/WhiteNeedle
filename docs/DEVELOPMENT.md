# WhiteNeedle VS Code Extension 开发规范

> 记录开发过程中踩过的坑和必须遵守的规范，避免重复犯错。
> 最后更新：2026-03-31

---

## 一、Webview 面板开发规范

### 1.1 CSP 与事件绑定（严重级别：P0）

**规则：在设置了 Content-Security-Policy 的 Webview 中，禁止使用内联事件处理器（`onclick`、`onchange` 等 HTML 属性）。必须使用 `addEventListener`。**

**背景**：VS Code Webview 要求通过 `nonce` 机制保护脚本执行安全。CSP 策略 `script-src 'nonce-xxx'` 只允许带有匹配 `nonce` 的 `<script>` 标签执行，所有内联事件处理器（`onclick="..."`）都被视为内联脚本，会被 CSP 静默阻止。

**出过的事故**：`hostMappingPanel.ts` 的模态框 Cancel 按钮使用了 `onclick="..."`，被 CSP 阻止后无法关闭模态框。模态框遮罩层（`position: fixed` 覆盖全屏）挡住了下方所有按钮，导致整个面板看似"所有按钮无法响应"。

**正确写法**：

```html
<!-- ✗ 错误：内联 onclick 被 CSP 阻止 -->
<button onclick="doSomething()">Click</button>

<!-- ✓ 正确：通过 addEventListener 绑定 -->
<button id="myBtn">Click</button>
```

```javascript
// 在带有 nonce 的 <script> 块中绑定事件
document.getElementById('myBtn').addEventListener('click', () => {
    doSomething();
});
```

**动态生成 HTML 时的处理**（如模态框 innerHTML）：

```javascript
// ✗ 错误
modalContent.innerHTML = '...<button onclick="closeModal()">Cancel</button>...';

// ✓ 正确：先设置 innerHTML，再用 addEventListener 绑定
modalContent.innerHTML = '...<button id="mCancel">Cancel</button>...';
document.getElementById('mCancel').addEventListener('click', closeModal);
```

**存量问题**：以下面板使用了内联 `onclick` 但未设置 CSP，当前能工作但应在后续统一修复：
- `sandboxPanel.ts`：文件导航、下载、删除按钮（8处）
- `objcPanel.ts`：分组折叠、类展开、方法 Trace 按钮（3处）

### 1.2 Webview 面板标准模板

所有新面板应遵循以下结构：

```typescript
private getHtmlContent(): string {
    const nonce = getNonce();
    return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>/* CSS here */</style>
</head>
<body>
<!-- HTML here, 不使用任何 onclick/onchange 等内联事件 -->
<script nonce="${nonce}">
(function() {
    const vscode = acquireVsCodeApi();
    // 所有事件绑定只使用 addEventListener
    document.getElementById('btn').addEventListener('click', handler);
})();
</script>
</body>
</html>`;
}
```

### 1.3 面板间数据字段命名一致性

iOS 端 RPC 返回的数据字段名要与 Webview JS 中使用的字段名完全一致。

**出过的事故**：iOS 端 `WNHostGroup.toDictionary` 用 `"id"` 作为 key，但 Webview JS 中错误地使用了 `g.groupId` 来查找分组，导致分组选中、切换等功能失效。

**规则**：新增 RPC 接口时，先在 iOS 端确认 `toDictionary` / `summaryDict` 的 key 名，再编写 Webview JS，保持完全一致。

---

## 二、iOS 侧开发规范

### 2.1 fishhook 使用注意事项

- `fishhook` 只能 hook 当前进程通过动态链接器加载的符号
- 系统库函数（如 `getaddrinfo`）始终可被 hook（它们来自 `libsystem_info.dylib` 等系统动态库）
- 第三方静态库中的函数如果不通过动态链接器解析，则无法被 hook（如静态链接的 `libcurl`）
- 使用 `dlsym(RTLD_DEFAULT, "symbol_name")` 在 hook 前检查符号是否可用，提供优雅降级

### 2.2 数据持久化路径

所有 WhiteNeedle 的持久化数据存放到 `Library/WhiteNeedle/` 目录下，**不要**使用 `Documents` 目录（宿主 App 可能对 Documents 有清洁性要求）。

---

## 三、检查清单

新建或修改 Webview 面板时，提交前检查：

- [ ] CSP 策略已设置（`script-src 'nonce-${nonce}'`）
- [ ] `<script>` 标签包含 `nonce="${nonce}"` 属性
- [ ] 无任何 `onclick`、`onchange`、`onsubmit` 等内联事件属性
- [ ] 所有事件绑定使用 `addEventListener`
- [ ] 动态生成的 HTML 中的按钮也通过 `addEventListener` 绑定
- [ ] iOS 返回的字段名与 JS 中使用的字段名一致
