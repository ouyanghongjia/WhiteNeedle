# WhiteNeedle 增强型循环引用检测 & 可视化引用图 — 开发计划

> **版本**: v1.0 draft  
> **日期**: 2026-04-03  
> **状态**: 待评审  
> **目标**: 借鉴 FBRetainCycleDetector 的核心思路，在 WhiteNeedle 现有架构上实现更精准的循环引用检测，并提供交互式引用图可视化。

---

## 一、总体设计原则

| 原则 | 说明 |
|------|------|
| **不影响现有功能** | 所有新代码以独立文件/模块形式加入，现有 `WNLeakDetector` / `WNHeapScanner` / `leakDetectorPanel` 零修改 |
| **模块化可摘除** | iOS 端新增文件以 `WNRefGraph` 前缀命名，VS Code 端新增 `retainGraphPanel.ts`，删除这些文件 + 注册入口即可完全移除 |
| **宿主 App 兼容** | 运行时检测宿主是否已集成 FBRetainCycleDetector，避免 hook 冲突 |
| **渐进式实现** | 分 5 个阶段，每阶段可独立交付，不依赖后续阶段 |

---

## 二、架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    VS Code Extension                            │
│                                                                 │
│  ┌─────────────────────┐    ┌────────────────────────────────┐  │
│  │ leakDetectorPanel   │    │ retainGraphPanel (新增)         │  │
│  │ (现有 - 不修改)      │    │                                │  │
│  │ · Snapshot Diff      │    │ · D3.js 力导向图 (SVG)         │  │
│  │ · Find Instances     │    │ · 节点 = ObjC 对象             │  │
│  │ · Reference Table    │    │ · 边 = 强引用 (ivar/block/     │  │
│  │ · Cycle Text List    │    │        assoc/collection)       │  │
│  └──────────┬──────────┘    │ · 环路高亮 + 动画              │  │
│             │               │ · 点击节点 → 侧边详情面板       │  │
│             │               │ · 右键菜单 → 展开子引用         │  │
│             │               │ · 一键从 Leak Detector 跳转     │  │
│             │               └──────────┬─────────────────────┘  │
│             │                          │                        │
│             │     evaluate(JS code)    │                        │
│             └──────────┬───────────────┘                        │
│                        ▼                                        │
│              ┌──────────────────┐                               │
│              │  DeviceManager   │                               │
│              │  TcpBridge:27042 │                               │
│              └────────┬─────────┘                               │
└───────────────────────┼─────────────────────────────────────────┘
                        │ JSON-RPC evaluate
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    iOS Dylib (WhiteNeedle)                       │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ WNJSEngine.m  (现有 - 仅新增 1 行注册调用)               │   │
│  │   [WNRefGraphDetector registerInContext:context];         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────────┐  │
│  │WNHeapScanner │  │WNLeakDetector  │  │ WNRefGraph* (新增)   │  │
│  │(现有-不修改)  │  │(现有-不修改)   │  │                     │  │
│  └──────┬───────┘  └───────┬────────┘  │ WNRefGraphDetector  │  │
│         │                  │           │ WNRefGraphBuilder    │  │
│         │   共享堆扫描能力  │           │ WNBlockAnalyzer      │  │
│         └──────────────────┤           │ WNAssocTracker       │  │
│                            │           │ WNIvarLayoutParser   │  │
│                            │           └──────────┬──────────┘  │
│                            │                      │             │
│                            └──────────────────────┘             │
│                            WNRefGraph* 调用 WNHeapScanner       │
│                            的 public API（只读依赖）             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、新增文件清单

### iOS Framework 端 (`ios-dylib/WhiteNeedle/Sources/`)

