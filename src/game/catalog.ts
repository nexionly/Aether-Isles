import type {
  AiFactionId,
  Alignment,
  BuildOptionKind,
  Direction,
  FactionId,
  Fury,
  Owner,
  SpeedMultiplier,
  StructureDef,
  StructureKind,
  TetrominoKey,
  VictoryRules,
} from './types';

export const GRID_SIZE = 50;
export const TILE_W = 64;
export const TILE_H = 32;
export const BRIDGE_TILE_HP = 95;
export const MAX_GOLEMS = 6;
export const GOLEM_COST = 65;
export const MAX_OPPONENTS = 6;
export const SPEED_STEPS: readonly SpeedMultiplier[] = [1, 2, 3, 5];
export const AETHER_OVERLOAD_TARGET = 2500;
export const AETHER_OVERLOAD_OPTIONS = [2500, 4000, 6000] as const;
export const ALTAR_DOMINANCE_DURATION = 90;

const VICTORY_RULES_STORAGE_KEY = 'aether_isles_victory_rules';

export const DEFAULT_VICTORY_RULES: VictoryRules = {
  priestSacrifice: true,
  templeDestruction: true,
  altarDominance: true,
  aetherOverload: true,
  aetherOverloadTarget: AETHER_OVERLOAD_TARGET,
};

export function loadVictoryRules(): VictoryRules {
  try {
    const raw = localStorage.getItem(VICTORY_RULES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VICTORY_RULES };
    const parsed = JSON.parse(raw) as Partial<VictoryRules>;
    const validTarget = AETHER_OVERLOAD_OPTIONS.includes(
      parsed.aetherOverloadTarget as (typeof AETHER_OVERLOAD_OPTIONS)[number]
    )
      ? (parsed.aetherOverloadTarget as number)
      : DEFAULT_VICTORY_RULES.aetherOverloadTarget;
    return {
      priestSacrifice: true,
      templeDestruction:
        typeof parsed.templeDestruction === 'boolean'
          ? parsed.templeDestruction
          : DEFAULT_VICTORY_RULES.templeDestruction,
      altarDominance:
        typeof parsed.altarDominance === 'boolean'
          ? parsed.altarDominance
          : DEFAULT_VICTORY_RULES.altarDominance,
      aetherOverload:
        typeof parsed.aetherOverload === 'boolean'
          ? parsed.aetherOverload
          : DEFAULT_VICTORY_RULES.aetherOverload,
      aetherOverloadTarget: validTarget,
    };
  } catch {
    return { ...DEFAULT_VICTORY_RULES };
  }
}

export function saveVictoryRules(rules: VictoryRules): void {
  try {
    localStorage.setItem(
      VICTORY_RULES_STORAGE_KEY,
      JSON.stringify({ ...rules, priestSacrifice: true })
    );
  } catch {
    // Ignore storage failures
  }
}

export function getRequiredSacredSites(totalSites: number): number {
  if (totalSites <= 0) return 1;
  return Math.floor(totalSites / 2) + 1;
}

export function getNextSpeedMultiplier(current: SpeedMultiplier): SpeedMultiplier {
  const idx = SPEED_STEPS.indexOf(current);
  return SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
}

export const AI_FACTION_IDS: AiFactionId[] = ['AI_1', 'AI_2', 'AI_3', 'AI_4', 'AI_5', 'AI_6'];

export const AI_FACTION_PROFILES: Record<AiFactionId, { label: string; color: string; landTint: string }> = {
  AI_1: { label: 'Crimson', color: '#ef4444', landTint: '#8c4b4f' },
  AI_2: { label: 'Ember', color: '#f97316', landTint: '#8f5d3e' },
  AI_3: { label: 'Rose', color: '#ec4899', landTint: '#8a4869' },
  AI_4: { label: 'Verdant', color: '#84cc16', landTint: '#5e7d3f' },
  AI_5: { label: 'Orchid', color: '#d946ef', landTint: '#7a4887' },
  AI_6: { label: 'Coral', color: '#fb7185', landTint: '#8e515c' },
};

