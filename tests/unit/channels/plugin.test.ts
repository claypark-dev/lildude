import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';
import { discoverChannelPlugins } from '../../../src/channels/plugin.js';

function createTempPluginDir(): string {
  const dir = join(tmpdir(), `lildude-test-plugins-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('channel plugin', () => {
  describe('discoverChannelPlugins', () => {
    it('returns empty array for nonexistent directory', () => {
      const plugins = discoverChannelPlugins('/tmp/nonexistent-dir-' + nanoid());
      expect(plugins).toHaveLength(0);
    });

    it('returns empty array for empty directory', () => {
      const dir = createTempPluginDir();
      try {
        const plugins = discoverChannelPlugins(dir);
        expect(plugins).toHaveLength(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('discovers plugins with index.js', () => {
      const dir = createTempPluginDir();
      const pluginDir = join(dir, 'my-channel');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'index.js'), 'module.exports = {}');

      try {
        const plugins = discoverChannelPlugins(dir);
        expect(plugins).toHaveLength(1);
        expect(plugins[0].name).toBe('my-channel');
        expect(plugins[0].entryPoint).toBe(join(pluginDir, 'index.js'));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('skips directories without index.js', () => {
      const dir = createTempPluginDir();
      const pluginDir = join(dir, 'no-entry');
      mkdirSync(pluginDir);
      writeFileSync(join(pluginDir, 'other.js'), 'module.exports = {}');

      try {
        const plugins = discoverChannelPlugins(dir);
        expect(plugins).toHaveLength(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('skips non-directory entries', () => {
      const dir = createTempPluginDir();
      writeFileSync(join(dir, 'file.txt'), 'not a plugin');

      try {
        const plugins = discoverChannelPlugins(dir);
        expect(plugins).toHaveLength(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('discovers multiple plugins', () => {
      const dir = createTempPluginDir();

      for (const name of ['plugin-a', 'plugin-b', 'plugin-c']) {
        const pluginDir = join(dir, name);
        mkdirSync(pluginDir);
        writeFileSync(join(pluginDir, 'index.js'), 'module.exports = {}');
      }

      try {
        const plugins = discoverChannelPlugins(dir);
        expect(plugins).toHaveLength(3);
        const names = plugins.map((p) => p.name).sort();
        expect(names).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
