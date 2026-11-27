import type { Difficulty } from './types';

/**
 * ============================================================================
 * LOCKED DIFFICULTY PROFILES — DO NOT MODIFY WITHOUT EXPLICIT USER REQUEST
 * ============================================================================
 * Single canonical, frozen source of truth for all AI opponent difficulty
 * scaling (opening grace, action cadence, passive Aether income, starting
 * bonus, economy caps, defensive response cap, and Overload hoarding).
 *
 * Consumed directly by `ai.ts`, `worldGen.ts`, `simulation.ts`,
 * `TitleScreen.tsx`, and `ModalOverlays.tsx` so gameplay behavior and UI
 * tooltips can never drift out of sync.
 */
export interface DifficultyProfile {
  readonly key: Difficulty;
  readonly label: string;
  readonly detail: string;
  readonly accent: string;
  readonly summary: string;
  /** Seconds before each AI takes its first move at match start (staggered per rival). */
  readonly openingGraceSeconds: number;
  /** Base seconds between AI strategic actions. */
  readonly actionCadenceSeconds: number;
  /** Random extra jitter (0..actionJitterSeconds) added to each action cooldown. */
  readonly actionJitterSeconds: number;
  /** Multiplier on passive baseline Aether trickle (1.0 = exact parity with player). */
  readonly passiveAetherMultiplier: number;
  /** Extra starting Aether granted at match start (0 = exact parity with player). */
  readonly startingAetherBonus: number;
  /** Target number of Aether Golems the AI maintains. */
  readonly desiredGolems: number;
  /** Maximum number of Aether Mills the AI builds. */
  readonly maxWindmills: number;
  /** Max defensive towers the AI will stack near an urgent home threat. */
  readonly homeDefenseTowerCap: number;
  /** Whether the AI conserves Aether reserves when nearing Aether Overload victory. */
  readonly overloadHoardEnabled: boolean;
}

export const DIFFICULTY_ORDER: readonly Difficulty[] = Object.freeze([
  'INITIATE',
  'ARCHON',
  'STORMLORD',
]);

export const DIFFICULTY_PROFILES: Readonly<Record<Difficulty, DifficultyProfile>> = Object.freeze({
  INITIATE: Object.freeze({
    key: 'INITIATE',
    label: 'Acolyte',
    detail: 'Measured pace',
    accent: '#7dd3fc',
    summary: 'Relaxed rival pacing for learning bridge lanes, tower counters, and altar rituals.',
    openingGraceSeconds: 6.0,
    actionCadenceSeconds: 5.4,
    actionJitterSeconds: 0.8,
    passiveAetherMultiplier: 0.75,
    startingAetherBonus: 0,
    desiredGolems: 2,
    maxWindmills: 1,
    homeDefenseTowerCap: 1,
    overloadHoardEnabled: false,
  }),
  ARCHON: Object.freeze({
    key: 'ARCHON',
    label: 'Archon',
    detail: 'Balanced rival',
    accent: '#f0b429',
    summary: 'Fair resource parity with steady bridge expansion, defensive reactions, and objective play.',
    openingGraceSeconds: 4.2,
    actionCadenceSeconds: 3.6,
    actionJitterSeconds: 0.6,
    passiveAetherMultiplier: 1.0,
    startingAetherBonus: 0,
    desiredGolems: 4,
    maxWindmills: 2,
    homeDefenseTowerCap: 2,
    overloadHoardEnabled: true,
  }),
  STORMLORD: Object.freeze({
    key: 'STORMLORD',
    label: 'Ascendant',
    detail: 'Relentless siege',
    accent: '#fb923c',
    summary: 'Accelerated Aether generation, rapid island expansion, and dense forward tower lines.',
    openingGraceSeconds: 2.6,
    actionCadenceSeconds: 2.2,
    actionJitterSeconds: 0.4,
    passiveAetherMultiplier: 1.18,
    startingAetherBonus: 35,
    desiredGolems: 5,
    maxWindmills: 4,
    homeDefenseTowerCap: 2,
    overloadHoardEnabled: true,
  }),
});

export function getDifficultyProfile(difficulty: Difficulty): DifficultyProfile {
  return DIFFICULTY_PROFILES[difficulty] ?? DIFFICULTY_PROFILES.ARCHON;
}

export function getAverageActionCadence(profile: DifficultyProfile): number {
  return profile.actionCadenceSeconds + profile.actionJitterSeconds * 0.5;
}