| 文件 | 职责 | 依赖 |
|------|------|------|
| `WNRefGraphDetector.h/m` | JS 命名空间 `RefGraph.*` 注册入口，协调各子模块 | WNRefGraphBuilder, WNHeapScanner |
| `WNRefGraphBuilder.h/m` | 从一个根对象构建完整引用图 (nodes + edges) 并检测环路 | WNIvarLayoutParser, WNBlockAnalyzer, WNAssocTracker |
| `WNIvarLayoutParser.h/m` | 使用 `class_getIvarLayout` / `class_getWeakIvarLayout` 精确提取强引用 ivar | objc/runtime.h |
| `WNBlockAnalyzer.h/m` | Block ABI 解析 + release detector 黑盒技术，提取 Block 的强捕获变量 | Block ABI, objc/runtime.h |
| `WNAssocTracker.h/m` | 通过 fishhook hook `objc_setAssociatedObject`，追踪 RETAIN 策略的关联对象 | fishhook (项目已有) |
| `WNCollectionEnumerator.h/m` | NSArray/NSDictionary/NSSet/NSMapTable/NSHashTable 的内容枚举 | Foundation |

### VS Code Extension 端 (`vscode-extension/src/`)

| 文件 | 职责 |
|------|------|
| `panels/retainGraphPanel.ts` | 新的 Webview Panel，包含 D3.js 力导向图渲染 |
| `panels/retainGraphHtml.ts` | HTML/CSS/JS 模板（与 Panel 逻辑分离，便于维护） |

### 需修改的现有文件 (最小改动)

| 文件 | 改动 | 可逆性 |
|------|------|--------|
| `WNJSEngine.m` | 新增 1 行 `[WNRefGraphDetector registerInContext:context];`（条件编译包裹） | 删除该行即可 |
| `extension.ts` | 新增命令注册 `whiteneedle.openRetainGraph` | 删除注册代码即可 |
| `package.json` | 新增 1 个 command + 1 个 submenu item | 删除对应条目即可 |

---

## 四、分阶段开发计划

### Phase 1：精确强引用提取（iOS 端核心）

**目标**：替代现有的 `type_encoding[0] == '@'` 粗糙判断，实现三种引用源的精确扫描。

#### 1.1 WNIvarLayoutParser — ivar layout 精确解析

**技术方案**：

```
                class_getIvarLayout(cls)     → 强引用 index 集合
                class_getWeakIvarLayout(cls) → 弱引用 index 集合
                差集 = 真正的强引用

                对于每个 strong index：
                    ivar_getOffset(ivar) → 读取目标地址
                    验证是否为有效 ObjC 对象
```

**ivar layout 编码格式**（Apple 未公开文档，但格式稳定）：

```
layout 是一个字节序列，每个字节：
  高 4 位 = 跳过的 non-object slots 数量
  低 4 位 = 连续的 object slots 数量
  0x00 终止
```

**输入/输出**：

```objc
@interface WNIvarLayoutParser : NSObject

/// 返回对象的所有强引用 ivar 信息
/// @return [{ name, type, offset, address, className, source:"ivar" }]
+ (NSArray<NSDictionary *> *)strongIvarReferencesForObject:(id)obj;

/// 返回原始 strong ivar 偏移量列表（供 Builder 使用）
+ (NSArray<NSNumber *> *)strongIvarOffsetsForClass:(Class)cls;

@end
```

**ObjC++ struct 支持**（P2 优先级）：

解析 `ivar_getTypeEncoding` 中的 struct 编码（如 `{CGRect={CGPoint=dd}{CGSize=dd}}`），递归查找其中的 `@` 类型字段，计算偏移量。

**预计工作量**：2-3 天

#### 1.2 WNBlockAnalyzer — Block 强引用分析

**技术方案**（借鉴 FBRetainCycleDetector 的 `FBBlockStrongLayout.m`）：

**Step 1 — Block ABI 解析**：

```c
// Block 在内存中的布局（Apple 公开的 ABI）
struct Block_literal {
    void *isa;                  // _NSConcreteStackBlock / _NSConcreteMallocBlock
    int flags;
    int reserved;
    void (*invoke)(void *, ...);
    struct Block_descriptor *descriptor;
    // captured variables follow...
};

struct Block_descriptor {
    unsigned long reserved;
    unsigned long size;
    // 可选字段（根据 flags 判断是否存在）：
    void (*copy_helper)(void *dst, void *src);   // BLOCK_HAS_COPY_DISPOSE
    void (*dispose_helper)(void *dst);
    const char *signature;                        // BLOCK_HAS_SIGNATURE
};
```

