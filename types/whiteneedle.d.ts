/**
 * WhiteNeedle JavaScript API Type Definitions
 * 
 * 基于 JavaScriptCore 的 iOS 动态化引擎 API 类型声明。
 * 提供 ObjC Runtime 操控、方法 Hook、Block 桥接、原生内存操作等能力。
 */

// ─── 全局变量 ───────────────────────────────────────────────────

/** 引擎版本号 */
declare const __wnVersion: string;

/** 底层引擎名称 ("JavaScriptCore") */
declare const __wnEngine: string;

/** 底层日志函数，直接输出到 NSLog */
declare function __wnLog(message: string): void;

// ─── Process ────────────────────────────────────────────────────

declare namespace Process {
    /** 平台标识，固定为 "ios" */
    const platform: "ios";
    /** 架构标识，固定为 "arm64" */
    const arch: "arm64";
}

// ─── RPC ────────────────────────────────────────────────────────

declare namespace rpc {
    /** 向外部暴露可调用接口的对象容器 */
    var exports: Record<string, (...args: any[]) => any>;
}

// ─── 定时器 ──────────────────────────────────────────────────────

declare function setTimeout(callback: () => void, delayMs: number): number;
declare function setInterval(callback: () => void, intervalMs: number): number;
declare function clearTimeout(timerId: number): void;
declare function clearInterval(timerId: number): void;

// ─── ObjC Proxy ─────────────────────────────────────────────────

/** ObjC 类/实例代理对象 */
interface ObjCProxy {
    /**
     * 调用 ObjC 方法（通过 NSInvocation 动态派发）
     * @param selector ObjC 选择器名称
     * @param args 参数数组，每个参数对应选择器中的一个冒号
     * @returns 方法返回值（自动转换为 JS 类型）
     */
    invoke(selector: string, args?: any[]): any;

    /**
     * 通过 KVC (valueForKey:) 读取 ObjC 属性
     * @param name 属性名
     */
    getProperty(name: string): any;

    /**
     * 通过 KVC (setValue:forKey:) 设置 ObjC 属性
     * @param name 属性名
     * @param value 要设置的值
     */
    setProperty(name: string, value: any): void;

    /** 获取对象的类名 */
    className(): string;

    /** 获取对象的父类名 */
    superclass(): string | null;

    /**
     * 检查对象是否响应指定选择器
     * @param selector 选择器名称
     */
    respondsToSelector(selector: string): boolean;

    /**
     * 列出对象所属类的所有方法（含类型编码）
     * @returns 格式为 "selectorName (typeEncoding)" 的数组
     */
    getMethods(): string[];
}

// ─── ObjC 命名空间 ──────────────────────────────────────────────

interface EnumerateCallbacks {
    onMatch(className: string): void;
    onComplete(): void;
}

interface ChooseCallbacks {
    onMatch(instance: ObjCProxy): void;
    onComplete(): void;
}

interface DefineMethodHandler {
    (self: ObjCProxy, args: any[]): any;
}

interface DefineSpec {
    /** 类名（必须唯一） */
    name: string;
    /** 父类名，默认 "NSObject" */
    super?: string;
    /** 要遵循的协议名称列表 */
    protocols?: string[];
    /** 属性定义，键为属性名，值为类型编码 */
    properties?: Record<string, string>;
    /** 方法定义，键为选择器名称，值为 JS 回调函数 */
    methods?: Record<string, DefineMethodHandler>;
}

interface DelegateSpec {
    /** 要遵循的协议名称列表 */
    protocols: string[];
    /** 协议方法实现 */
    methods: Record<string, DefineMethodHandler>;
}

declare namespace ObjC {
    /** ObjC Runtime 是否可用（始终为 true） */
    const available: boolean;

    /** 所有已注册 ObjC 类名的字典（键和值均为类名） */
    const classes: Record<string, string>;

    /**
     * 通过类名获取 ObjC 类的代理对象
     * @param className ObjC 类名
     * @returns 类代理对象，类不存在时返回 null
     */
    function use(className: string): ObjCProxy | null;

    /**
     * 将任意 NSObject 子类实例包装为实例代理（不限于 UI）。
     * 若传入纯十六进制指针字符串（可选 0x 前缀），在通过内存校验后按地址包装；常用于日志 %p、调试工具返回的 address 等。
     * @param object 原生对象、WNBoxing，或十六进制地址字符串
     */
    function instance(object: any): ObjCProxy | null;

