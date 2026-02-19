import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeBrowserAction } from '../../../src/tools/browser.js';
import type { BrowserToolOptions, PlaywrightProvider } from '../../../src/tools/browser.js';

// ---------------------------------------------------------------------------
// Mock playwright provider (dependency injection — no module mocking needed)
// ---------------------------------------------------------------------------

function createMockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue('<html><body>Hello</body></html>'),
    evaluate: vi.fn().mockResolvedValue('script-result'),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockProvider(page = createMockPage()): {
  provider: PlaywrightProvider;
  mocks: {
    page: ReturnType<typeof createMockPage>;
    launch: ReturnType<typeof vi.fn>;
    browserClose: ReturnType<typeof vi.fn>;
  };
} {
  const browserClose = vi.fn().mockResolvedValue(undefined);
  const launch = vi.fn().mockResolvedValue({
    newPage: vi.fn().mockResolvedValue(page),
    close: browserClose,
  });

  return {
    provider: { chromium: { launch } },
    mocks: { page, launch, browserClose },
  };
}

describe('browser tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('domain allowlist enforcement', () => {
    it('blocks navigation to a domain not in the allowlist', async () => {
      const { provider, mocks } = createMockProvider();
      const options: BrowserToolOptions = {
        url: 'https://evil.example.com/phishing',
        allowedDomains: ['www.google.com'],
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in the allowed domains');
      expect(result.error).toContain('evil.example.com');
      expect(mocks.launch).not.toHaveBeenCalled();
    });

    it('allows navigation to a domain in the allowlist', async () => {
      const { provider, mocks } = createMockProvider();
      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(true);
      expect(mocks.launch).toHaveBeenCalled();
      expect(mocks.page.goto).toHaveBeenCalledWith(
        'https://www.google.com/travel/flights',
        expect.objectContaining({ waitUntil: 'domcontentloaded' }),
      );
    });

    it('blocks when allowedDomains is empty', async () => {
      const { provider } = createMockProvider();
      const options: BrowserToolOptions = {
        url: 'https://www.google.com/search',
        allowedDomains: [],
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('At least one allowed domain');
    });

    it('is case-insensitive for URLs (URL parser lowercases hostnames)', async () => {
      const { provider } = createMockProvider();
      const options: BrowserToolOptions = {
        url: 'https://WWW.GOOGLE.COM/travel',
        allowedDomains: ['www.google.com'],
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);
      expect(result.success).toBe(true);
    });
  });

  describe('timeout enforcement', () => {
    it('uses default timeout of 30s when not specified', async () => {
      const { provider, mocks } = createMockProvider();
      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        playwrightProvider: provider,
      };

      await executeBrowserAction(options);

      expect(mocks.page.goto).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ timeout: 30000 }),
      );
    });

    it('uses custom timeout when specified', async () => {
      const { provider, mocks } = createMockProvider();
      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        timeout: 15000,
        playwrightProvider: provider,
      };

      await executeBrowserAction(options);

      expect(mocks.page.goto).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ timeout: 15000 }),
      );
    });

    it('handles timeout expiry gracefully', async () => {
      const page = createMockPage();
      page.goto.mockImplementation(() => new Promise(() => {
        // Never resolves — simulates a hang
      }));
      const { provider } = createMockProvider(page);

      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        timeout: 50,
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });
  });

  describe('script execution', () => {
    it('executes a script and returns its result', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue('extracted-data');
      const { provider } = createMockProvider(page);

      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        script: 'document.title',
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(true);
      expect(result.content).toContain('extracted-data');
      expect(page.evaluate).toHaveBeenCalledWith('document.title');
    });

    it('stringifies non-string script results', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValue({ flights: ['AA100', 'UA200'] });
      const { provider } = createMockProvider(page);

      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        script: 'JSON.parse("test")',
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(true);
      expect(result.content).toContain('AA100');
      expect(result.content).toContain('UA200');
    });

    it('returns page content when no script is provided', async () => {
      const page = createMockPage();
      page.content.mockResolvedValue('<html><body>Flight Results</body></html>');
      const { provider } = createMockProvider(page);

      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Flight Results');
    });
  });

  describe('screenshot capture', () => {
    it('captures a screenshot when requested', async () => {
      const page = createMockPage();
      const { provider } = createMockProvider(page);

      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        screenshot: true,
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(true);
      expect(result.screenshotPath).toBeDefined();
      expect(result.screenshotPath).toContain('lildude-screenshot-');
      expect(page.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ fullPage: true }),
      );
    });

    it('does not capture screenshot when not requested', async () => {
      const page = createMockPage();
      const { provider } = createMockProvider(page);

      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        screenshot: false,
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(true);
      expect(result.screenshotPath).toBeUndefined();
      expect(page.screenshot).not.toHaveBeenCalled();
    });
  });

  describe('playwright not installed', () => {
    it('returns a clear error when no playwright provider and module unavailable', async () => {
      // No playwrightProvider injected AND playwright is not installed
      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Playwright is not installed');
    });
  });

  describe('error handling', () => {
    it('handles navigation failures gracefully', async () => {
      const page = createMockPage();
      page.goto.mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED'));
      const { provider } = createMockProvider(page);

      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ERR_NAME_NOT_RESOLVED');
    });

    it('handles script evaluation failures', async () => {
      const page = createMockPage();
      page.evaluate.mockRejectedValue(new Error('ReferenceError: foo is not defined'));
      const { provider } = createMockProvider(page);

      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        script: 'foo.bar.baz',
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ReferenceError');
    });

    it('returns error for invalid URL', async () => {
      const { provider } = createMockProvider();
      const options: BrowserToolOptions = {
        url: 'not-a-valid-url',
        allowedDomains: ['www.google.com'],
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('closes browser even when navigation fails', async () => {
      const page = createMockPage();
      page.goto.mockRejectedValue(new Error('Navigation failed'));
      const { provider, mocks } = createMockProvider(page);

      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        playwrightProvider: provider,
      };

      await executeBrowserAction(options);

      expect(mocks.browserClose).toHaveBeenCalled();
    });
  });

  describe('spotlighting', () => {
    it('wraps page content with untrusted content markers', async () => {
      const page = createMockPage();
      page.content.mockResolvedValue('<html><body>Flight data</body></html>');
      const { provider } = createMockProvider(page);

      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(true);
      expect(result.content).toContain('<external_data');
      expect(result.content).toContain('trust_level="untrusted"');
      expect(result.content).toContain('browser:www.google.com');
    });
  });

  describe('input validation', () => {
    it('rejects missing url', async () => {
      const { provider } = createMockProvider();
      const options = {
        allowedDomains: ['www.google.com'],
        playwrightProvider: provider,
      } as unknown as BrowserToolOptions;

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid options');
    });

    it('rejects negative timeout', async () => {
      const { provider } = createMockProvider();
      const options: BrowserToolOptions = {
        url: 'https://www.google.com/travel/flights',
        allowedDomains: ['www.google.com'],
        timeout: -1,
        playwrightProvider: provider,
      };

      const result = await executeBrowserAction(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid options');
    });
  });
});