**Step 2 — Release Detector 黑盒探测**：

```
1. 读取 block 的 descriptor->size，得知 block 总大小
2. 计算 captured variables 区域 = size - sizeof(Block_literal)
3. 构造一个大小相同的 fake block（memcpy 自原始 block）
4. 在每个 pointer slot 位置放入 "release detector" 对象
   release detector = 一个轻量 ObjC 对象，重写 -release 方法
   只记录"我被 release 了"这个事实
5. 将 fake block 强制释放（objc_release）
6. 检查哪些 detector 收到了 -release → 这些位置是 strong 引用
7. 读取原始 block 对应位置的指针 → 得到被 block 强引用的对象
```

**注意事项**：
- 此文件必须用 `-fno-objc-arc` 编译（MRR），因为需要手动控制 release
- 需要在 Makefile 中为此文件单独设置编译标志

**输入/输出**：

```objc
@interface WNBlockAnalyzer : NSObject

/// 分析一个 Block 对象的强捕获变量
/// @return [{ index, address, className, source:"block_capture" }]
+ (NSArray<NSDictionary *> *)strongCapturesOfBlock:(id)blockObj;

/// 判断一个 id 是否是 Block 类型
+ (BOOL)isBlock:(id)obj;

@end
```

**预计工作量**：3-4 天（Block ABI 解析比较精细，需大量真机测试）

#### 1.3 WNAssocTracker — 关联对象追踪

**技术方案**：

```
使用项目已有的 fishhook 库 hook 两个 C 函数：
  - objc_setAssociatedObject → 记录 (object, key, policy)
  - objc_removeAssociatedObjects → 清除记录

仅追踪 policy == OBJC_ASSOCIATION_RETAIN / RETAIN_NONATOMIC 的

数据结构：
  std::unordered_map<id, std::unordered_set<const void *>> assocMap;
  std::mutex assocMutex;
```

**宿主 App 冲突检测**：

```objc
+ (void)installIfSafe {
    // 检测宿主是否已有 FBAssociationManager
    if (NSClassFromString(@"FBAssociationManager")) {
        NSLog(@"[WNAssocTracker] FBRetainCycleDetector detected, "
               "delegating to FBAssociationManager");
        sUseFBFallback = YES;  // 直接调用 FB 的 API 获取关联对象
        return;
    }
    // 安装自己的 hook
    rebind_symbols((struct rebinding[]){
        {"objc_setAssociatedObject", (void *)wn_setAssocObj, (void **)&orig_setAssocObj},
        {"objc_removeAssociatedObjects", (void *)wn_removeAssocObjs, (void **)&orig_removeAssocObjs},
    }, 2);
}
```

**输入/输出**：

```objc
@interface WNAssocTracker : NSObject

+ (void)installIfSafe;
+ (void)uninstall;

/// 获取对象的所有强关联对象
/// @return [{ key(hex), address, className, source:"associated_object" }]
+ (NSArray<NSDictionary *> *)strongAssociationsForObject:(id)obj;

@end
```

**预计工作量**：1-2 天

#### 1.4 WNCollectionEnumerator — 集合内容枚举

**技术方案**：

```objc
+ (NSArray<NSDictionary *> *)enumerateCollection:(id)obj {
    if ([obj isKindOfClass:[NSArray class]]) {
        // 枚举所有元素
    } else if ([obj isKindOfClass:[NSDictionary class]]) {
        // 枚举所有 value（key 通常是 copy 语义不形成 retain）
    } else if ([obj isKindOfClass:[NSSet class]]) {
        // 枚举所有元素
    } else if ([obj isKindOfClass:[NSMapTable class]]) {
        // 根据 valuePointerFunctions 判断是否 strong
    } else if ([obj isKindOfClass:[NSHashTable class]]) {
        // 根据 pointerFunctions 判断是否 strong
    }
    // 返回 [{ index/key, address, className, source:"collection_element" }]
}
```

