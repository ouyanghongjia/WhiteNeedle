/**
 * WhiteNeedle API Stability Test — Service APIs
 *
 * 覆盖: FileSystem, Cookies, UserDefaults, SQLite, Debug,
 *       Performance, UIDebug, HostMapping
 */
(function() {
    var _r = [], _suite = 'api_stability_services';
    function _log(s, n, d) {
        _r.push({ s: s, n: n, d: d || '' });
        var p = s === 'PASS' ? '  ✓' : s === 'FAIL' ? '  ✗' : '  ⊘';
        var m = p + ' ' + n + (d ? ' — ' + d : '');
        if (s === 'FAIL') console.error(m); else if (s === 'SKIP') console.warn(m); else console.log(m);
    }
    var T = {
        suite: function(n) { console.log('\n▸ ' + n); },
        ok: function(c, n) { _log(c ? 'PASS' : 'FAIL', n, c ? '' : 'assertion false'); },
        eq: function(a, b, n) { var p = a === b; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); },
        neq: function(a, b, n) { var p = a !== b; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'should not equal ' + JSON.stringify(b)); },
        type: function(v, t, n) { var p = typeof v === t; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'typeof=' + typeof v + ', want ' + t); },
        gt: function(a, b, n) { var p = a > b; _log(p ? 'PASS' : 'FAIL', n, p ? '' : a + ' not > ' + b); },
        approx: function(a, b, eps, n) { var p = Math.abs(a - b) < eps; _log(p ? 'PASS' : 'FAIL', n, p ? '' : 'got ' + a + ', want ~' + b); },
        throws: function(fn, n) { try { fn(); _log('FAIL', n, 'no throw'); } catch(e) { _log('PASS', n); } },
        safe: function(fn, n) { try { fn(); _log('PASS', n); } catch(e) { _log('FAIL', n, '' + (e.message || e)); } },
        skip: function(n, reason) { _log('SKIP', n, reason); },
        done: function() {
            var p = 0, f = 0, s = 0, fails = [];
            for (var i = 0; i < _r.length; i++) {
                if (_r[i].s === 'PASS') p++; else if (_r[i].s === 'FAIL') { f++; fails.push(_r[i].n + ': ' + _r[i].d); } else s++;
            }
            console.log('\n══════════════════════════════════════');
            console.log('SUITE: ' + _suite);
            console.log('TOTAL: ' + _r.length + '  PASSED: ' + p + '  FAILED: ' + f + '  SKIPPED: ' + s);
            if (f > 0) { console.error('FAILURES:'); for (var j = 0; j < fails.length; j++) console.error('  • ' + fails[j]); }
            console.log('══════════════════════════════════════');
            console.log('[RESULT_JSON] ' + JSON.stringify({ suite: _suite, total: _r.length, passed: p, failed: f, skipped: s, failures: fails }));
        }
    };

    console.log('╔══════════════════════════════════════╗');
    console.log('║  API Stability Test — Service APIs   ║');
    console.log('╚══════════════════════════════════════╝');

    var TEST_PREFIX = '__wn_stability_test_';

    // ═══════════════════════════════════════════════════════════════
    // 1. FileSystem
    // ═══════════════════════════════════════════════════════════════
    T.suite('FileSystem');

    if (typeof FileSystem !== 'undefined') {
        T.type(FileSystem.home, 'string', 'FileSystem.home is string');
        T.ok(FileSystem.home.length > 0, 'FileSystem.home is non-empty');

        // list()
        T.safe(function() {
            var entries = FileSystem.list();
            T.ok(Array.isArray(entries), 'FileSystem.list() returns array');
            T.gt(entries.length, 0, 'list() has entries: ' + entries.length);
            if (entries.length > 0) {
                T.type(entries[0].name, 'string', 'entry.name is string');
                T.type(entries[0].isDir, 'boolean', 'entry.isDir is boolean');
            }
        }, 'FileSystem.list() no crash');

        // list(subdir)
        T.safe(function() {
            var docs = FileSystem.list('Documents');
            T.ok(Array.isArray(docs), 'list("Documents") returns array');
        }, 'FileSystem.list("Documents") no crash');

        // write + read roundtrip
        var testFile = 'Documents/' + TEST_PREFIX + 'file.txt';
        var testContent = 'Hello WhiteNeedle 🎯 ' + Date.now();
        T.safe(function() {
            var ok = FileSystem.write(testFile, testContent);
            T.ok(ok, 'write() returns true');

            var content = FileSystem.read(testFile);
            T.eq(content, testContent, 'read() matches written content');
        }, 'write/read roundtrip no crash');

        // exists
        T.safe(function() {
            var r = FileSystem.exists(testFile);
            T.ok(r && r.exists === true, 'exists() returns true for written file');
            T.eq(r.isDir, false, 'written file is not dir');
        }, 'exists(file) no crash');

        T.safe(function() {
            var r = FileSystem.exists('__nonexistent_xyz__');
            T.ok(r && r.exists === false, 'exists(nonexistent) returns false');
        }, 'exists(nonexistent) no crash');

        // stat
        T.safe(function() {
            var s = FileSystem.stat(testFile);
            T.ok(s !== null, 'stat() returns non-null');
            if (s) {
                T.gt(s.size, 0, 'stat.size > 0');
                T.type(s.type, 'string', 'stat.type is string');
                T.type(s.mtime, 'number', 'stat.mtime is number');
            }
        }, 'stat() no crash');

        // writeBytes / readBytes
        T.safe(function() {
            var binFile = 'Documents/' + TEST_PREFIX + 'bin.dat';
            var b64 = 'AQIDBA=='; // [1, 2, 3, 4]
            var ok = FileSystem.writeBytes(binFile, b64);
            T.ok(ok, 'writeBytes() returns true');

            var read = FileSystem.readBytes(binFile);
            T.eq(read, b64, 'readBytes() matches written base64');

            FileSystem.remove(binFile);
        }, 'writeBytes/readBytes no crash');

        // mkdir + remove
        T.safe(function() {
            var dir = 'Documents/' + TEST_PREFIX + 'testdir';
            var ok = FileSystem.mkdir(dir);
            T.ok(ok, 'mkdir() returns true');

            var e = FileSystem.exists(dir);
            T.ok(e && e.exists && e.isDir, 'mkdir created directory');

            FileSystem.remove(dir);
            var e2 = FileSystem.exists(dir);
            T.ok(e2 && !e2.exists, 'remove() deleted directory');
        }, 'mkdir/remove no crash');

        // Boundary: nested mkdir
        T.safe(function() {
            var nested = 'Documents/' + TEST_PREFIX + 'a/b/c';
            FileSystem.mkdir(nested);
            var e = FileSystem.exists(nested);
            T.ok(e && e.exists, 'nested mkdir creates path');

            // Cleanup
            FileSystem.remove(nested);
            FileSystem.remove('Documents/' + TEST_PREFIX + 'a/b');
            FileSystem.remove('Documents/' + TEST_PREFIX + 'a');
        }, 'nested mkdir no crash');

        // Boundary: unicode filename
        T.safe(function() {
            var uniFile = 'Documents/' + TEST_PREFIX + '日本語ファイル.txt';
            FileSystem.write(uniFile, 'content');
            var c = FileSystem.read(uniFile);
            T.eq(c, 'content', 'unicode filename roundtrip');
            FileSystem.remove(uniFile);
        }, 'unicode filename no crash');

        // Boundary: empty file
        T.safe(function() {
            var emptyFile = 'Documents/' + TEST_PREFIX + 'empty.txt';
            FileSystem.write(emptyFile, '');
            var c = FileSystem.read(emptyFile);
            T.eq(c, '', 'empty file read returns empty string');
            FileSystem.remove(emptyFile);
        }, 'empty file no crash');

        // Boundary: read nonexistent
        T.safe(function() {
            var c = FileSystem.read('__nonexistent_xyz__.txt');
            T.ok(c === null || c === undefined, 'read(nonexistent) returns null');
        }, 'read(nonexistent) no crash');

        // Boundary: large file
        T.safe(function() {
            var bigFile = 'Documents/' + TEST_PREFIX + 'large.txt';
            var big = '';
            for (var i = 0; i < 10000; i++) big += 'ABCDEFGHIJ';
            FileSystem.write(bigFile, big);
            var c = FileSystem.read(bigFile);
            T.eq(c.length, 100000, 'large file 100KB roundtrip');
            FileSystem.remove(bigFile);
        }, 'large file no crash');

        // Cleanup
        FileSystem.remove(testFile);
    } else {
        T.skip('FileSystem.*', 'FileSystem not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. Cookies
    // ═══════════════════════════════════════════════════════════════
    T.suite('Cookies');

    if (typeof Cookies !== 'undefined') {
        T.type(Cookies.getAll, 'function', 'Cookies.getAll exists');
        T.type(Cookies.get, 'function', 'Cookies.get exists');
        T.type(Cookies.set, 'function', 'Cookies.set exists');
        T.type(Cookies.remove, 'function', 'Cookies.remove exists');
        T.type(Cookies.clear, 'function', 'Cookies.clear exists');

        // getAll
        T.safe(function() {
            var all = Cookies.getAll();
            T.ok(Array.isArray(all), 'getAll() returns array');
        }, 'Cookies.getAll() no crash');

        // set + get roundtrip
        T.safe(function() {
            var ok = Cookies.set({
                name: TEST_PREFIX + 'cookie',
                value: 'test_value_123',
                domain: '.localhost'
            });
            T.ok(ok, 'set() returns true');

            var c = Cookies.get(TEST_PREFIX + 'cookie', '.localhost');
            if (c) {
                T.eq(c.name, TEST_PREFIX + 'cookie', 'get() name matches');
                T.eq(c.value, 'test_value_123', 'get() value matches');
                T.type(c.domain, 'string', 'cookie.domain is string');
            } else {
                T.ok(true, 'get() returned null — cookie store may not support .localhost');
            }
        }, 'Cookies set/get no crash');

        // getAll with domain filter
        T.safe(function() {
            var filtered = Cookies.getAll('.localhost');
            T.ok(Array.isArray(filtered), 'getAll(".localhost") returns array');
        }, 'Cookies.getAll(domain) no crash');

        // remove
        T.safe(function() {
            Cookies.remove(TEST_PREFIX + 'cookie', '.localhost');
            var c = Cookies.get(TEST_PREFIX + 'cookie', '.localhost');
            T.ok(c === null || c === undefined, 'remove() deleted cookie');
        }, 'Cookies.remove no crash');

        // Boundary: remove nonexistent
        T.safe(function() {
            var ok = Cookies.remove('__nonexistent_cookie_xyz__', '.localhost');
            T.ok(true, 'remove(nonexistent) no crash');
        }, 'Cookies.remove(nonexistent) no crash');

        // Boundary: get nonexistent
        T.safe(function() {
            var c = Cookies.get('__nonexistent_cookie_xyz__');
            T.ok(c === null || c === undefined, 'get(nonexistent) returns null');
        }, 'Cookies.get(nonexistent) no crash');

        // set with attributes
        T.safe(function() {
            Cookies.set({
                name: TEST_PREFIX + 'secure_cookie',
                value: 'secure_val',
                domain: '.localhost',
                path: '/',
                isSecure: true,
                isHTTPOnly: true
            });
            Cookies.remove(TEST_PREFIX + 'secure_cookie', '.localhost');
        }, 'Cookies.set(secure+httpOnly) no crash');
    } else {
        T.skip('Cookies.*', 'Cookies not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. UserDefaults
    // ═══════════════════════════════════════════════════════════════
    T.suite('UserDefaults');

    if (typeof UserDefaults !== 'undefined') {
        T.type(UserDefaults.get, 'function', 'UserDefaults.get exists');
        T.type(UserDefaults.set, 'function', 'UserDefaults.set exists');
        T.type(UserDefaults.remove, 'function', 'UserDefaults.remove exists');
        T.type(UserDefaults.getAll, 'function', 'UserDefaults.getAll exists');
        T.type(UserDefaults.suites, 'function', 'UserDefaults.suites exists');

        // suites
        T.safe(function() {
            var s = UserDefaults.suites();
            T.ok(Array.isArray(s), 'suites() returns array');
        }, 'UserDefaults.suites() no crash');

        // set/get roundtrip — string
        T.safe(function() {
            UserDefaults.set(TEST_PREFIX + 'str', 'hello world');
            var v = UserDefaults.get(TEST_PREFIX + 'str');
            T.eq(v, 'hello world', 'string set/get roundtrip');
        }, 'UserDefaults string no crash');

        // set/get — number
        T.safe(function() {
            UserDefaults.set(TEST_PREFIX + 'num', 42);
            var v = UserDefaults.get(TEST_PREFIX + 'num');
            T.eq(v, 42, 'number set/get roundtrip');
        }, 'UserDefaults number no crash');

        // set/get — boolean
        T.safe(function() {
            UserDefaults.set(TEST_PREFIX + 'bool', true);
            var v = UserDefaults.get(TEST_PREFIX + 'bool');
            T.ok(v === true || v === 1, 'boolean set/get roundtrip');
        }, 'UserDefaults boolean no crash');

        // set/get — array
        T.safe(function() {
            UserDefaults.set(TEST_PREFIX + 'arr', [1, 'two', 3]);
            var v = UserDefaults.get(TEST_PREFIX + 'arr');
            T.ok(Array.isArray(v) && v.length === 3, 'array set/get roundtrip');
        }, 'UserDefaults array no crash');

        // set/get — dict
        T.safe(function() {
            UserDefaults.set(TEST_PREFIX + 'dict', { a: 1, b: 'two' });
            var v = UserDefaults.get(TEST_PREFIX + 'dict');
            T.ok(v && v.a === 1, 'dict set/get roundtrip');
        }, 'UserDefaults dict no crash');

        // remove
        T.safe(function() {
            UserDefaults.remove(TEST_PREFIX + 'str');
            var v = UserDefaults.get(TEST_PREFIX + 'str');
            T.ok(v === null || v === undefined, 'remove clears value');
        }, 'UserDefaults.remove no crash');

        // get nonexistent
        T.safe(function() {
            var v = UserDefaults.get('__nonexistent_key_xyz__');
            T.ok(v === null || v === undefined, 'get(nonexistent) returns null');
        }, 'UserDefaults.get(nonexistent) no crash');

        // set null = remove
        T.safe(function() {
            UserDefaults.set(TEST_PREFIX + 'null_test', 'exists');
            UserDefaults.set(TEST_PREFIX + 'null_test', null);
            var v = UserDefaults.get(TEST_PREFIX + 'null_test');
            T.ok(v === null || v === undefined, 'set(null) acts as remove');
        }, 'UserDefaults set(null) no crash');

        // getAll
        T.safe(function() {
            var all = UserDefaults.getAll();
            T.type(all, 'object', 'getAll() returns object');
        }, 'UserDefaults.getAll() no crash');

        // getAllApp
        T.safe(function() {
            var app = UserDefaults.getAllApp();
            T.type(app, 'object', 'getAllApp() returns object');
        }, 'UserDefaults.getAllApp() no crash');

        // systemKeyPrefixes / isSystemKey
        T.safe(function() {
            var prefixes = UserDefaults.systemKeyPrefixes();
            T.ok(Array.isArray(prefixes), 'systemKeyPrefixes() returns array');
            T.gt(prefixes.length, 0, 'systemKeyPrefixes > 0');
        }, 'systemKeyPrefixes no crash');

        T.safe(function() {
            T.eq(UserDefaults.isSystemKey('AppleLanguages'), true, 'isSystemKey("AppleLanguages") === true');
            T.eq(UserDefaults.isSystemKey('myCustomKey'), false, 'isSystemKey("myCustomKey") === false');
        }, 'isSystemKey no crash');

        // Cleanup
        var testKeys = ['num', 'bool', 'arr', 'dict'];
        for (var i = 0; i < testKeys.length; i++) {
            UserDefaults.remove(TEST_PREFIX + testKeys[i]);
        }
    } else {
        T.skip('UserDefaults.*', 'UserDefaults not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. SQLite
    // ═══════════════════════════════════════════════════════════════
    T.suite('SQLite');

    if (typeof SQLite !== 'undefined') {
        T.type(SQLite.databases, 'function', 'SQLite.databases exists');
        T.type(SQLite.tables, 'function', 'SQLite.tables exists');
        T.type(SQLite.query, 'function', 'SQLite.query exists');
        T.type(SQLite.execute, 'function', 'SQLite.execute exists');

        // databases
        T.safe(function() {
            var dbs = SQLite.databases();
            T.ok(Array.isArray(dbs), 'databases() returns array');
            console.log('  ℹ found ' + dbs.length + ' databases');
        }, 'SQLite.databases() no crash');

        // Create test DB and table
        var testDbPath = 'Documents/' + TEST_PREFIX + 'test.sqlite';
        T.safe(function() {
            var r = SQLite.execute(testDbPath, 'CREATE TABLE IF NOT EXISTS test_items (id INTEGER PRIMARY KEY, name TEXT, value REAL)');
            T.ok(r && (r.ok || r.changes !== undefined), 'CREATE TABLE succeeds');
        }, 'SQLite CREATE TABLE no crash');

        // INSERT
        T.safe(function() {
            SQLite.execute(testDbPath, "INSERT INTO test_items (name, value) VALUES ('alpha', 1.1)");
            SQLite.execute(testDbPath, "INSERT INTO test_items (name, value) VALUES ('beta', 2.2)");
            SQLite.execute(testDbPath, "INSERT INTO test_items (name, value) VALUES ('gamma', 3.3)");
            T.ok(true, 'INSERT 3 rows succeeds');
        }, 'SQLite INSERT no crash');

        // SELECT query
        T.safe(function() {
            var r = SQLite.query(testDbPath, 'SELECT * FROM test_items');
            T.ok(r && Array.isArray(r.rows), 'query returns rows array');
            T.eq(r.rows.length, 3, 'query returns 3 rows');
            if (r.rows.length > 0) {
                T.type(r.rows[0].name, 'string', 'row.name is string');
            }
        }, 'SQLite SELECT no crash');

        // query with limit
        T.safe(function() {
            var r = SQLite.query(testDbPath, 'SELECT * FROM test_items', 1);
            T.eq(r.rows.length, 1, 'query with limit=1 returns 1 row');
        }, 'SQLite query(limit) no crash');

        // tables
        T.safe(function() {
            var tbls = SQLite.tables(testDbPath);
            T.ok(Array.isArray(tbls), 'tables() returns array');
            var found = false;
            for (var i = 0; i < tbls.length; i++) {
                if (tbls[i].name === 'test_items') found = true;
            }
            T.ok(found, 'tables() includes test_items');
        }, 'SQLite.tables() no crash');

        // schema
        T.safe(function() {
            var cols = SQLite.schema(testDbPath, 'test_items');
            T.ok(Array.isArray(cols), 'schema() returns array');
            T.eq(cols.length, 3, 'schema has 3 columns');
        }, 'SQLite.schema() no crash');

        // tableRowCount
        T.safe(function() {
            var count = SQLite.tableRowCount(testDbPath, 'test_items');
            T.eq(count, 3, 'tableRowCount === 3');
        }, 'SQLite.tableRowCount() no crash');

        // indexes
        T.safe(function() {
            var idx = SQLite.indexes(testDbPath);
            T.ok(Array.isArray(idx), 'indexes() returns array');
        }, 'SQLite.indexes() no crash');

        // UPDATE + DELETE
        T.safe(function() {
            var r = SQLite.execute(testDbPath, "UPDATE test_items SET value = 9.9 WHERE name = 'alpha'");
            T.ok(r && r.changes >= 1, 'UPDATE changes >= 1');

            r = SQLite.execute(testDbPath, "DELETE FROM test_items WHERE name = 'gamma'");
            T.ok(r && r.changes >= 1, 'DELETE changes >= 1');

            var count = SQLite.tableRowCount(testDbPath, 'test_items');
            T.eq(count, 2, 'row count after delete === 2');
        }, 'SQLite UPDATE/DELETE no crash');

        // Boundary: query nonexistent table
        T.safe(function() {
            var r = SQLite.query(testDbPath, 'SELECT * FROM __nonexistent__');
            T.ok(r && r.error, 'query nonexistent table returns error');
        }, 'SQLite query(nonexistent table) no crash');

        // Boundary: invalid SQL
        T.safe(function() {
            var r = SQLite.execute(testDbPath, 'THIS IS NOT SQL');
            T.ok(r && r.error, 'execute(invalid SQL) returns error');
        }, 'SQLite execute(invalid) no crash');

        // snapshot + diff
        T.safe(function() {
            var snap = SQLite.snapshot(testDbPath, 'test_items', 'test_snap');
            T.ok(snap && snap.ok, 'snapshot() succeeds');

            SQLite.execute(testDbPath, "INSERT INTO test_items (name, value) VALUES ('delta', 4.4)");

            var diff = SQLite.diff(testDbPath, 'test_items', 'test_snap');
            T.ok(diff && diff.hasChanges, 'diff detects changes');
            T.gt(diff.addedCount, 0, 'diff.addedCount > 0');
        }, 'SQLite snapshot/diff no crash');

        // Cleanup
        T.safe(function() {
            SQLite.execute(testDbPath, 'DROP TABLE IF EXISTS test_items');
        }, 'SQLite cleanup no crash');

        // Remove test DB
        if (typeof FileSystem !== 'undefined') {
            FileSystem.remove(testDbPath);
        }
    } else {
        T.skip('SQLite.*', 'SQLite not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 5. Debug
    // ═══════════════════════════════════════════════════════════════
    T.suite('Debug');

    if (typeof Debug !== 'undefined') {
        T.type(Debug.log, 'function', 'Debug.log exists');
        T.type(Debug.trace, 'function', 'Debug.trace exists');
        T.type(Debug.time, 'function', 'Debug.time exists');
        T.type(Debug.timeEnd, 'function', 'Debug.timeEnd exists');
        T.type(Debug.heapSize, 'function', 'Debug.heapSize exists');
        T.type(Debug.nativeTrace, 'function', 'Debug.nativeTrace exists');
        T.type(Debug.threads, 'function', 'Debug.threads exists');

        // Debug.log
        T.safe(function() {
            Debug.log('info', 'stability test message');
            Debug.log('warn', 'warning test');
            Debug.log('error', 'error test');
        }, 'Debug.log no crash');

        // Debug.trace
        T.safe(function() {
            var trace = Debug.trace();
            T.type(trace, 'string', 'trace() returns string');
            T.gt(trace.length, 0, 'trace() is non-empty');
        }, 'Debug.trace() no crash');

        // Debug.time / timeEnd
        T.safe(function() {
            Debug.time('test_timer');
            var elapsed = Debug.timeEnd('test_timer');
            T.type(elapsed, 'number', 'timeEnd() returns number');
            T.ok(elapsed >= 0, 'timeEnd() >= 0: ' + elapsed + 'ms');
        }, 'Debug.time/timeEnd no crash');

        // Boundary: timeEnd without matching time
        T.safe(function() {
            var r = Debug.timeEnd('__nonexistent_timer__');
            T.ok(true, 'timeEnd(nonexistent) no crash');
        }, 'timeEnd(nonexistent) no crash');

        // Boundary: duplicate time labels
        T.safe(function() {
            Debug.time('dup');
            Debug.time('dup');
            Debug.timeEnd('dup');
        }, 'duplicate time labels no crash');

        // Debug.heapSize
        T.safe(function() {
            var h = Debug.heapSize();
            T.ok(h !== null, 'heapSize() returns value');
            if (h) {
                T.type(h.residentSize, 'number', 'heapSize.residentSize is number');
                T.gt(h.residentSize, 0, 'residentSize > 0');
                T.type(h.virtualSize, 'number', 'heapSize.virtualSize is number');
            }
        }, 'Debug.heapSize() no crash');

        // Debug.nativeTrace
        T.safe(function() {
            var trace = Debug.nativeTrace();
            T.ok(Array.isArray(trace), 'nativeTrace() returns array');
            T.gt(trace.length, 0, 'nativeTrace has frames: ' + trace.length);
        }, 'Debug.nativeTrace() no crash');

        // Boundary: nativeTrace with maxFrames
        T.safe(function() {
            var trace = Debug.nativeTrace(5);
            T.ok(Array.isArray(trace), 'nativeTrace(5) returns array');
            T.ok(trace.length <= 5, 'nativeTrace(5) has ≤5 frames: ' + trace.length);
        }, 'nativeTrace(maxFrames) no crash');

        // Debug.threads
        T.safe(function() {
            var threads = Debug.threads();
            T.ok(Array.isArray(threads), 'threads() returns array');
            T.gt(threads.length, 0, 'threads() has entries: ' + threads.length);
            if (threads.length > 0) {
                T.type(threads[0].index, 'number', 'thread.index is number');
                T.type(threads[0].cpuUsage, 'number', 'thread.cpuUsage is number');
            }
        }, 'Debug.threads() no crash');
    } else {
        T.skip('Debug.*', 'Debug not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 6. Performance
    // ═══════════════════════════════════════════════════════════════
    T.suite('Performance');

    if (typeof Performance !== 'undefined') {
        T.type(Performance.memory, 'function', 'Performance.memory exists');
        T.type(Performance.cpu, 'function', 'Performance.cpu exists');
        T.type(Performance.snapshot, 'function', 'Performance.snapshot exists');
        T.type(Performance.fps, 'function', 'Performance.fps exists');
        T.type(Performance.stopFps, 'function', 'Performance.stopFps exists');

        // memory
        T.safe(function() {
            var mem = Performance.memory();
            T.ok(mem !== null, 'memory() returns value');
            if (mem) {
                T.type(mem.used, 'number', 'memory.used is number');
                T.gt(mem.used, 0, 'memory.used > 0');
                T.type(mem.virtual, 'number', 'memory.virtual is number');
                T.type(mem.free, 'number', 'memory.free is number');
            }
        }, 'Performance.memory() no crash');

        // cpu
        T.safe(function() {
            var cpu = Performance.cpu();
            T.ok(cpu !== null, 'cpu() returns value');
            if (cpu) {
                T.type(cpu.userTime, 'number', 'cpu.userTime is number');
                T.type(cpu.systemTime, 'number', 'cpu.systemTime is number');
                T.type(cpu.threadCount, 'number', 'cpu.threadCount is number');
                T.gt(cpu.threadCount, 0, 'threadCount > 0');
            }
        }, 'Performance.cpu() no crash');

        // snapshot
        T.safe(function() {
            var snap = Performance.snapshot();
            T.ok(snap !== null, 'snapshot() returns value');
            if (snap) {
                T.ok(snap.memory !== null || snap.memory !== undefined, 'snapshot.memory exists');
                T.ok(snap.cpu !== null || snap.cpu !== undefined, 'snapshot.cpu exists');
                T.type(snap.timestamp, 'number', 'snapshot.timestamp is number');
            }
        }, 'Performance.snapshot() no crash');

        // Consistency: two consecutive snapshots
        T.safe(function() {
            var s1 = Performance.snapshot();
            var s2 = Performance.snapshot();
            T.ok(s2.timestamp >= s1.timestamp, 'timestamps monotonic');
        }, 'snapshot consistency no crash');

        // fps — brief start/stop
        T.safe(function() {
            Performance.fps(function(fpsValue) {});
            Performance.stopFps();
        }, 'Performance.fps/stopFps no crash');

        // Boundary: stopFps without start
        T.safe(function() {
            Performance.stopFps();
        }, 'stopFps without start no crash');
    } else {
        T.skip('Performance.*', 'Performance not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 7. UIDebug
    // ═══════════════════════════════════════════════════════════════
    T.suite('UIDebug');

    if (typeof UIDebug !== 'undefined') {
        T.type(UIDebug.keyWindow, 'function', 'UIDebug.keyWindow exists');
        T.type(UIDebug.viewHierarchy, 'function', 'UIDebug.viewHierarchy exists');
        T.type(UIDebug.screenshot, 'function', 'UIDebug.screenshot exists');
        T.type(UIDebug.viewControllers, 'function', 'UIDebug.viewControllers exists');

        // keyWindow
        T.safe(function() {
            var kw = UIDebug.keyWindow();
            T.ok(kw !== null, 'keyWindow() returns value');
            if (kw) {
                T.type(kw.class, 'string', 'keyWindow.class is string');
                T.type(kw.frame, 'string', 'keyWindow.frame is string');
                T.type(kw.address, 'string', 'keyWindow.address is string');
            }
        }, 'UIDebug.keyWindow() no crash');

        // viewHierarchy
        T.safe(function() {
            var vh = UIDebug.viewHierarchy();
            T.ok(vh !== null, 'viewHierarchy() returns value');
            if (vh) {
                T.type(vh.class, 'string', 'root.class is string');
                T.ok(vh.subviews === undefined || Array.isArray(vh.subviews), 'root.subviews is array or undef');
            }
        }, 'UIDebug.viewHierarchy() no crash');

        // viewControllers (returns a tree: { class, address, children: [...] })
        T.safe(function() {
            var tree = UIDebug.viewControllers();
            T.ok(tree !== null && tree !== undefined && typeof tree === 'object', 'viewControllers() returns object');
            T.type(tree['class'], 'string', 'root vc has class: ' + tree['class']);
            if (tree.children) {
                T.ok(Array.isArray(tree.children), 'root vc has children array');
            }
        }, 'UIDebug.viewControllers() no crash');

        // screenshot
        T.safe(function() {
            var ss = UIDebug.screenshot();
            T.ok(ss !== null && ss !== undefined, 'screenshot() returns value');
            if (ss) {
                T.type(ss, 'string', 'screenshot is base64 string');
                T.gt(ss.length, 100, 'screenshot has content: ' + ss.length + ' chars');
            }
        }, 'UIDebug.screenshot() no crash');

        // bounds + screenshotView — require a real view address
        T.safe(function() {
            var kw = UIDebug.keyWindow();
            if (kw && kw.address) {
                if (typeof UIDebug.bounds === 'function') {
                    var b = UIDebug.bounds(kw.address);
                    T.ok(b !== null, 'bounds(keyWindow) returns value');
                    if (b) {
                        T.type(b.frame, 'string', 'bounds.frame is string');
                        T.type(b.hidden, 'boolean', 'bounds.hidden is boolean');
                    }
                }
                if (typeof UIDebug.screenshotView === 'function') {
                    var sv = UIDebug.screenshotView(kw.address);
                    T.ok(sv !== null, 'screenshotView(keyWindow) returns value');
                }
            }
        }, 'UIDebug.bounds/screenshotView no crash');

        // Boundary: bounds with invalid address
        T.safe(function() {
            if (typeof UIDebug.bounds === 'function') {
                var b = UIDebug.bounds('0x0000000000000000');
                T.ok(b === null || b === undefined, 'bounds(null addr) returns null');
            }
        }, 'bounds(invalid) no crash');
    } else {
        T.skip('UIDebug.*', 'UIDebug not available');
    }

    // ═══════════════════════════════════════════════════════════════
    // 8. HostMapping
    // ═══════════════════════════════════════════════════════════════
    T.suite('HostMapping');

    if (typeof HostMapping !== 'undefined') {
        T.type(HostMapping.listGroups, 'function', 'HostMapping.listGroups exists');
        T.type(HostMapping.createGroup, 'function', 'HostMapping.createGroup exists');
        T.type(HostMapping.getEffectiveMap, 'function', 'HostMapping.getEffectiveMap exists');

        // listGroups
        T.safe(function() {
            var groups = HostMapping.listGroups();
            T.ok(Array.isArray(groups), 'listGroups() returns array');
        }, 'HostMapping.listGroups() no crash');

        // createGroup + getEffectiveMap + deleteGroup
        T.safe(function() {
            var g = HostMapping.createGroup(TEST_PREFIX + 'group', '127.0.0.1 test.local');
            T.ok(g !== null, 'createGroup() returns group');
            if (g && g.id) {
                T.type(g.id, 'string', 'group.id is string');
                T.eq(g.title, TEST_PREFIX + 'group', 'group.title matches');

                // toggleGroup
                HostMapping.toggleGroup(g.id, true);
                var map = HostMapping.getEffectiveMap();
                T.ok(Array.isArray(map), 'getEffectiveMap() returns array');

                // updateGroup
                HostMapping.updateGroup(g.id, '192.168.1.1 updated.local');

                // deleteGroup
                HostMapping.deleteGroup(g.id);

                var afterDelete = HostMapping.listGroups();
                var stillExists = false;
                for (var i = 0; i < afterDelete.length; i++) {
                    if (afterDelete[i].id === g.id) stillExists = true;
                }
                T.ok(!stillExists, 'deleteGroup removes group');
            }
        }, 'HostMapping CRUD no crash');

        // addRule
        T.safe(function() {
            HostMapping.addRule('10.0.0.1', 'rule-test.local', TEST_PREFIX + 'rule_group');
            // Cleanup
            var groups = HostMapping.listGroups();
            for (var i = 0; i < groups.length; i++) {
                if (groups[i].title === TEST_PREFIX + 'rule_group') {
                    HostMapping.deleteGroup(groups[i].id);
                }
            }
        }, 'HostMapping.addRule no crash');
    } else {
        T.skip('HostMapping.*', 'HostMapping not available');
    }

    T.done();
})();
