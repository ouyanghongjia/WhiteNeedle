/**
 * Records hook codes applied via HookPanel so they can be replayed
 * after a JSContext reset in project mode.
 */
export class HookCodeRegistry {
    private entries: Array<{ id: string; code: string; timestamp: number }> = [];

    record(id: string, code: string): void {
        this.remove(id);
        this.entries.push({ id, code, timestamp: Date.now() });
    }

    remove(id: string): void {
        this.entries = this.entries.filter(e => e.id !== id);
    }

    clear(): void {
        this.entries = [];
    }

    getRecordedHooks(): string[] {
        return this.entries
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(e => e.code);
    }

    get count(): number {
        return this.entries.length;
    }
}
