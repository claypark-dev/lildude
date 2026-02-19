/**
 * Skills module barrel re-exports.
 * Provides a single entry point for skill schema validation, loading, and registry.
 */

export { validateManifest, SkillManifestSchema } from './schema.js';
export type { ManifestValidationResult } from './schema.js';

export { loadSkills } from './loader.js';

export {
  registerSkill,
  getSkill,
  matchSkill,
  getAllSkills,
  clearRegistry,
} from './registry.js';
export type { SkillMatch } from './registry.js';

export { executeSkill } from './executor.js';
export type { SkillExecutionResult, SkillExecutorDeps } from './executor.js';
