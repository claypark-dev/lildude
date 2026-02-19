/**
 * Browser tool types — S2.N.4
 *
 * Shared type definitions for the browser automation tool.
 * Includes Playwright stubs, option/result interfaces, and Zod validation.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Playwright type stubs (avoid importing real types at compile time)
// ---------------------------------------------------------------------------

/** Minimal Browser interface matching Playwright's Browser. */
export interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

/** Minimal Page interface matching Playwright's Page. */
export interface PlaywrightPage {
  goto(url: string, options?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  content(): Promise<string>;
  evaluate(script: string): Promise<unknown>;
  screenshot(options?: { path?: string; fullPage?: boolean }): Promise<Buffer>;
  close(): Promise<void>;
}

/** Minimal Chromium launch interface. */
export interface PlaywrightChromium {
  launch(options?: { headless?: boolean }): Promise<PlaywrightBrowser>;
}

/** Shape of a playwright-compatible module (injectable for testing). */
export interface PlaywrightProvider {
  chromium: PlaywrightChromium;
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Options for a browser automation action. */
export interface BrowserToolOptions {
  /** URL to navigate to. */
  url: string;
  /** Optional JavaScript to execute in the page context after load. */
  script?: string;
  /** Navigation timeout in milliseconds (default: 30 000). */
  timeout?: number;
  /** Whether to capture a screenshot of the page. */
  screenshot?: boolean;
  /** Allowed domains — navigation is blocked unless the URL host is listed. */
  allowedDomains: string[];
  /** Optional injected playwright provider for testing / custom setups. */
  playwrightProvider?: PlaywrightProvider;
}

/** Result returned by executeBrowserAction. */
export interface BrowserResult {
  /** Whether the action completed successfully. */
  success: boolean;
  /** Extracted page content, script result, or error message. */
  content: string;
  /** File path to a captured screenshot, if requested. */
  screenshotPath?: string;
  /** Error description when success is false. */
  error?: string;
}

/** Zod schema for validating BrowserToolOptions at runtime. */
export const BrowserToolOptionsSchema = z.object({
  url: z.string().url('A valid URL is required'),
  script: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  screenshot: z.boolean().optional(),
  allowedDomains: z.array(z.string().min(1)).min(1, 'At least one allowed domain is required'),
});
