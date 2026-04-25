# WNAuto — UI 自动化库

`WNAuto` 是 WhiteNeedle **内置模块**，集成 WhiteNeedle 后即可直接使用，无需额外安装。

```javascript
var WNAuto = require('wn-auto');
```

通过直接调用 Objective-C 方法来实现 UI 交互，跳过传统的坐标模拟和辅助功能 API，提供更快、更稳定的自动化能力。

## 核心优势

| 维度 | 传统方案（XCUITest / Appium） | WNAuto |
|------|------|------|
| 交互方式 | 坐标点击 / 辅助功能树 | 直接方法调用 |
| 稳定性 | 受布局/动画/键盘影响 | 不受 UI 渲染影响 |
| 速度 | 需等待渲染完成 | 即时执行 |
| 覆盖范围 | 仅可见/可交互元素 | 所有 ObjC 对象 |
| 按钮点击 | 模拟触摸事件链 | `sendActionsForControlEvents:` |
| 文本输入 | 模拟键盘逐字输入 | `setText:` + 通知 |
| 滚动 | 模拟拖拽手势 | `setContentOffset:animated:` |

## 快速开始

```javascript
// 查找并点击按钮
var loginBtn = WNAuto.find.byText('Login')[0];
WNAuto.tap(loginBtn);

// 输入文本
var emailField = WNAuto.find.byClass('UITextField')[0];
WNAuto.type(emailField, 'user@example.com');

// 等待结果
WNAuto.find.waitForText('Welcome', { timeout: 5000 });

// 截图
var screenshot = WNAuto.screenshot.full();
```

---

## 查找 API — `WNAuto.find`

### find.byClass(className, [root])

按 UIKit 类名搜索视图（递归遍历整个视图树）。

```javascript
var buttons = WNAuto.find.byClass('UIButton');
var labels = WNAuto.find.byClass('UILabel');
var tableViews = WNAuto.find.byClass('UITableView');
```

### find.byText(text, [root])

按文本内容搜索（大小写不敏感的包含匹配）。自动检查 UILabel.text、UIButton.currentTitle、UITextField.text/placeholder、UITextView.text。

```javascript
var loginBtns = WNAuto.find.byText('Login');
var errorLabels = WNAuto.find.byText('error');
```

### find.byId(identifier, [root])

按 `accessibilityIdentifier` 搜索（精确匹配）。

```javascript
var submitBtn = WNAuto.find.byId('submit_button')[0];
```

### find.byLabel(label, [root])

按 `accessibilityLabel` 搜索（包含匹配）。

```javascript
var closeBtn = WNAuto.find.byLabel('Close')[0];
```

### find.byTag(tag, [root])

按视图 `tag` 属性搜索。

```javascript
var views = WNAuto.find.byTag(100);
```

### find.where(criteria, [root])

组合条件搜索，支持多个条件同时匹配。

```javascript
var results = WNAuto.find.where({
    class: 'UILabel',       // 类名
    text: 'Error',          // 文本包含
    visible: true           // 仅可见
});

var btns = WNAuto.find.where({
    class: 'UIButton',
    id: 'login_btn'         // accessibilityIdentifier
});
```

criteria 支持的字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `class` | string | 精确类名匹配 |
| `text` | string | 文本包含（不区分大小写） |
| `id` | string | accessibilityIdentifier 精确匹配 |
| `label` | string | accessibilityLabel 包含匹配 |
| `tag` | number | view.tag 精确匹配 |
| `visible` | boolean | 是否可见（hidden=false 且 alpha>0） |

### find.topViewController()

获取当前最顶层的 ViewController。

```javascript
var topVC = WNAuto.find.topViewController();
var cn = WNAuto.props.className(topVC);
```

### find.viewControllers()

获取完整的 ViewController 层级。

---

## 等待 API

### find.waitFor(conditionFn, [opts])

等待条件满足，轮询直到 conditionFn 返回 truthy。