    /**
     * 在运行时动态创建新的 ObjC 类
     * @param spec 类定义规范
     * @returns 新创建类的类代理对象
     */
    function define(spec: DefineSpec): ObjCProxy;

    /**
     * 快速创建遵循指定协议的代理对象实例
     * @param spec 代理定义规范
     * @returns 已实例化的代理对象
     */
    function delegate(spec: DelegateSpec): ObjCProxy;

    /**
     * 获取已注册的类名列表，支持可选过滤
     * @param filter 过滤字符串（大小写不敏感的包含匹配）
     */
    function getClassNames(filter?: string): string[];

    /**
     * 异步枚举所有已注册的 ObjC 类
     * @param callbacks 枚举回调
     */
    function enumerateLoadedClasses(callbacks: EnumerateCallbacks): void;

    /**
     * 在堆中搜索指定类的实例（heap scan）
     * @param className 要搜索的类名
     * @param callbacks 搜索回调
     */
    function choose(className: string, callbacks: ChooseCallbacks): void;
}

// ─── Interceptor (ObjC Hook + C Hook) ──────────────────────────

interface AttachCallbacks {
    /**
     * 原方法执行前调用
     * @param self 被调用对象的实例代理
     * @param sel 选择器名称
     * @param args 方法参数数组
     */
    onEnter?(self: ObjCProxy, sel: string, args: any[]): void;

    /**
     * 原方法执行后调用
     * @param retval 原方法返回值
     * @returns 返回非 undefined 值可修改原方法的返回值
     */
    onLeave?(retval: any): any;
}

type ReplacementFunction = (self: ObjCProxy, args: any[]) => any;

interface HookCFunctionResult {
    success: boolean;
    /** 原始函数地址 */
    original: number;
}

declare namespace Interceptor {
    /**
     * 拦截 ObjC 方法调用
     * @param selectorKey 格式为 "-[ClassName method:]" 或 "+[ClassName method:]"
     * @param callbacks 拦截回调
     */
    function attach(selectorKey: string, callbacks: AttachCallbacks): void;

    /**
     * 完全替换 ObjC 方法的实现
     * @param selectorKey 格式为 "-[ClassName method:]" 或 "+[ClassName method:]"
     * @param replacement 替换函数
     */
    function replace(selectorKey: string, replacement: ReplacementFunction): void;

    /**
     * 移除指定方法上的 Hook，恢复原始实现
     * @param selectorKey 之前 Hook 的方法标识
     */
    function detach(selectorKey: string): void;

    /** 移除所有已注册的 ObjC 方法 Hook */
    function detachAll(): void;

    /**
     * 列出所有当前活跃的 Hook
     * @returns 活跃 Hook 的 selectorKey 列表
     */
    function list(): string[];

    /**
     * 解析 C 符号的原始地址（fishhook）
     * @param symbolName C 函数符号名
     * @returns 函数原始地址，符号不存在返回 undefined
     */
    function rebindSymbol(symbolName: string): number | undefined;

    /**
     * 通过 fishhook 将 C 函数符号重绑定到另一个函数指针
     * @param symbolName 要 Hook 的 C 函数名
     * @param replacementAddress 替换函数的地址（必须是编译后的函数指针）
     * @returns 成功时返回结果对象，失败返回 false
     */
    function hookCFunction(symbolName: string, replacementAddress: number): HookCFunctionResult | false;
}

// ─── Module（模块与符号查找）──────────────────────────────────────

interface ModuleInfo {
    /** 模块完整路径 */
    name: string;
    /** 基地址（十六进制字符串，如 "0x100000000"） */
    base: string;
    /** ASLR 偏移量 */
    slide: number;
}

interface ModuleExportInfo {
    path: string;
    index: number;
}

declare namespace Module {
    /**
     * 在指定模块中查找导出符号的地址
     * @param moduleName 模块名（传 null 搜索所有已加载模块）
     * @param symbolName 符号名称
     * @returns 符号地址，未找到返回 undefined
     */
    function findExportByName(moduleName: string | null, symbolName: string): number | undefined;

    /**
     * 枚举所有已加载的 dyld 镜像
     * @returns 模块信息列表
     */
    function enumerateModules(): ModuleInfo[];

    /**
     * 查找指定模块名对应的 dyld 镜像信息
     * @param moduleName 模块名称
     */
    function enumerateExports(moduleName: string): ModuleExportInfo[];

    /** 当前的模块搜索路径数组 */
    const searchPaths: string[];

    /** 添加额外的模块搜索路径 */
    function addSearchPath(path: string): void;

