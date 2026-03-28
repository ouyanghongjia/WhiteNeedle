// test_globals.js — 测试全局变量 __wnVersion, __wnEngine, Process, rpc

(function () {
    console.log("=== test_globals.js START ===");

    // 1. __wnVersion
    console.log("__wnVersion:", typeof __wnVersion, __wnVersion);
    if (typeof __wnVersion === "string" && __wnVersion.length > 0) {
        console.log("__wnVersion: PASS");
    } else {
        console.error("__wnVersion: FAIL — expected non-empty string");
    }

    // 2. __wnEngine
    console.log("__wnEngine:", typeof __wnEngine, __wnEngine);
    if (__wnEngine === "JavaScriptCore") {
        console.log("__wnEngine: PASS");
    } else {
        console.error("__wnEngine: FAIL — expected 'JavaScriptCore'");
    }

    // 3. __wnLog (internal logging)
    if (typeof __wnLog === "function") {
        __wnLog("__wnLog test message from JS");
        console.log("__wnLog: PASS — function exists and called");
    } else {
        console.error("__wnLog: FAIL — not a function");
    }

    // 4. Process namespace
    console.log("Process:", typeof Process);
    if (typeof Process === "object") {
        console.log("Process.platform:", Process.platform);
        console.log("Process.arch:", Process.arch);
        if (Process.platform === "ios") {
            console.log("Process.platform: PASS");
        } else {
            console.error("Process.platform: FAIL — expected 'ios'");
        }
        if (Process.arch === "arm64") {
            console.log("Process.arch: PASS");
        } else {
            console.warn("Process.arch:", Process.arch, "(may differ on simulator)");
        }
    } else {
        console.error("Process: FAIL — not an object");
    }

    // 5. rpc namespace
    console.log("rpc:", typeof rpc);
    if (typeof rpc === "object" && typeof rpc.exports === "object") {
        console.log("rpc.exports: PASS — object exists");
        rpc.exports.testFunc = function () {
            return "hello from rpc";
        };
        var result = rpc.exports.testFunc();
        console.log("rpc.exports.testFunc():", result);
        if (result === "hello from rpc") {
            console.log("rpc.exports: PASS — can set and call functions");
        }
    } else {
        console.error("rpc: FAIL — missing or malformed");
    }

    console.log("=== test_globals.js END ===");
})();
