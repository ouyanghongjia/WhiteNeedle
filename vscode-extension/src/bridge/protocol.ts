/**
 * JSON-RPC protocol definitions for direct TCP communication between
 * VSCode extension and WhiteNeedle on the iOS device.
 *
 * Extension -> Device (Requests):
 *   loadScript     { code: string, name: string }
 *   unloadScript   { name: string }
 *   evaluate       { code: string }
 *   rpcCall        { method: string, args: any[] }
 *   listScripts    {}
 *   listHooks      {}
 *   getClassNames  { filter?: string }
 *   getMethods     { className: string }
 *
 * Device -> Extension (Notifications):
 *   console        { level: string, message: string }
 *   scriptError    { message: string }
 *
 * Leak Detector JS API (via evaluate):
 *   LeakDetector.takeSnapshot(tag?, filter?)       → snapshotId
 *   LeakDetector.diffSnapshots(tagBefore, tagAfter) → { grown: [...] }
 *   LeakDetector.clearSnapshot(tag)
 *   LeakDetector.clearAllSnapshots()
 *   LeakDetector.getStrongReferences(addressHex)   → [{ name, type, address, className }]
 *   LeakDetector.scanReferences(addressHex, max?)  → [{ offset, address, className }]
 *   LeakDetector.detectCycles(addressHex, depth?)   → [[cycle nodes...], ...]
 *   LeakDetector.findInstances(className, subs?, max?) → [{ address, className, size }]
 */

export interface LoadScriptParams {
    code: string;
    name: string;
}

export interface UnloadScriptParams {
    name: string;
}

export interface EvaluateParams {
    code: string;
}

export interface RpcCallParams {
    method: string;
    args: unknown[];
}

export interface GetClassNamesParams {
    filter?: string;
}

export interface GetMethodsParams {
    className: string;
}

export interface ConsoleNotification {
    level: 'log' | 'warn' | 'error' | 'info' | 'debug';
    message: string;
}

export interface ScriptErrorNotification {
    message: string;
    stack?: string;
    lineNumber?: number;
    fileName?: string;
}
