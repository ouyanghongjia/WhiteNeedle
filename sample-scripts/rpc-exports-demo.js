/**
 * WhiteNeedle Sample: RPC Exports
 *
 * 演示 rpc.exports —— 允许外部（VS Code / MCP）远程调用脚本中定义的函数：
 *   - rpc.exports 中定义的每个函数都可以通过 rpcCall(name, args) 远程调用
 *   - 返回值会自动序列化回调用方
 *   - 适合构建可交互的调试工具和自动化脚本
 */

// ── 定义可远程调用的函数 ────────────────────────────────────
rpc.exports = {
    /**
     * 返回 App 基本信息
     */
    appInfo: function () {
        var bundle = ObjC.use('NSBundle').invoke('mainBundle');
        return {
            name: (bundle.invoke('objectForInfoDictionaryKey:', ['CFBundleDisplayName'])
                || bundle.invoke('objectForInfoDictionaryKey:', ['CFBundleName'])).toString(),
            version: bundle.invoke('objectForInfoDictionaryKey:', ['CFBundleShortVersionString']).toString(),
            bundleId: bundle.invoke('bundleIdentifier').toString()
        };
    },

    /**
     * 获取设备信息
     */
    deviceInfo: function () {
        return dispatch.main(function () {
            var dev = ObjC.use('UIDevice').invoke('currentDevice');
            return {
                name: dev.invoke('name').toString(),
                model: dev.invoke('model').toString(),
                systemVersion: dev.invoke('systemVersion').toString()
            };
        });
    },

    /**
     * 计算示例：接收参数并返回结果
     * @param {number} a
     * @param {number} b
     */
    add: function (a, b) {
        return { result: a + b };
    },

    /**
     * 在 App 中弹出 Alert
     * @param {string} title
     * @param {string} message
     */
    showAlert: function (title, message) {
        dispatch.mainAsync(function () {
            var alertCls = ObjC.use('UIAlertController');
            var alert = alertCls.invoke('alertControllerWithTitle:message:preferredStyle:', [
                title || 'WhiteNeedle',
                message || 'Hello from RPC!',
                1 // UIAlertControllerStyleAlert
            ]);
            var actionCls = ObjC.use('UIAlertAction');
            var ok = actionCls.invoke('actionWithTitle:style:handler:', ['OK', 0, null]);
            alert.invoke('addAction:', [ok]);

            var app = ObjC.use('UIApplication').invoke('sharedApplication');
            var win = app.invoke('windows').invoke('firstObject');
            var rootVC = win.invoke('rootViewController');
            rootVC.invoke('presentViewController:animated:completion:', [alert, true, null]);
        });
        return { success: true };
    }
};

console.log('[RPC] Exports loaded. Available methods:');
console.log('  rpcCall("appInfo")');
console.log('  rpcCall("deviceInfo")');
console.log('  rpcCall("add", [1, 2])');
console.log('  rpcCall("showAlert", ["Hi", "From WhiteNeedle"])');
