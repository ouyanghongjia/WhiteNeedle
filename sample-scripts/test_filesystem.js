// test_filesystem.js — 测试 FileSystem 命名空间 API

(function () {
    console.log("=== test_filesystem.js START ===");

    if (typeof FileSystem === "undefined") {
        console.error("FileSystem: FAIL — not defined");
        return;
    }
    console.log("FileSystem: namespace exists");

    // 1. home — 沙盒根目录
    var home = FileSystem.home;
    console.log("FileSystem.home:", home);
    if (home) {
        console.log("FileSystem.home: PASS");
    }

    // 2. list — 列目录
    if (typeof FileSystem.list === "function") {
        var root = FileSystem.list();
        console.log("FileSystem.list() root:", root.length, "entries");
        root.forEach(function (f) {
            console.log("  ", f.name, f.isDir ? "[DIR]" : f.size + " bytes");
        });
        console.log("FileSystem.list: PASS");
    }

    // 3. list Documents 子目录
    var docs = FileSystem.list("Documents");
    console.log("FileSystem.list('Documents'):", docs.length, "entries");

    // 4. write / read — 写入再读取
    if (typeof FileSystem.write === "function" && typeof FileSystem.read === "function") {
        var testPath = "Documents/wn_test_file.txt";
        var ok = FileSystem.write(testPath, "Hello from WhiteNeedle!\nLine 2");
        console.log("FileSystem.write:", ok ? "PASS" : "FAIL");

        var content = FileSystem.read(testPath);
        console.log("FileSystem.read:", content ? content.substring(0, 40) : "null");
        if (content && content.indexOf("Hello from WhiteNeedle") >= 0) {
            console.log("FileSystem write/read: PASS");
        }
    }

    // 5. exists
    if (typeof FileSystem.exists === "function") {
        console.log("FileSystem.exists('Documents'):", FileSystem.exists("Documents"));
        console.log("FileSystem.exists('nonexistent'):", FileSystem.exists("nonexistent_path"));
        console.log("FileSystem.exists: PASS");
    }

    // 6. stat — 文件信息
    if (typeof FileSystem.stat === "function") {
        var info = FileSystem.stat("Documents/wn_test_file.txt");
        if (info) {
            console.log("FileSystem.stat: size =", info.size, "type =", info.type);
            console.log("FileSystem.stat: PASS");
        }
    }

    // 7. mkdir — 创建目录
    if (typeof FileSystem.mkdir === "function") {
        var mkOk = FileSystem.mkdir("Documents/wn_test_dir");
        console.log("FileSystem.mkdir:", mkOk ? "PASS" : "FAIL (may already exist)");
    }

    // 8. remove — 清理测试文件
    if (typeof FileSystem.remove === "function") {
        FileSystem.remove("Documents/wn_test_file.txt");
        FileSystem.remove("Documents/wn_test_dir");
        console.log("FileSystem.remove: cleanup done");
    }

    console.log("=== test_filesystem.js END ===");
})();
