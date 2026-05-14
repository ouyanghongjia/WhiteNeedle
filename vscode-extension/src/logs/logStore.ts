import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type LogCategory = 'Console' | 'Hook' | 'Network' | 'Error' | 'System' | 'Native' | 'Marker';
export type LogLevel = 'log' | 'warn' | 'error' | 'debug' | 'marker';

export interface LogEntry {
    timestamp: number;
    category: LogCategory;
    level: LogLevel;
    message: string;
    source?: string;
}

export interface MarkerInfo {
    index: number;
    timestamp: number;
    label: string;
}

export interface LogFilter {
    categories?: Set<string>;
    levels?: Set<string>;
    search?: string;
    showCleared?: boolean;
    timeStart?: number;
    timeEnd?: number;
}

export class LogStore implements vscode.Disposable {
    private static _instance: LogStore;

    private entries: LogEntry[] = [];
    private _markers: MarkerInfo[] = [];
    private _clearWatermark = 0;
    private filePath = '';
    private fd = -1;

    private readonly _onDidAppend = new vscode.EventEmitter<{ entry: LogEntry; index: number }>();
    readonly onDidAppend = this._onDidAppend.event;

    private readonly _onDidReset = new vscode.EventEmitter<void>();
    readonly onDidReset = this._onDidReset.event;

    private readonly _onDidClearScreen = new vscode.EventEmitter<void>();
    readonly onDidClearScreen = this._onDidClearScreen.event;

    private constructor() {}

    static getInstance(): LogStore {
        if (!LogStore._instance) {
            LogStore._instance = new LogStore();
        }
        return LogStore._instance;
    }

    async initialize(storageUri: vscode.Uri): Promise<void> {
        const dir = storageUri.fsPath;
        await fs.promises.mkdir(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        this.filePath = path.join(dir, `wn-logs-${ts}.jsonl`);
        this.fd = fs.openSync(this.filePath, 'a+');
    }

    append(entry: LogEntry): number {
        const idx = this.entries.length;
        this.entries.push(entry);

        if (this.fd >= 0) {
            try {
                const line = JSON.stringify(entry) + '\n';
                fs.writeSync(this.fd, line);
            } catch { /* disk full or closed — tolerate */ }
        }

        if (entry.category === 'Marker') {
            this._markers.push({ index: idx, timestamp: entry.timestamp, label: entry.message });
        }

        this._onDidAppend.fire({ entry, index: idx });
        return idx;
    }

    insertMarker(label: string): number {
        return this.append({
            timestamp: Date.now(),
            category: 'Marker',
            level: 'marker',
            message: label,
        });
    }

    clearScreen(): void {
        this._clearWatermark = this.entries.length;
        this.insertMarker('\u2500\u2500 Screen Cleared \u2500\u2500');
        this._onDidClearScreen.fire();
    }

    deleteAll(): void {
        this.entries = [];
        this._markers = [];
        this._clearWatermark = 0;
        if (this.fd >= 0) {
            try { fs.ftruncateSync(this.fd, 0); } catch { /* ignore */ }
        }
        this._onDidReset.fire();
    }

    get totalCount(): number { return this.entries.length; }
    get clearWatermark(): number { return this._clearWatermark; }
    get markers(): readonly MarkerInfo[] { return this._markers; }

    getEntry(idx: number): LogEntry | undefined {
        return this.entries[idx];
    }

    matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
        if (filter.categories && !filter.categories.has(entry.category)) { return false; }
        if (filter.levels && !filter.levels.has(entry.level)) { return false; }
        if (filter.timeStart != null && entry.timestamp < filter.timeStart) { return false; }
        if (filter.timeEnd != null && entry.timestamp > filter.timeEnd) { return false; }
        if (filter.search) {
            const text = entry.message + ' ' + (entry.source || '');
            const s = filter.search;
            if (s.startsWith('/') && s.endsWith('/') && s.length > 2) {
                try { if (!new RegExp(s.slice(1, -1), 'i').test(text)) { return false; } }
                catch { return false; }
            } else {
                if (!text.toLowerCase().includes(s.toLowerCase())) { return false; }
            }
        }
        return true;
    }

    queryFiltered(filter: LogFilter, includeMarkers = true): LogEntry[] {
        const start = filter.showCleared ? 0 : this._clearWatermark;
        const result: LogEntry[] = [];
        for (let i = start; i < this.entries.length; i++) {
            const e = this.entries[i];
            if (includeMarkers && e.category === 'Marker') {
                result.push(e);
            } else if (this.matchesFilter(e, filter)) {
                result.push(e);
            }
        }
        return result;
    }

    hiddenCount(): number {
        return this._clearWatermark;
    }

    async exportToFile(
        uri: vscode.Uri,
        filter: LogFilter,
        format: 'text' | 'jsonl' | 'csv',
        indexRange?: { start: number; end: number }
    ): Promise<number> {
        const overrideFilter: LogFilter = { ...filter, showCleared: true };
        const startIdx = indexRange?.start ?? (filter.showCleared ? 0 : this._clearWatermark);
        const endIdx = indexRange?.end ?? this.entries.length - 1;

        const source: LogEntry[] = [];
        for (let i = startIdx; i <= endIdx && i < this.entries.length; i++) {
            const e = this.entries[i];
            if (e.category === 'Marker') { continue; }
            if (this.matchesFilter(e, overrideFilter)) {
                source.push(e);
            }
        }

        let content: string;
        switch (format) {
            case 'jsonl':
                content = source.map(e => JSON.stringify(e)).join('\n');
                break;
            case 'csv': {
                const hdr = 'timestamp,category,level,message,source';
                const csvEsc = (v: string) => '"' + v.replace(/"/g, '""') + '"';
                const rows = source.map(e => {
                    const ts = new Date(e.timestamp).toISOString();
                    return `${ts},${e.category},${e.level},${csvEsc(e.message || '')},${csvEsc(e.source || '')}`;
                });
                content = [hdr, ...rows].join('\n');
                break;
            }
            default:
                content = source.map(e => {
                    const ts = new Date(e.timestamp).toISOString();
                    return `[${ts}] [${e.category}] [${e.level.toUpperCase()}] ${e.message}`;
                }).join('\n');
                break;
        }

        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
        return source.length;
    }

    dispose(): void {
        if (this.fd >= 0) {
            try { fs.closeSync(this.fd); } catch { /* ignore */ }
            this.fd = -1;
        }
        this._onDidAppend.dispose();
        this._onDidReset.dispose();
        this._onDidClearScreen.dispose();
        LogStore._instance = undefined as any;
    }
}