export const PLAYER_POWER_BIT = 1;

export function isFactionId(owner: Owner | null): owner is FactionId {
  return owner !== null && owner !== 'NEUTRAL';
}

export function isAiFaction(owner: Owner | null): owner is AiFactionId {
  return owner !== null && owner !== 'PLAYER' && owner !== 'NEUTRAL';
}

export function getFactionBit(id: FactionId): number {
  if (id === 'PLAYER') return PLAYER_POWER_BIT;
  const idx = AI_FACTION_IDS.indexOf(id);
  return idx >= 0 ? 1 << (idx + 1) : 0;
}

export function clampOpponentCount(count: number): number {
  return Math.max(1, Math.min(MAX_OPPONENTS, Math.round(count)));
}

export function getGridSizeForOpponents(opponentCount: number): number {
  const c = clampOpponentCount(opponentCount);
  return 50 + (c - 1) * 8; // 50, 58, 66, 74, 82, 90
}

export function getMapScaleLabel(opponentCount: number): string {
  const c = clampOpponentCount(opponentCount);
  const size = getGridSizeForOpponents(c);
  switch (c) {
    case 1:
      return `Standard Sky · ${size}×${size}`;
    case 2:
      return `Broad Sky · ${size}×${size}`;
    case 3:
      return `Wide Archipelago · ${size}×${size}`;
    case 4:
      return `Grand Expanse · ${size}×${size}`;
    case 5:
      return `Titanic Skysea · ${size}×${size}`;
    default:
      return `Vast Archipelago · ${size}×${size}`;
  }
}

export function getWorldIsoBounds(gridSize: number): {
  minX: number;
  maxX: number;
  spanX: number;
  minY: number;
  maxY: number;
  spanY: number;
} {
  const halfX = Math.round((gridSize - 8.75) * (TILE_W * 0.5));
  const minY = 180;
  const maxY = Math.max(minY + 600, (gridSize - 1) * TILE_H - 188);
  return {
    minX: -halfX,
    maxX: halfX,
    spanX: halfX * 2,
    minY,
    maxY,
    spanY: maxY - minY,
  };
}

export const FURY_META: Record<
  Fury,
  {
    name: string;
    tagline: string;
    color: string;
    accentSoft: string;
    emblemSrc: string;
    tier2Unit: BuildOptionKind;
    units: BuildOptionKind[];
  }
> = {
  WIND: {
    name: 'Wind Aspect',
    tagline: 'Rapid gale ballistas, cyclone spires, and piercing lance volleys.',
    color: '#2dd4bf',
    accentSoft: 'rgba(45, 212, 191, 0.2)',
    emblemSrc: '/src/assets/images/fury_wind_emblem_1795699735323.jpg',
    tier2Unit: 'ZEPHYR_CANNON',
    units: ['WIND_CROSSBOW', 'WHIRLWIND_SPIRE', 'ZEPHYR_CANNON'],
  },
  RAIN: {
    name: 'Rain Aspect',
    tagline: 'Splash tidal mortars, glacial bulwarks, and regenerating leviathans.',
    color: '#38bdf8',
    accentSoft: 'rgba(56, 189, 248, 0.2)',
    emblemSrc: '/src/assets/images/fury_rain_emblem_1795699736142.jpg',
    tier2Unit: 'MAN_O_WAR',
    units: ['RAIN_CANNON', 'FROST_BLOCKER', 'MAN_O_WAR'],
  },
  THUNDER: {
    name: 'Thunder Aspect',
    tagline: 'Bridge-shattering volt cannons, chain-spark pylons, and arc spires.',
    color: '#c084fc',
    accentSoft: 'rgba(192, 132, 252, 0.2)',
    emblemSrc: '/src/assets/images/fury_thunder_emblem_1795699736997.jpg',
    tier2Unit: 'ARC_SPIRE',
    units: ['THUNDER_CANNON', 'SPARK_PYLON', 'ARC_SPIRE'],
  },
};

export const SUN_UNITS: BuildOptionKind[] = ['SUN_DISC', 'STONE_BLOCKER', 'WINDMILL'];

