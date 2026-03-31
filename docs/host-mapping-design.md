# Host Mapping + Mock 方案设计与演进

> 记录 WhiteNeedle Host Mapping 和 Mock 功能从初版到最终方案的技术演进过程。
> 最后更新：2026-03-31

---

## 一、现状

WhiteNeedle 作为注入到 iOS App 进程中的动态调试工具（dylib），其 Host Mapping 功能的目标是：**将指定域名的网络请求重定向到用户配置的目标 IP**，类似于桌面端 SwitchHosts 工具。

iOS App 中发起网络请求的路径多种多样：

| 调用层 | 典型 API | DNS 解析 / 连接方式 |
|--------|----------|---------------------|
| POSIX C | `getaddrinfo()` → `connect()` | 走 `getaddrinfo`，通过 `connect()` 建立 TCP |
| libcurl | `curl_easy_perform()` | 内部调用 `getaddrinfo`，通过 `connect()` 建立 TCP |
| CFNetwork / NSURLSession | `NSURLSession dataTask...` | **绕过** `getaddrinfo`，走 `mDNSResponder`；**绕过** `connect()`，走 NECP 内核通道 |
| network.framework | `nw_connection_t` | 同上 |
| WKWebView | 独立进程 WebContent | 完全在 App 进程外 |

### 核心难点

1. **DNS 解析不可 hook**：苹果现代网络栈不经过 `getaddrinfo`，而是通过 XPC → `mDNSResponder` 守护进程
2. **TCP 连接不走 `connect()`**：`NSURLSession` → `network.framework` 使用 NECP（Network Extension Control Policy）内核通道建连，完全绕过 `connect()` / `connectx()` 系统调用
3. **WKWebView 进程隔离**：网络请求在独立的 WebContent 进程执行，App 进程内的任何 hook 都无法触达
4. **VPN/NetworkExtension 不可用**：虽然 `NEPacketTunnelProvider` 能在内核层拦截全设备流量，但它需要独立 `.appex` 进程 + 特殊 entitlement + 用户显式授权，无法从注入的 dylib 中实现

## 二、目标

提供一个**稳定、兼容各底层网络库**的 Host Mapping 方案，覆盖 App 内所有网络路径：

- 使用 `getaddrinfo` 的传统代码路径
- 使用 `libcurl` 的第三方库
- 使用 `NSURLSession` / `CFNetwork` / `network.framework` 的苹果原生网络栈
- 应用内 WKWebView 的网络请求

同时支持**请求 Mock**（纯本地 mock 和响应改写）和**请求监控**（在 VSCode 中实时查看明文请求/响应）。

## 三、方案演进历程

### v1: 仅 Hook `getaddrinfo`

- **原理**：通过 `fishhook` 替换 `getaddrinfo` 符号，在 DNS 解析阶段将域名映射为目标 IP
- **结论**：❌ `NSURLSession` / `network.framework` 不经过 `getaddrinfo`，对主流网络路径无效

### v2: 加入 `connect()` / `connectx()` Hook

- **原理**：在 TCP 连接建立时，通过「反向 IP 映射表」替换目标 IP
- **实测结论**：❌ 对 NSURLSession 无效。`network.framework` 使用 NECP 内核通道建连，不走 `connect()` / `connectx()`

### v3: 加入 `CURLOPT_RESOLVE` 注入

- **原理**：Hook `curl_easy_perform`，注入 `+hostname:port:ip` 映射
- **结论**：✅ libcurl 解决，但 NSURLSession 仍未覆盖

### v4: 加入 WKWebView 桥接

- **原理**：通过私有 API `WKBrowsingContextController` 将请求路由回 App 进程
- **结论**：❌ 路由回来后仍依赖无效的 connect hook

### v5: 全局 NSURLProtocol + URL 改写

