/**
 * WhiteNeedle Engine API Type Definitions
 * Provides IntelliSense for WhiteNeedle script authoring (JavaScriptCore runtime).
 */

// ─── ObjC Bridge ($objc / ObjC.classes) ───────────────────────────────────────

declare namespace ObjC {
    /** Dictionary of all loaded ObjC classes (Frida-compatible) */
    const classes: { [name: string]: ObjCProxy };
}

interface ObjCProxy {
    /** Invoke a method on this ObjC object/class */
    invoke(selector: string, ...args: any[]): any;
    /** Get the string representation */
    toString(): string;
}

/**
 * Get a class proxy by name.
 * @example const app = $objc('UIApplication').invoke('sharedApplication');
 */
declare function $objc(className: string): ObjCProxy;

/**
 * Define a new ObjC class at runtime.
 * @example
 * $define('MyHandler', 'NSObject', {
 *   '- handleTap:': function(self, sender) { console.log('tapped'); }
 * });
 */
declare function $define(className: string, superClass: string, methods: {
    [selectorKey: string]: (...args: any[]) => any;
}): ObjCProxy;

/**
 * Create a delegate object implementing given methods.
 * @example
 * var delegate = $delegate({
 *   '- tableView:numberOfRowsInSection:': function(self, tv, section) { return 10; }
 * });
 */
declare function $delegate(methods: {
    [selectorKey: string]: (...args: any[]) => any;
}): ObjCProxy;

// ─── Interceptor (ObjC method hooks) ─────────────────────────────────────────

declare namespace Interceptor {
    /**
     * Hook an ObjC method.
     * @param target Selector key like '-[UIView setFrame:]' or '+[NSObject alloc]'
     * @param callbacks onEnter receives `self`, onLeave is called after original
     */
    function attach(target: string, callbacks: {
        onEnter?: (self: ObjCProxy) => void;
        onLeave?: () => void;
    }): void;

    /**
     * Replace an ObjC method implementation entirely.
     * @param target Selector key like '-[MyClass myMethod]'
     * @param replacement New implementation function
     */
    function replace(target: string, replacement: (...args: any[]) => any): void;

    /**
     * Resolve a C symbol and return its original address.
     * @param symbolName C function name (e.g., 'open', 'close')
     */
    function rebindSymbol(symbolName: string): number | undefined;

    /**
     * Hook a C function via fishhook GOT rebinding.
     * @param symbolName C function name
     * @param replacementAddress Address of replacement function
     */
    function hookCFunction(symbolName: string, replacementAddress: number): {
        success: boolean;
        original: number;
    };
}

// ─── $struct() ────────────────────────────────────────────────────────────────

interface StructField {
    name: string;
    type: 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' |
          'int64' | 'uint64' | 'float' | 'double' | 'pointer' | 'bool';
}

interface StructConstructor {
    (initValues?: Record<string, number>): StructInstance;
    size: number;
    fields: StructField[];
}

interface StructInstance {
    [fieldName: string]: any;
    _size: number;
    _structName: string;
    toPointer(): any;
    update(values: Record<string, number>): void;
}

/**
 * Define a C struct type.
 * @example
 * var CGPoint = $struct('CGPoint', [{name:'x',type:'double'},{name:'y',type:'double'}]);
 * var pt = CGPoint({x: 100, y: 200});
 */
declare function $struct(name: string, fields: StructField[]): StructConstructor;

// ─── $pointer ─────────────────────────────────────────────────────────────────

declare namespace $pointer {
    function read(address: number, type: string, count?: number): any;
    function write(address: number, type: string, value: any): void;
    function alloc(size: number): { address: number; size: number };
    function free(address: number): void;
}

// ─── Module ───────────────────────────────────────────────────────────────────

declare namespace Module {
    function findExportByName(moduleName: string | null, symbolName: string): number | undefined;
    function enumerateModules(): Array<{ name: string; base: string; slide: number }>;
    function enumerateExports(moduleName: string): Array<{ path: string; index: number }>;

    /** Module search paths for require() */
    var searchPaths: string[];
    function addSearchPath(path: string): void;
    function clearCache(): void;
    function listCached(): Array<{ name: string; loaded: boolean }>;
}

// ─── Debug ────────────────────────────────────────────────────────────────────

declare namespace Debug {
    function breakpoint(): void;
    function log(level: string, message: string): void;
    function trace(): string;
    function time(label?: string): void;
    function timeEnd(label?: string): number;
    function heapSize(): { residentSize: number; virtualSize: number } | undefined;
}

// ─── Process / Utility ────────────────────────────────────────────────────────

declare namespace Process {
    const arch: string;
    const platform: string;
    const pageSize: number;
}

/** WhiteNeedle engine version */
declare const __wnVersion: string;

// ─── RPC Exports ──────────────────────────────────────────────────────────────

declare namespace rpc {
    var exports: Record<string, (...args: any[]) => any>;
}

// ─── require() ────────────────────────────────────────────────────────────────

/**
 * Load a module from wn_modules/ search paths or builtins.
 * Supports CommonJS (module.exports) pattern.
 */
declare function require(moduleName: string): any;

// ─── Timers ───────────────────────────────────────────────────────────────────

declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(id: number): void;
declare function setInterval(callback: () => void, ms: number): number;
declare function clearInterval(id: number): void;