    /** 清除已缓存的模块 */
    function clearCache(): void;

    /** 列出所有已缓存的模块 */
    function listCached(): Array<{ name: string; loaded: boolean }>;
}

// ─── $pointer（内存读写）─────────────────────────────────────────

type PointerType =
    | "int8" | "uint8" | "bool"
    | "int16" | "uint16"
    | "int32" | "uint32"
    | "float"
    | "int64" | "uint64"
    | "double"
    | "pointer"
    | "utf8"
    | "bytes";

interface AllocResult {
    /** 分配的内存地址 */
    address: number;
    /** 分配的大小 */
    size: number;
    /** 内部引用（用于生命周期管理） */
    _box: any;
}

declare namespace $pointer {
    /**
     * 从内存地址读取数据
     * @param address 内存地址
     * @param type 数据类型
     * @param count 读取数量（默认 1）
     */
    function read(address: number, type: PointerType, count?: number): any;

    /**
     * 向内存地址写入数据
     * @param address 内存地址
     * @param type 数据类型
     * @param value 要写入的值
     */
    function write(address: number, type: PointerType, value: any): void;

    /**
     * 在堆上分配指定大小的内存（calloc，初始化为零）
     * @param size 分配的字节数
     */
    function alloc(size: number): AllocResult;

    /**
     * 释放之前通过 $pointer.alloc 分配的内存
     * @param address 要释放的内存地址
     */
    function free(address: number): void;
}

// ─── $struct（结构体定义与操作）──────────────────────────────────

type StructFieldType =
    | "int8" | "uint8" | "bool"
    | "int16" | "uint16"
    | "int32" | "uint32"
    | "float"
    | "int64" | "uint64"
    | "double"
    | "pointer";

interface StructField {
    name: string;
    type: StructFieldType;
}

interface StructInstance {
    /** 底层内存指针 */
    _ptr: any;
    /** 结构体类型名 */
    _structName: string;
    /** 结构体字节大小 */
    _size: number;
    /** 获取底层指针对象 */
    toPointer(): any;
    /** 更新字段值 */
    update(values: Record<string, number>): void;
    /** 动态字段访问 */
    [field: string]: any;
}

interface StructConstructor {
    /** 结构体总字节大小 */
    size: number;
    /** 字段定义数组 */
    fields: StructField[];
    /** 创建结构体实例 */
    (initValues?: Record<string, number>): StructInstance;
}

/**
 * 定义 C 结构体的内存布局
 * @param name 结构体名称
 * @param fields 字段定义数组
 * @returns 结构体构造函数
 */
declare function $struct(name: string, fields: StructField[]): StructConstructor;

// ─── $block（Block 桥接）────────────────────────────────────────

/** 封装后的 ObjC Block 对象 */
interface BoxedBlock {}

/**
 * 将 JavaScript 函数包装为 ObjC Block 对象
 * @param fn JavaScript 回调函数
 * @param typeEncoding Block 的 ObjC 类型编码（如 "v@?", "v@?@", "@@?@"）
 * @returns 封装后的 Block 对象
 */
declare function $block(fn: (...args: any[]) => any, typeEncoding: string): BoxedBlock;

/**
 * 从 JavaScript 调用一个 ObjC Block
 * @param block Block 对象
 * @param typeEncoding Block 的类型编码
 * @param args 传递给 Block 的参数
 * @returns Block 的返回值
 */
declare function $callBlock(block: BoxedBlock, typeEncoding: string, ...args: any[]): any;

// ─── dispatch（线程调度）─────────────────────────────────────────

declare namespace dispatch {
    /**
     * 在主线程上同步执行函数（阻塞当前线程直到完成）。
     * 如果已在主线程则直接执行，不会死锁。
     * 适用于需要立即获取 UIKit 返回值的场景。
     * @param fn 要在主线程执行的函数
     * @returns fn 的返回值
     */
    function main<T>(fn: () => T): T;

    /**
     * 在主线程上异步执行函数（立即返回，不等待完成）。
     * 适用于修改 UI 但不需要返回值的场景。
     * @param fn 要在主线程执行的函数
     */
    function mainAsync(fn: () => void): void;

    /**
     * 延迟指定毫秒后在主线程上执行函数
     * @param delayMs 延迟时间（毫秒）
     * @param fn 要执行的函数
     */
    function after(delayMs: number, fn: () => void): void;

    /**
     * 检查当前是否在主线程上
     */
    function isMainThread(): boolean;
}

// ─── Debug（调试工具）────────────────────────────────────────────

