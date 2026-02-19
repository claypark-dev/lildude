/**
 * Zod schema for skill.json manifest validation.
 * Validates skill manifests against the SkillManifest interface.
 * See src/types/index.ts for the canonical interface definition.
 */

import { z } from 'zod';
import type { SkillManifest } from '../types/index.js';

/** Zod schema matching the SkillManifest interface from types/index.ts */
export const SkillManifestSchema = z.object({
  name: z.string().min(1, 'Skill name is required'),
  version: z.string().min(1, 'Version is required'),
  description: z.string().min(1, 'Description is required'),
  author: z.string().min(1, 'Author is required'),
  permissions: z.object({
    domains: z.array(z.string()).default([]),
    shell: z.array(z.string()).default([]),
    directories: z.array(z.string()).default([]),
    requiresBrowser: z.boolean().default(false),
    requiresOAuth: z.array(z.string()).default([]),
  }),
  triggers: z.array(z.string()).min(1, 'At least one trigger is required'),
  deterministic: z.boolean(),
  tools: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      parameters: z.record(z.unknown()),
    }),
  ).default([]),
  minTier: z.enum(['basic', 'standard', 'power']),
  entryPoint: z.string().min(1, 'Entry point is required'),
});

/** Result of manifest validation. */
export interface ManifestValidationResult {
  valid: boolean;
  manifest?: SkillManifest;
  errors?: string[];
}

/**
 * Validate raw data against the SkillManifest Zod schema.
 * @param data - Untrusted data to validate (e.g., parsed JSON from skill.json).
 * @returns A result object containing either the validated manifest or an array of error messages.
 */
export function validateManifest(data: unknown): ManifestValidationResult {
  const result = SkillManifestSchema.safeParse(data);

  if (result.success) {
    return { valid: true, manifest: result.data as SkillManifest };
  }

  const errors = result.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`,
  );

  return { valid: false, errors };
}