```javascript
var found = WNAuto.find.waitFor(function() {
    return WNAuto.find.byText('Success').length > 0;
}, { timeout: 10000, interval: 200 });
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `timeout` | 10000 | 超时毫秒数 |
| `interval` | 200 | 轮询间隔 |
| `message` | '' | 超时时的日志信息 |

### find.waitForText(text, [opts])

等待指定文本出现在视图树中。

```javascript
WNAuto.find.waitForText('Welcome', { timeout: 5000 });
```

### find.waitForClass(className, [opts])

等待指定类的视图出现。

```javascript
WNAuto.find.waitForClass('MyCustomView', { timeout: 3000 });
```

---

## 操作 API

### WNAuto.tap(viewOrAddress)

点击控件。对 UIControl 子类调用 `sendActionsForControlEvents:` (TouchUpInside)；对非 UIControl 触发 TapGestureRecognizer。

```javascript
WNAuto.tap(button);
WNAuto.tap('0x12345678');  // 支持地址字符串
```

### WNAuto.doubleTap(viewOrAddress)

双击控件。

### WNAuto.longPress(viewOrAddress, [duration])

长按控件，触发 UILongPressGestureRecognizer。

```javascript
WNAuto.longPress(cell, 1.0);  // 长按 1 秒
```

### WNAuto.type(viewOrAddress, text, [opts])

在文本输入框中输入文字。支持 UITextField、UITextView、UISearchBar。

```javascript
WNAuto.type(textField, 'Hello World');
WNAuto.type(textField, ' appended', { append: true });
WNAuto.type(textField, 'silent', { triggerEvents: false });
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `append` | false | 追加到现有文本 |
| `triggerEvents` | true | 触发 UITextField/UITextView 通知和事件 |

**触发的事件：**
- UITextField: `UITextFieldTextDidChangeNotification` + `UIControlEventEditingChanged`
- UITextView: `UITextViewTextDidChangeNotification` + `delegate.textViewDidChange:`

### WNAuto.clearText(viewOrAddress)

清空文本输入框。

### WNAuto.scroll(viewOrAddress, offset, [animated])

设置 UIScrollView 的 contentOffset。

```javascript
WNAuto.scroll(scrollView, { x: 0, y: 500 });
WNAuto.scroll(scrollView, { x: 0, y: 500 }, true);  // 带动画
```

### WNAuto.scrollBy(viewOrAddress, direction, [distance])

相对当前位置滚动。

```javascript
WNAuto.scrollBy(scrollView, 'down', 300);
WNAuto.scrollBy(scrollView, 'up', 200);
WNAuto.scrollBy(scrollView, 'left', 100);
WNAuto.scrollBy(scrollView, 'right', 100);
```

### WNAuto.scrollToTop(viewOrAddress) / scrollToBottom(viewOrAddress)

滚动到顶部/底部。

### WNAuto.setSwitch(viewOrAddress, on)

设置 UISwitch 状态并触发 ValueChanged 事件。

```javascript
WNAuto.setSwitch(mySwitch, true);
```

### WNAuto.selectSegment(viewOrAddress, index)

选择 UISegmentedControl 的指定段。

```javascript
WNAuto.selectSegment(segControl, 2);
```

### WNAuto.setSlider(viewOrAddress, value)

设置 UISlider 的值（0.0 ~ 1.0）。

```javascript
WNAuto.setSlider(slider, 0.75);
```

### WNAuto.setDate(viewOrAddress, timestamp)

设置 UIDatePicker 的日期。

```javascript
WNAuto.setDate(datePicker, Date.now() / 1000);
```

---

## 导航 API — `WNAuto.nav`

### nav.push(vcProxy, [animated])

Push ViewController 到当前的 NavigationController。

```javascript
var vc = ObjC.use('MyDetailVC').invoke('new');
WNAuto.nav.push(vc);
```

### nav.pop([animated])

Pop 当前 ViewController。

### nav.popToRoot([animated])

Pop 到根 ViewController。

### nav.present(vcProxy, [animated])

Present 一个 ViewController。

### nav.dismiss([animated])

Dismiss 当前 presented ViewController。

### nav.selectTab(index)

选择 TabBar 的指定 tab。