**安全保护**：
- 枚举过程用 `@try/@catch` 包裹
- 单个集合最多枚举 1000 个元素
- 跳过已知安全集合（如 `NSCache` 不构成强引用循环）

**预计工作量**：1 天

---

### Phase 2：引用图构建器（iOS 端核心）

**目标**：将 Phase 1 的四个引用源组合成完整的引用图，实现精确的环路检测。

#### 2.1 WNRefGraphBuilder

**核心数据结构**：

```objc
// 图中的一个节点
typedef struct {
    NSString *nodeId;       // "0x1a2b3c4d"
    NSString *className;
    NSString *address;
    NSUInteger retainCount;
    NSUInteger instanceSize;
    BOOL isBlock;
} WNGraphNode;

// 图中的一条边
typedef struct {
    NSString *fromNodeId;
    NSString *toNodeId;
    NSString *label;        // ivar 名 / "block_capture[0]" / "assoc:0xkey" / "array[3]"
    NSString *source;       // "ivar" / "block_capture" / "associated_object" / "collection_element"
} WNGraphEdge;
```

**BFS 图构建算法**：

```
输入：rootAddress, maxNodes(默认 200), maxDepth(默认 15)
输出：{ nodes: [...], edges: [...], cycles: [...] }

算法：
1. queue = [rootAddress]
2. visited = {}
3. while queue 非空 && nodes.count < maxNodes:
     addr = queue.dequeue()
     if visited[addr]: continue
     visited[addr] = true
     
     obj = 地址转对象（安全校验）
     node = 创建 WNGraphNode
     nodes.append(node)
     
     // 收集所有强引用
     refs = []
     refs += WNIvarLayoutParser.strongIvarReferences(obj)
     if WNBlockAnalyzer.isBlock(obj):
         refs += WNBlockAnalyzer.strongCaptures(obj)
     refs += WNAssocTracker.strongAssociations(obj)
     refs += WNCollectionEnumerator.enumerate(obj)  // 仅当 obj 是集合时
     
     for ref in refs:
         edge = 创建 WNGraphEdge
         edges.append(edge)
         if !visited[ref.address]:
             queue.enqueue(ref.address)

4. // 环路检测（在已构建的图上跑 Tarjan SCC 或 DFS）
   cycles = detectCyclesInGraph(nodes, edges)

5. return { nodes, edges, cycles }
```

**环路检测算法**：

采用 **Tarjan 强连通分量** 算法（而非简单 DFS），原因：
- 能一次性找到所有环，不遗漏
- 时间复杂度 O(V+E)，比从每个节点 DFS 要快
- 每个 SCC 大小 > 1 即为一个环路群

**JS API 注册**：

```javascript
// RefGraph.buildGraph(address, maxNodes?, maxDepth?)
// → { nodes: [...], edges: [...], cycles: [[nodeId, ...], ...] }
RefGraph.buildGraph("0x1a2b3c4d", 200, 15)

// RefGraph.expandNode(address)  
// → { refs: [{ label, address, className, source }] }
// 用于图上"展开"某个节点，仅返回该节点的直接引用
RefGraph.expandNode("0x1a2b3c4d")

// RefGraph.getNodeDetail(address)
// → { className, address, retainCount, size, ivars: [...], 
//     blockCaptures: [...], assocObjects: [...] }
RefGraph.getNodeDetail("0x1a2b3c4d")

// RefGraph.isAvailable() → true/false
// 用于 VS Code 端检测此模块是否存在
RefGraph.isAvailable()
```

**预计工作量**：3-4 天

---

### Phase 3：VS Code 交互式引用图面板

**目标**：在 VS Code 中提供 D3.js 力导向图，直观展示对象引用关系和循环引用。

#### 3.1 技术选型

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| **D3.js force-directed graph** | 成熟稳定、社区大、SVG 可交互 | 需内联或通过 webview resource | ✅ 选用 |
| Cytoscape.js | API 更直观 | 包体积大 (900KB+) | ❌ |
| vis-network | 开箱即用 | 样式定制弱 | ❌ |
| 纯 Canvas 手绘 | 最轻量 | 开发量大 | ❌ |

