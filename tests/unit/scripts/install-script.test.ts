import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPTS_DIR = join(__dirname, '..', '..', '..', 'scripts');

/**
 * Read a script file and return its contents.
 */
function readScript(filename: string): string {
  return readFileSync(join(SCRIPTS_DIR, filename), 'utf-8');
}

describe('install.sh', () => {
  const script = readScript('install.sh');

  it('starts with a valid shebang', () => {
    expect(script.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('includes a Node.js version check', () => {
    expect(script).toContain('node');
    expect(script).toContain('20');
    // Should check node version and exit with code 1 on failure
    expect(script).toContain('exit 1');
  });

  it('includes npm install step', () => {
    expect(script).toContain('npm install -g');
    expect(script).toContain('lil-dude');
  });

  it('includes the doctor health check', () => {
    expect(script).toContain('lil-dude doctor');
  });

  it('includes the onboard prompt', () => {
    expect(script).toContain('lil-dude onboard');
  });

  it('supports the --yes flag for non-interactive installs', () => {
    expect(script).toContain('--yes');
    expect(script).toContain('YES_FLAG');
  });

  it('has correct exit codes documented', () => {
    // exit 0 for success, exit 1 for missing Node, exit 2 for install fail, exit 3 for verification
    expect(script).toContain('exit 0');
    expect(script).toContain('exit 1');
    expect(script).toContain('exit 2');
    expect(script).toContain('exit 3');
  });

  it('uses set -euo pipefail for safety', () => {
    expect(script).toContain('set -euo pipefail');
  });

  it('includes the ASCII banner', () => {
    expect(script).toContain('Lil');
    expect(script).toContain('Dude');
    expect(script).toContain('Your personal AI executive assistant');
  });

  it('handles color output gracefully', () => {
    // Should check if stdout is a terminal before using colors
    expect(script).toContain('-t 1');
    expect(script).toContain('RESET');
  });

  it('does not require sudo', () => {
    // The script should NOT force sudo — only suggest it if npm fails
    const lines = script.split('\n');
    const sudoLines = lines.filter(
      (line: string) => line.trim().startsWith('sudo ') && !line.trim().startsWith('#') && !line.trim().startsWith('error') && !line.trim().startsWith('"'),
    );
    expect(sudoLines.length).toBe(0);
  });
});

describe('install.ps1', () => {
  const script = readScript('install.ps1');

  it('includes a Node.js version check', () => {
    expect(script).toContain('node');
    expect(script).toContain('20');
  });

  it('includes npm install step', () => {
    expect(script).toContain('npm install -g');
    expect(script).toContain('lil-dude');
  });

  it('includes the doctor health check', () => {
    expect(script).toContain('lil-dude doctor');
  });

  it('includes the onboard prompt', () => {
    expect(script).toContain('lil-dude onboard');
  });

  it('supports the -Yes flag for non-interactive installs', () => {
    expect(script).toContain('$Yes');
  });

  it('uses Write-Host for colored output', () => {
    expect(script).toContain('Write-Host');
    expect(script).toContain('ForegroundColor');
  });

  it('has correct exit codes', () => {
    expect(script).toContain('exit 0');
    expect(script).toContain('exit 1');
    expect(script).toContain('exit 2');
    expect(script).toContain('exit 3');
  });

  it('includes the ASCII banner', () => {
    expect(script).toContain('Dude');
    expect(script).toContain('Your personal AI executive assistant');
  });
});

describe('uninstall.sh', () => {
  const script = readScript('uninstall.sh');

  it('starts with a valid shebang', () => {
    expect(script.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('removes the global npm package', () => {
    expect(script).toContain('npm uninstall -g');
    expect(script).toContain('lil-dude');
  });

  it('handles the config directory cleanup', () => {
    expect(script).toContain('.lil-dude');
    expect(script).toContain('rm -rf');
  });

  it('asks before removing config directory', () => {
    // Should prompt the user before deleting config
    expect(script).toContain('Remove');
    expect(script).toContain('[y/N]');
  });

  it('uses set -euo pipefail for safety', () => {
    expect(script).toContain('set -euo pipefail');
  });

  it('handles non-interactive mode gracefully', () => {
    // Should check if stdin is a terminal
    expect(script).toContain('-t 0');
  });
});
