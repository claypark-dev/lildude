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

export {
  detectGap,
  generateWaveProposal,
  approveWaveProposal,
  rejectWaveProposal,
  getPendingProposals,
} from './shorebreak.js';
export type { GapDetectionResult, WaveProposal, ShorebreakDeps } from './shorebreak.js';

export { scanWaveCode } from './security-scanner.js';
export type { ScanResult, SecurityFinding, FindingSeverity } from './security-scanner.js';

export { executeSandboxed } from './shorebreak-sandbox.js';
export type { SandboxResult } from './shorebreak-sandbox.js';

export { findMatchingTemplate, SHOREBREAK_TEMPLATES } from './shorebreak-templates/index.js';
export type { ShorebreakTemplate } from './shorebreak-templates/index.js';