**D3.js 引入方式**：将 `d3.min.js`（v7，约 270KB）放入 `vscode-extension/media/` 目录，通过 `webview.asWebviewUri()` 加载。

#### 3.2 retainGraphPanel.ts — 面板逻辑

**与现有 leakDetectorPanel 的关系**：

```
完全独立的新 Panel，不修改 leakDetectorPanel。
但提供"跳转"能力：
  - leakDetectorPanel 中检测到 cycle 后，显示 "Open in Graph" 按钮
  - 点击后打开 retainGraphPanel，传入根地址
  
（这个跳转通过 VS Code command 实现，不需要修改 leakDetectorPanel 代码，
  只需在 extension.ts 中注册一个新 command）
```

**消息协议**（webview ↔ extension）：

```typescript
// Webview → Extension
{ command: 'buildGraph', address: string, maxNodes?: number, maxDepth?: number }
{ command: 'expandNode', address: string }
{ command: 'getNodeDetail', address: string }
{ command: 'exportGraph' }  // 导出为 JSON / PNG

// Extension → Webview
{ command: 'graphData', data: { nodes, edges, cycles } }
{ command: 'nodeExpanded', address: string, refs: [...] }
{ command: 'nodeDetail', data: { className, address, retainCount, ... } }
{ command: 'error', text: string }
```

#### 3.3 retainGraphHtml.ts — 图形渲染

**布局设计**：

```
┌─────────────────────────────────────────────────────────────┐
│  Retain Graph Viewer                                         │
│  ┌──────────────────┬──────────────────────────────────────┐ │
│  │   控制面板 (左)   │        图形画布 (右)                  │ │
│  │                  │                                      │ │
│  │  地址输入框       │    ┌───┐    ┌───┐                    │ │
│  │  [Build Graph]   │    │ A │───→│ B │                    │ │
│  │                  │    └───┘    └─┬─┘                    │ │
│  │  Options:        │      ↑       │                       │ │
│  │  ☑ Show Blocks   │      │       ▼                       │ │
│  │  ☑ Show Assoc    │    ┌─┴─┐   ┌───┐                    │ │
│  │  ☐ Show All Refs │    │ D │←──│ C │  ← 环路红色高亮     │ │
│  │  Max Nodes: 200  │    └───┘   └───┘                    │ │
│  │  Max Depth: 15   │                                      │ │
│  │                  │    [缩放] [重置] [导出]               │ │
│  │  ─────────────── │                                      │ │
│  │                  ├──────────────────────────────────────┤ │
│  │  选中节点详情：   │  (点击节点后此处可折叠展开)           │ │
│  │                  │                                      │ │
│  │  ClassName:      │  节点详情面板 (底部或右侧抽屉)        │ │
│  │  UIViewController│  · retainCount: 3                    │ │
│  │  Address:        │  · instanceSize: 256                 │ │
│  │  0x1a2b3c4d      │  · Strong Ivars:                     │ │
│  │  Size: 256 bytes │    - _view: UIView (0x...)           │ │
│  │                  │    - _delegate: ... (0x...)          │ │
│  │  [Expand Refs]   │  · Block Captures:                   │ │
│  │  [Detect Cycles] │    - capture[0]: self (0x...)        │ │
│  │  [Copy Address]  │  · Associated Objects:               │ │
│  │                  │    - key:0x8f2a: Handler (0x...)     │ │
│  └──────────────────┴──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**图形交互细节**：

| 交互 | 行为 |
|------|------|
| **节点颜色** | 普通对象: 主题色蓝; Block 对象: 紫色; 环路成员: 红色边框 + 浅红背景 |
| **边样式** | ivar: 实线; block_capture: 虚线; associated_object: 点划线; collection: 灰色实线 |
| **边标签** | 显示 ivar 名 / capture 索引 / 集合 key |
| **单击节点** | 选中，右侧显示详情面板，高亮该节点的所有出入边 |
| **双击节点** | 调用 `expandNode`，动态加载该节点的子引用并追加到图中 |
| **右键节点** | 上下文菜单：Expand / Copy Address / Remove from Graph / Set as Root |
| **拖拽节点** | D3 force 布局中自由拖拽，固定位置 |
| **滚轮缩放** | SVG zoom + pan（D3 zoom behavior） |
| **环路高亮** | 检测到的环路自动用红色半透明覆盖连线，环上节点脉冲动画 |
| **Hover 节点** | tooltip 显示 className + address |
| **Hover 边** | tooltip 显示引用类型 + 引用名 |

**环路可视化效果**：

```
检测到环路后：
1. 环路上的边变为红色，线宽加粗，添加 SVG animate 呼吸效果
2. 环路上的节点边框变红，背景变浅红
3. 顶部弹出提示条："Found N retain cycle(s)  [← Prev] [Next →]"
4. 点击 Prev/Next 自动平移画布居中到对应环路
5. 非环路节点降低透明度（focus mode），点击空白区域恢复
```

**预计工作量**：5-7 天

---

### Phase 4：面板集成与跳转联动

**目标**：将新的 Retain Graph 面板注册到 VS Code 命令系统，并与现有 Leak Detector 面板联动。

#### 4.1 extension.ts 注册

```typescript
// 新增命令
context.subscriptions.push(
    vscode.commands.registerCommand('whiteneedle.openRetainGraph', () => {
        RetainGraphPanel.createOrShow(context.extensionUri, deviceManager);
    })
);

