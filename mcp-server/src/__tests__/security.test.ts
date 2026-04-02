import { describe, it, expect } from 'vitest';

/**
 * Tests that validate the code-generation patterns used by MCP tools
 * are safe against injection attacks.
 */
describe('MCP tool code injection safety', () => {
    describe('trace_method — target escaping', () => {
        function generateTraceCode(target: string): string {
            const safeTarget = JSON.stringify(target);
            return `
(function() {
    var t = ${safeTarget};
    Interceptor.attach(t, {
        onEnter: function(self) {
            console.log('[TRACE] ' + t + ' called on: ' + self);
        },
        onLeave: function() {
            console.log('[TRACE] ' + t + ' returned');
        }
    });
})();
`;
        }

        it('safely escapes normal selectors', () => {
            const code = generateTraceCode('-[NSURLSession dataTaskWithRequest:]');
            expect(code).toContain('"-[NSURLSession dataTaskWithRequest:]"');
        });

        it('prevents breakout via double quotes', () => {
            const malicious = '"; process.exit(1); //';
            const code = generateTraceCode(malicious);
            expect(code).toContain(`var t = ${JSON.stringify(malicious)}`);
            expect(code).not.toMatch(/var t = ""; process\.exit/);
        });

        it('prevents breakout via template literals', () => {
            const malicious = '`; require("child_process").exec("rm -rf /"); `';
            const code = generateTraceCode(malicious);
            expect(code).toContain(JSON.stringify(malicious));
        });

        it('handles newlines in input', () => {
            const malicious = 'foo\n"; evil(); //';
            const code = generateTraceCode(malicious);
            expect(code).toContain('\\n');
            expect(code).not.toMatch(/^"; evil\(\)/m);
        });
    });

    describe('inspect_object — expression escaping', () => {
        function generateInspectCode(expression: string): string {
            return `
(function() {
    try {
        var obj = eval(${JSON.stringify(expression)});
        if (!obj) return JSON.stringify({ error: 'Expression returned null' });
        var desc = obj.toString ? obj.toString() : String(obj);
        return JSON.stringify({ description: desc });
    } catch(e) {
        return JSON.stringify({ error: e.message || String(e) });
    }
})()
`;
        }

        it('wraps normal expressions safely', () => {
            const code = generateInspectCode("ObjC.use('UIApplication')");
            expect(code).toContain(`eval("ObjC.use('UIApplication')")`);
        });

        it('prevents breakout via closing parens and semicolons', () => {
            const malicious = '"); process.exit(1); //';
            const code = generateInspectCode(malicious);
            expect(code).toContain('eval("\\"); process.exit(1); //")');
        });

        it('handles unicode escapes', () => {
            const malicious = '\u0022); require(\u0022child_process\u0022);//';
            const code = generateInspectCode(malicious);
            const evalArg = JSON.stringify(malicious);
            expect(code).toContain(`eval(${evalArg})`);
        });
    });

    describe('heap_search — className escaping', () => {
        function generateHeapCode(className: string): string {
            const safeClassName = JSON.stringify(className);
            return `
(function() {
    var instances = ObjC.chooseSync(${safeClassName});
    return JSON.stringify({
        count: instances.length,
        samples: instances.slice(0, 10).map(function(i) { return String(i); })
    });
})()
`;
        }

        it('safely passes normal class names', () => {
            const code = generateHeapCode('NSObject');
            expect(code).toContain('ObjC.chooseSync("NSObject")');
        });

        it('prevents injection via single-quote breakout', () => {
            const malicious = "NSObject'); process.exit(1); //";
            const code = generateHeapCode(malicious);
            expect(code).toContain(`ObjC.chooseSync(${JSON.stringify(malicious)})`);
            expect(code).not.toMatch(/chooseSync\('NSObject'\)/);
        });
    });
});
