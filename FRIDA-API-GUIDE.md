# WhiteNeedle Frida 脚本编写指南

## 基础概念

WhiteNeedle 使用 Frida 的 JavaScript API 在目标 App 进程内执行脚本。脚本可以：
- Hook Objective-C / Swift 方法
- 读写内存
- 枚举类和实例
- 拦截网络请求
- 修改函数行为

## 控制台输出

```javascript
console.log('普通日志');
console.warn('警告');
console.error('错误');
```

输出会显示在 VSCode 的 WhiteNeedle Output Channel 中。

## ObjC 类操作

### 列举所有类

```javascript
const classes = Object.keys(ObjC.classes);
console.log(`Total classes: ${classes.length}`);

// 过滤特定前缀
const uiClasses = classes.filter(c => c.startsWith('UI'));
console.log(uiClasses.join('\n'));
```

### 查看类方法

```javascript
const cls = ObjC.classes.UIViewController;
console.log('Own methods:', cls.$ownMethods.join('\n'));
console.log('Super class:', cls.$superClass.$className);
```

### 搜索活跃实例

```javascript
ObjC.choose(ObjC.classes.UIViewController, {
    onMatch(instance) {
        console.log(`Found: ${instance.$className} @ ${instance.handle}`);
        console.log(`  title: ${instance.title()}`);
    },
    onComplete() {
        console.log('Search complete');
    }
});
```

## 方法 Hook

### 基本 Hook

```javascript
const cls = ObjC.classes.NSURLSession;
Interceptor.attach(cls['- dataTaskWithRequest:completionHandler:'].implementation, {
    onEnter(args) {
        const request = new ObjC.Object(args[2]);
        console.log('URL:', request.URL().absoluteString().toString());
        console.log('Method:', request.HTTPMethod().toString());
    },
    onLeave(retval) {
        console.log('Task created:', retval);
    }
});
```

### 修改返回值

```javascript
Interceptor.attach(ObjC.classes.SomeClass['- isFeatureEnabled'].implementation, {
    onLeave(retval) {
        retval.replace(ptr(1)); // 强制返回 YES
    }
});
```

### 修改参数

```javascript
Interceptor.attach(ObjC.classes.SomeClass['- setTitle:'].implementation, {
    onEnter(args) {
        const newTitle = ObjC.classes.NSString.stringWithString_('Modified Title');
        args[2] = newTitle.handle;
    }
});
```

## RPC 导出

脚本可以通过 `rpc.exports` 导出函数，供 VSCode 插件调用：

```javascript
rpc.exports = {
    getAppInfo() {
        return {
            bundleId: ObjC.classes.NSBundle.mainBundle().bundleIdentifier().toString(),
            version: ObjC.classes.NSBundle.mainBundle()
                .objectForInfoDictionaryKey_('CFBundleShortVersionString').toString(),
        };
    },

    searchClass(name) {
        return Object.keys(ObjC.classes)
            .filter(c => c.toLowerCase().includes(name.toLowerCase()));
    },
};
```

## 网络监控

```javascript
// Hook NSURLSession
const session = ObjC.classes.NSURLSession;
Interceptor.attach(session['- dataTaskWithRequest:completionHandler:'].implementation, {
    onEnter(args) {
        const req = new ObjC.Object(args[2]);
        const url = req.URL().absoluteString().toString();
        const method = req.HTTPMethod().toString();

        console.log(`[NET] ${method} ${url}`);

        const headers = req.allHTTPHeaderFields();
        if (headers) {
            const keys = headers.allKeys();
            for (let i = 0; i < keys.count(); i++) {
                const key = keys.objectAtIndex_(i).toString();
                const val = headers.objectForKey_(keys.objectAtIndex_(i)).toString();
                console.log(`  ${key}: ${val}`);
            }
        }
    }
});
```

## 内存操作

### 读取字符串

```javascript
const addr = ptr('0x100000000');
console.log(addr.readUtf8String());
```

### 扫描内存

```javascript
const module = Process.findModuleByName('MyApp');
Memory.scan(module.base, module.size, 'FF FF FF FF', {
    onMatch(address, size) {
        console.log(`Found pattern at ${address}`);
    },
    onComplete() {
        console.log('Scan done');
    }
});
```

## UI 操作

### 获取当前 ViewController

```javascript
function getCurrentVC() {
    const app = ObjC.classes.UIApplication.sharedApplication();
    let vc = app.keyWindow().rootViewController();
    while (vc.presentedViewController()) {
        vc = vc.presentedViewController();
    }
    if (vc.isKindOfClass_(ObjC.classes.UINavigationController)) {
        vc = vc.topViewController();
    }
    return vc;
}

const vc = getCurrentVC();
console.log('Current VC:', vc.$className);
```

### 修改 UI (主线程)

```javascript
ObjC.schedule(ObjC.mainQueue, () => {
    const label = ObjC.classes.UILabel.alloc().initWithFrame_(
        ObjC.classes.CGRect.make(100, 100, 200, 50)
    );
    label.setText_('WhiteNeedle');
    label.setTextColor_(ObjC.classes.UIColor.redColor());
    getCurrentVC().view().addSubview_(label);
});
```

## 调试技巧

### 使用 `debugger` 语句

在脚本中插入 `debugger;` 可以在 VSCode 调试器中触发断点：

```javascript
Interceptor.attach(target.implementation, {
    onEnter(args) {
        const request = new ObjC.Object(args[2]);
        debugger; // 在这里暂停，可以检查 request 变量
    }
});
```

### 错误处理

```javascript
try {
    const cls = ObjC.classes.MayNotExist;
    if (!cls) {
        console.warn('Class not found');
        return;
    }
    // ...
} catch (e) {
    console.error('Error:', e.message);
    console.error('Stack:', e.stack);
}
```

## IntelliSense 支持

将 `sample-scripts/jsconfig.json` 复制到你的脚本目录，即可在 VSCode 中获得 Frida API 的自动补全和类型检查：

```bash
cp sample-scripts/jsconfig.json your-scripts/
```
