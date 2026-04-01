# WhiteNeedle 开发规范

> 记录开发过程中踩过的坑和必须遵守的规范，避免重复犯错。
> 最后更新：2026-04-01

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

## 三、ObjC Runtime Hook 规范

### 3.1 class_replaceMethod 对继承方法返回 NULL（严重级别：P0）

**规则：使用 `class_replaceMethod` swizzle 方法时，必须在替换前通过 `class_getInstanceMethod` + `method_getImplementation` 保存原始 IMP。不能依赖 `class_replaceMethod` 的返回值来获取原始实现。**

**原因**：`class_replaceMethod` 只在目标类**自身**实现了该方法时返回旧 IMP。如果方法是从父类**继承**来的（未被 override），则返回 **NULL**。大多数类不会 override `methodSignatureForSelector:` 和 `forwardInvocation:`（继承自 NSObject），因此直接用返回值作为原始 IMP 必然为 NULL。

**出过的事故**：`WNHookEngine.m` 的 `ensureClassHooked:` 中，用 `class_replaceMethod` 的返回值保存 `origMethodSignatureForSelector`。当 `WNBlockTestHelper`（继承自 NSObject，未 override 该方法）被 hook 后，所有**未被 hook 的方法**调用 `methodSignatureForSelector:` 时走到 fallback 分支 `return nil`，导致 `invoke` 静默失败——`sig` 为 nil，方法完全无法调用。

```objc
// ✗ 错误：class_replaceMethod 对继承方法返回 NULL
state.origMethodSignatureForSelector = class_replaceMethod(cls, sigSel, newIMP, typeEnc);
// origMethodSignatureForSelector == NULL → fallback 时 return nil

// ✓ 正确：替换前先保存当前 IMP（无论自身实现还是继承的）
Method m = class_getInstanceMethod(cls, sigSel);
IMP origIMP = m ? method_getImplementation(m) : NULL;
class_replaceMethod(cls, sigSel, newIMP, typeEnc);
state.origMethodSignatureForSelector = origIMP;  // 始终非 NULL
```

**影响范围**：所有通过 `Interceptor.attach` hook 某个类的方法后，该类上**未被 hook 的其他方法**全部无法通过 `invoke()` 调用。

### 3.2 method_setImplementation 与消息转发

当 hook 一个方法后将其 IMP 设为 `_objc_msgForward`，ObjC runtime 会走消息转发流程：`methodSignatureForSelector:` → `forwardInvocation:`。必须同时 swizzle 这两个方法，且确保对未被 hook 的 selector 能正确回退到原始实现。

---

## 四、ObjC Bridge JS API 规范

### 4.1 ObjC.use() 代理只支持 invoke()（严重级别：P1）

**规则：`ObjC.use()` 返回的代理对象不支持直接调用 ObjC 方法名（如 `.alloc()`、`.init()`）。所有操作必须通过 `.invoke("selector:", [args])` 进行。**

**出过的事故**：测试脚本中写了 `ObjC.use("NSMutableArray").alloc().init()`，运行时报 `NSMutableArray.alloc is not a function`。

```javascript
// ✗ 错误：代理对象没有 alloc/init 等方法
var arr = ObjC.use("NSMutableArray").alloc().init();

// ✓ 正确：通过 invoke 调用工厂方法
var arr = ObjC.use("NSMutableArray").invoke("array");

// ✓ 正确：如果需要 alloc + init 流程
var arr = ObjC.use("NSMutableArray").invoke("alloc");
arr = arr.invoke("init");
```

### 4.2 invoke 参数中 WNBoxing/WNObjCProxy 无法转 JSValue（严重级别：P0）

**规则：`invokeSelector:` 的参数循环中，必须在转 JSValue 之前先处理 `WNBoxing` 和 `WNObjCProxy` 类型，直接解包后设置到 NSInvocation，不能走 `[JSValue valueWithObject:]` 通道。**

**原因**：`[argsArray toArray]` 将 JS 参数数组转为 NSArray 后，其中的 `$block()` 返回值会变成 `WNBoxing`（包裹 `__NSMallocBlock__`），`ObjC.use()` 创建的代理会变成 `WNObjCProxy`。这两个类型传给 `[JSValue valueWithObject:inContext:]` 时，JSC 无法转换，返回 **nil**。后续用 nil JSValue 设置 NSInvocation 参数直接崩溃。