declare namespace Debug {
    /** 触发 JavaScript debugger 语句 */
    function breakpoint(): void;

    /**
     * 带级别的结构化日志输出
     * @param level 日志级别
     * @param message 日志内容
     */
    function log(level: string, message: any): void;

    /**
     * 打印当前 JavaScript 调用栈
     * @returns 调用栈字符串
     */
    function trace(): string;

    /**
     * 开始一个命名计时器
     * @param label 计时器名称（默认 "default"）
     */
    function time(label?: string): void;

    /**
     * 结束命名计时器并输出耗时
     * @param label 计时器名称
     * @returns 经过的毫秒数
     */
    function timeEnd(label: string): number;

    /**
     * 获取当前进程的内存使用信息
     * @returns 内存大小（字节）
     */
    function heapSize(): { residentSize: number; virtualSize: number };

    /**
     * 获取当前的原生（C/ObjC）调用栈
     * @param maxFrames 最大帧数（默认 128，最大 256）
     * @returns 原生调用栈符号字符串数组
     */
    function nativeTrace(maxFrames?: number): string[];

    /**
     * 列出当前进程的所有线程信息
     * @returns 线程信息数组
     */
    function threads(): Array<{
        index: number;
        userTime: number;
        systemTime: number;
        cpuUsage: number;
        state: number;
        idle: boolean;
    }>;
}

// ─── Cookies（HTTP Cookie 管理）─────────────────────────────────

interface CookieInfo {
    name: string;
    value: string;
    domain: string;
    path: string;
    isSecure: boolean;
    isHTTPOnly: boolean;
    isSessionOnly: boolean;
    expires?: number;
    sameSite?: string;
}

declare namespace Cookies {
    /**
     * 获取所有 Cookie，可按域名过滤
     * @param domain 可选的域名后缀过滤
     */
    function getAll(domain?: string): CookieInfo[];

    /**
     * 获取指定名称的 Cookie
     * @param name Cookie 名称
     * @param domain 可选的域名过滤
     */
    function get(name: string, domain?: string): CookieInfo | null;

    /**
     * 添加或更新 Cookie
     * @param properties Cookie 属性
     * @returns 是否成功
     */
    function set(properties: Partial<CookieInfo> & { name: string; value: string; domain: string }): boolean;

    /**
     * 删除指定 Cookie
     * @param name Cookie 名称
     * @param domain Cookie 所属域名
     * @returns 是否成功删除
     */
    function remove(name: string, domain: string): boolean;

    /** 清除所有 Cookie */
    function clear(): void;
}

// ─── UserDefaults（偏好设置管理）─────────────────────────────────

interface SuiteInfo {
    /** Preferences plist 名（不含扩展名） */
    suiteName: string;
    /** 与 suiteName 相同，便于日志/遍历 */
    name: string;
    isDefault: boolean;
    /** plist 根字典键数量（无法解析时为 0） */
    keyCount: number;
}

declare namespace UserDefaults {
    /** 列出沙盒中所有可用的 Preferences plist 套件 */
    function suites(): SuiteInfo[];

    /**
     * 获取指定套件的所有键值对
     * @param suiteName 套件名（省略则使用标准 UserDefaults）
     */
    function getAll(suiteName?: string): Record<string, any>;

    /**
     * 获取单个键的值
     * @param key 键名
     * @param suiteName 套件名
     */
    function get(key: string, suiteName?: string): any;

    /**
     * 写入值（传 null/undefined 等同于 remove）
     * @param key 键名
     * @param value 值
     * @param suiteName 套件名
     * @returns 是否成功
     */
    function set(key: string, value: any, suiteName?: string): boolean;

    /**
     * 删除指定键
     * @param key 键名
     * @param suiteName 套件名
     * @returns 是否成功
     */
    function remove(key: string, suiteName?: string): boolean;

    /**
     * 清空指定套件的所有键值
     * @param suiteName 套件名
     */
    function clear(suiteName?: string): void;
}

// ─── FileSystem（沙盒文件操作）───────────────────────────────────

interface FileEntry {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    /** 修改时间（毫秒时间戳） */
    mtime: number;
    /** 创建时间（毫秒时间戳） */
    ctime: number;
}

interface FileStat {
    size: number;
    type: string;
    mtime: number;
    ctime: number;
    owner: string;
    permissions: string;
}

declare namespace FileSystem {
    /** 沙盒根目录绝对路径 */
    const home: string;