- **原理**：注册全局 `NSURLProtocol`，swizzle `protocolClasses`，将 URL hostname 改写为 mapped IP
- **致命缺陷**：
  - **TLS SNI 被破坏**：ClientHello 中的 SNI 变成 IP 地址，CDN 和虚拟主机无法正确路由
  - HTTP/2 多路复用被打断
  - 对 App 已有 NSURLProtocol 生态有侵入性
  - 不支持请求 Mock
- **结论**：⚠️ 可用但有缺陷，需要更好的方案

### v6: 外部代理 + NSURLProtocol Mock（最终方案）

见下文详细说明。

## 四、v6 最终方案：外部代理 + NSURLProtocol Mock

### 设计思路

将 Host Mapping 和 Mock 两个职责**彻底分离**，Host Mapping 完全由 VSCode Extension 侧的代理服务器处理，iOS dylib 中不保留任何 Host Mapping 代码：

| 职责 | 实现位置 | 机制 |
|------|----------|------|
| **Host Mapping**（域名→IP 映射转发） | VSCode Extension 代理服务器 | HTTP 正向代理 + CONNECT 隧道 |
| **Host Mapping 规则管理** | VSCode Extension 本地存储 | `vscode.Memento` (globalState) |
| **Mock 响应**（纯本地 mock / 改写真实响应） | App 内 NSURLProtocol (`WNMockInterceptor`) | `NSURLProtocol` + protocolClasses swizzle |
| **请求监控**（请求/响应明文展示） | App dylib → WebSocket → VSCode Extension | 应用层主动上报（非代理抓包） |

### 架构图

```
┌───────────────────────────── iPhone ──────────────────────────────┐
│                                                                   │
│  ┌─── App 进程 ──────────────────────────────────────────────┐   │
│  │                                                            │   │
│  │  ┌──────────────────────────────────────┐                 │   │
│  │  │ WNMockInterceptor (NSURLProtocol)    │                 │   │
│  │  │  ├─ Pure Mock → 直接返回本地响应      │                 │   │
│  │  │  ├─ Rewrite  → 放行→收到真响应→改写   │                 │   │
│  │  │  └─ 无匹配   → 放行到系统网络栈       │                 │   │
│  │  └──────────────────────────────────────┘                 │   │
│  │                           │                                │   │
│  │                    放行的请求走系统代理                      │   │
│  │                           │                                │   │
│  │  ┌──────────────────────────────────────┐                 │   │
│  │  │ WhiteNeedle.dylib                    │                 │   │
│  │  │  ├─ WNNetworkMonitor (请求监控)       │──── WebSocket ──┼───┼──→ VSCode Extension
│  │  │  └─ WNCurlMonitor (libcurl 监控)      │                 │   │
│  │  └──────────────────────────────────────┘                 │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  系统 HTTP 代理 → Mac:8899                                        │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
             │
       LAN (Wi-Fi)
             │
┌───────────────────────────── Mac ─────────────────────────────────┐
│                                                                   │
│  ┌─── VSCode Extension ──────────────────────────────────────┐   │
│  │                                                            │   │
│  │  ┌──────────────────────────────────────┐                 │   │
│  │  │ ProxyServer (:8899)                  │                 │   │
│  │  │  ├─ HTTPS: CONNECT 隧道             │                 │   │
│  │  │  │   → DNS 查询 mappedIP             │                 │   │
│  │  │  │   → TCP 连接到 mappedIP:port      │                 │   │
│  │  │  │   → 双向透传（保留原始 SNI）       │                 │   │
│  │  │  ├─ HTTP: Host 改写 → 转发           │                 │   │
│  │  │  └─ 无映射规则: 直接转发原始域名      │                 │   │
│  │  └──────────────────────────────────────┘                 │   │
│  │                                                            │   │
│  │  ┌──────────────────────────────────────┐                 │   │
│  │  │ HostMappingPanel                     │                 │   │
│  │  │  ├─ 规则分组管理 (CRUD)              │                 │   │
│  │  │  ├─ 规则存储: VSCode globalState      │                 │   │
│  │  │  ├─ 导入/导出 hosts 文本              │                 │   │
│  │  │  └─ 实时推送到 ProxyServer            │                 │   │
│  │  └──────────────────────────────────────┘                 │   │
│  │                                                            │   │
│  │  ┌──────────────────────────────────────┐                 │   │
│  │  │ 其他 UI Panels                       │                 │   │
│  │  │  ├─ Network Panel (请求监控展示)      │                 │   │
│  │  │  └─ Mock Panel (Mock 规则管理) [计划] │                 │   │
│  │  └──────────────────────────────────────┘                 │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  Mac 系统 DNS / hosts 文件 ← 不受影响                             │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### 核心优势：SNI 保留

v6 方案的代理通过 **CONNECT 隧道** 实现 HTTPS host mapping：

```
1. App 发起 HTTPS 请求 https://httpbin.org/get
2. 系统代理将请求发送到 Mac:8899
3. 代理收到 CONNECT httpbin.org:443
4. 代理查找映射规则：httpbin.org → 10.13.157.100
5. 代理建立 TCP 连接到 10.13.157.100:443
6. 代理在 client ↔ target 之间建立双向透传隧道
7. App 的 TLS ClientHello 中 SNI 仍然是 httpbin.org ✅
8. 服务器看到正确的 SNI，返回正确证书
```

**关键区别**：代理在 TCP 层转发，不解密 TLS 流量，SNI 原封不动传递。

### Host Mapping 规则管理

规则**完全存储在 VSCode Extension 本地**（`vscode.Memento` / `globalState`），不需要与 iOS 设备同步：

- **存储格式**：分组管理，每个 `HostGroup` 包含 `id`, `title`, `content` (hosts 格式文本), `enabled`
- **规则解析**：与 `/etc/hosts` 格式一致，每行 `IP hostname [hostname2 ...]`，`#` 开头为注释
- **生效机制**：编辑/切换分组后立即计算有效规则 → 推送到 ProxyServer → 代理实时生效
- **持久化**：随 VSCode 扩展状态自动持久化，重启不丢失