export const ALIGNMENT_COLORS: Record<Alignment, string> = {
  SUN: '#f0b429',
  WIND: '#2dd4bf',
  RAIN: '#38bdf8',
  THUNDER: '#c084fc',
};

export const STRUCTURE_CATALOG: Record<StructureKind, StructureDef> = {
  TEMPLE: {
    kind: 'TEMPLE',
    name: 'High Temple',
    shortName: 'Temple',
    alignment: 'SUN',
    cost: 0,
    maxHp: 1200,
    range: 0,
    damage: 0,
    fireRate: 0,
    directional: false,
    tier: 1,
    role: 'CORE',
    description:
      'Heart of an archipelago’s Aether grid and crystal store. Shattering a rival High Temple eliminates that faction and unlocks Tier-2 mastery.',
    canBuildOnBridge: false,
  },
  ALTAR: {
    kind: 'ALTAR',
    name: 'Sacrificial Altar',
    shortName: 'Altar',
    alignment: 'SUN',
    cost: 0,
    maxHp: 650,
    range: 0,
    damage: 0,
    fireRate: 0,
    directional: false,
    tier: 1,
    role: 'CORE',
    description:
      'Bind stunned Rogue or rival Priests to unlock Tier-2 weapons and eliminate rivals without destroying their High Temple.',
    canBuildOnBridge: false,
  },
  STORM_OBELISK: {
    kind: 'STORM_OBELISK',
    name: 'Shrine Monolith',
    shortName: 'Monolith',
    alignment: 'SUN',
    cost: 0,
    maxHp: 170,
    range: 5.5,
    damage: 16,
    fireRate: 0.75,
    directional: false,
    tier: 1,
    role: 'DEFENSE',
    description: 'Ancient shrine guardian protecting a Rogue Priest.',
    canBuildOnBridge: false,
    projectileSpeed: 9,
  },
  SUN_DISC: {
    kind: 'SUN_DISC',
    name: 'Solar Chakram',
    shortName: 'Chakram',
    alignment: 'SUN',
    cost: 55,
    maxHp: 135,
    range: 6.2,
    damage: 17,
    fireRate: 0.95,
    directional: false,
    tier: 1,
    role: 'OFFENSE',
    description: 'Universal 360-degree disc launcher. Reliable defense against Golems and forward towers.',
    canBuildOnBridge: true,
    projectileSpeed: 10.5,
  },
  STONE_BLOCKER: {
    kind: 'STONE_BLOCKER',
    name: 'Stone Bulwark',
    shortName: 'Bulwark',
    alignment: 'SUN',
    cost: 35,
    maxHp: 340,
    range: 0,
    damage: 0,
    fireRate: 0,
    directional: false,
    tier: 1,
    role: 'DEFENSE',
    description: 'Heavy limestone bastion that absorbs fire and intercepts directional bolts and cannon shells.',
    canBuildOnBridge: true,
    blocksDirectional: true,
  },
  WINDMILL: {
    kind: 'WINDMILL',
    name: 'Aether Mill',
    shortName: 'Aether Mill',
    alignment: 'SUN',
    cost: 75,
    maxHp: 120,
    range: 0,
    damage: 0,
    fireRate: 0,
    directional: false,
    tier: 1,
    role: 'ECONOMY',
    description: 'Harnesses high-altitude gusts for +4.5 Aether per second while connected to your Temple.',
    canBuildOnBridge: false,
    passiveIncome: 4.5,
  },

  // WIND ASPECT
  WIND_CROSSBOW: {
    kind: 'WIND_CROSSBOW',
    name: 'Gale Ballista',
    shortName: 'Ballista',
    alignment: 'WIND',
    cost: 50,
    maxHp: 125,
    range: 8.5,
    damage: 15,
    fireRate: 1.85,
    directional: true,
    tier: 1,
    role: 'OFFENSE',
    description: 'Directional rapid-fire bolt battery. Rotate with R to lock down bridge corridors.',
    canBuildOnBridge: true,
    projectileSpeed: 14,
  },
  WHIRLWIND_SPIRE: {
    kind: 'WHIRLWIND_SPIRE',
    name: 'Cyclone Spire',
    shortName: 'Cyclone',
    alignment: 'WIND',
    cost: 75,
    maxHp: 165,
    range: 5.2,
    damage: 22,
    fireRate: 0.72,
    directional: false,
    tier: 1,
    role: 'DEFENSE',
    description: 'Emits cutting cyclone pulses that damage all nearby enemies and shred fragile bridges.',
    canBuildOnBridge: true,
    splashRadius: 2.2,
  },
  ZEPHYR_CANNON: {
    kind: 'ZEPHYR_CANNON',
    name: 'Zephyr Lance',
    shortName: 'Zephyr',
    alignment: 'WIND',
    cost: 115,
    maxHp: 175,
    range: 9.5,
    damage: 34,
    fireRate: 0.85,
    directional: true,
    tier: 2,
    role: 'OFFENSE',
    description: 'Tier-2 Wind siege weapon launching piercing gale blades through up to 3 targets in a lane.',
    canBuildOnBridge: true,
    pierceCount: 3,
    projectileSpeed: 15.5,
  },

  // RAIN ASPECT
  RAIN_CANNON: {
    kind: 'RAIN_CANNON',
    name: 'Tidal Mortar',
    shortName: 'Tidal Mortar',
    alignment: 'RAIN',
    cost: 65,
    maxHp: 155,
    range: 7.0,
    damage: 28,
    fireRate: 0.58,
    directional: false,
    tier: 1,
    role: 'OFFENSE',
    description: 'Lobs heavy pressurized water orbs that burst in a splash radius over walls and clusters.',
    canBuildOnBridge: true,
    splashRadius: 1.8,
    projectileSpeed: 7.5,
  },
  FROST_BLOCKER: {
    kind: 'FROST_BLOCKER',
    name: 'Glacial Bulwark',
    shortName: 'Frost Wall',
    alignment: 'RAIN',
    cost: 55,
    maxHp: 390,
    range: 0,
    damage: 0,
    fireRate: 0,
    directional: false,
    tier: 1,
    role: 'DEFENSE',
    description: 'Self-regenerating glacial bastion that intercepts directional shots and chills nearby enemy Golems.',
    canBuildOnBridge: true,
    blocksDirectional: true,
    regenPerSec: 11,
    slowAuraRadius: 3.5,
  },
  MAN_O_WAR: {
    kind: 'MAN_O_WAR',
    name: 'Tidal Leviathan',
    shortName: 'Leviathan',
    alignment: 'RAIN',
    cost: 120,
    maxHp: 260,
    range: 6.8,
    damage: 26,
    fireRate: 1.05,
    directional: false,
    tier: 2,
    role: 'OFFENSE',
    description: 'Tier-2 Rain sky-leviathan that steadily regenerates HP and lashes enemies with bio-electric tendrils.',
    canBuildOnBridge: true,
    regenPerSec: 12,
    chainCount: 2,
    projectileSpeed: 11,
  },

  // THUNDER ASPECT
  THUNDER_CANNON: {
    kind: 'THUNDER_CANNON',
    name: 'Volt Siege Cannon',
    shortName: 'Volt Cannon',
    alignment: 'THUNDER',
    cost: 70,
    maxHp: 150,
    range: 8.5,
    damage: 46,
    fireRate: 0.52,
    directional: true,
    tier: 1,
    role: 'OFFENSE',
    description: 'Directional siege mortar dealing devastating bonus damage to Bulwarks and enemy bridges.',
    canBuildOnBridge: true,
    splashRadius: 1.15,
    projectileSpeed: 12,
  },
  SPARK_PYLON: {
    kind: 'SPARK_PYLON',
    name: 'Spark Pylon',
    shortName: 'Spark Pylon',
    alignment: 'THUNDER',
    cost: 75,
    maxHp: 145,
    range: 5.8,
    damage: 20,
    fireRate: 0.85,
    directional: false,
    tier: 1,
    role: 'OFFENSE',
    description: 'Discharges instant chain lightning that arcs across up to 3 nearby enemy structures or Golems.',
    canBuildOnBridge: true,
    chainCount: 3,
  },
  ARC_SPIRE: {
    kind: 'ARC_SPIRE',
    name: 'Arc Spire',
    shortName: 'Arc Spire',
    alignment: 'THUNDER',
    cost: 125,
    maxHp: 185,
    range: 7.5,
    damage: 52,
    fireRate: 0.56,
    directional: false,
    tier: 2,
    role: 'OFFENSE',
    description: 'Tier-2 Thunder obelisk calling pinpoint sky-bolts to shatter bridge junctions and stun Priests.',
    canBuildOnBridge: true,
    chainCount: 2,
  },
};

