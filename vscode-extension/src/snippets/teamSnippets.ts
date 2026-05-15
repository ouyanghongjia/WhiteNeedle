import * as vscode from 'vscode';
import * as path from 'path';
import { ScriptSnippet, importSnippets, BUILTIN_SNIPPETS } from './snippetLibrary';
import { combineTeamFiles, mergeDisplaySnippets } from './teamSnippetsMerge';

export interface TeamSnippetSourceInfo {
    uri: vscode.Uri;
    mtime: number;
    count: number;
}

export interface SnippetSyncResult {
    snippets: ScriptSnippet[];
    warnings: string[];
    errors: string[];
    sources: TeamSnippetSourceInfo[];
    missingPaths: string[];
    lastSyncAt: number;
}

/** @deprecated Use SnippetSyncResult */
export type TeamSnippetSyncResult = SnippetSyncResult & { teamSnippets: ScriptSnippet[]; missingFiles: string[] };

let cachedTeamSnippetsRaw: ScriptSnippet[] = [];
let cachedPersonalSnippetsRaw: ScriptSnippet[] = [];
let lastTeamSyncResult: SnippetSyncResult = { snippets: [], warnings: [], errors: [], sources: [], missingPaths: [], lastSyncAt: 0 };
let lastPersonalSyncResult: SnippetSyncResult = { snippets: [], warnings: [], errors: [], sources: [], missingPaths: [], lastSyncAt: 0 };

export function getTeamSnippetsRawFromCache(): ScriptSnippet[] { return cachedTeamSnippetsRaw; }
export function getPersonalSnippetsRawFromCache(): ScriptSnippet[] { return cachedPersonalSnippetsRaw; }

export function getLastTeamSyncResult(): TeamSnippetSyncResult {
    const r = lastTeamSyncResult;
    return { ...r, teamSnippets: r.snippets, missingFiles: r.missingPaths };
}

// ─── Settings helpers ───

function getCfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('whiteneedle');
}

function getConfiguredTeamDir(): string {
    return (getCfg().get<string>('snippets.teamDir') ?? '').trim();
}

function getConfiguredPersonalDir(): string {
    return (getCfg().get<string>('snippets.personalDir') ?? '').trim();
}

function isAbsolutePath(p: string): boolean {
    return path.isAbsolute(p);
}

// ─── Directory scanning ───

async function listJsonFilesInDir(dirUri: vscode.Uri): Promise<vscode.Uri[]> {
    try {
        const entries = await vscode.workspace.fs.readDirectory(dirUri);
        return entries
            .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name]) => vscode.Uri.joinPath(dirUri, name));
    } catch {
        return [];
    }
}

async function resolveSnippetUris(): Promise<{ teamUris: vscode.Uri[]; teamDirPaths: string[] }> {
    const teamDir = getConfiguredTeamDir();
    const folders = vscode.workspace.workspaceFolders ?? [];

    if (!teamDir) {
        return { teamUris: [], teamDirPaths: [] };
    }

    if (isAbsolutePath(teamDir)) {
        const dirUri = vscode.Uri.file(teamDir);
        const files = await listJsonFilesInDir(dirUri);
        return { teamUris: files, teamDirPaths: files.length === 0 ? [teamDir] : [] };
    }

    const uris: vscode.Uri[] = [];
    const missing: string[] = [];
    for (const folder of folders) {
        const dirUri = vscode.Uri.joinPath(folder.uri, ...teamDir.split('/').filter(Boolean));
        const files = await listJsonFilesInDir(dirUri);
        if (files.length > 0) {
            uris.push(...files);
        } else {
            missing.push(dirUri.fsPath);
        }
    }
    return { teamUris: uris, teamDirPaths: missing };
}

async function resolvePersonalUris(): Promise<{ uris: vscode.Uri[]; missingDir: string | undefined }> {
    const dir = getConfiguredPersonalDir();
    if (!dir) { return { uris: [], missingDir: undefined }; }
    if (!isAbsolutePath(dir)) {
        return { uris: [], missingDir: dir };
    }
    const dirUri = vscode.Uri.file(dir);
    const files = await listJsonFilesInDir(dirUri);
    return { uris: files, missingDir: files.length === 0 ? dir : undefined };
}

// ─── Loading ───