// 带地址参数的命令（供其他面板跳转使用）
context.subscriptions.push(
    vscode.commands.registerCommand('whiteneedle.openRetainGraphAt', (address: string) => {
        RetainGraphPanel.createOrShowAt(context.extensionUri, deviceManager, address);
    })
);
```

#### 4.2 package.json 新增

```json
{
    "command": "whiteneedle.openRetainGraph",
    "title": "WhiteNeedle: Open Retain Graph",
    "icon": "$(type-hierarchy)"
}
```

加入到 `whiteneedle.devicesPanels` submenu。

#### 4.3 从 Leak Detector 跳转（不修改 leakDetectorPanel）

通过 extension.ts 监听 leakDetectorPanel 的消息来实现：

```typescript
// 在 extension.ts 中（不修改 leakDetectorPanel.ts）：
// 注册一个全局命令，让 webview 中的按钮可以触发
context.subscriptions.push(
    vscode.commands.registerCommand('whiteneedle.inspectInGraph', (address: string) => {
        RetainGraphPanel.createOrShowAt(context.extensionUri, deviceManager, address);
    })
);
```

用户在 Leak Detector 面板中看到地址后，可以直接复制地址到 Retain Graph 面板中使用。后续如果需要更紧密的集成，可以在 leakDetectorPanel 中增加一个 "Open in Graph" 按钮（小改动）。

**预计工作量**：1-2 天

---

### Phase 5：高级功能（可选增强）

以下功能独立于前四个阶段，根据实际需求逐步添加。

#### 5.1 Allocation Tracker（alloc/dealloc hook）

**目标**：替代全堆扫描，实现 O(1) 实例查询。

```objc
@interface WNAllocTracker : NSObject

+ (void)installIfSafe;   // hook +allocWithZone: / -dealloc
+ (void)uninstall;

+ (NSArray *)instancesOfClass:(Class)cls maxCount:(NSUInteger)max;
+ (NSDictionary *)allocationSummary;  // { className: { alloc, dealloc, alive } }

// 分代追踪
+ (void)markGeneration;
+ (NSArray *)instancesInGeneration:(NSUInteger)gen forClass:(Class)cls;

