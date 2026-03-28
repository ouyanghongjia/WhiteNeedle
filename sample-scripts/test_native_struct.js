// test_native_struct.js — 测试 $struct 定义和操作
// 注意: $struct 字段格式为 [{name: "x", type: "double"}, ...] 数组
// 支持的类型: int8, uint8, bool, int16, uint16, int32, uint32, float, int64, uint64, double, pointer

(function () {
    console.log("=== test_native_struct.js START ===");

    if (typeof $struct !== "function") {
        console.error("$struct: FAIL — function not found");
        return;
    }
    console.log("$struct: function exists");

    // 1. 定义 CGPoint 等效结构体
    var CGPoint = $struct("TestCGPoint", [
        { name: "x", type: "double" },
        { name: "y", type: "double" }
    ]);
    console.log("$struct CGPoint:", CGPoint);
    if (CGPoint) {
        console.log("$struct creation: PASS");
        console.log("  size:", CGPoint.size);
        console.log("  fields:", JSON.stringify(CGPoint.fields));
        if (CGPoint.size === 16) {
            console.log("  size check (2 doubles = 16): PASS");
        } else {
            console.warn("  size check: expected 16, got", CGPoint.size);
        }
    } else {
        console.error("$struct creation: FAIL");
        return;
    }

    // 2. 创建结构体实例
    var point = CGPoint({ x: 100.5, y: 200.75 });
    console.log("struct instance:", point);
    if (point) {
        console.log("struct instantiation: PASS");
        console.log("  x:", point.x, "y:", point.y);
        if (point.x === 100.5 && point.y === 200.75) {
            console.log("  field values: PASS");
        } else {
            console.warn("  field values: unexpected x=", point.x, "y=", point.y);
        }
    }

    // 3. 定义 CGSize 等效结构体
    var CGSize = $struct("TestCGSize", [
        { name: "width", type: "double" },
        { name: "height", type: "double" }
    ]);
    var size = CGSize({ width: 320, height: 480 });
    console.log("CGSize:", size.width, "x", size.height);
    if (size.width == 320 && size.height == 480) {
        console.log("CGSize struct: PASS");
    }

    // 4. 定义 CGRect 等效结构体 (4 个 double 字段)
    var CGRect = $struct("TestCGRect", [
        { name: "x", type: "double" },
        { name: "y", type: "double" },
        { name: "width", type: "double" },
        { name: "height", type: "double" }
    ]);
    var rect = CGRect({ x: 10, y: 20, width: 300, height: 400 });
    console.log("CGRect:", rect.x, rect.y, rect.width, rect.height);
    if (rect.x == 10 && rect.width == 300) {
        console.log("CGRect struct: PASS");
    }
    if (CGRect.size === 32) {
        console.log("CGRect size (4 doubles = 32): PASS");
    }

    // 5. 结构体 update
    if (point && typeof point.update === "function") {
        point.update({ x: 999 });
        console.log("struct update called");
        console.log("struct update: PASS — no crash");
    } else {
        console.warn("struct update: method not available");
    }

    // 6. 定义带整数字段的结构体 (使用 int32 而非 int)
    var IntPair = $struct("TestIntPair", [
        { name: "a", type: "int32" },
        { name: "b", type: "int32" }
    ]);
    var pair = IntPair({ a: 42, b: -7 });
    console.log("IntPair:", pair.a, pair.b);
    if (pair.a == 42 && pair.b == -7) {
        console.log("int32 struct: PASS");
    }
    if (IntPair.size === 8) {
        console.log("IntPair size (2 int32 = 8): PASS");
    }

    // 7. float 类型结构体
    var FloatVec = $struct("TestFloatVec", [
        { name: "x", type: "float" },
        { name: "y", type: "float" },
        { name: "z", type: "float" }
    ]);
    var vec = FloatVec({ x: 1.5, y: 2.5, z: 3.5 });
    console.log("FloatVec:", vec.x, vec.y, vec.z);
    if (FloatVec.size === 12) {
        console.log("FloatVec size (3 floats = 12): PASS");
    }

    // 8. toPointer
    if (point && typeof point.toPointer === "function") {
        var ptr = point.toPointer();
        console.log("struct toPointer:", ptr);
        console.log("toPointer: PASS");
    } else {
        console.warn("struct toPointer: method not available");
    }

    // 9. 混合类型结构体
    var MixedStruct = $struct("TestMixed", [
        { name: "flag", type: "uint8" },
        { name: "count", type: "int32" },
        { name: "value", type: "double" }
    ]);
    var mixed = MixedStruct({ flag: 1, count: 100, value: 3.14 });
    console.log("MixedStruct: flag=", mixed.flag, "count=", mixed.count, "value=", mixed.value);
    if (mixed.flag == 1 && mixed.count == 100) {
        console.log("mixed type struct: PASS");
    }

    console.log("=== test_native_struct.js END ===");
})();