async function loadSnippetsFromUris(uris: vscode.Uri[]): Promise<{
    byFile: ScriptSnippet[][];
    sources: TeamSnippetSourceInfo[];
    errors: string[];
}> {
    const byFile: ScriptSnippet[][] = [];
    const sources: TeamSnippetSourceInfo[] = [];
    const errors: string[] = [];

    for (const uri of uris) {
        try {
            const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
            const parsed = importSnippets(raw);
            let mtime = 0;
            try { mtime = (await vscode.workspace.fs.stat(uri)).mtime; } catch { /* noop */ }
            sources.push({ uri, mtime, count: parsed.length });
            byFile.push(parsed);
        } catch (e: any) {
            errors.push(`${uri.fsPath}: ${e?.message ?? String(e)}`);
        }
    }

    return { byFile, sources, errors };
}

// ─── Public sync API ───

export async function loadTeamSnippetsFromWorkspace(): Promise<TeamSnippetSyncResult> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0 && !getConfiguredTeamDir()) {
        const empty: SnippetSyncResult = { snippets: [], warnings: [], errors: [], sources: [], missingPaths: [], lastSyncAt: Date.now() };
        cachedTeamSnippetsRaw = [];
        lastTeamSyncResult = empty;
        return { ...empty, teamSnippets: [], missingFiles: [] };
    }

    const { teamUris, teamDirPaths } = await resolveSnippetUris();
    const { byFile, sources, errors } = await loadSnippetsFromUris(teamUris);
    const { teamSnippets: teamRaw, warnings } = combineTeamFiles(BUILTIN_SNIPPETS, byFile);

    const result: SnippetSyncResult = {
        snippets: teamRaw,
        warnings,
        errors,
        sources,
        missingPaths: teamDirPaths,
        lastSyncAt: Date.now(),
    };
    cachedTeamSnippetsRaw = teamRaw;
    lastTeamSyncResult = result;
    return { ...result, teamSnippets: teamRaw, missingFiles: teamDirPaths };
}

export async function loadPersonalSnippetsFromDisk(): Promise<SnippetSyncResult> {
    const dir = getConfiguredPersonalDir();
    if (!dir) {
        const empty: SnippetSyncResult = { snippets: [], warnings: [], errors: [], sources: [], missingPaths: [], lastSyncAt: Date.now() };
        cachedPersonalSnippetsRaw = [];
        lastPersonalSyncResult = empty;
        return empty;
    }

    const { uris, missingDir } = await resolvePersonalUris();
    const { byFile, sources, errors } = await loadSnippetsFromUris(uris);
    const allTeamAndBuiltinIds = new Set([
        ...BUILTIN_SNIPPETS.map(s => s.id),
        ...cachedTeamSnippetsRaw.map(s => s.id),
    ]);

    const warnings: string[] = [];
    const personalOut: ScriptSnippet[] = [];
    const seenIds = new Set<string>();
    for (const fileSnippets of byFile) {
        for (const s of fileSnippets) {
            if (allTeamAndBuiltinIds.has(s.id)) {
                warnings.push(`Personal snippet "${s.name}" (id: ${s.id}): conflicts with built-in/team, skipped`);
                continue;
            }
            if (seenIds.has(s.id)) { continue; }
            seenIds.add(s.id);
            personalOut.push(s);
        }
    }

    const result: SnippetSyncResult = {
        snippets: personalOut,
        warnings,
        errors,
        sources,
        missingPaths: missingDir ? [missingDir] : [],
        lastSyncAt: Date.now(),
    };
    cachedPersonalSnippetsRaw = personalOut;
    lastPersonalSyncResult = result;
    return result;
}

export async function syncAllSnippetSources(): Promise<void> {
    await loadTeamSnippetsFromWorkspace();
    await loadPersonalSnippetsFromDisk();
}

// ─── Status labels ───

