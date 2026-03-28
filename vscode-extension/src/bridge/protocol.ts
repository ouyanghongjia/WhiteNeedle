/**
 * JSON-RPC protocol definitions for direct TCP communication between
 * VSCode extension and WhiteNeedle.dylib on the iOS device.
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