@end
```

**冲突检测**：

```objc
+ (void)installIfSafe {
    if (NSClassFromString(@"FBAllocationTrackerManager")) {
        NSLog(@"[WNAllocTracker] FBAllocationTracker detected, skip hook");
        sUseFBFallback = YES;
        return;
    }
    // 安装自己的 hook...
}
```

**预计工作量**：2-3 天

#### 5.2 自动泄漏检测模式

```javascript
// 在 JS 端提供自动检测 API
RefGraph.autoDetect({
    interval: 30,        // 每 30 秒扫描一次
    classes: ["UIViewController", "UIView"],  // 关注的类
    onCycleFound: function(cycles) {
        console.log("Retain cycle detected!", JSON.stringify(cycles));
    }
});
```

**预计工作量**：1-2 天

#### 5.3 图导出功能

- **JSON 导出**：完整的 `{ nodes, edges, cycles }` 数据
- **SVG 导出**：当前画布的矢量图
- **PNG 导出**：当前画布截图（Canvas → toDataURL）
- **Mermaid 导出**：生成 Mermaid graph 语法，可粘贴到 Markdown

**预计工作量**：1 天

#### 5.4 环路聚类与去重

借鉴 Meta 后端的环路聚类算法：

```
1. 收集所有检测到的环
2. 对每个环，提取涉及的类名集合
3. 找到每个环的"最小子环"（包含最少节点的等价环）
4. 按最小子环分组
5. 只展示每组的最小环（代表性环路）
```

**预计工作量**：1-2 天

---

## 五、条件编译与摘除方案

### iOS 端

在 `WNJSEngine.m` 中使用条件编译：

```objc
// 可选模块：增强型引用图检测
#if WN_ENABLE_REFGRAPH
#import "WNRefGraphDetector.h"
#endif

// 在 setup 方法中：
#if WN_ENABLE_REFGRAPH
    [WNRefGraphDetector registerInContext:context];
#endif
```

Makefile 中：

```makefile
# 默认启用，设为 0 可禁用
WN_REFGRAPH ?= 1
ifeq ($(WN_REFGRAPH),1)
    CFLAGS += -DWN_ENABLE_REFGRAPH=1
    SOURCES += WNRefGraphDetector.m WNRefGraphBuilder.m WNIvarLayoutParser.m \
               WNBlockAnalyzer.m WNAssocTracker.m WNCollectionEnumerator.m
    # WNBlockAnalyzer 需要 MRR
    WNBlockAnalyzer.m_CFLAGS = -fno-objc-arc
endif
```

### VS Code 端

`retainGraphPanel.ts` 在连接设备后先检测模块可用性：

```typescript
private async checkAvailability(): Promise<boolean> {
    try {
        const result = await this.deviceManager.evaluate(
            'typeof RefGraph !== "undefined" && RefGraph.isAvailable()'
        );
        return result === true || result === 'true';
    } catch {
        return false;
    }
}
```

不可用时显示提示：
> "RefGraph module is not available on the connected device. 
>  Rebuild WhiteNeedle.framework with WN_REFGRAPH=1 to enable this feature."

### 完全摘除

```bash
# iOS 端：删除文件 + Makefile 设为 0
rm ios-dylib/WhiteNeedle/Sources/WNRefGraph*.{h,m}
rm ios-dylib/WhiteNeedle/Sources/WNBlockAnalyzer.{h,m}
rm ios-dylib/WhiteNeedle/Sources/WNAssocTracker.{h,m}
rm ios-dylib/WhiteNeedle/Sources/WNCollectionEnumerator.{h,m}
rm ios-dylib/WhiteNeedle/Sources/WNIvarLayoutParser.{h,m}
# 删除 WNJSEngine.m 中的 registerInContext 调用