```javascript
WNAuto.nav.selectTab(0);  // 第一个 tab
WNAuto.nav.selectTab(2);  // 第三个 tab
```

### nav.goBack()

点击导航栏返回按钮，或回退。

---

## Alert 处理 — `WNAuto.alert`

### alert.current()

检测当前是否有 UIAlertController。

```javascript
var alertVC = WNAuto.alert.current();
if (alertVC) console.log('Alert is showing');
```

### alert.tapButton(buttonTitle)

点击 Alert 上的指定按钮。

```javascript
WNAuto.alert.tapButton('OK');
WNAuto.alert.tapButton('Cancel');
WNAuto.alert.tapButton('Delete');
```

### alert.typeInField(fieldIndex, text)

在 Alert 的输入框中输入。

```javascript
WNAuto.alert.typeInField(0, 'my_password');
```

### alert.dismiss()

强制关闭当前 Alert。

### alert.waitFor([opts])

等待 Alert 出现。

```javascript
WNAuto.alert.waitFor({ timeout: 3000 });
WNAuto.alert.tapButton('OK');
```

---

## 属性读取 — `WNAuto.props`

| 方法 | 返回 | 说明 |
|------|------|------|
| `text(view)` | string | 视图文本 |
| `className(view)` | string | 类名 |
| `isVisible(view)` | boolean | 可见性 |
| `isEnabled(view)` | boolean | 是否可交互 |
| `frame(view)` | string | frame 描述 |
| `isSelected(view)` | boolean | 选中状态 |
| `isSwitchOn(view)` | boolean | Switch 开/关 |
| `subviewCount(view)` | number | 子视图数量 |

---

## 截图 — `WNAuto.screenshot`

```javascript
var full = WNAuto.screenshot.full();       // Base64 PNG
var part = WNAuto.screenshot.view(button); // 指定视图截图
```

---

## 工具方法

### WNAuto.wait(ms)

等待指定毫秒。

```javascript
WNAuto.wait(1000);  // 等待 1 秒
```

### WNAuto.toProxy(viewOrAddress)

将视图地址或原生对象转换为 ObjC 代理。

---

## 完整示例：登录流程自动化测试

```javascript
var suite = WNTest.create('Login Flow');

suite.describe('Login', function(ctx) {
    ctx.beforeEach(function() {
        WNAuto.nav.popToRoot(false);
        WNAuto.wait(200);
    });

    ctx.it('should login with valid credentials', function(assert) {
        var emailField = WNAuto.find.byId('email_input')[0];
        var passField = WNAuto.find.byId('password_input')[0];
        var loginBtn = WNAuto.find.byText('Login')[0];

        assert.isNotNil(emailField, 'email field found');
        assert.isNotNil(passField, 'password field found');
        assert.isNotNil(loginBtn, 'login button found');

        WNAuto.type(emailField, 'user@test.com');
        WNAuto.type(passField, 'password123');
        WNAuto.tap(loginBtn);

        var success = WNAuto.find.waitForText('Welcome', { timeout: 5000 });
        assert.ok(success, 'login succeeded');
    });

    ctx.it('should show error on invalid login', function(assert) {
        var emailField = WNAuto.find.byId('email_input')[0];
        var passField = WNAuto.find.byId('password_input')[0];
        var loginBtn = WNAuto.find.byText('Login')[0];

        WNAuto.type(emailField, 'bad@test.com');
        WNAuto.type(passField, 'wrong');
        WNAuto.tap(loginBtn);

        var hasError = WNAuto.find.waitForText('Invalid', { timeout: 3000 });
        assert.ok(hasError, 'error message shown');
    });
});

suite.run();
```

## 与 MCP 集成

通过 MCP 工具可以远程加载和执行测试：

```
# 1. 连接设备
connect

# 2. 加载测试框架
load_script name="wn-test" code="<lib/wn-test.js 内容>"
load_script name="wn-auto" code="<lib/wn-auto.js 内容>"

# 3. 加载并运行测试
load_script name="my-test" code="<测试脚本内容>"

# 4. 获取结果（解析 console 中的 [RESULT_JSON]）
rpc_call method="getLastTestReport"
```
