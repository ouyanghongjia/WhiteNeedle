(function() {
    var vscode = window.__WN_SQLITE_VSCODE;
    var wnDbg = typeof window.__WN_SQLITE_WNDBG === 'function' ? window.__WN_SQLITE_WNDBG : function() {};
    if (!vscode) {
        try {
            if (typeof window.__WN_SQLITE_WNDBG === 'function') window.__WN_SQLITE_WNDBG('webview: main script aborted (no vscode handle)');
        } catch (e0) {}
        return;
    }
    wnDbg('webview: script boot (main)');
    var databases = [];
    var openDbs = {};
    var tableCache = {};
    var selectedDb = null;
    var selectedTable = null;
    var schemaCache = {};
    var dataCache = {};
    var queryResults = {};
    var snapshots = {};

    var discoverBtn = document.getElementById('discoverBtn');
    var statusEl = document.getElementById('status');
    var sidebarEl = document.getElementById('sidebar');
    var detailEl = document.getElementById('detail');
    var toastEl = document.getElementById('toast');

    /* --- Split-panel resizer, collapse, close & maximize logic --- */
    var sidebarPanel = document.getElementById('sidebarPanel');
    var detailPanel = document.getElementById('detailPanel');
    var resizer = document.getElementById('resizer');
    var splitContainer = document.getElementById('splitContainer');
    var collapseIcon = document.getElementById('collapseIcon');
    var sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
    var sidebarHeader = document.getElementById('sidebarHeader');
    var detailMaxBtn = document.getElementById('detailMaxBtn');
    var detailCloseBtn = document.getElementById('detailCloseBtn');
    var detailTitle = document.getElementById('detailTitle');
    var dbCountBadge = document.getElementById('dbCount');
    var sidebarCollapsed = false;
    var detailClosed = true;

    function syncLayout() {
        if (detailClosed) {
            detailPanel.classList.add('hidden');
            resizer.classList.add('hidden');
            sidebarPanel.classList.add('detail-closed');
            sidebarPanel.style.height = '';
            sidebarPanel.style.flex = '';
        } else {
            detailPanel.classList.remove('hidden');
            resizer.classList.remove('hidden');
            sidebarPanel.classList.remove('detail-closed');
        }
    }

    function openDetailPanel() {
        if (!detailClosed) return;
        detailClosed = false;
        if (sidebarCollapsed) {
            sidebarCollapsed = false;
            sidebarPanel.classList.remove('collapsed');
            collapseIcon.classList.remove('collapsed');
        }
        syncLayout();
    }

    function closeDetailPanel() {
        detailClosed = true;
        sidebarPanel.style.height = '';
        sidebarPanel.style.flex = '';
        syncLayout();
    }

    function toggleSidebarCollapse() {
        sidebarCollapsed = !sidebarCollapsed;
        if (sidebarCollapsed) {
            sidebarPanel.classList.add('collapsed');
            collapseIcon.classList.add('collapsed');
            sidebarPanel.style.height = '';
            sidebarPanel.style.flex = '';
        } else {
            sidebarPanel.classList.remove('collapsed');
            collapseIcon.classList.remove('collapsed');
        }
    }

    function toggleDetailMaximize() {
        if (detailClosed) return;
        if (!sidebarCollapsed) {
            toggleSidebarCollapse();
            detailMaxBtn.innerHTML = '&#9645;';
            detailMaxBtn.title = 'Restore layout';
        } else {
            toggleSidebarCollapse();
            detailMaxBtn.innerHTML = '&#9633;';
            detailMaxBtn.title = 'Maximize data view';
        }
    }

    if (sidebarCollapseBtn) {
        sidebarCollapseBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleSidebarCollapse();
        });
    }
    if (sidebarHeader) {
        sidebarHeader.addEventListener('click', function(e) {
            if (e.target === sidebarCollapseBtn || sidebarCollapseBtn.contains(e.target)) return;
            if (sidebarCollapsed) toggleSidebarCollapse();
        });
    }
    if (detailMaxBtn) {
        detailMaxBtn.addEventListener('click', toggleDetailMaximize);
    }
    if (detailCloseBtn) {
        detailCloseBtn.addEventListener('click', function() {
            closeDetailPanel();
        });
    }

    syncLayout();

    /* --- Resizer drag logic --- */
    if (resizer && sidebarPanel && splitContainer) {
        var isResizing = false;
        var startY = 0;
        var startSidebarH = 0;

        resizer.addEventListener('mousedown', function(e) {
            if (detailClosed) return;
            e.preventDefault();
            isResizing = true;
            startY = e.clientY;
            startSidebarH = sidebarPanel.getBoundingClientRect().height;
            document.body.classList.add('resizing');
            resizer.classList.add('active');
        });

        document.addEventListener('mousemove', function(e) {
            if (!isResizing) return;
            e.preventDefault();
            var dy = e.clientY - startY;
            var newH = Math.max(60, startSidebarH + dy);
            var containerH = splitContainer.getBoundingClientRect().height;
            var maxH = containerH - 160;
            if (newH > maxH) newH = maxH;
            sidebarPanel.style.height = newH + 'px';
            sidebarPanel.style.flex = 'none';
        });

        document.addEventListener('mouseup', function() {
            if (!isResizing) return;
            isResizing = false;
            document.body.classList.remove('resizing');
            resizer.classList.remove('active');
        });
    }

    var SQLKW = ['SELECT','FROM','WHERE','AND','OR','NOT','IN','LIKE','BETWEEN','IS','NULL','ORDER','BY','ASC','DESC','LIMIT','OFFSET','JOIN','LEFT','RIGHT','INNER','OUTER','CROSS','ON','GROUP','HAVING','AS','DISTINCT','COUNT','SUM','AVG','MIN','MAX','CASE','WHEN','THEN','ELSE','END','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','TABLE','INDEX','IF','EXISTS','DROP','ALTER','ADD','COLUMN','PRIMARY','KEY','AUTOINCREMENT','UNIQUE','CHECK','DEFAULT','FOREIGN','REFERENCES','CASCADE','PRAGMA','BEGIN','COMMIT','ROLLBACK','TRANSACTION','WITH','RECURSIVE','UNION','ALL','EXCEPT','INTERSECT','VIRTUAL','REPLACE','TRIGGER','VIEW','ROWID','WITHOUT','VACUUM','ANALYZE','REINDEX','ATTACH','DETACH','EXPLAIN','ABORT','FAIL','IGNORE'];

    var suggestItems = [];
    var suggestIdx = -1;

    function quoteSqlIdentJs(name) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
        return '"' + name.replace(/"/g, '""') + '"';
    }

    function isSuggestVisible() {
        var box = document.getElementById('sqlSuggest');
        return !!(box && box.className.indexOf('show') >= 0);
    }

    function hideSqlSuggest() {
        var box = document.getElementById('sqlSuggest');
        if (box) { box.className = 'sql-suggest'; box.innerHTML = ''; }
        suggestItems = [];
        suggestIdx = -1;
    }

    function updateSuggestHighlight() {
        var box = document.getElementById('sqlSuggest');
        if (!box) return;
        var opts = box.querySelectorAll('.sg-opt');
        for (var i = 0; i < opts.length; i++) {
            opts[i].className = i === suggestIdx ? 'sg-opt active' : 'sg-opt';
        }
        if (suggestIdx >= 0 && suggestIdx < opts.length) {
            var el = opts[suggestIdx];
            if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
        }
    }

    function applySqlCompletion(word) {
        var ta = document.getElementById('sqlInput');
        if (!ta) return;
        var pos = ta.selectionStart;
        var text = ta.value;
        var before = text.substring(0, pos);
        var after = text.substring(pos);
        var m = before.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
        if (m) {
            before = before.substring(0, before.length - m[1].length);
        }
        ta.value = before + word + ' ';
        var np = before.length + word.length + 1;
        ta.focus();
        ta.setSelectionRange(np, np);
        hideSqlSuggest();
    }

    function openSqlSuggest() {
        var ta = document.getElementById('sqlInput');
        var box = document.getElementById('sqlSuggest');
        if (!ta || !box) return;
        var pos = ta.selectionStart;
        var before = ta.value.substring(0, pos);
        var pm = before.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
        var prefix = pm ? pm[1] : '';
        var plow = (prefix || '').toLowerCase();
        if (!prefix) { hideSqlSuggest(); return; }
        var items = [];
        for (var i = 0; i < SQLKW.length; i++) {
            if (SQLKW[i].toLowerCase().indexOf(plow) === 0 && SQLKW[i].toLowerCase() !== plow) {
                items.push(SQLKW[i]);
            }
        }
        if (items.length === 0) { hideSqlSuggest(); return; }
        if (items.length > 20) items = items.slice(0, 20);
        suggestItems = items;
        suggestIdx = 0;
        var h = '';
        for (var j = 0; j < items.length; j++) {
            var cls = j === 0 ? 'sg-opt active' : 'sg-opt';
            var escaped = esc(items[j]);
            var plen = prefix.length;
            h += '<div class="' + cls + '"><b>' + escaped.substring(0, plen) + '</b>' + escaped.substring(plen) + '</div>';
        }
        box.innerHTML = h;
        box.className = 'sql-suggest show';
        var opts = box.querySelectorAll('.sg-opt');
        for (var k = 0; k < opts.length; k++) {
            (function(w) {
                opts[k].addEventListener('mousedown', function(ev) { ev.preventDefault(); applySqlCompletion(w); });
            })(items[k]);
        }
    }

    function renderSidebar() {
        if (dbCountBadge) {
            dbCountBadge.textContent = databases.length > 0 ? databases.length : '';
        }
        if (databases.length === 0) {
            sidebarEl.innerHTML = '<div class="empty">Click "Discover Databases" to scan sandbox</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < databases.length; i++) {
            var db = databases[i];
            var isOpen = !!openDbs[db.path];
            html += '<div class="db-section">';
            html += '<div class="db-header" data-db-idx="' + i + '">';
            html += '<span class="arrow ' + (isOpen ? 'open' : '') + '">&#9654;</span>';
            html += '<strong>' + esc(db.name) + '</strong>';
            html += ' <span class="badge">' + db.tableCount + ' tables</span>';
            html += ' <span class="size-label">' + formatSize(db.size) + '</span>';
            html += '</div>';
            if (isOpen) {
                var tables = tableCache[db.path];
                if (!tables) {
                    html += '<div style="padding:12px 24px;opacity:0.5">Loading tables...</div>';
                } else {
                    for (var j = 0; j < tables.length; j++) {
                        var t = tables[j];
                        var isActive = selectedDb === db.path && selectedTable === t.name;
                        html += '<div class="table-item' + (isActive ? ' active' : '') + '" data-db="' + esc(db.path) + '" data-table="' + esc(t.name) + '">';
                        html += '&#128202; ' + esc(t.name);
                        html += ' <span class="badge">' + t.rowCount + ' rows</span>';
                        html += '</div>';
                    }
                }
            }
            html += '</div>';
        }
        sidebarEl.innerHTML = html;
        bindSidebarClicks();
    }

    function bindSidebarClicks() {
        var headers = sidebarEl.querySelectorAll('.db-header');
        for (var i = 0; i < headers.length; i++) {
            headers[i].addEventListener('click', function() {
                var idx = parseInt(this.getAttribute('data-db-idx'), 10);
                var db = databases[idx];
                if (!db) return;
                openDbs[db.path] = !openDbs[db.path];
                if (openDbs[db.path] && !tableCache[db.path]) {
                    vscode.postMessage({ command: 'loadTables', dbPath: db.path });
                }
                renderSidebar();
            });
        }
        var items = sidebarEl.querySelectorAll('.table-item');
        for (var j = 0; j < items.length; j++) {
            items[j].addEventListener('click', function() {
                var dbPath = this.getAttribute('data-db');
                var tableName = this.getAttribute('data-table');
                selectTable(dbPath, tableName);
            });
        }
    }

    function selectTable(dbPath, tableName) {
        selectedDb = dbPath;
        selectedTable = tableName;
        openDetailPanel();
        renderSidebar();
        renderDetail();
        var key = dbPath + '::' + tableName;
        if (!schemaCache[key]) {
            vscode.postMessage({ command: 'loadSchema', dbPath: dbPath, tableName: tableName });
        }
        if (!dataCache[key]) {
            vscode.postMessage({ command: 'loadTableData', dbPath: dbPath, tableName: tableName, limit: 100 });
        }
    }

    function renderDetail() {
        persistSqlInput();
        if (!selectedDb || !selectedTable) {
            detailEl.innerHTML = '<div class="empty">Select a table from the sidebar</div>';
            if (detailTitle) detailTitle.textContent = 'Data View';
            return;
        }

        var key = selectedDb + '::' + selectedTable;
        var activeTab = (detailEl._activeTab && detailEl._activeTab[key]) || 'data';

        if (detailTitle) {
            detailTitle.textContent = selectedTable;
            detailTitle.title = selectedTable + ' in ' + selectedDb;
        }

        var html = '';
        html += '<div class="tab-bar">';
        html += '<div class="tab' + (activeTab === 'data' ? ' active' : '') + '" data-tab="data">Data</div>';
        html += '<div class="tab' + (activeTab === 'schema' ? ' active' : '') + '" data-tab="schema">Schema</div>';
        html += '<div class="tab' + (activeTab === 'query' ? ' active' : '') + '" data-tab="query">SQL Execute</div>';
        html += '<div class="tab' + (activeTab === 'monitor' ? ' active' : '') + '" data-tab="monitor">Monitor</div>';
        html += '</div>';

        // Data tab
        html += '<div class="tab-content' + (activeTab === 'data' ? ' active' : '') + '" data-tab-content="data">';
        var data = dataCache[key];
        if (!data) {
            html += '<div style="padding:12px;opacity:0.5">Loading...</div>';
        } else if (data.error) {
            html += '<div style="padding:12px;color:var(--error-fg)">' + esc(data.error) + '</div>';
        } else {
            html += '<div style="margin-bottom:4px;font-size:11px;opacity:0.6">' + data.rowCount + ' rows' + (data.truncated ? ' (truncated)' : '') + '</div>';
            html += '<div class="data-scroll">' + buildDataTable(data.rows) + '</div>';
        }
        html += '</div>';

        // Schema tab
        html += '<div class="tab-content' + (activeTab === 'schema' ? ' active' : '') + '" data-tab-content="schema">';
        var schema = schemaCache[key];
        if (!schema) {
            html += '<div style="padding:12px;opacity:0.5">Loading...</div>';
        } else {
            html += '<table><tr><th>#</th><th>Name</th><th>Type</th><th>NotNull</th><th>Default</th><th>PK</th></tr>';
            for (var s = 0; s < schema.length; s++) {
                var col = schema[s];
                html += '<tr>';
                html += '<td>' + col.cid + '</td>';
                html += '<td><strong>' + esc(col.name) + '</strong></td>';
                html += '<td>' + esc(col.type || 'ANY') + '</td>';
                html += '<td>' + (col.notnull ? '&#10003;' : '') + '</td>';
                html += '<td>' + (col.dflt_value != null ? esc(String(col.dflt_value)) : '<span style="opacity:0.4">NULL</span>') + '</td>';
                html += '<td>' + (col.pk ? '&#128273;' : '') + '</td>';
                html += '</tr>';
            }
            html += '</table>';
        }
        html += '</div>';

        // SQL Execute tab
        html += '<div class="tab-content' + (activeTab === 'query' ? ' active' : '') + '" data-tab-content="query">';
        html += '<div class="query-area">';
        var defaultSql = 'SELECT * FROM ' + quoteSqlIdentJs(selectedTable) + ' LIMIT 50';
        html += '<textarea id="sqlInput" spellcheck="false" placeholder="SELECT / INSERT / UPDATE / DELETE …">' + (queryResults[key + '::lastSql'] || defaultSql) + '</textarea>';
        html += '<div class="sql-suggest" id="sqlSuggest"></div>';
        html += '<div class="query-toolbar">';
        html += '<button id="runQueryBtn">Execute SQL</button>';
        html += '<span id="queryStatus" style="font-size:11px;opacity:0.6"></span>';
        html += '</div></div>';
        var qr = queryResults[key];
        if (qr) {
            if (qr.error) {
                html += '<div style="padding:8px;color:var(--error-fg)">' + esc(qr.error) + '</div>';
            } else if (qr.rows) {
                html += '<div style="margin-bottom:4px;font-size:11px;opacity:0.6">' + qr.rowCount + ' rows' + (qr.truncated ? ' (truncated)' : '') + '</div>';
                html += '<div class="data-scroll">' + buildDataTable(qr.rows) + '</div>';
            } else if (qr.ok !== undefined) {
                html += '<div style="padding:8px;color:var(--success)">' + qr.changes + ' rows affected</div>';
            }
        }
        html += '</div>';

        // Monitor tab
        html += '<div class="tab-content' + (activeTab === 'monitor' ? ' active' : '') + '" data-tab-content="monitor">';
        html += '<div class="snapshot-bar">';
        html += '<input id="snapTag" placeholder="snapshot tag" value="' + (snapshots[key + '::lastTag'] || 'before') + '" />';
        html += '<button id="snapBtn" class="success small">Take Snapshot</button>';
        html += '<button id="diffBtn" class="warning small">Diff vs Snapshot</button>';
        html += '</div>';
        var snap = snapshots[key + '::snap'];
        if (snap) {
            html += '<div style="font-size:11px;opacity:0.6;margin-bottom:4px">Snapshot "' + esc(snap.tag) + '": ' + snap.result.rowCount + ' rows at ' + new Date(snap.result.timestamp || Date.now()).toLocaleTimeString() + '</div>';
        }
        var diff = snapshots[key + '::diff'];
        if (diff) {
            if (diff.error) {
                html += '<div style="color:var(--error-fg)">' + esc(diff.error) + '</div>';
            } else {
                html += '<div style="margin-bottom:6px">';
                html += '<span class="badge">' + diff.oldRowCount + ' → ' + diff.newRowCount + '</span> ';
                if (diff.hasChanges) {
                    html += '<span class="badge green">+' + diff.addedCount + '</span> ';
                    html += '<span class="badge orange">-' + diff.removedCount + '</span>';
                } else {
                    html += '<span style="opacity:0.6">No changes</span>';
                }
                html += '</div>';
                if (diff.added && diff.added.length > 0) {
                    html += '<div style="margin-bottom:4px;font-size:11px;font-weight:600;color:var(--success)">Added rows:</div>';
                    html += '<div class="data-scroll">' + buildDataTable(diff.added, 'diff-added') + '</div>';
                }
                if (diff.removed && diff.removed.length > 0) {
                    html += '<div style="margin:8px 0 4px;font-size:11px;font-weight:600;color:var(--error-fg)">Removed rows:</div>';
                    html += '<div class="data-scroll">' + buildDataTable(diff.removed, 'diff-removed') + '</div>';
                }
            }
        }
        html += '</div>';

        detailEl.innerHTML = html;
        bindDetailEvents(key);
    }

    function persistSqlInput() {
        var ta = document.getElementById('sqlInput');
        if (ta && selectedDb && selectedTable) {
            queryResults[selectedDb + '::' + selectedTable + '::lastSql'] = ta.value;
        }
    }

    function bindDetailEvents(key) {
        var tabs = detailEl.querySelectorAll('.tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener('click', function() {
                persistSqlInput();
                var tab = this.getAttribute('data-tab');
                if (!detailEl._activeTab) detailEl._activeTab = {};
                detailEl._activeTab[key] = tab;
                renderDetail();
            });
        }

        var runBtn = document.getElementById('runQueryBtn');
        var sqlInput = document.getElementById('sqlInput');
        if (runBtn && sqlInput) {
            runBtn.addEventListener('click', function() {
                var sql = sqlInput.value.trim();
                if (!sql) return;
                queryResults[key + '::lastSql'] = sql;
                var qs = document.getElementById('queryStatus');
                if (qs) qs.textContent = 'Executing...';
                vscode.postMessage({ command: 'executeQuery', dbPath: selectedDb, sql: sql, limit: 500 });
            });
            sqlInput.addEventListener('keydown', function(e) {
                if (isSuggestVisible()) {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (suggestIdx < suggestItems.length - 1) { suggestIdx++; updateSuggestHighlight(); }
                        return;
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (suggestIdx > 0) { suggestIdx--; updateSuggestHighlight(); }
                        return;
                    }
                    if (e.key === 'Tab' || e.key === 'Enter') {
                        e.preventDefault();
                        if (suggestIdx >= 0 && suggestIdx < suggestItems.length) {
                            applySqlCompletion(suggestItems[suggestIdx]);
                        }
                        return;
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        hideSqlSuggest();
                        return;
                    }
                }
            });
            sqlInput.addEventListener('input', function() {
                openSqlSuggest();
            });
            sqlInput.addEventListener('blur', function() { setTimeout(hideSqlSuggest, 150); });
        }

        var snapBtn = document.getElementById('snapBtn');
        var diffBtn = document.getElementById('diffBtn');
        var snapTag = document.getElementById('snapTag');
        if (snapBtn && snapTag) {
            snapBtn.addEventListener('click', function() {
                var tag = snapTag.value.trim() || 'default';
                snapshots[key + '::lastTag'] = tag;
                vscode.postMessage({ command: 'takeSnapshot', dbPath: selectedDb, tableName: selectedTable, tag: tag });
            });
        }
        if (diffBtn && snapTag) {
            diffBtn.addEventListener('click', function() {
                var tag = snapTag.value.trim() || 'default';
                snapshots[key + '::lastTag'] = tag;
                vscode.postMessage({ command: 'diffSnapshot', dbPath: selectedDb, tableName: selectedTable, tag: tag });
            });
        }
    }

    function buildDataTable(rows, rowClass) {
        if (!rows || rows.length === 0) return '<div style="padding:8px;opacity:0.5">No data</div>';
        var cols = Object.keys(rows[0]);
        var html = '<table><tr>';
        for (var c = 0; c < cols.length; c++) {
            html += '<th>' + esc(cols[c]) + '</th>';
        }
        html += '</tr>';
        for (var r = 0; r < rows.length; r++) {
            html += '<tr' + (rowClass ? ' class="' + rowClass + '"' : '') + '>';
            for (var ci = 0; ci < cols.length; ci++) {
                var val = rows[r][cols[ci]];
                if (val === null || val === undefined) {
                    html += '<td class="null-val">NULL</td>';
                } else {
                    var s = typeof val === 'object' ? JSON.stringify(val) : String(val);
                    html += '<td title="' + esc(s) + '">' + esc(trunc(s, 60)) + '</td>';
                }
            }
            html += '</tr>';
        }
        html += '</table>';
        return html;
    }

    window.__WN_SQLITE_MAIN_MSG = handleMainMsg;

    var pending = window.__WN_SQLITE_PENDING_MSGS;
    if (pending && pending.length) {
        wnDbg('webview: replaying ' + pending.length + ' queued messages');
        for (var pi = 0; pi < pending.length; pi++) {
            try { handleMainMsg(pending[pi]); } catch (pe) {
                wnDbg('webview: replay error: ' + (pe && pe.message ? pe.message : String(pe)));
            }
        }
    }
    window.__WN_SQLITE_PENDING_MSGS = [];

    function handleMainMsg(e) {
        var msg = e.data;
        switch (msg.command) {
            case 'databasesLoaded':
                discoverBtn.disabled = false;
                statusEl.textContent = '';
                databases = msg.databases || [];
                openDbs = {};
                tableCache = {};
                renderSidebar();
                showToast(databases.length + ' databases found');
                break;
            case 'tablesLoaded':
                tableCache[msg.dbPath] = msg.tables || [];
                renderSidebar();
                break;
            case 'schemaLoaded':
                schemaCache[msg.dbPath + '::' + msg.tableName] = msg.schema;
                if (msg.dbPath === selectedDb && msg.tableName === selectedTable) renderDetail();
                break;
            case 'tableDataLoaded':
                dataCache[msg.dbPath + '::' + msg.tableName] = msg.result;
                if (msg.dbPath === selectedDb && msg.tableName === selectedTable) renderDetail();
                break;
            case 'queryResult':
                var qKey = msg.dbPath + '::' + (selectedTable || '');
                queryResults[qKey] = msg.result;
                var qsEl = document.getElementById('queryStatus');
                if (qsEl) qsEl.textContent = '';
                if (msg.isSelect === false && selectedDb && selectedTable && msg.result && !msg.result.error) {
                    delete dataCache[selectedDb + '::' + selectedTable];
                    vscode.postMessage({ command: 'loadTableData', dbPath: selectedDb, tableName: selectedTable, limit: 100 });
                }
                renderDetail();
                break;
            case 'snapshotTaken':
                var sKey = msg.dbPath + '::' + msg.tableName;
                snapshots[sKey + '::snap'] = { tag: msg.tag, result: msg.result };
                showToast('Snapshot "' + msg.tag + '" saved (' + msg.result.rowCount + ' rows)');
                renderDetail();
                break;
            case 'diffResult':
                var dKey = msg.dbPath + '::' + msg.tableName;
                snapshots[dKey + '::diff'] = msg.result;
                if (msg.result.hasChanges) {
                    showToast('Changes detected: +' + msg.result.addedCount + ' / -' + msg.result.removedCount);
                } else {
                    showToast('No changes detected');
                }
                renderDetail();
                break;
            case 'error':
                discoverBtn.disabled = false;
                statusEl.textContent = '';
                showToast(msg.text, true);
                break;
        }
    };

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function trunc(s, n) { return s && s.length > n ? s.substring(0, n) + '\\u2026' : (s || ''); }
    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function showToast(text, isError) {
        toastEl.textContent = text;
        toastEl.className = 'toast show' + (isError ? ' error' : '');
        setTimeout(function() { toastEl.className = 'toast'; }, 3000);
    }
})();