**出过的事故**：调用 `helper.invoke("enumerateItems:withBlock:", [arr, blk])` 时，`arr`（WNObjCProxy）和 `blk`（WNBoxing）都走到 `[JSValue valueWithObject:]` 分支，jsValue 为 nil，崩溃在 `setArgument:atIndex:` 处。

```objc
// ✗ 崩溃：WNBoxing/WNObjCProxy 无法通过 valueWithObject 转为 JSValue
jsValue = [JSValue valueWithObject:jsArg inContext:context]; // → nil!
[WNTypeConversion convertJSValue:jsValue ...];              // → 崩溃

// ✓ 正确：优先处理桥接类型，直接解包
if ([jsArg isKindOfClass:[WNBoxing class]]) {
    WNBoxing *box = (WNBoxing *)jsArg;
    id unboxed = box.isPointer ? nil : [box unbox];
    *(void **)argBuf = box.isPointer ? [box unboxPointer] : (__bridge void *)unboxed;
    [invocation setArgument:argBuf atIndex:i + 2]; free(argBuf); continue;
}
if ([jsArg isKindOfClass:[WNObjCProxy class]]) {
    id target = [(WNObjCProxy *)jsArg target];
    *(void **)argBuf = (__bridge void *)target;
    [invocation setArgument:argBuf atIndex:i + 2]; free(argBuf); continue;
}
```

### 4.3 invoke 参数中嵌套 JS 数组的歧义（严重级别：P1）

**规则：当 OC 方法的参数类型为 NSArray 时，不要在 invoke 的参数数组中直接嵌套 JS 数组字面量。应通过 ObjC 桥创建 NSArray/NSMutableArray 对象后传递。**

**原因**：`invoke("sel:", [arg1, arg2])` 的第二个参数本身就是一个参数数组。如果 `arg1` 也是一个 JS 数组（如 `[["a", "b"], block]`），桥接层可能无法区分"嵌套的参数"和"数组类型的参数值"，导致方法调用静默失败。

```javascript
// ✗ 可能出问题：JS 数组嵌套在参数数组中
helper.invoke("enumerateItems:withBlock:", [["apple", "banana"], blk]);

// ✓ 安全：通过 ObjC 桥创建 NSArray
var arr = ObjC.use("NSMutableArray").invoke("array");
arr.invoke("addObject:", ["apple"]);
arr.invoke("addObject:", ["banana"]);
helper.invoke("enumerateItems:withBlock:", [arr, blk]);
```

---

## 五、CocoaPods / Podspec 规范

### 5.1 source_files 必须包含汇编文件（严重级别：P0）

**规则：当 Pod 包含需要编译的汇编文件（`.S`）时，`s.source_files` 的 glob 模式必须显式包含 `.S` 扩展名。**

**出过的事故**：集成 `libffi` 后，`WhiteNeedle.podspec` 的 `s.source_files` 为 `'Sources/**/*.{h,hpp,m,mm,c,cpp}'`，遗漏了 `.S`。导致 `sysv_arm64.S`（libffi 的 ARM64 汇编入口）未被编译，链接阶段报 `Undefined symbols: _ffi_call_SYSV, _ffi_closure_SYSV, _ffi_bridge_data_page1`。

```ruby
# ✗ 错误：遗漏 .S 汇编文件
s.source_files = 'Sources/**/*.{h,hpp,m,mm,c,cpp}'

# ✓ 正确：包含 .S
s.source_files = 'Sources/**/*.{h,hpp,m,mm,c,cpp,S}'
```

### 5.2 #include 文件不能被 glob 重复编译（严重级别：P1）

**规则：如果某个 `.c` 文件是通过 `#include` 被另一个 `.c` 文件包含的（而非独立编译单元），必须通过 `s.exclude_files` 将其排除，否则会产生 duplicate symbol 错误。**

**出过的事故**：libffi 的 `closures.c` 通过 `#include "dlmalloc.c"` 包含了 `dlmalloc.c`。但 `s.source_files` 的 glob 同时匹配了 `dlmalloc.c`，导致它被编译了两次。

```ruby
s.exclude_files = 'Sources/libffi/src/dlmalloc.c',   # 被 closures.c #include
                  'Sources/libffi/src/debug.c',       # 不需要
                  'Sources/libffi/src/java_raw_api.c', # 不需要
                  'Sources/libffi/src/raw_api.c'       # 不需要
```