export interface TetrominoDef {
  key: TetrominoKey;
  label: string;
  cost: number;
  cells: Array<{ x: number; y: number }>;
}

export const TETROMINOES: Record<TetrominoKey, TetrominoDef> = {
  I3: {
    key: 'I3',
    label: 'Span III',
    cost: 24,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
  },
  I4: {
    key: 'I4',
    label: 'Long Span',
    cost: 32,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
  },
  CORNER: {
    key: 'CORNER',
    label: 'Angle III',
    cost: 24,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ],
  },
  L: {
    key: 'L',
    label: 'L-Bridge',
    cost: 32,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ],
  },
  J: {
    key: 'J',
    label: 'J-Bridge',
    cost: 32,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
    ],
  },
  T: {
    key: 'T',
    label: 'T-Junction',
    cost: 32,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
    ],
  },
  S: {
    key: 'S',
    label: 'S-Causeway',
    cost: 32,
    cells: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  },
  Z: {
    key: 'Z',
    label: 'Z-Causeway',
    cost: 32,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
  },
};

export const TETROMINO_KEYS: TetrominoKey[] = ['I3', 'I4', 'CORNER', 'L', 'J', 'T', 'S', 'Z'];

export function randomTetrominoKey(): TetrominoKey {
  // Slightly favor straight & L spans so bridging feels fluid and satisfying
  const weighted: TetrominoKey[] = ['I3', 'I4', 'I4', 'CORNER', 'L', 'J', 'T', 'S', 'Z', 'I3'];
  return weighted[Math.floor(Math.random() * weighted.length)];
}

