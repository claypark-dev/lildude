/**
 * Config module public API.
 * Re-exports schema, types, and loader functions.
 */

export { ConfigSchema, type Config } from './schema.js';
export { loadConfig, saveConfig, homeDir } from './loader.js';
