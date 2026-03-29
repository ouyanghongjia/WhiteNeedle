#!/usr/bin/env node
/**
 * 检查某台机器/设备上是否暴露了 Chrome 风格的 JS Inspector（CDP 发现接口）。
 *
 * 用法:
 *   node scripts/check-inspector.mjs <host> [port]
 * 示例:
 *   node scripts/check-inspector.mjs 192.168.1.10 9222
 *   node scripts/check-inspector.mjs 127.0.0.1 9222
 *
 * 判定标准: GET http://host:port/json 返回 200，且 JSON 数组里至少有一项含 webSocketDebuggerUrl。
 */

import http from 'http';

const host = process.argv[2] || '127.0.0.1';
const port = parseInt(process.argv[3] || '9222', 10);

if (!process.argv[2]) {
    console.error('用法: node scripts/check-inspector.mjs <host> [port]');
    console.error('示例: node scripts/check-inspector.mjs 192.168.1.10 9222');
    process.exit(1);
}

const url = `http://${host}:${port}/json`;
console.log(`请求: ${url}\n`);

const req = http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => {
        body += c;
    });
    res.on('end', () => {
        console.log(`HTTP 状态: ${res.statusCode}`);
        if (res.statusCode !== 200) {
            console.log('\n结论: 没有标准的 CDP 发现接口（需要 HTTP 200）。');
            process.exit(2);
        }
        let data;
        try {
            data = JSON.parse(body);
        } catch (e) {
            console.log('响应体（前 500 字符）:', body.slice(0, 500));
            console.log('\n结论: 响应不是 JSON（该端口可能不是 Inspector，例如 WhiteNeedle 引擎 27042 是 JSON-RPC 文本）。');
            process.exit(3);
        }
        if (!Array.isArray(data)) {
            console.log('\n结论: JSON 不是数组，不符合 /json 列表格式。');
            process.exit(4);
        }
        const withWs = data.filter((t) => t && typeof t.webSocketDebuggerUrl === 'string');
        console.log(`目标数量: ${data.length}，含 webSocketDebuggerUrl: ${withWs.length}`);
        if (withWs.length === 0) {
            console.log('\n结论: 没有可用的 CDP WebSocket 目标（VS Code / Chrome DevTools 无法附着）。');
            process.exit(5);
        }
        withWs.slice(0, 5).forEach((t, i) => {
            console.log(`\n[${i}] title: ${t.title || '(无)'}`);
            console.log(`    webSocketDebuggerUrl: ${t.webSocketDebuggerUrl}`);
        });
        console.log('\n结论: 该地址上存在 Inspector/CDP 发现端点，WhiteNeedle 插件的「Debug Script」理论上可连（若 WebSocket URL 对当前网络可达）。');
        process.exit(0);
    });
});

req.on('error', (err) => {
    console.error('请求失败:', err.message);
    console.log('\n结论: 无法连接（端口未监听、防火墙、或不是 HTTP 服务）。WhiteNeedle Inspector 默认监听 9222。');
    process.exit(6);
});

req.setTimeout(8000, () => {
    req.destroy();
    console.error('请求超时');
    process.exit(7);
});
