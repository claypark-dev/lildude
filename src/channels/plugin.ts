/**
 * Channel plugin loader.
 * Discovers and loads channel adapter plugins from a plugins directory.
 * Each plugin directory must contain an index.js with a createAdapter() export.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChannelAdapter, ChannelConfig } from '../types/index.js';
import { createModuleLogger } from '../utils/logger.js';

const pluginLogger = createModuleLogger('channel-plugin');

/** Metadata about a discovered channel plugin. */
export interface ChannelPluginInfo {
  name: string;
  directory: string;
  entryPoint: string;
}

/** Result of loading channel plugins. */
export interface ChannelPluginLoadResult {
  loaded: string[];
  failed: Array<{ name: string; error: string }>;
}

/** Expected exports from a channel plugin module. */
interface ChannelPluginModule {
  createAdapter: (config: ChannelConfig) => ChannelAdapter;
}

/**
 * Discover channel plugin directories.
 * Scans the plugins directory for subdirectories containing index.js.
 *
 * @param pluginsDir - The directory to scan for channel plugins.
 * @returns Array of discovered plugin info objects.
 */
export function discoverChannelPlugins(pluginsDir: string): ChannelPluginInfo[] {
  if (!existsSync(pluginsDir)) {
    pluginLogger.debug({ pluginsDir }, 'Channel plugins directory does not exist');
    return [];
  }

  const discovered: ChannelPluginInfo[] = [];
  const entries = readdirSync(pluginsDir);

  for (const entry of entries) {
    const pluginDir = join(pluginsDir, entry);

    try {
      if (!statSync(pluginDir).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    const entryPoint = join(pluginDir, 'index.js');
    if (!existsSync(entryPoint)) {
      pluginLogger.debug({ name: entry }, 'No index.js found, skipping plugin');
      continue;
    }

    discovered.push({
      name: entry,
      directory: pluginDir,
      entryPoint,
    });

    pluginLogger.debug({ name: entry, entryPoint }, 'Channel plugin discovered');
  }

  return discovered;
}

/**
 * Load a channel plugin by importing its module.
 *
 * @param pluginInfo - The plugin info with path to entry point.
 * @param config - Channel configuration to pass to createAdapter.
 * @returns The created ChannelAdapter.
 */
export async function loadChannelPlugin(
  pluginInfo: ChannelPluginInfo,
  config: ChannelConfig,
): Promise<ChannelAdapter> {
  try {
    const moduleUrl = pathToFileURL(pluginInfo.entryPoint).href;
    const imported = await import(moduleUrl) as ChannelPluginModule;

    if (typeof imported.createAdapter !== 'function') {
      throw new Error(`Plugin "${pluginInfo.name}" does not export a createAdapter() function`);
    }

    const adapter = imported.createAdapter(config);

    pluginLogger.info(
      { name: pluginInfo.name, type: adapter.type },
      'Channel plugin loaded successfully',
    );

    return adapter;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    pluginLogger.error(
      { name: pluginInfo.name, error: message },
      'Failed to load channel plugin',
    );
    throw new Error(`Failed to load channel plugin "${pluginInfo.name}": ${message}`);
  }
}

/**
 * Discover and load all channel plugins from a directory.
 *
 * @param pluginsDir - The plugins directory path.
 * @param getConfig - Function to retrieve config for a plugin by name.
 * @returns Load results with loaded/failed plugin names.
 */
export async function loadAllChannelPlugins(
  pluginsDir: string,
  getConfig: (name: string) => ChannelConfig | undefined,
): Promise<{ adapters: ChannelAdapter[]; result: ChannelPluginLoadResult }> {
  const discovered = discoverChannelPlugins(pluginsDir);
  const adapters: ChannelAdapter[] = [];
  const result: ChannelPluginLoadResult = { loaded: [], failed: [] };

  for (const pluginInfo of discovered) {
    const config = getConfig(pluginInfo.name);
    if (!config || !config.enabled) {
      pluginLogger.debug({ name: pluginInfo.name }, 'Channel plugin not enabled, skipping');
      continue;
    }

    try {
      const adapter = await loadChannelPlugin(pluginInfo, config);
      adapters.push(adapter);
      result.loaded.push(pluginInfo.name);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ name: pluginInfo.name, error: message });
    }
  }

  pluginLogger.info(
    { loaded: result.loaded.length, failed: result.failed.length },
    'Channel plugin loading complete',
  );

  return { adapters, result };
}
