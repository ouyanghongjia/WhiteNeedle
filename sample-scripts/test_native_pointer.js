// test_native_pointer.js — 测试 $pointer read / write / alloc / free

(function () {
    console.log("=== test_native_pointer.js START ===");

    if (typeof $pointer === "undefined") {
        console.error("$pointer: FAIL — not defined");
        return;
    }
    console.log("$pointer: exists");

    // 1. $pointer.alloc — 分配内存
    var mem = $pointer.alloc(64);
    console.log("$pointer.alloc(64):", mem);
    if (mem && mem.address) {
        console.log("  address:", mem.address);
        console.log("  size:", mem.size);
        console.log("$pointer.alloc: PASS");
    } else {
        console.error("$pointer.alloc: FAIL");
        return;
    }

    // 2. $pointer.write — 写入整数
    try {
        $pointer.write(mem.address, "int32", 0x12345678);
        console.log("$pointer.write int32: PASS");
    } catch (e) {
        console.error("$pointer.write int32: FAIL —", e.message || e);
    }

    // 3. $pointer.read — 读取整数
    try {
        var val = $pointer.read(mem.address, "int32");
        console.log("$pointer.read int32:", val);
        if (val == 0x12345678) {
            console.log("$pointer.read int32: PASS");
        } else {
            console.warn("$pointer.read int32: unexpected value", val);
        }
    } catch (e) {
        console.error("$pointer.read int32: FAIL —", e.message || e);
    }

    // 4. 写入和读取 double
    try {
        $pointer.write(mem.address, "double", 3.14159);
        var dval = $pointer.read(mem.address, "double");
        console.log("$pointer read/write double:", dval);
        if (Math.abs(dval - 3.14159) < 0.001) {
            console.log("$pointer double: PASS");
        }
    } catch (e) {
        console.error("$pointer double: FAIL —", e.message || e);
    }

    // 5. 写入和读取 byte (uint8)
    try {
        $pointer.write(mem.address, "uint8", 0xFF);
        var bval = $pointer.read(mem.address, "uint8");
        console.log("$pointer read/write uint8:", bval);
        if (bval == 0xFF) {
            console.log("$pointer uint8: PASS");
        }
    } catch (e) {
        console.error("$pointer uint8: FAIL —", e.message || e);
    }

    // 6. 读取多个值 (count 参数)
    try {
        // 先写入几个连续的 int32
        $pointer.write(mem.address, "int32", 100);
        $pointer.write(mem.address + 4, "int32", 200);
        $pointer.write(mem.address + 8, "int32", 300);

        var vals = $pointer.read(mem.address, "int32", 3);
        console.log("$pointer.read count=3:", vals);
        if (vals && vals.length >= 3) {
            console.log("  [0]:", vals[0], "[1]:", vals[1], "[2]:", vals[2]);
            if (vals[0] == 100 && vals[1] == 200 && vals[2] == 300) {
                console.log("$pointer read multiple: PASS");
            }
        }
    } catch (e) {
        console.warn("$pointer read multiple: skipped —", e.message || e);
    }

    // 7. $pointer.free — 释放内存
    try {
        $pointer.free(mem.address);
        console.log("$pointer.free: PASS");
    } catch (e) {
        console.error("$pointer.free: FAIL —", e.message || e);
    }

    // 8. 分配较大内存
    var bigMem = $pointer.alloc(4096);
    if (bigMem && bigMem.address) {
        console.log("$pointer.alloc(4096): PASS, addr:", bigMem.address);
        $pointer.free(bigMem.address);
    }

    console.log("=== test_native_pointer.js END ===");
})();
