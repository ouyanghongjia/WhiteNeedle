// test_leak_detector.js — LeakDetector 完整测试
// 演示: 快照对比、实例搜索、引用扫描、循环检测

(function () {
    console.log("=== test_leak_detector.js START ===");
    console.log("");

    // ─────────────────────────────────────────────
    // Step 1: 拍摄基线快照
    // ─────────────────────────────────────────────
    console.log("▶ Step 1: 拍摄基线快照 (before)...");
    var beforeTag = LeakDetector.takeSnapshot("before");
    console.log("  快照 ID:", beforeTag);
    console.log("");

    // ─────────────────────────────────────────────
    // Step 2: 制造内存泄漏
    // ─────────────────────────────────────────────
    console.log("▶ Step 2: 制造内存泄漏...");

    var LeakExamples = ObjC.use("WNLeakExamples");
    if (!LeakExamples) {
        console.error("  ✗ WNLeakExamples 类未找到，请确保已添加到工程中");
        return;
    }

    // 2a: 创建循环引用 (A <-> B)
    console.log("  2a. 创建 3 组循环引用 (WNRetainCycleA <-> WNRetainCycleB)...");
    LeakExamples.invoke("createRetainCycle");
    LeakExamples.invoke("createRetainCycle");
    LeakExamples.invoke("createRetainCycle");

    // 2b: 创建 Timer 泄漏
    console.log("  2b. 创建 Timer 泄漏 (WNTimerLeaker)...");
    LeakExamples.invoke("createTimerLeak");

    // 2c: 创建 Block 捕获泄漏
    console.log("  2c. 创建 2 个 Block 捕获泄漏 (WNBlockCaptureLeak)...");
    LeakExamples.invoke("createBlockCaptureLeak");
    LeakExamples.invoke("createBlockCaptureLeak");

    // 2d: 累积孤立对象
    console.log("  2d. 累积 20 个孤立对象 (WNOrphanedObject)...");
    LeakExamples.invoke("accumulateOrphanedObjects:", [20]);

    console.log("  ✓ 所有泄漏场景已创建");
    console.log("");

    // ─────────────────────────────────────────────
    // Step 3: 拍摄第二次快照
    // ─────────────────────────────────────────────
    console.log("▶ Step 3: 拍摄操作后快照 (after)...");
    var afterTag = LeakDetector.takeSnapshot("after");
    console.log("  快照 ID:", afterTag);
    console.log("");

    // ─────────────────────────────────────────────
    // Step 4: 对比快照 — 找出增长的类
    // ─────────────────────────────────────────────
    console.log("▶ Step 4: 对比快照差异...");
    var diff = LeakDetector.diffSnapshots("before", "after");

    if (!diff || !diff.grown || diff.grown.length === 0) {
        console.warn("  ⚠ 未检测到实例增长（可能快照间隔太短）");
    } else {
        console.log("  检测到 " + diff.grown.length + " 个类的实例数增长:");
        console.log("  ┌─────────────────────────────┬────────┬────────┬───────┐");
        console.log("  │ 类名                        │ 之前   │ 之后   │ 增量  │");
        console.log("  ├─────────────────────────────┼────────┼────────┼───────┤");

        var leakyClasses = [
            "WNRetainCycleA", "WNRetainCycleB",
            "WNTimerLeaker", "WNBlockCaptureLeak", "WNOrphanedObject"
        ];
        var foundLeaks = [];

        for (var i = 0; i < diff.grown.length && i < 30; i++) {
            var item = diff.grown[i];
            var name = item.className;
            var padded = name + "                              ".substring(0, 28 - name.length);
            var marker = "";
            if (leakyClasses.indexOf(name) >= 0) {
                marker = " ← LEAK!";
                foundLeaks.push(name);
            }
            console.log("  │ " + padded + "│ " +
                        padLeft(item.before, 6) + " │ " +
                        padLeft(item.after, 6) + " │ " +
                        padLeft("+" + item.delta, 5) + " │" + marker);
        }
        console.log("  └─────────────────────────────┴────────┴────────┴───────┘");

        if (diff.grown.length > 30) {
            console.log("  ... 还有 " + (diff.grown.length - 30) + " 个类省略");
        }

        console.log("");
        console.log("  检测到的泄漏类: " + (foundLeaks.length > 0 ? foundLeaks.join(", ") : "无"));
    }
    console.log("");

    // ─────────────────────────────────────────────
    // Step 5: 搜索特定泄漏类的实例
    // ─────────────────────────────────────────────
    console.log("▶ Step 5: 搜索堆上的泄漏实例...");

    var searchTargets = [
        "WNRetainCycleA",
        "WNRetainCycleB",
        "WNTimerLeaker",
        "WNBlockCaptureLeak",
        "WNOrphanedObject"
    ];

    var foundAddresses = {};

    for (var t = 0; t < searchTargets.length; t++) {
        var target = searchTargets[t];
        var instances = LeakDetector.findInstances(target, false, 50);
        if (instances && instances.length > 0) {
            console.log("  " + target + ": 找到 " + instances.length + " 个实例");
            for (var j = 0; j < instances.length && j < 3; j++) {
                console.log("    [" + j + "] addr=" + instances[j].address +
                            " size=" + instances[j].size + "B");
            }
            if (instances.length > 3) {
                console.log("    ... 还有 " + (instances.length - 3) + " 个");
            }
            foundAddresses[target] = instances[0].address;
        } else {
            console.log("  " + target + ": 未找到实例");
        }
    }
    console.log("");

    // ─────────────────────────────────────────────
    // Step 6: 检查循环引用链
    // ─────────────────────────────────────────────
    console.log("▶ Step 6: 循环引用检测...");

    if (foundAddresses["WNRetainCycleA"]) {
        var addr = foundAddresses["WNRetainCycleA"];
        console.log("  对 WNRetainCycleA (" + addr + ") 进行循环检测:");
        var cycles = LeakDetector.detectCycles(addr, 10);
        if (cycles && cycles.length > 0) {
            console.log("  ✓ 检测到 " + cycles.length + " 个循环引用!");
            for (var c = 0; c < cycles.length; c++) {
                var cycle = cycles[c];
                var chain = [];
                for (var n = 0; n < cycle.length; n++) {
                    chain.push(cycle[n].className + "(" + cycle[n].address + ")");
                }
                console.log("    Cycle " + (c + 1) + ": " + chain.join(" → "));
            }
        } else {
            console.log("  ⚠ 未检测到循环（可能对象已被回收或深度不足）");
        }
    } else {
        console.log("  跳过: 未找到 WNRetainCycleA 实例");
    }
    console.log("");

    // ─────────────────────────────────────────────
    // Step 7: 查看强引用关系
    // ─────────────────────────────────────────────
    console.log("▶ Step 7: 查看强引用关系 (ivar 扫描)...");

    if (foundAddresses["WNRetainCycleA"]) {
        var addrA = foundAddresses["WNRetainCycleA"];
        console.log("  WNRetainCycleA (" + addrA + ") 的强引用:");
        var refsA = LeakDetector.getStrongReferences(addrA);
        if (refsA && refsA.length > 0) {
            for (var r = 0; r < refsA.length; r++) {
                console.log("    ivar: " + refsA[r].name +
                            "  type: " + refsA[r].type +
                            "  → " + refsA[r].className + "(" + refsA[r].address + ")");
            }
        } else {
            console.log("    无强引用");
        }
    }

    if (foundAddresses["WNBlockCaptureLeak"]) {
        var addrB = foundAddresses["WNBlockCaptureLeak"];
        console.log("  WNBlockCaptureLeak (" + addrB + ") 的强引用:");
        var refsB = LeakDetector.getStrongReferences(addrB);
        if (refsB && refsB.length > 0) {
            for (var r2 = 0; r2 < refsB.length; r2++) {
                console.log("    ivar: " + refsB[r2].name +
                            "  type: " + refsB[r2].type +
                            "  → " + refsB[r2].className + "(" + refsB[r2].address + ")");
            }
        }
    }
    console.log("");

    // ─────────────────────────────────────────────
    // Step 8: 清理快照
    // ─────────────────────────────────────────────
    console.log("▶ Step 8: 清理快照...");
    LeakDetector.clearAllSnapshots();
    console.log("  ✓ 快照已清理");
    console.log("");

    // ─────────────────────────────────────────────
    // 结果汇总
    // ─────────────────────────────────────────────
    console.log("═══════════════════════════════════════════");
    console.log("  LeakDetector 测试完成!");
    console.log("  已验证功能: takeSnapshot / diffSnapshots /");
    console.log("    findInstances / detectCycles /");
    console.log("    getStrongReferences / clearAllSnapshots");
    console.log("═══════════════════════════════════════════");
    console.log("");
    console.log("=== test_leak_detector.js END ===");

    function padLeft(val, width) {
        var s = String(val);
        while (s.length < width) s = " " + s;
        return s;
    }
})();
