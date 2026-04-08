import * as vscode from 'vscode';
import { ScriptSnippet, importSnippets, BUILTIN_SNIPPETS } from './snippetLibrary';
import { combineTeamFiles, mergeDisplaySnippets } from './teamSnippetsMerge';

export const DEFAULT_TEAM_SNIPPETS_RELATIVE_PATH = '.whiteneedle/team-snippets.json';

export interface TeamSnippetSourceInfo {
    uri: vscode.Uri;
    mtime: number;
    count: number;
}

export interface TeamSnippetSyncResult {
    teamSnippets: ScriptSnippet[];
    warnings: string[];
    errors: string[];
    sources: TeamSnippetSourceInfo[];
    missingFiles: string[];
    lastSyncAt: number;
}

/** Team snippets after load (builtin conflicts + cross-file dedupe); custom overrides applied in getAllSnippetsMerged. */
let cachedTeamSnippetsRaw: ScriptSnippet[] = [];
let lastSyncResult: TeamSnippetSyncResult = {
    teamSnippets: [],
    warnings: [],
    errors: [],
    sources: [],
    missingFiles: [],
    lastSyncAt: 0,
};

export function getTeamSnippetsRawFromCache(): ScriptSnippet[] {
    return cachedTeamSnippetsRaw;
}

export function getLastTeamSyncResult(): TeamSnippetSyncResult {
    return lastSyncResult;
}

export function getConfiguredTeamFileRelativePath(): string {
    const cfg = vscode.workspace.getConfiguration('whiteneedle');
    const rel = cfg.get<string>('snippets.teamFile', DEFAULT_TEAM_SNIPPETS_RELATIVE_PATH);
    return rel.trim() || DEFAULT_TEAM_SNIPPETS_RELATIVE_PATH;
}

export function resolveTeamSnippetUris(
    folders: readonly vscode.WorkspaceFolder[],
    relativePath: string,
): vscode.Uri[] {
    const normalized = relativePath.replace(/\\/g, '/');
    return folders.map((f) => vscode.Uri.joinPath(f.uri, ...normalized.split('/').filter(Boolean)));
}

