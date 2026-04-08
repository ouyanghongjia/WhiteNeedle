#!/usr/bin/env node
/**
 * Copies WhiteNeedle JS API markdown from the self-contained skill into the extension
 * so published VSIX bundles docs offline. Run from repo: npm run sync-bundled-docs (in vscode-extension).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(__dirname, '..');
const repoRoot = path.join(extRoot, '..');
const src = path.join(repoRoot, 'skills', 'whiteneedle-js-api', 'references');
const dest = path.join(extRoot, 'bundled-docs');

if (!fs.existsSync(src)) {
    console.error('sync-bundled-docs: missing skill references:', src);
    process.exit(1);
}
fs.mkdirSync(dest, { recursive: true });
const files = fs.readdirSync(src).filter((f) => f.endsWith('.md'));
for (const f of files) {
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
}
console.log(`sync-bundled-docs: copied ${files.length} files → ${dest}`);
