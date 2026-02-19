/**
 * In-memory skill registry.
 * Maintains a map of loaded skills and provides trigger-based matching.
 * Skills are registered after validation and remain in memory for fast lookup.
 */

import type { Skill } from '../types/index.js';
import { createModuleLogger } from '../utils/logger.js';

const skillsLogger = createModuleLogger('skills');

/** Result of a trigger match: the matched skill and a confidence score. */
export interface SkillMatch {
  skill: Skill;
  score: number;
}

/** In-memory store of registered skills, keyed by name. */
const skillsMap = new Map<string, Skill>();

/**
 * Register a skill in the in-memory registry.
 * If a skill with the same name already exists, it is overwritten and a warning is logged.
 * @param name - The unique skill name (from the manifest).
 * @param skill - The validated Skill object.
 */
export function registerSkill(name: string, skill: Skill): void {
  if (skillsMap.has(name)) {
    skillsLogger.warn({ name }, 'Overwriting existing skill registration');
  }

  skillsMap.set(name, skill);
  skillsLogger.info({ name, triggers: skill.manifest.triggers }, 'Skill registered');
}

/**
 * Retrieve a skill by its exact name.
 * @param name - The skill name to look up.
 * @returns The Skill object, or undefined if not registered.
 */
export function getSkill(name: string): Skill | undefined {
  return skillsMap.get(name);
}

/**
 * Match a user message against registered skill triggers.
 * Checks each skill's trigger keywords against the user message (case-insensitive).
 * Returns the skill with the highest match score, or null if no triggers match.
 * @param userMessage - The raw user message to match against skill triggers.
 * @returns The best matching skill and its score, or null if no match found.
 */
export function matchSkill(userMessage: string): SkillMatch | null {
  const lowerMessage = userMessage.toLowerCase();
  let bestMatch: SkillMatch | null = null;

  for (const [, skill] of skillsMap) {
    const matchingTriggers = skill.manifest.triggers.filter(
      (trigger) => lowerMessage.includes(trigger.toLowerCase()),
    );

    if (matchingTriggers.length === 0) {
      continue;
    }

    const score = computeMatchScore(lowerMessage, matchingTriggers);

    if (bestMatch === null || score > bestMatch.score) {
      bestMatch = { skill, score };
    }
  }

  return bestMatch;
}

/**
 * Get all registered skills as an immutable Map snapshot.
 * @returns A new Map containing all registered skills.
 */
export function getAllSkills(): Map<string, Skill> {
  return new Map(skillsMap);
}

/**
 * Remove all registered skills from the registry.
 * Primarily used for testing to reset state between test runs.
 */
export function clearRegistry(): void {
  skillsMap.clear();
  skillsLogger.debug('Skill registry cleared');
}

/**
 * Compute a match score for a message against a set of matching triggers.
 * Score is based on the number of matching triggers and the proportion
 * of the message covered by those triggers.
 * @param lowerMessage - The lowercased user message.
 * @param matchingTriggers - Triggers that were found in the message.
 * @returns A score between 0 and 1 (exclusive of 0).
 */
function computeMatchScore(lowerMessage: string, matchingTriggers: string[]): number {
  const triggerCoverage = matchingTriggers.reduce(
    (totalLength, trigger) => totalLength + trigger.length,
    0,
  );

  const coverageRatio = Math.min(triggerCoverage / lowerMessage.length, 1);
  const countBonus = Math.min(matchingTriggers.length * 0.1, 0.5);

  return coverageRatio + countBonus;
}