function formatSyncStatusSummary(result: TeamSnippetSyncResult): string {
    const n = result.teamSnippets.length;
    if (result.errors.length > 0 && result.sources.length === 0) {
        return `Team: sync failed (${result.errors.length} error(s))`;
    }
    if (result.sources.length === 0 && result.missingFiles.length > 0) {
        return 'Team: no snippet file in workspace (see settings path)';
    }
    if (result.sources.length === 0) {
        return 'Team: open a workspace folder to load team snippets';
    }
    const t = new Date(result.lastSyncAt);
    const timeStr = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`;
    return `Team: ${n} snippet(s) · last sync ${timeStr}`;
}

export function getTeamSyncStatusLabel(): string {
    return formatSyncStatusSummary(lastSyncResult);
}

/** Toasts + optional output for sync command / toolbar button. */
export function reportTeamSyncUi(result: TeamSnippetSyncResult, output?: vscode.OutputChannel): void {
    if (result.errors.length > 0) {
        const extra = result.errors.length > 1 ? ` (+${result.errors.length - 1} more)` : '';
        void vscode.window.showErrorMessage(`Team snippets: ${result.errors[0]}${extra}`);
        output?.appendLine('[WhiteNeedle] Team snippet sync errors:');
        result.errors.forEach((e) => output?.appendLine(`  ${e}`));
        return;
    }

    const folderCount = vscode.workspace.workspaceFolders?.length ?? 0;
    if (folderCount === 0) {
        void vscode.window.showInformationMessage('Team snippets: open a workspace folder first.');
        return;
    }

    if (result.sources.length === 0) {
        const rel = getConfiguredTeamFileRelativePath();
        void vscode.window.showInformationMessage(
            `Team snippets: no file found at "${rel}" under workspace root(s). Create it or change whiteneedle.snippets.teamFile.`,
        );
        return;
    }

    const summary = `Team snippets: loaded ${result.teamSnippets.length} from ${result.sources.length} file(s).`;
    if (result.warnings.length > 0) {
        void vscode.window.showWarningMessage(`${summary} (${result.warnings.length} warning(s), see WhiteNeedle output).`);
        output?.appendLine('[WhiteNeedle] Team snippet sync warnings:');
        result.warnings.forEach((w) => output?.appendLine(`  ${w}`));
    } else {
        void vscode.window.showInformationMessage(summary);
    }
}

export async function loadTeamSnippetsFromWorkspace(): Promise<TeamSnippetSyncResult> {
    const rel = getConfiguredTeamFileRelativePath();
    const folders = vscode.workspace.workspaceFolders ?? [];
    const errors: string[] = [];
    const parseWarnings: string[] = [];
    const sources: TeamSnippetSourceInfo[] = [];
    const missingFiles: string[] = [];
    const teamByFile: ScriptSnippet[][] = [];

    if (folders.length === 0) {
        const empty: TeamSnippetSyncResult = {
            teamSnippets: [],
            warnings: [],
            errors: ['No workspace folder open.'],
            sources: [],
            missingFiles: [],
            lastSyncAt: Date.now(),
        };
        cachedTeamSnippetsRaw = [];
        lastSyncResult = empty;
        return empty;
    }

    const uris = resolveTeamSnippetUris(folders, rel);

    for (const uri of uris) {
        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            missingFiles.push(uri.fsPath);
            continue;
        }

        try {
            const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
            const parsed = importSnippets(raw);
            let mtime = 0;
            try {
                const st = await vscode.workspace.fs.stat(uri);
                mtime = st.mtime;
            } catch {
                mtime = 0;
            }
            sources.push({ uri, mtime, count: parsed.length });
            teamByFile.push(parsed);
        } catch (e: any) {
            errors.push(`${uri.fsPath}: ${e?.message ?? String(e)}`);
        }
    }

    const { teamSnippets: teamRaw, warnings: combineWarnings } = combineTeamFiles(BUILTIN_SNIPPETS, teamByFile);
    const allWarnings = [...parseWarnings, ...combineWarnings];

    const result: TeamSnippetSyncResult = {
        teamSnippets: teamRaw,
        warnings: allWarnings,
        errors,
        sources,
        missingFiles,
        lastSyncAt: Date.now(),
    };

    cachedTeamSnippetsRaw = teamRaw;
    lastSyncResult = result;
    return result;
}

/**
 * Full list for the snippet panel: built-in, team (cache), local custom — with custom overriding team ids.
 */
export function getAllSnippetsMerged(custom: ScriptSnippet[]): ScriptSnippet[] {
    return mergeDisplaySnippets(BUILTIN_SNIPPETS, getTeamSnippetsRawFromCache(), custom).snippets;
}

export function getTeamSnippetIdsForUi(): Set<string> {
    return new Set(getTeamSnippetsRawFromCache().map((s) => s.id));
}

/**
 * Watches team snippet files under each workspace root (path from settings at subscribe time).
 * If `whiteneedle.snippets.teamFile` changes, reopen the Snippets panel or run Sync again to re-bind paths.
 */
export function createTeamSnippetWatchers(
    onChange: () => void,
): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];
    const rel = getConfiguredTeamFileRelativePath();
    const folders = vscode.workspace.workspaceFolders ?? [];

    for (const folder of folders) {
        const pattern = new vscode.RelativePattern(folder, rel);
        const w = vscode.workspace.createFileSystemWatcher(pattern);
        disposables.push(w);
        disposables.push(w.onDidChange(() => onChange()));
        disposables.push(w.onDidCreate(() => onChange()));
        disposables.push(w.onDidDelete(() => onChange()));
    }

    return vscode.Disposable.from(...disposables);
}