export function rotateCells(
  cells: Array<{ x: number; y: number }>,
  rotation: Direction
): Array<{ x: number; y: number }> {
  let pts = cells.map((c) => ({ x: c.x, y: c.y }));
  for (let r = 0; r < rotation; r++) {
    pts = pts.map((p) => ({ x: -p.y, y: p.x }));
  }
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  return pts.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

export function directionVector(dir: Direction): { dx: number; dy: number } {
  switch (dir) {
    case 0:
      return { dx: 0, dy: -1 }; // North
    case 1:
      return { dx: 1, dy: 0 }; // East
    case 2:
      return { dx: 0, dy: 1 }; // South
    case 3:
      return { dx: -1, dy: 0 }; // West
  }
}

export function directionLabel(dir: Direction): string {
  switch (dir) {
    case 0:
      return 'North-East';
    case 1:
      return 'South-East';
    case 2:
      return 'South-West';
    case 3:
      return 'North-West';
  }
}

export function getPaletteForFury(fury: Fury): BuildOptionKind[] {
  return [...SUN_UNITS, ...FURY_META[fury].units];
}

export function getContrastingAiFury(playerFury: Fury): Fury {
  if (playerFury === 'WIND') return 'THUNDER';
  if (playerFury === 'RAIN') return 'WIND';
  return 'RAIN';
}

export function getAiFuryForIndex(playerFury: Fury, index: number): Fury {
  const order: Fury[] =
    playerFury === 'WIND'
      ? ['THUNDER', 'RAIN', 'WIND']
      : playerFury === 'RAIN'
        ? ['WIND', 'THUNDER', 'RAIN']
        : ['RAIN', 'WIND', 'THUNDER'];
  return order[index % order.length];
}
