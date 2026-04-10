import * as fs from 'fs';
import * as path from 'path';

export interface LocalDependency {
    relativePath: string;
    content: string;
}

const REQUIRE_RE = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

/**
 * Recursively collects local (relative-path) require() dependencies
 * starting from a given JS file.  Bare module names (lodash, etc.)
 * are ignored — they are assumed pre-installed in wn_modules / wn_installed_modules.
 */
export class DependencyAnalyzer {
    static analyze(code: string, filePath: string): LocalDependency[] {
        const baseDir = path.dirname(filePath);
        const visited = new Set<string>();
        const result: LocalDependency[] = [];

        const walk = (source: string, sourceDir: string) => {
            let match: RegExpExecArray | null;
            const re = new RegExp(REQUIRE_RE.source, 'g');
            while ((match = re.exec(source)) !== null) {
                const rawSpec = match[1];
                let resolved = path.resolve(sourceDir, rawSpec);
                if (!resolved.endsWith('.js') && !resolved.endsWith('.json')) {
                    if (fs.existsSync(resolved + '.js')) {
                        resolved += '.js';
                    } else if (fs.existsSync(path.join(resolved, 'index.js'))) {
                        resolved = path.join(resolved, 'index.js');
                    } else {
                        resolved += '.js';
                    }
                }

                if (visited.has(resolved)) { continue; }
                visited.add(resolved);

                if (!fs.existsSync(resolved)) { continue; }

                const content = fs.readFileSync(resolved, 'utf-8');
                const relPath = path.relative(baseDir, resolved);
                result.push({ relativePath: relPath, content });

                walk(content, path.dirname(resolved));
            }
        };

        walk(code, baseDir);
        return result;
    }
}