# VS Code 端：删除文件 + 注册入口
rm vscode-extension/src/panels/retainGraphPanel.ts
rm vscode-extension/src/panels/retainGraphHtml.ts
rm vscode-extension/media/d3.min.js
# 删除 extension.ts 中的命令注册
# 删除 package.json 中的 command 和 submenu item
```

---

## 六、测试计划

### iOS 端单元测试

| 测试项 | 方法 |
|--------|------|
| ivar layout 解析正确性 | 构造已知类（含 strong/weak/__unsafe_unretained ivar），验证 parser 输出 |
| Block 强引用检测 | 构造 `__strong self` / `__weak self` / 多变量 block，验证 analyzer 输出 |
| 关联对象追踪 | `objc_setAssociatedObject` 后验证 tracker 返回 |
| 集合枚举 | NSArray/NSDictionary/NSSet 各放入已知对象，验证枚举结果 |
| 图构建 | 构造已知的循环引用 (A→B→C→A)，验证 builder 输出的 nodes/edges/cycles |
| 宿主兼容 | 模拟 `FBAssociationManager` 存在的场景，验证 fallback 路径 |

### VS Code 端测试

| 测试项 | 方法 |
|--------|------|
| 面板打开/关闭 | 手动验证 singleton 行为 |
| 图渲染 | 用 mock 数据验证 D3 渲染 |
| 节点交互 | 点击/双击/右键/拖拽/缩放 |
| 环路高亮 | 用包含已知环路的 mock 数据验证 |
| 模块不可用提示 | 断开设备或 RefGraph 未编译时的提示 |

### 真机集成测试

| 场景 | 步骤 |
|------|------|
| **基本环路检测** | 在 sample app 中故意构造 `vc.block -> vc` 循环，验证图中高亮 |
| **复杂引用图** | UINavigationController → VCs → subviews → delegates → blocks，验证图完整性 |
| **性能** | 对 500+ 节点图测试渲染帧率 (目标 > 30fps) |
| **与 FBRetainCycleDetector 共存** | 在已集成 FB 库的 App 上注入 WhiteNeedle，验证无 crash |

---

## 七、工期估算

| 阶段 | 内容 | 预估工期 | 依赖 |
|------|------|---------|------|
| **Phase 1** | 精确强引用提取 (4 个模块) | 7-10 天 | 无 |
| **Phase 2** | 引用图构建器 | 3-4 天 | Phase 1 |
| **Phase 3** | VS Code 交互式图面板 | 5-7 天 | Phase 2 |
| **Phase 4** | 面板集成与跳转联动 | 1-2 天 | Phase 3 |
| **Phase 5** | 高级功能（可选） | 5-8 天 | Phase 1-4 |
| **测试与修复** | 全量测试 + bug fix | 3-5 天 | 全部 |
| **合计** | | **24-36 天** | |

去掉 Phase 5 可选项，核心功能 (Phase 1-4 + 测试) 约 **19-28 天**。

---

## 八、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Block ABI 在新版 iOS 上变化 | 低 | 高 | Block ABI 自 2010 年来未变；加入版本检测，不支持时 graceful fallback |
| arm64e ptrauth 影响 isa 解析 | 中 | 中 | 已有 `ptrauth_strip` 处理；Block 指针同样需要 strip |
| 大型引用图 D3 渲染卡顿 | 中 | 中 | 限制 maxNodes=200；超过时自动切换为 cluster 视图或分层渲染 |
| 线程安全：扫描时对象被释放 | 中 | 高 | 所有指针操作用 `vm_read_overwrite` 安全读取；`@try/@catch` 包裹 |
| fishhook 与宿主其他 hook 框架冲突 | 低 | 高 | `installIfSafe` 检测机制 + 可禁用开关 |
| WNBlockAnalyzer MRR 编译问题 | 低 | 低 | 在 Makefile 中为单文件设置 `-fno-objc-arc` |

---

## 九、参考资料

| 资源 | 链接 |
|------|------|
| FBRetainCycleDetector 源码 | https://github.com/facebook/FBRetainCycleDetector |
| FBAllocationTracker 源码 | https://github.com/facebook/FBAllocationTracker |
| Meta 博客：Automatic memory leak detection on iOS | https://engineering.fb.com/2016/04/13/ios/automatic-memory-leak-detection-on-ios/ |
| Block ABI 规范 | http://clang.llvm.org/docs/Block-ABI-Apple.html |
| Mike Ash's Circle (Block 分析灵感来源) | https://github.com/mikeash/Circle |
| D3.js Force-Directed Graph | https://d3js.org/d3-force |
| Apple: Objective-C Runtime — ivar layout | class_getIvarLayout / class_getWeakIvarLayout 文档 |
| Tarjan SCC 算法 | https://en.wikipedia.org/wiki/Tarjan%27s_strongly_connected_components_algorithm |
