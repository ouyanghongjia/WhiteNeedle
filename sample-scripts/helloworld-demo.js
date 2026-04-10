/**
 * WhiteNeedle Sample: Hello World
 *
 * 最简单的入门示例 —— 演示基础 API：
 *   - console.log / warn / error   → 日志输出
 *   - __wnVersion / __wnEngine    → 引擎信息
 *   - Process.platform / arch      → 平台信息
 *   - dispatch.main                → 主线程安全调用
 *   - ObjC.use + invoke            → 调用 ObjC 方法
 */

// ── 1. 基本日志 ─────────────────────────────────────────────
console.log('Hello from WhiteNeedle!');
console.log('Engine: ' + __wnEngine + '  Version: ' + __wnVersion);
console.log('Platform: ' + Process.platform + '  Arch: ' + Process.arch);

// ── 2. 获取设备信息（主线程安全） ────────────────────────────
dispatch.main(function () {
    var device = ObjC.use('UIDevice').invoke('currentDevice');
    console.log('Device: ' + device.invoke('name'));
    console.log('System: ' + device.invoke('systemName') + ' ' + device.invoke('systemVersion'));
    console.log('Model:  ' + device.invoke('model'));
});

// ── 3. 获取 App 基本信息 ────────────────────────────────────
var bundle = ObjC.use('NSBundle').invoke('mainBundle');
var appName = bundle.invoke('objectForInfoDictionaryKey:', ['CFBundleDisplayName'])
           || bundle.invoke('objectForInfoDictionaryKey:', ['CFBundleName']);
var appVersion = bundle.invoke('objectForInfoDictionaryKey:', ['CFBundleShortVersionString']);
console.log('App: ' + appName + ' v' + appVersion);