function formatSyncLabel(kind: string, result: SnippetSyncResult): string {
    const n = result.snippets.length;
    if (result.errors.length > 0 && result.sources.length === 0) {
        return `${kind}: sync failed (${result.errors.length} error(s))`;
    }
    if (result.sources.length === 0 && result.missingPaths.length > 0) {
        return `${kind}: directory not found or empty`;
    }
    if (result.sources.length === 0) {
        return `${kind}: not configured`;
    }
    const t = new Date(result.lastSyncAt);
    const timeStr = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`;
    return `${kind}: ${n} snippet(s) from ${result.sources.length} file(s) · ${timeStr}`;
}

export function getTeamSyncStatusLabel(): string {
    return formatSyncLabel('Team', lastTeamSyncResult);
}

export function getPersonalSyncStatusLabel(): string {
    if (!getConfiguredPersonalDir()) { return ''; }
    return formatSyncLabel('Personal', lastPersonalSyncResult);
}

// ─── UI report ───

export function reportTeamSyncUi(result: SnippetSyncResult | TeamSnippetSyncResult, output?: vscode.OutputChannel): void {
    const missingPaths = 'missingPaths' in result ? result.missingPaths : (result as any).missingFiles ?? [];
    if (result.errors.length > 0) {
        const extra = result.errors.length > 1 ? ` (+${result.errors.length - 1} more)` : '';
        void vscode.window.showErrorMessage(`Snippets sync: ${result.errors[0]}${extra}`);
        output?.appendLine('[WhiteNeedle] Snippet sync errors:');
        result.errors.forEach((e) => output?.appendLine(`  ${e}`));
        return;
    }

    if (result.sources.length === 0 && missingPaths.length > 0) {
        void vscode.window.showInformationMessage(
            `Snippets: no JSON files found in configured path(s). Check whiteneedle.snippets.teamDir / personalDir settings.`,
        );
        return;
    }

    const count = 'snippets' in result ? result.snippets.length : (result as any).teamSnippets?.length ?? 0;
    const summary = `Snippets: loaded ${count} from ${result.sources.length} file(s).`;
    if (result.warnings.length > 0) {
        void vscode.window.showWarningMessage(`${summary} (${result.warnings.length} warning(s), see WhiteNeedle output).`);
        output?.appendLine('[WhiteNeedle] Snippet sync warnings:');
        result.warnings.forEach((w) => output?.appendLine(`  ${w}`));
    } else {
        void vscode.window.showInformationMessage(summary);
    }
}

// ─── Merged list for panel ───

export function getAllSnippetsMerged(custom: ScriptSnippet[]): ScriptSnippet[] {
    return mergeDisplaySnippets(BUILTIN_SNIPPETS, cachedTeamSnippetsRaw, cachedPersonalSnippetsRaw, custom).snippets;
}

export function getTeamSnippetIdsForUi(): Set<string> {
    return new Set(cachedTeamSnippetsRaw.map((s) => s.id));
}

export function getPersonalSnippetIdsForUi(): Set<string> {
    return new Set(cachedPersonalSnippetsRaw.map((s) => s.id));
}

// ─── File watchers ───

export function createTeamSnippetWatchers(onChange: () => void): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];
    const teamDir = getConfiguredTeamDir();
    const folders = vscode.workspace.workspaceFolders ?? [];

    if (!teamDir) { return vscode.Disposable.from(); }

    if (isAbsolutePath(teamDir)) {
        const pattern = new vscode.RelativePattern(vscode.Uri.file(teamDir), '*.json');
        const w = vscode.workspace.createFileSystemWatcher(pattern);
        disposables.push(w, w.onDidChange(() => onChange()), w.onDidCreate(() => onChange()), w.onDidDelete(() => onChange()));
    } else {
        for (const folder of folders) {
            const dirUri = vscode.Uri.joinPath(folder.uri, ...teamDir.split('/').filter(Boolean));
            const pattern = new vscode.RelativePattern(dirUri, '*.json');
            const w = vscode.workspace.createFileSystemWatcher(pattern);
            disposables.push(w, w.onDidChange(() => onChange()), w.onDidCreate(() => onChange()), w.onDidDelete(() => onChange()));
        }
    }

    return vscode.Disposable.from(...disposables);
}

export function createPersonalSnippetWatchers(onChange: () => void): vscode.Disposable {
    const dir = getConfiguredPersonalDir();
    if (!dir || !isAbsolutePath(dir)) { return vscode.Disposable.from(); }

    const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), '*.json');
    const w = vscode.workspace.createFileSystemWatcher(pattern);
    return vscode.Disposable.from(w, w.onDidChange(() => onChange()), w.onDidCreate(() => onChange()), w.onDidDelete(() => onChange()));
}

