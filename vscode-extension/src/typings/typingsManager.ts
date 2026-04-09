import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Ensures WhiteNeedle JS API type declarations are available for
 * IntelliSense in the current workspace. Creates or patches
 * jsconfig.json so the TS language service picks up the bundled
 * `typings/whiteneedle.d.ts` shipped inside the extension.
 */
export function ensureTypingsForWorkspace(context: vscode.ExtensionContext): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return; }

    const typingsSource = path.join(context.extensionPath, 'typings', 'whiteneedle.d.ts');
    if (!fs.existsSync(typingsSource)) { return; }

    for (const folder of folders) {
        ensureTypingsInFolder(folder.uri.fsPath, typingsSource);
    }
}

/**
 * Returns the absolute path to the bundled whiteneedle.d.ts.
 */
export function getBundledTypingsPath(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'typings', 'whiteneedle.d.ts');
}

function ensureTypingsInFolder(folderPath: string, typingsSource: string): void {
    const jsconfigPath = path.join(folderPath, 'jsconfig.json');
    const tsconfigPath = path.join(folderPath, 'tsconfig.json');

    if (fs.existsSync(tsconfigPath)) {
        patchConfigFile(tsconfigPath, typingsSource);
    } else if (fs.existsSync(jsconfigPath)) {
        patchConfigFile(jsconfigPath, typingsSource);
    } else {
        createJsConfig(jsconfigPath, typingsSource);
    }
}

function createJsConfig(configPath: string, typingsSource: string): void {
    const config = {
        compilerOptions: {
            target: 'ES6',
            module: 'commonjs',
            noEmit: true,
            allowJs: true,
            checkJs: false,
        },
        include: ['**/*.js', typingsSource],
    };

    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4) + '\n', 'utf-8');
    } catch {
        // Silently ignore — workspace may be read-only
    }
}

function patchConfigFile(configPath: string, typingsSource: string): void {
    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(stripJsonComments(raw));

        const include: string[] = config.include ?? [];
        const alreadyHas = include.some(
            (entry: string) => entry.includes('whiteneedle.d.ts')
        );

        if (alreadyHas) { return; }

        include.push(typingsSource);
        config.include = include;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4) + '\n', 'utf-8');
    } catch {
        // Parse error or write error — don't break the user's config
    }
}

function stripJsonComments(text: string): string {
    return text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
