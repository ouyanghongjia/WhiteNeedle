/**
 * WDA (WebDriverAgent) HTTP Client
 *
 * Speaks the W3C WebDriver / WDA-extended protocol over HTTP.
 * WDA runs on the iOS device (port 8100 by default, forwarded via iproxy).
 */

export interface WdaElement {
    ELEMENT: string;
    'element-6066-11e4-a52e-4f735466cecf'?: string;
}

export interface WdaRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface WdaStatus {
    ready: boolean;
    message?: string;
    sessionId?: string;
    os?: { name: string; version: string };
    build?: Record<string, unknown>;
}

interface WdaResponse<T = unknown> {
    value: T;
    sessionId?: string;
    status?: number;
}

export class WdaClient {
    private baseUrl: string;
    private sessionId: string | null = null;
    private timeout = 15000;

    constructor(host = '127.0.0.1', port = 8100) {
        this.baseUrl = `http://${host}:${port}`;
    }

    get isSessionActive(): boolean {
        return this.sessionId !== null;
    }

    get endpoint(): string {
        return this.baseUrl;
    }

    // ------------------------------------------------------------------
    // Low-level HTTP
    // ------------------------------------------------------------------

    private async request<T = unknown>(
        method: string,
        path: string,
        body?: Record<string, unknown>,
    ): Promise<T> {
        const url = `${this.baseUrl}${path}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);

        try {
            const res = await fetch(url, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });

            const text = await res.text();
            let json: WdaResponse<T>;
            try {
                json = JSON.parse(text) as WdaResponse<T>;
            } catch {
                throw new Error(`WDA returned non-JSON: ${text.slice(0, 200)}`);
            }

            if (!res.ok && json.value && typeof json.value === 'object' && 'error' in (json.value as Record<string, unknown>)) {
                const errObj = json.value as Record<string, unknown>;
                throw new Error(`WDA error: ${errObj['error']} — ${errObj['message'] ?? ''}`);
            }

            return json.value;
        } finally {
            clearTimeout(timer);
        }
    }

    private sessionPath(suffix = ''): string {
        if (!this.sessionId) throw new Error('No active WDA session. Call createSession() first.');
        return `/session/${this.sessionId}${suffix}`;
    }

    // ------------------------------------------------------------------
    // Status & Session
    // ------------------------------------------------------------------

    async status(): Promise<WdaStatus> {
        return this.request<WdaStatus>('GET', '/status');
    }

    async createSession(bundleId?: string): Promise<string> {
        const capabilities: Record<string, unknown> = {};
        if (bundleId) {
            capabilities['bundleId'] = bundleId;
        }

        const result = await this.request<{ sessionId: string; capabilities?: unknown }>(
            'POST', '/session',
            { capabilities: { alwaysMatch: capabilities } },
        );

        this.sessionId = result.sessionId ?? (result as unknown as { sessionId: string }).sessionId;
        if (!this.sessionId) {
            const raw = result as unknown as Record<string, unknown>;
            this.sessionId = (raw['sessionId'] as string) ?? null;
        }
        return this.sessionId!;
    }

    async deleteSession(): Promise<void> {
        if (!this.sessionId) return;
        try {
            await this.request('DELETE', this.sessionPath());
        } finally {
            this.sessionId = null;
        }
    }

    // ------------------------------------------------------------------
    // App lifecycle
    // ------------------------------------------------------------------

    async launchApp(bundleId: string): Promise<void> {
        await this.request('POST', this.sessionPath('/wda/apps/launch'), { bundleId });
    }

    async activateApp(bundleId: string): Promise<void> {
        await this.request('POST', this.sessionPath('/wda/apps/activate'), { bundleId });
    }

    async terminateApp(bundleId: string): Promise<void> {
        await this.request('POST', this.sessionPath('/wda/apps/terminate'), { bundleId });
    }

    async queryAppState(bundleId: string): Promise<number> {
        const result = await this.request<number>(
            'POST', this.sessionPath('/wda/apps/state'),
            { bundleId },
        );
        return result;
    }

    // ------------------------------------------------------------------
    // Element finding
    // ------------------------------------------------------------------

    async findElement(
        using: 'accessibility id' | 'class name' | 'xpath' | 'predicate string' | 'class chain',
        value: string,
    ): Promise<WdaElement> {
        return this.request<WdaElement>(
            'POST', this.sessionPath('/element'),
            { using, value },
        );
    }

    async findElements(
        using: 'accessibility id' | 'class name' | 'xpath' | 'predicate string' | 'class chain',
        value: string,
    ): Promise<WdaElement[]> {
        return this.request<WdaElement[]>(
            'POST', this.sessionPath('/elements'),
            { using, value },
        );
    }

    private elementId(el: WdaElement): string {
        return el['element-6066-11e4-a52e-4f735466cecf'] ?? el.ELEMENT;
    }

    // ------------------------------------------------------------------
    // Element actions
    // ------------------------------------------------------------------

    async clickElement(element: WdaElement): Promise<void> {
        const id = this.elementId(element);
        await this.request('POST', this.sessionPath(`/element/${id}/click`));
    }

    async sendKeys(element: WdaElement, text: string): Promise<void> {
        const id = this.elementId(element);
        await this.request('POST', this.sessionPath(`/element/${id}/value`), { text });
    }

    async clearElement(element: WdaElement): Promise<void> {
        const id = this.elementId(element);
        await this.request('POST', this.sessionPath(`/element/${id}/clear`));
    }

    async getElementText(element: WdaElement): Promise<string> {
        const id = this.elementId(element);
        return this.request<string>('GET', this.sessionPath(`/element/${id}/text`));
    }

    async getElementAttribute(element: WdaElement, name: string): Promise<string | null> {
        const id = this.elementId(element);
        return this.request<string | null>('GET', this.sessionPath(`/element/${id}/attribute/${name}`));
    }

    async getElementRect(element: WdaElement): Promise<WdaRect> {
        const id = this.elementId(element);
        return this.request<WdaRect>('GET', this.sessionPath(`/element/${id}/rect`));
    }

    async isElementDisplayed(element: WdaElement): Promise<boolean> {
        const id = this.elementId(element);
        return this.request<boolean>('GET', this.sessionPath(`/element/${id}/displayed`));
    }

    async isElementEnabled(element: WdaElement): Promise<boolean> {
        const id = this.elementId(element);
        return this.request<boolean>('GET', this.sessionPath(`/element/${id}/enabled`));
    }

    // ------------------------------------------------------------------
    // Touch actions
    // ------------------------------------------------------------------

    async tap(x: number, y: number): Promise<void> {
        await this.request('POST', this.sessionPath('/wda/tap/0'), { x, y });
    }

    async doubleTap(x: number, y: number): Promise<void> {
        await this.request('POST', this.sessionPath('/wda/doubleTap'), { x, y });
    }

    async longPress(x: number, y: number, duration = 1): Promise<void> {
        await this.request('POST', this.sessionPath('/wda/touchAndHold'), { x, y, duration });
    }

    async swipe(
        fromX: number, fromY: number,
        toX: number, toY: number,
        duration = 0.5,
    ): Promise<void> {
        await this.request('POST', this.sessionPath('/wda/dragfromtoforduration'), {
            fromX, fromY, toX, toY, duration,
        });
    }

    // ------------------------------------------------------------------
    // Alerts (system dialogs)
    // ------------------------------------------------------------------

    async getAlertText(): Promise<string> {
        return this.request<string>('GET', this.sessionPath('/alert/text'));
    }

    async acceptAlert(): Promise<void> {
        await this.request('POST', this.sessionPath('/alert/accept'));
    }

    async dismissAlert(): Promise<void> {
        await this.request('POST', this.sessionPath('/alert/dismiss'));
    }

    // ------------------------------------------------------------------
    // Screen
    // ------------------------------------------------------------------

    async getScreenshot(): Promise<string> {
        return this.request<string>('GET', this.sessionPath('/screenshot'));
    }

    async getWindowSize(): Promise<{ width: number; height: number }> {
        return this.request<{ width: number; height: number }>(
            'GET', this.sessionPath('/window/rect'),
        );
    }

    async getPageSource(): Promise<string> {
        return this.request<string>('GET', this.sessionPath('/source'));
    }

    // ------------------------------------------------------------------
    // Device controls
    // ------------------------------------------------------------------

    async pressHome(): Promise<void> {
        await this.request('POST', '/wda/homescreen');
    }

    async lock(): Promise<void> {
        await this.request('POST', this.sessionPath('/wda/lock'));
    }

    async unlock(): Promise<void> {
        await this.request('POST', this.sessionPath('/wda/unlock'));
    }

    async isLocked(): Promise<boolean> {
        return this.request<boolean>('GET', this.sessionPath('/wda/locked'));
    }

    async getDeviceInfo(): Promise<Record<string, unknown>> {
        return this.request<Record<string, unknown>>('GET', this.sessionPath('/wda/device/info'));
    }

    async setBatteryMonitor(enabled: boolean): Promise<void> {
        await this.request('POST', this.sessionPath('/wda/batteryInfo'), {});
    }

    // ------------------------------------------------------------------
    // Keyboard
    // ------------------------------------------------------------------

    async typeText(text: string): Promise<void> {
        await this.request('POST', this.sessionPath('/wda/keys'), { value: text.split('') });
    }

    // ------------------------------------------------------------------
    // Orientation
    // ------------------------------------------------------------------

    async getOrientation(): Promise<string> {
        return this.request<string>('GET', this.sessionPath('/orientation'));
    }

    async setOrientation(orientation: 'PORTRAIT' | 'LANDSCAPE'): Promise<void> {
        await this.request('POST', this.sessionPath('/orientation'), { orientation });
    }

    // ------------------------------------------------------------------
    // Convenience: find + tap by accessibility ID
    // ------------------------------------------------------------------

    async tapByAccessibilityId(label: string): Promise<void> {
        const el = await this.findElement('accessibility id', label);
        await this.clickElement(el);
    }

    async tapByText(text: string): Promise<void> {
        const el = await this.findElement('predicate string', `label == "${text}" OR value == "${text}"`);
        await this.clickElement(el);
    }

    async tapByXPath(xpath: string): Promise<void> {
        const el = await this.findElement('xpath', xpath);
        await this.clickElement(el);
    }

    /** Wait for an element and tap it. */
    async waitAndTap(
        using: 'accessibility id' | 'predicate string' | 'class chain' | 'xpath',
        value: string,
        timeoutMs = 10000,
    ): Promise<void> {
        const el = await this.waitForElement(using, value, timeoutMs);
        await this.clickElement(el);
    }

    /** Poll until an element appears. */
    async waitForElement(
        using: 'accessibility id' | 'class name' | 'xpath' | 'predicate string' | 'class chain',
        value: string,
        timeoutMs = 10000,
    ): Promise<WdaElement> {
        const deadline = Date.now() + timeoutMs;
        let lastErr: Error | null = null;

        while (Date.now() < deadline) {
            try {
                return await this.findElement(using, value);
            } catch (e) {
                lastErr = e instanceof Error ? e : new Error(String(e));
                await new Promise((r) => setTimeout(r, 500));
            }
        }
        throw new Error(`Element not found within ${timeoutMs}ms (${using}=${value}): ${lastErr?.message}`);
    }
}
