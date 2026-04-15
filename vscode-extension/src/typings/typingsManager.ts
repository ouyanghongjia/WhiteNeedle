import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const TYPINGS_FILENAME = 'whiteneedle.d.ts';

/**
 * Ensures WhiteNeedle JS API type declarations are available for
 * IntelliSense in the current workspace.
 *
 * Strategy:
 *   1. Copy the bundled `whiteneedle.d.ts` into `.vscode/` of each
 *      workspace folder. VS Code's implicit JS project (when no
 *      jsconfig.json exists) automatically includes all `.d.ts` files
 *      in the workspace tree, so no root-level jsconfig.json is needed.
 *   2. If a `jsconfig.json` or `tsconfig.json` already exists with
 *      restrictive `include` patterns that would miss `.vscode/`,
 *      patch it to add the `.vscode/whiteneedle.d.ts` path.
 */
export function ensureTypingsForWorkspace(context: vscode.ExtensionContext): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return; }

    const typingsSource = path.join(context.extensionPath, 'typings', TYPINGS_FILENAME);
    if (!fs.existsSync(typingsSource)) { return; }

    for (const folder of folders) {
        ensureTypingsInFolder(folder.uri.fsPath, typingsSource);
    }
}

/**
 * Returns the absolute path to the bundled whiteneedle.d.ts.
 */
export function getBundledTypingsPath(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'typings', TYPINGS_FILENAME);
}

/**
 * Remove `.vscode/whiteneedle.d.ts` from every workspace folder (cleanup on deactivate).
 */
export function removeTypingsFromWorkspace(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) { return; }
    for (const folder of folders) {
        const target = path.join(folder.uri.fsPath, '.vscode', TYPINGS_FILENAME);
        try {
            if (fs.existsSync(target)) { fs.unlinkSync(target); }
        } catch { /* ignore */ }
    }
}

function ensureTypingsInFolder(folderPath: string, typingsSource: string): void {
    const vscodeDir = path.join(folderPath, '.vscode');
    const targetDts = path.join(vscodeDir, TYPINGS_FILENAME);

    try {
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }
        const sourceContent = fs.readFileSync(typingsSource, 'utf-8');
        const existingContent = fs.existsSync(targetDts)
            ? fs.readFileSync(targetDts, 'utf-8')
            : null;
        if (sourceContent !== existingContent) {
            fs.writeFileSync(targetDts, sourceContent, 'utf-8');
        }
    } catch {
        // Workspace may be read-only
        return;
    }

    // If a jsconfig/tsconfig exists with an explicit `include` that would miss
    // `.vscode/*.d.ts`, patch it so the language service still picks up our types.
    const jsconfigPath = path.join(folderPath, 'jsconfig.json');
    const tsconfigPath = path.join(folderPath, 'tsconfig.json');
    const relativeDts = '.vscode/' + TYPINGS_FILENAME;

    if (fs.existsSync(tsconfigPath)) {
        patchConfigIfNeeded(tsconfigPath, relativeDts);
    } else if (fs.existsSync(jsconfigPath)) {
        patchConfigIfNeeded(jsconfigPath, relativeDts);
    }
}

/**
 * If the config has an explicit `include` array, make sure our `.vscode/whiteneedle.d.ts`
 * is listed so the TS language service includes it.  Does NOT create the config file.
 */
function patchConfigIfNeeded(configPath: string, relativeDts: string): void {
    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(stripJsonComments(raw));

        if (!Array.isArray(config.include)) { return; }

        const alreadyHas = config.include.some(
            (entry: string) => entry.includes(TYPINGS_FILENAME)
        );
        if (alreadyHas) { return; }

        config.include.push(relativeDts);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4) + '\n', 'utf-8');
    } catch {
        // Parse error or write error — don't break the user's config
    }
}

function stripJsonComments(text: string): string {
    return text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