    /**
     * 列出目录内容
     * @param path 相对于沙盒根目录的路径（默认 "/"）
     */
    function list(path?: string): FileEntry[];

    /**
     * 以 UTF-8 读取文件内容
     * @param path 相对路径
     * @returns 文件内容，失败返回 null
     */
    function read(path: string): string | null;

    /**
     * 以 Base64 读取文件内容（适用于二进制文件）
     * @param path 相对路径
     * @returns Base64 字符串，失败返回 null
     */
    function readBytes(path: string): string | null;

    /**
     * 写入 UTF-8 文本到文件（自动创建中间目录）
     * @param path 相对路径
     * @param content 文本内容
     * @returns 是否成功
     */
    function write(path: string, content: string): boolean;

    /**
     * 检查路径是否存在
     * @param path 相对路径
     */
    function exists(path: string): { exists: boolean; isDir: boolean };

    /**
     * 获取文件/目录的详细属性
     * @param path 相对路径
     */
    function stat(path: string): FileStat | null;

    /**
     * 删除文件或空目录
     * @param path 相对路径
     * @returns 是否成功
     */
    function remove(path: string): boolean;

    /**
     * 创建目录（含中间目录）
     * @param path 相对路径
     * @returns 是否成功
     */
    function mkdir(path: string): boolean;
}

// ─── Performance（性能监控）──────────────────────────────────────

interface MemoryInfo {
    /** 常驻内存大小（字节） */
    used: number;
    /** 虚拟内存大小（字节） */
    virtual: number;
    /** 系统空闲内存（字节） */
    free: number;
}

interface CpuInfo {
    /** 所有线程的用户态 CPU 时间（秒） */
    userTime: number;
    /** 所有线程的内核态 CPU 时间（秒） */
    systemTime: number;
    /** 当前线程数 */
    threadCount: number;
}

interface PerformanceSnapshot {
    memory: MemoryInfo | null;
    cpu: CpuInfo | null;
    timestamp: number;
}

declare namespace Performance {
    /** 获取当前内存使用情况 */
    function memory(): MemoryInfo | null;

    /** 获取当前 CPU 使用情况 */
    function cpu(): CpuInfo | null;

    /**
     * 启动 FPS 监控，每秒回调一次当前帧率
     * @param callback 接收 FPS 值的回调函数
     */
    function fps(callback: (fps: number) => void): void;

    /** 停止 FPS 监控 */
    function stopFps(): void;

    /** 获取内存 + CPU 的组合快照 */
    function snapshot(): PerformanceSnapshot;
}

// ─── UIDebug（UI 调试工具）───────────────────────────────────────

interface ViewNode {
    class: string;
    address: string;
    frame: string;
    hidden: boolean;
    alpha: number;
    text?: string;
    title?: string;
    imageSize?: string;
    subviews?: ViewNode[];
}

interface ViewControllerInfo {
    class: string;
    title: string;
    address: string;
    depth: number;
}

declare namespace UIDebug {
    /** 获取 Key Window 信息 */
    function keyWindow(): { class: string; frame: string; address: string } | null;

    /** 获取完整的视图层级树 */
    function viewHierarchy(): ViewNode | null;

    /**
     * 截取 Key Window 的屏幕截图
     * @returns Base64 编码的 PNG 字符串
     */
    function screenshot(): string | null;

    /**
     * 截取指定视图的截图
     * @param address 视图内存地址（如 "0x1234abcd"）
     * @returns Base64 编码的 PNG 字符串
     */
    function screenshotView(address: string): string | null;

    /**
     * 获取指定视图的布局信息
     * @param address 视图内存地址
     */
    function bounds(address: string): {
        frame: string;
        bounds: string;
        center: string;
        hidden: boolean;
        alpha: number;
    } | null;

    /** 获取当前的 ViewController 层级列表 */
    function viewControllers(): ViewControllerInfo[];
}

// ─── require（CommonJS 模块加载）────────────────────────────────

/**
 * 加载并返回模块的 exports 对象
 * @param moduleName 模块名称或相对路径
 */
declare function require(moduleName: string): any;

// ─── 内置模块类型 ──────────────────────────────────────────────

interface EventEmitter {
    on(event: string, fn: (...args: any[]) => void): EventEmitter;
    emit(event: string, ...args: any[]): boolean;
    off(event: string, fn?: (...args: any[]) => void): void;
}

interface EventsModule {
    EventEmitter: new () => EventEmitter;
}

interface UtilModule {
    format(fmt: string, ...args: any[]): string;
    inspect(obj: any): string;
}