### 5.3 pod_target_xcconfig 头文件搜索路径

当第三方 C 库的头文件使用 `#include "xxx.h"`（引号形式）相互引用时，需要在 `pod_target_xcconfig` 中设置 `HEADER_SEARCH_PATHS`，而非依赖 `s.header_dir`。路径变量使用 `${PODS_TARGET_SRCROOT}` 指向 Pod 源码根目录。

```ruby
s.pod_target_xcconfig = {
  'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/Sources/libffi/include" ' \
                           '"${PODS_TARGET_SRCROOT}/Sources/libffi/src"'
}
```

---

## 六、Block Bridge 开发规范

### 6.1 $blockSig 签名解析器对嵌套 block 的处理（严重级别：P2）

**规则：`WNBlockSignatureParser` 的 `scanParameterEncoding` 在扫描到一个类型关键字后，需要前瞻检查后续是否跟着 `(^)` 模式，以识别 `返回类型 (^)(参数...)` 格式的嵌套 block 参数。**

**出过的事故**：`$blockSig("void (^)(id, void (^)(double))")` 返回 null。第二个参数 `void (^)(double)` 以 `void` 关键字开头，原有逻辑只检查是否以 `(^` 开头来识别嵌套 block，因此将 `void` 解析为普通类型后因剩余 `(^)(double))` 无法匹配 `,` 或 `)` 而报错。

```objc
// 修复：扫描到关键字后前瞻检查 (^) 模式
if ([self scanKeywordEncoding:sc into:&keyEnc error:nil]) {
    NSUInteger afterKeyword = sc.scanLocation;
    skipWS(sc);
    if (!sc.isAtEnd && [sc scanString:@"(" intoString:NULL]) {
        skipWS(sc);
        if ([sc scanString:@"^" intoString:NULL]) {
            sc.scanLocation = pos;  // 回退，当作嵌套 block 解析
            return [self scanBlockParameterEncoding:sc into:outEnc error:error];
        }
    }
    // ...
}
```

### 6.2 UIKit 类型需要显式 import（严重级别：P2）

在使用 `@encode(UIEdgeInsets)` 等 UIKit 结构体编码时，源文件必须 `#import <UIKit/UIKit.h>`，否则编译报 `unknown type name 'UIEdgeInsets'`。CoreGraphics 类型（CGRect 等）只需 `#import <CoreGraphics/CoreGraphics.h>`。

---

## 七、检查清单

### Webview 面板提交前：

- [ ] CSP 策略已设置（`script-src 'nonce-${nonce}'`）
- [ ] `<script>` 标签包含 `nonce="${nonce}"` 属性
- [ ] 无任何 `onclick`、`onchange`、`onsubmit` 等内联事件属性
- [ ] 所有事件绑定使用 `addEventListener`
- [ ] 动态生成的 HTML 中的按钮也通过 `addEventListener` 绑定
- [ ] iOS 返回的字段名与 JS 中使用的字段名一致

### ObjC Runtime Hook 提交前：

- [ ] `class_replaceMethod` 前已用 `method_getImplementation` 保存原始 IMP
- [ ] swizzle 的 fallback 分支对未 hook 的 selector 正确回退到原始实现
- [ ] hook 后测试了同一个类上**未被 hook 的其他方法**是否仍能正常调用

### Podspec 修改提交前：

- [ ] `source_files` glob 覆盖了所有需要编译的文件类型（.h .m .c .cpp .S 等）
- [ ] 被 `#include` 包含的 `.c` 文件已通过 `exclude_files` 排除
- [ ] `HEADER_SEARCH_PATHS` 覆盖了所有 C 库的头文件目录
- [ ] 修改后执行了 `pod install` + 完整编译验证

### invoke 参数处理修改提交前：

- [ ] `WNBoxing` 和 `WNObjCProxy` 在 JSValue 转换之前优先处理
- [ ] WNBoxing 区分 `isPointer` 走 `unboxPointer` vs `unbox`
- [ ] WNObjCProxy 直接取 `target` 设置到 NSInvocation

### JS 测试脚本编写规范：

- [ ] ObjC 对象操作统一使用 `.invoke("selector:", [args])`
- [ ] NSArray 参数通过 ObjC 桥创建，不直接嵌套 JS 数组字面量
- [ ] Block 签名使用 ObjC type encoding 格式（如 `"v@?@d"`）