为什么不存储在 iOS 设备端：
1. Host Mapping 映射完全由 Mac 端代理执行，设备端无需知道映射规则
2. 消除了设备连接前后的规则同步逻辑
3. 简化架构，规则管理、存储、生效全在同一侧

### 与 v5 方案对比

| 维度 | v5 (NSURLProtocol URL 改写) | **v6 (外部代理 + NSURLProtocol Mock)** |
|------|:---:|:---:|
| TLS SNI | ❌ 被替换为 IP | **✅ 保留原始域名** |
| CDN 兼容 | ❌ CDN 无法根据 SNI 路由 | **✅ 完全兼容** |
| HTTP/2 多路复用 | ❌ IP URL 打断复用 | **✅ 不影响** |
| 对 App NSURLProtocol 生态 | ⚠️ 始终注入，有冲突风险 | **✅ 仅 mock 时注入** |
| 是否需要证书 | 否 | **否**（代理不解密 TLS） |
| 是否影响 Mac 其他应用 | 否 | **否**（仅影响设置了代理的手机） |
| 纯本地 Mock | ❌ 不支持 | **✅ NSURLProtocol 拦截，不经过网络** |
| 响应改写 | ❌ 不支持 | **✅ 先发真实请求，再改写响应体** |
| WKWebView 覆盖 | ✅（需私有 API） | ✅（系统代理对 WKWebView 生效） |
| libcurl 覆盖 | 需 CURLOPT_RESOLVE hook | ✅（系统代理对 libcurl 生效） |
| 请求监控 | 需额外实现 | **✅ dylib 主动上报明文数据** |
| Host Mapping 代码在 dylib 中 | ✅（大量 hook 代码） | **❌（零 host mapping 代码）** |

### NSURLProtocol Mock 拦截器 (WNMockInterceptor)

Mock 规则管理和请求拦截由 App 内 `WNMockInterceptor` 负责：

**支持两种 Mock 模式：**

