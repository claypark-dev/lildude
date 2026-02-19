/**
 * ASCII Art Banner — S4.T.5
 *
 * Provides the Lil Dude ASCII art logo and version string
 * for use in CLI output, install scripts, and the start command.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The current Lil Dude version */
const VERSION = '0.1.0';

/**
 * Returns the Lil Dude ASCII art banner.
 * The banner is a simple, clean text logo suitable for terminal output.
 *
 * @returns A multi-line ASCII art string
 */
export function getAsciiBanner(): string {
  const banner = [
    '',
    '  _     _ _   ____            _      ',
    ' | |   (_) | |  _ \\ _   _  __| | ___ ',
    ' | |   | | | | | | | | | |/ _` |/ _ \\',
    ' | |___| | | | |_| | |_| | (_| |  __/',
    ' |_____|_|_| |____/ \\__,_|\\__,_|\\___|',
    '',
    '  Your personal AI executive assistant',
    '',
  ];
  return banner.join('\n');
}

/**
 * Returns a formatted version string for CLI display.
 *
 * @returns A string in the format "lil-dude v0.1.0"
 */
export function getVersionString(): string {
  return `lil-dude v${VERSION}`;
}

/**
 * Returns the raw version number without prefix.
 *
 * @returns The semantic version string (e.g. "0.1.0")
 */
export function getVersion(): string {
  return VERSION;
}
