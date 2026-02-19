/**
 * Browser automation tool — S2.N.4
 *
 * Provides headless browser automation via Playwright (if available).
 * Enforces domain allowlist before navigating, applies timeouts,
 * and optionally captures screenshots or executes scripts in page context.
 *
 * Playwright is NOT a required dependency. The module detects its
 * availability at runtime via dynamic import and returns a clear error
 * if Playwright is not installed.
 *
 * For testability, callers may inject a playwright-compatible module
 * via the `playwrightProvider` option (dependency injection).
 */

import { wrapUntrustedContent } from '../security/spotlighting.js';
import { createModuleLogger } from '../utils/logger.js';
import { BrowserToolOptionsSchema } from './browser-types.js';
import type {
  BrowserToolOptions,
  BrowserResult,
  PlaywrightBrowser,
  PlaywrightPage,
  PlaywrightProvider,
} from './browser-types.js';

export type { BrowserToolOptions, BrowserResult, PlaywrightProvider } from './browser-types.js';
export { BrowserToolOptionsSchema } from './browser-types.js';

const browserLogger = createModuleLogger('browser-tool');

/** Default page navigation timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Maximum content length returned from page extraction. */
const MAX_CONTENT_LENGTH = 50_000;

/**
 * Extract the hostname from a URL string for domain allowlist checks.
 *
 * @param urlString - Full URL to parse.
 * @returns The hostname portion of the URL.
 * @throws {Error} When the URL cannot be parsed.
 */
function extractHostname(urlString: string): string {
  return new URL(urlString).hostname;
}

/**
 * Check whether a hostname is present in the allowedDomains list.
 *
 * @param hostname - Hostname extracted from the target URL.
 * @param allowedDomains - Array of permitted domain strings.
 * @returns True when the hostname is explicitly allowed.
 */
function isDomainAllowed(hostname: string, allowedDomains: string[]): boolean {
  return allowedDomains.includes(hostname);
}

/**
 * Attempt to dynamically import the `playwright` package.
 *
 * @returns The Playwright module or undefined when the package is not installed.
 */
async function loadPlaywright(): Promise<PlaywrightProvider | undefined> {
  try {
    const pw = await import('playwright') as unknown as PlaywrightProvider;
    return pw?.chromium ? pw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Race a promise against a timeout.
 *
 * @param promise - The promise to race.
 * @param timeoutMs - Maximum duration in milliseconds.
 * @param label - A label used in the timeout error message.
 * @returns The resolved value of the promise.
 * @throws {Error} When the timeout expires before the promise resolves.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let handle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(handle!);
  }
}

/**
 * Execute a headless browser action.
 *
 * 1. Validates options with Zod.
 * 2. Checks the target URL hostname against the domain allowlist.
 * 3. Resolves Playwright (injected provider or dynamic import).
 * 4. Launches a headless Chromium browser.
 * 5. Navigates to the URL with the configured timeout.
 * 6. Optionally runs a script in the page context.
 * 7. Optionally captures a screenshot.
 * 8. Wraps page content with spotlighting for safe downstream consumption.
 * 9. Cleans up the browser regardless of outcome.
 *
 * @param options - Browser action options including url, script, timeout,
 *   screenshot, allowedDomains, and an optional playwrightProvider for DI.
 * @returns A BrowserResult describing success or failure.
 */
export async function executeBrowserAction(options: BrowserToolOptions): Promise<BrowserResult> {
  try {
    const validation = BrowserToolOptionsSchema.safeParse(options);
    if (!validation.success) {
      const issues = validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return { success: false, content: '', error: `Invalid options: ${issues}` };
    }

    const { url, script, screenshot, allowedDomains } = options;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

    let hostname: string;
    try {
      hostname = extractHostname(url);
    } catch {
      return { success: false, content: '', error: `Invalid URL: ${url}` };
    }

    if (!isDomainAllowed(hostname, allowedDomains)) {
      browserLogger.warn({ hostname, allowedDomains }, 'Browser navigation blocked — domain not in allowlist');
      return { success: false, content: '', error: `Domain "${hostname}" is not in the allowed domains list` };
    }

    const playwright = options.playwrightProvider ?? (await loadPlaywright());
    if (!playwright) {
      browserLogger.warn('Playwright is not installed — browser tool unavailable');
      return { success: false, content: '', error: 'Playwright is not installed. Install it with: npm install playwright' };
    }

    let browser: PlaywrightBrowser | undefined;
    let page: PlaywrightPage | undefined;

    try {
      browser = await playwright.chromium.launch({ headless: true });
      page = await browser.newPage();

      await withTimeout(page.goto(url, { timeout, waitUntil: 'domcontentloaded' }), timeout, 'Page navigation');

      let scriptResult: string | undefined;
      if (script) {
        const rawResult = await withTimeout(page.evaluate(script), timeout, 'Script execution');
        scriptResult = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
      }

      let screenshotPath: string | undefined;
      if (screenshot) {
        const tmpPath = `/tmp/lildude-screenshot-${Date.now()}.png`;
        await page.screenshot({ path: tmpPath, fullPage: true });
        screenshotPath = tmpPath;
      }

      const rawContent = scriptResult ?? (await page.content());
      const truncated = rawContent.length > MAX_CONTENT_LENGTH
        ? rawContent.substring(0, MAX_CONTENT_LENGTH) + '\n[...content truncated...]'
        : rawContent;

      const spottedContent = wrapUntrustedContent(truncated, `browser:${hostname}`);
      browserLogger.info({ hostname, url, hasScript: !!script, hasScreenshot: !!screenshot }, 'Browser action completed');

      return { success: true, content: spottedContent, screenshotPath };
    } finally {
      try { if (page) await page.close(); } catch { /* best-effort */ }
      try { if (browser) await browser.close(); } catch { /* best-effort */ }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    browserLogger.error({ error: message }, 'Browser tool error');
    return { success: false, content: '', error: `Browser tool error: ${message}` };
  }
}