| 模式 | 说明 | 数据流 |
|------|------|--------|
| **Pure Mock** | 纯本地 mock，请求不离开设备 | 请求 → NSURLProtocol 拦截 → 直接返回配置的响应 |
| **Rewrite Response** | 发真实请求，改写响应 | 请求 → NSURLProtocol 放行到网络 → 收到真实响应 → 替换 body/headers/status |

**NSURLProtocol 与代理的优先级：**

```
NSURLProtocol 在系统代理之前拦截：
  → Pure Mock: 直接返回，请求永远不到代理
  → Rewrite:   标记请求防循环 → 请求经过代理转发 → 收到真实响应 → 改写后返回
  → 无匹配:    请求正常经过代理转发
```

**RPC 接口：**

| 方法 | 参数 | 说明 |
|------|------|------|
| `listMockRules` | — | 列出所有 mock 规则 |
| `addMockRule` | `{urlPattern, method, mode, statusCode, responseHeaders, responseBody, delay}` | 添加规则 |
| `updateMockRule` | `{ruleId, ...fields}` | 更新规则 |
| `removeMockRule` | `{ruleId}` | 删除规则 |
| `removeAllMockRules` | — | 清空所有规则 |
| `enableMockInterceptor` | — | 安装 NSURLProtocol + swizzle |
| `disableMockInterceptor` | — | 卸载 NSURLProtocol |
| `getMockInterceptorStatus` | — | 获取安装状态和规则数 |

### 代理服务器 (ProxyServer)

VSCode Extension 中的 HTTP/HTTPS 正向代理：

- 监听端口由配置 `whiteneedle.proxyPort` 控制，默认 `8899`
- 手机设置 Wi-Fi HTTP 代理指向 Mac IP + 该端口
- HTTPS 使用 CONNECT 方法建立 TCP 隧道，不解密 TLS
- HTTP 使用 Host 头改写 + 请求转发
- Host Mapping 规则从 HostMappingPanel 本地存储加载
- 规则在 HostMappingPanel 中修改后实时推送到代理

## 五、`connect()`/`connectx()` hook 为何对 NSURLSession 无效

**实测验证**：在 `wn_connect`、`wn_connectx`、`wn_freeaddrinfo` 设置断点，NSURLSession 请求均未命中。

**根本原因**：现代 iOS 的 `NSURLSession` → `CFNetwork` → `network.framework` 的 TCP 连接建立路径为：

```
nw_connection_create()
  → nw_connection_start()
    → necp_client_action()     ← NECP 内核接口，非 POSIX syscall
      → kernel 内部完成 TCP 握手
```

完全绕过了 `connect()` / `connectx()` 系统调用。`fishhook` 即使成功 rebind 了这两个符号，`network.framework` 内部也不会调用它们。

## 六、为何不用 VPN / Network Extension 方案

`NEPacketTunnelProvider` 能在内核 NECP 层拦截全设备所有 App 的流量，但无法从 dylib 中使用：
- 必须是独立的 `.appex` 进程（App Extension），不能是进程内代码
- 需要 `com.apple.developer.networking.networkextension` entitlement（Apple 签名授权）
- 需要用户显式授权（系统弹窗 + Face ID/Touch ID + 状态栏 VPN 图标）

与 WhiteNeedle 作为进程内调试工具的定位不兼容。

## 七、兼容性分析

### 与 App 已有 NSURLProtocol 的兼容

`WNMockInterceptor` 仅在有 mock 规则时注册，影响范围远小于 v5 的全局注入：

| 场景 | 兼容性 | 说明 |
|------|--------|------|
| App 注册了 NSURLProtocol 但未 swizzle protocolClasses | ✅ | 两者共存，LIFO 顺序决定优先级 |
| App 也 swizzle 了 protocolClasses | ✅ | swizzle 链条正确传递 |
| 被 mock 的请求 | ⚠️ | Mock protocol 优先拦截，App 的 protocol 被跳过 |
| 未被 mock 的请求 | ✅ | Mock protocol 返回 NO，App 的 protocol 正常工作 |

### Swizzle 链安全性

