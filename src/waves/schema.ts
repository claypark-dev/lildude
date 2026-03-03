/**
 * Zod schema for wave.json manifest validation.
 * Validates wave manifests against the WaveManifest interface.
 * See src/types/index.ts for the canonical interface definition.
 */

import { z } from 'zod';
import type { WaveManifest } from '../types/index.js';

/** Zod schema matching the WaveManifest interface from types/index.ts */
export const WaveManifestSchema = z.object({
  name: z.string().min(1, 'Wave name is required'),
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
  safetyTier: z.enum(['observe', 'create', 'modify', 'destroy', 'execute']).optional(),
  waveCategory: z.enum(['personal', 'party']).optional().default('personal'),
});

/** Result of manifest validation. */
export interface ManifestValidationResult {
  valid: boolean;
  manifest?: WaveManifest;
  errors?: string[];
}

/**
 * Validate raw data against the WaveManifest Zod schema.
 * @param data - Untrusted data to validate (e.g., parsed JSON from wave.json).
 * @returns A result object containing either the validated manifest or an array of error messages.
 */
export function validateManifest(data: unknown): ManifestValidationResult {
  const result = WaveManifestSchema.safeParse(data);

  if (result.success) {
    return { valid: true, manifest: result.data as WaveManifest };
  }

  const errors = result.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`,
  );

  return { valid: false, errors };
}
