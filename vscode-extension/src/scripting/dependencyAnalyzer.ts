import * as fs from 'fs';
import * as path from 'path';

export interface LocalDependency {
    relativePath: string;
    content: string;
}

const REQUIRE_RE = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const IMPORT_RE  = /import\s+(?:[\w{},*\s]+\s+from\s+)?['"](\.[^'"]+)['"]/g;

/**
 * Recursively collects local (relative-path) dependencies
 * starting from a given JS file.  Supports both require() and ES import.
 * Bare module names (lodash, etc.) are ignored — they are assumed
 * pre-installed in wn_modules / wn_installed_modules.
 */
export class DependencyAnalyzer {
    static analyze(code: string, filePath: string): LocalDependency[] {
        const baseDir = path.dirname(filePath);
        const visited = new Set<string>();
        const result: LocalDependency[] = [];

        const resolveModule = (rawSpec: string, sourceDir: string): string => {
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
            return resolved;
        };

        const collectSpecs = (source: string): string[] => {
            const specs: string[] = [];
            let m: RegExpExecArray | null;
            const r1 = new RegExp(REQUIRE_RE.source, 'g');
            while ((m = r1.exec(source)) !== null) { specs.push(m[1]); }
            const r2 = new RegExp(IMPORT_RE.source, 'g');
            while ((m = r2.exec(source)) !== null) { specs.push(m[1]); }
            return specs;
        };

        const walk = (source: string, sourceDir: string) => {
            for (const rawSpec of collectSpecs(source)) {
                const resolved = resolveModule(rawSpec, sourceDir);
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

    /**
     * Convert ES module syntax to CommonJS so the code can run in JSC.
     *   import { a, b } from './x.js'  →  const { a, b } = require('./x.js')
     *   import x from './x.js'         →  const x = require('./x.js')
     *   import * as x from './x.js'    →  const x = require('./x.js')
     *   export function foo() {}       →  function foo() {} \n exports.foo = foo;
     *   export { a, b }                →  exports.a = a; exports.b = b;
     *   export default expr            →  exports.default = expr;
     */
    static esmToCjs(code: string): string {
        let result = code;

        // import { a, b } from './x'
        result = result.replace(
            /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?/g,
            (_m, names: string, mod: string) => {
                const trimmed = names.split(',').map((n: string) => n.trim()).filter(Boolean).join(', ');
                return `const { ${trimmed} } = require('${mod}');`;
            }
        );

        // import * as x from './x'
        result = result.replace(
            /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
            (_m, name: string, mod: string) => `const ${name} = require('${mod}');`
        );

        // import x from './x' (default import)
        result = result.replace(
            /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
            (_m, name: string, mod: string) => `const ${name} = require('${mod}');`
        );

        // export default <expr>
        result = result.replace(
            /export\s+default\s+/g,
            'exports.default = '
        );

        // export function foo(...)  /  export class Foo
        result = result.replace(
            /export\s+(function|class)\s+(\w+)/g,
            (_m, keyword: string, name: string) => `${keyword} ${name}`
        );
        // collect named function/class exports and append assignments at end
        const namedExports: string[] = [];
        const namedRe = /export\s+(?:function|class)\s+(\w+)/g;
        let nm: RegExpExecArray | null;
        while ((nm = namedRe.exec(code)) !== null) {
            namedExports.push(nm[1]);
        }

        // export { a, b }
        result = result.replace(
            /export\s+\{([^}]+)\}\s*;?/g,
            (_m, names: string) => {
                return names.split(',').map((n: string) => {
                    const t = n.trim();
                    return t ? `exports.${t} = ${t};` : '';
                }).filter(Boolean).join('\n');
            }
        );

        if (namedExports.length > 0) {
            result += '\n' + namedExports.map(n => `exports.${n} = ${n};`).join('\n');
        }

        return result;
    }
}