```
protocolClasses getter 被调用
  → wn_protocolClassesGetter()            // WNMockInterceptor
      → orig (指向 App 或系统的实现)
          → ... → Apple 原始实现
          各方依次追加自己的 protocol class
```

只要每方都正确保存并调用"原始实现"（通过 `method_setImplementation` 返回值），链条不会断裂。

## 八、实现文件清单

### iOS dylib

| 文件 | 职责 |
|------|------|
| `WNMockInterceptor.h/m` | Mock 规则管理 + `WNMockURLProtocol`（纯 Mock / 响应改写）+ protocolClasses swizzle |
| `WNNetworkMonitor.h/m` | NSURLSession / NSURLConnection 请求监控 + WebSocket 上报 |
| `WNCurlMonitor.h/m` | libcurl 请求监控 + WebSocket 上报 |
| `WNRemoteServer.m` | RPC dispatch，包含 Mock 规则管理方法 |
| `WhiteNeedle.m` | dylib 入口，初始化各组件 |
| `fishhook.h/c` | 动态符号重绑定库 |

### VSCode Extension

| 文件 | 职责 |
|------|------|
| `proxy/proxyServer.ts` | HTTP/HTTPS 正向代理 + Host Mapping 转发 |
| `panels/hostMappingPanel.ts` | Host Mapping 规则管理 UI + 本地持久化 + 推送到 ProxyServer |
| `panels/networkPanel.ts` | 请求监控 UI |
| `extension.ts` | 扩展入口，代理生命周期管理 + 规则同步 |
| `device/deviceManager.ts` | 设备 RPC 通信（Mock 规则等） |

### 已删除的文件（v5 → v6 清理）

| 文件 | 原职责 | 删除原因 |
|------|--------|----------|
| `WNHostMapping.h/m` | DNS/connect hook、NSURLProtocol URL 改写、WKWebView 桥接、Host Mapping 规则管理 | Host Mapping 完全由外部代理处理，dylib 中不再需要任何 host mapping 逻辑 |

## 九、已知限制

1. **依赖局域网**：手机和 Mac 必须在同一网络，手机需手动设置 HTTP 代理
2. **libcurl 绕过代理的情况**：如果 App 中的 libcurl 显式设置了 `CURLOPT_PROXY = ""`（强制不走代理），Host Mapping 将对其无效
3. **NSURLSession 绕过代理的情况**：使用 `NSURLSessionConfiguration.connectionProxyDictionary = @{}` 的 session 不走代理
4. **不解密 HTTPS**：代理不解密 TLS 流量，无法在代理层面做 HTTPS 内容级别的操作（如响应改写），但这部分由 App 内的 `WNMockInterceptor` 通过 NSURLProtocol 实现

## 十、演进总结

| 阶段 | 方案 | 问题 | 结论 |
|------|------|------|------|
| v1 | 仅 hook getaddrinfo | NSURLSession 不走 getaddrinfo | ❌ 对主流网络库无效 |
| v2 | + connect/connectx hook | NSURLSession 不走 connect（用 NECP） | ❌ 对 NSURLSession 仍无效 |
| v3 | + CURLOPT_RESOLVE 注入 | 仅覆盖 libcurl | ✅ libcurl 解决 |
| v4 | + WKWebView 桥接 | 路由回来后仍依赖无效的 connect hook | ❌ |
| v5 | 全局 NSURLProtocol URL 改写 | **TLS SNI 被破坏**，CDN 不兼容 | ⚠️ 有缺陷 |
| **v6** | **外部代理 + NSURLProtocol Mock** | — | **✅ 最终方案** |

**v6 的关键决策**：
- Host Mapping 从 dylib 中完全移除，交由 Mac 端代理处理
- Host Mapping 规则仅在 VSCode Extension 本地管理，不与设备同步
- Mock 功能保留在 App 内 NSURLProtocol 层，因为它需要在请求链路中修改内容
- 请求监控通过 App 主动上报明文数据，而非代理抓包
