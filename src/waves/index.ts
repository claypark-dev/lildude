/**
 * Waves module barrel re-exports.
 * Provides a single entry point for wave schema validation, loading, and registry.
 */

export { validateManifest, WaveManifestSchema } from './schema.js';
export type { ManifestValidationResult } from './schema.js';

export { loadWaves } from './loader.js';

export {
  registerWave,
  getWave,
  matchWave,
  getAllWaves,
  clearRegistry,
} from './registry.js';
export type { WaveMatch } from './registry.js';

export { executeWave } from './executor.js';
export type { WaveExecutionResult, WaveExecutorDeps } from './executor.js';
