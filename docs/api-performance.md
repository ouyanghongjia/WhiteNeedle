# Performance — 性能监控

`Performance` 命名空间提供内存、CPU 和帧率的实时监控能力，基于 Mach 内核 API 和 `CADisplayLink`。

## API

### `Performance.memory()`

获取当前进程的内存使用情况。

```javascript
var mem = Performance.memory();
if (mem) {
    console.log("Used:", (mem.used / 1024 / 1024).toFixed(1), "MB");
    console.log("Free:", (mem.free / 1024 / 1024).toFixed(1), "MB");
}
```

**返回值**：`MemoryInfo | null`

| 字段 | 类型 | 说明 |
|------|------|------|
| `used` | number | 常驻内存大小（字节）— `resident_size` |
| `virtual` | number | 虚拟内存大小（字节） |
| `free` | number | 系统空闲内存（字节） |

### `Performance.cpu()`

获取当前进程所有线程的 CPU 时间。

```javascript
var cpu = Performance.cpu();
if (cpu) {
    console.log("User:", cpu.userTime.toFixed(2) + "s");
    console.log("System:", cpu.systemTime.toFixed(2) + "s");
    console.log("Threads:", cpu.threadCount);
}
```

**返回值**：`CpuInfo | null`

| 字段 | 类型 | 说明 |
|------|------|------|
| `userTime` | number | 用户态 CPU 时间（秒） |
| `systemTime` | number | 内核态 CPU 时间（秒） |
| `threadCount` | number | 线程数量 |

### `Performance.fps(callback)`

启动 FPS 监控，基于 `CADisplayLink`，每秒回调一次当前帧率。

```javascript
Performance.fps(function(fps) {
    console.log("FPS:", fps);
});

// 5 秒后停止
setTimeout(function() {
    Performance.stopFps();
}, 5000);
```

**参数**：`callback(fps: number)` — 每秒触发，参数为四舍五入后的 FPS 值

### `Performance.stopFps()`

停止 FPS 监控。

### `Performance.snapshot()`

获取内存 + CPU 的组合快照，附带时间戳。

```javascript
var snap = Performance.snapshot();
console.log(JSON.stringify(snap, null, 2));
// {
//   "memory": { "used": 52428800, "virtual": 4294967296, "free": 1073741824 },
//   "cpu": { "userTime": 12.5, "systemTime": 3.2, "threadCount": 8 },
//   "timestamp": 1711612800000
// }
```

**返回值**：`{ memory, cpu, timestamp }`
