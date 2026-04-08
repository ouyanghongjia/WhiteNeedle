#!/usr/bin/env node
/**
 * 检查 ios_webkit_debug_proxy 是否可用并列出调试目标。
 *
 * 用法:
 *   node scripts/check-inspector.mjs [port]
 * 示例:
 *   node scripts/check-inspector.mjs
 *   node scripts/check-inspector.mjs 9222
 *
 * 判定标准: GET http://127.0.0.1:port/json 返回 200，且 JSON 数组里至少有一项含 webSocketDebuggerUrl。
 */

import http from 'http';

const port = parseInt(process.argv[2] || '9222', 10);
const host = '127.0.0.1';

const url = `http://${host}:${port}/json`;
console.log(`检查 ios_webkit_debug_proxy: ${url}\n`);

const req = http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => {
        body += c;
    });
    res.on('end', () => {
        console.log(`HTTP 状态: ${res.statusCode}`);
        if (res.statusCode !== 200) {
            console.log('\n结论: 非 200 响应，ios_webkit_debug_proxy 可能未正确运行。');
            process.exit(2);
        }
        let data;
        try {
            data = JSON.parse(body);
        } catch (e) {
            console.log('响应体（前 500 字符）:', body.slice(0, 500));
            console.log('\n结论: 响应不是 JSON。确认端口 ' + port + ' 上运行的是 ios_webkit_debug_proxy。');
            process.exit(3);
        }
        if (!Array.isArray(data)) {
            console.log('\n结论: JSON 不是数组，不符合 /json 列表格式。');
            process.exit(4);
        }
        const withWs = data.filter((t) => t && typeof t.webSocketDebuggerUrl === 'string');
        console.log(`目标数量: ${data.length}，含 webSocketDebuggerUrl: ${withWs.length}`);
        if (withWs.length === 0) {
            console.log('\n结论: 没有可用的调试目标。');
            console.log('  - 确认 iPhone 已通过 USB 连接');
            console.log('  - 确认 App 正在运行');
            console.log('  - 确认 设置 > Safari > 高级 > Web 检查器 = 开');
            process.exit(5);
        }
        withWs.forEach((t, i) => {
            console.log(`\n[${i}] title: ${t.title || '(无)'}`);
            console.log(`    url: ${t.url || '(无)'}`);
            console.log(`    webSocketDebuggerUrl: ${t.webSocketDebuggerUrl}`);
        });
        console.log(`\n结论: 发现 ${withWs.length} 个调试目标，VS Code F5 可连接。`);
        process.exit(0);
    });
});

req.on('error', (err) => {
    console.error('请求失败:', err.message);
    console.log('\n结论: 无法连接。请确认 ios_webkit_debug_proxy 正在运行：');
    console.log('  brew install ios-webkit-debug-proxy');
    console.log('  ios_webkit_debug_proxy -F');
    process.exit(6);
});

req.setTimeout(8000, () => {
    req.destroy();
    console.error('请求超时');
    process.exit(7);
});
