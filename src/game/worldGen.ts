import {
  AI_FACTION_IDS,
  AI_FACTION_PROFILES,
  DEFAULT_VICTORY_RULES,
  FURY_META,
  STRUCTURE_CATALOG,
  TILE_H,
  TILE_W,
  clampOpponentCount,
  getAiFuryForIndex,
  getGridSizeForOpponents,
  getInitialUnlockedTechs,
  randomTetrominoKey,
} from './catalog';
import { getDifficultyProfile } from './difficulty';
import { recomputePowerGrids } from './pathfinding';
import type {
  AerialUnit,
  AiFactionId,
  CaptureExplosion,
  Crystal,
  Difficulty,
  EnergyFenceLink,
  FactionId,
  FactionState,
  FloatingText,
  Fury,
  Geyser,
  Golem,
  ImpactEffect,
  IslandInfo,
  LightningArc,
  Owner,
  Particle,
  Priest,
  Projectile,
  SacrificeBeam,
  SacredSiteState,
  Structure,
  StructureKind,
  TechUnlockOption,
  Tile,
  VictoryRules,
  WeatherState,
} from './types';
import { createInitialWeatherState } from './weather';

export interface WorldState {
  gridSize: number;
  opponentCount: number;
  activeFactionIds: FactionId[];
  aiFactionIds: AiFactionId[];
  tiles: Tile[][];
  islands: IslandInfo[];
  structures: Structure[];
  priests: Priest[];
  golems: Golem[];
  aerialUnits: AerialUnit[];
  energyFences: EnergyFenceLink[];
  geysers: Geyser[];
  crystals: Crystal[];
  projectiles: Projectile[];
  lightningArcs: LightningArc[];
  sacrificeBeams: SacrificeBeam[];
  captureExplosions: CaptureExplosion[];
  impactEffects: ImpactEffect[];
  particles: Particle[];
  floatingTexts: FloatingText[];
  factions: Record<FactionId, FactionState>;
  sacredSites: SacredSiteState[];
  victoryRules: VictoryRules;
  fogGrid: Uint8Array; // 0 = unexplored, 1 = explored, 2 = visible
  pendingTechChoices: TechUnlockOption[] | null;
  difficulty: Difficulty;
  elapsedSeconds: number;
  nextEntityId: number;
  weather: WeatherState;
}

export function tileToIso(tx: number, ty: number): { x: number; y: number } {
  return {
    x: (tx - ty) * (TILE_W * 0.5),
    y: (tx + ty) * (TILE_H * 0.5),
  };
}

export function isoToTile(isoX: number, isoY: number): { tx: number; ty: number } {
  const halfW = TILE_W * 0.5;
  const halfH = TILE_H * 0.5;
  return {
    tx: (isoX / halfW + isoY / halfH) * 0.5,
    ty: (isoY / halfH - isoX / halfW) * 0.5,
  };
}

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2D(x: number, y: number, seedOffset = 0): number {
  const n = Math.sin((x + seedOffset * 0.37) * 127.1 + (y - seedOffset * 0.53) * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function createEmptyGrid(gridSize: number, seedOffset: number): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < gridSize; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < gridSize; x++) {
      row.push({
        x,
        y,
        kind: 'VOID',
        islandId: -1,
        owner: null,
        hp: 0,
        maxHp: 0,
        poweredMask: 0,
        variant: hash2D(x, y, seedOffset),
        hitFlash: 0,
        unpoweredSeconds: 0,
      });
    }
    tiles.push(row);
  }
  return tiles;
}

const HOME_NAMES = [
  'Sunspire Haven',
  'Aerie Crown',
  'Aether Bastion',
  'Skyward Keep',
  'Galewatch Hold',
  'Solstice Roost',
];

const RIVAL_NAMES = [
  'Crimson Sanctum',
  'Obsidian Perch',
  'Cloudcrest Citadel',
  'Dreadspire Isle',
  'Thunderhold Crag',
  'Ashen Eyrie',
  'Emberfall Keep',
  'Riftcrown Bastion',
  'Ironwind Roost',
];

const GEYSER_NAMES = [
  'Zephyr Vent',
  'Monsoon Caldera',
  'Amber Crag',
  'Fulminar Atoll',
  'Riftstone Isle',
  'Sunwell Reef',
  'Cinder Vent',
  'Aether Basin',
  'Gale Rift',
  'Nimbus Shelf',
  'Crystalline Mesa',
  'Skywell Tor',
];

const SHRINE_NAMES = [
  'Southern Shrine',
  'Northern Shrine',
  'Whispering Reliquary',
  'Altar of Echoes',
  'Skyseer Spire',
  'Cloudveil Sanctum',
];

const CITADEL_NAMES = [
  'Tempest Citadel',
  'Crown of Aetheria',
  'Eye of the Maelstrom',
  'High Spire of Aether',
  'Sovereign Plateau',
];

const OUTPOST_NAMES = [
  'Driftstone Cay',
  'Skybridge Outpost',
  'Windcarved Shoal',
  'Starfall Perch',
  'Cloudbreak Islet',
  'Aether Reef',
];

function pickUniqueName(pool: string[], used: Set<string>, rng: () => number): string {
  const available = pool.filter((n) => !used.has(n));
  const list = available.length > 0 ? available : pool;
  const chosen = list[Math.floor(rng() * list.length)];
  used.add(chosen);
  return chosen;
}

interface IslandBlueprint {
  name: string;
  role: IslandInfo['role'];
  homeOwner?: FactionId;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
  lobeFreq: number;
  lobeAmp: number;
  lobePhase: number;
  isOutpost?: boolean;
}

function clampGridCoord(v: number, margin: number, gridSize: number): number {
  return Math.max(margin, Math.min(gridSize - 1 - margin, Math.round(v)));
}

function mirrorCoord(v: number, gridSize: number): number {
  return gridSize - 2 - v;
}

function hasForeignLandNearby(
  tiles: Tile[][],
  gridSize: number,
  x: number,
  y: number,
  myId: number,
  buffer = 2
): boolean {
  for (let dy = -buffer; dy <= buffer; dy++) {
    for (let dx = -buffer; dx <= buffer; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
      const other = tiles[ny][nx];
      if (other.kind === 'LAND' && other.islandId !== myId) return true;
    }
  }
  return false;
}

function sculptOrganicIsland(
  tiles: Tile[][],
  gridSize: number,
  id: number,
  bp: IslandBlueprint,
  seedOffset: number
): IslandInfo {
  const cosR = Math.cos(bp.rot);
  const sinR = Math.sin(bp.rot);
  const maxR = Math.ceil(Math.max(bp.rx, bp.ry) * 1.35) + 1;

  const carved: Array<{ x: number; y: number }> = [];
  for (
    let y = Math.max(2, Math.floor(bp.cy - maxR));
    y <= Math.min(gridSize - 3, Math.ceil(bp.cy + maxR));
    y++
  ) {
    for (
      let x = Math.max(2, Math.floor(bp.cx - maxR));
      x <= Math.min(gridSize - 3, Math.ceil(bp.cx + maxR));
      x++
    ) {
      if (hasForeignLandNearby(tiles, gridSize, x, y, id, 2)) continue;

      const ox = x - bp.cx;
      const oy = y - bp.cy;
      const lx = (ox * cosR - oy * sinR) / bp.rx;
      const ly = (ox * sinR + oy * cosR) / bp.ry;
      const dist = Math.hypot(lx, ly);
      const angle = Math.atan2(ly, lx);

      const lobe = Math.sin(angle * bp.lobeFreq + bp.lobePhase) * bp.lobeAmp;
      const microJitter = (hash2D(x + id * 19, y + id * 37, seedOffset) - 0.5) * 0.24;
      const inGuaranteedCore = Math.abs(ox) <= 1 && Math.abs(oy) <= 1;

      if (inGuaranteedCore || dist + lobe + microJitter <= 1.0) {
        const tile = tiles[y][x];
        tile.kind = 'LAND';
        tile.islandId = id;
        carved.push({ x, y });
      }
    }
  }

  // Keep only the single contiguous landmass connected to (cx, cy) so no 1-tile crumbs float detached
  const keyOf = (x: number, y: number) => `${x},${y}`;
  const visited = new Set<string>();
  const queue: Array<{ x: number; y: number }> = [];
  if (tiles[bp.cy]?.[bp.cx]?.islandId === id) {
    queue.push({ x: bp.cx, y: bp.cy });
    visited.add(keyOf(bp.cx, bp.cy));
  } else if (carved.length > 0) {
    queue.push(carved[0]);
    visited.add(keyOf(carved[0].x, carved[0].y));
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const k = keyOf(nx, ny);
      if (visited.has(k)) continue;
      if (nx < 1 || ny < 1 || nx >= gridSize - 1 || ny >= gridSize - 1) continue;
      if (tiles[ny][nx].islandId === id) {
        visited.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
  }

  const finalTiles: Array<{ x: number; y: number }> = [];
  for (const pt of carved) {
    if (visited.has(keyOf(pt.x, pt.y))) {
      finalTiles.push(pt);
    } else {
      tiles[pt.y][pt.x].kind = 'VOID';
      tiles[pt.y][pt.x].islandId = -1;
    }
  }

  return {
    id,
    name: bp.name,
    role: bp.role,
    homeOwner: bp.homeOwner,
    centerX: bp.cx,
    centerY: bp.cy,
    tiles: finalTiles,
  };
}

function generateArchipelagoBlueprints(
  rng: () => number,
  gridSize: number,
  aiFactionIds: AiFactionId[]
): IslandBlueprint[] {
  const center = Math.floor((gridSize - 1) / 2);
  const usedNames = new Set<string>();
  const blueprints: IslandBlueprint[] = [];

  const fitsWell = (cx: number, cy: number, radius: number, minGap = 3.1): boolean => {
    const margin = Math.ceil(radius) + 3;
    if (cx < margin || cy < margin || cx > gridSize - 1 - margin || cy > gridSize - 1 - margin) {
      return false;
    }
    for (const existing of blueprints) {
      const existingR = Math.max(existing.rx, existing.ry);
      const dist = Math.hypot(cx - existing.cx, cy - existing.cy);
      if (dist < radius + existingR + minGap) return false;
    }
    return true;
  };

  // Classic 1v1 Duel: preserve 3 distinct mirrored archipelago archetypes on 50x50
  if (aiFactionIds.length === 1) {
    const archetypeRoll = rng();
    const archetype: 'TWIN_FLANK' | 'RING_ATOLL' | 'CROSSWIND_STRAIT' =
      archetypeRoll < 0.4 ? 'TWIN_FLANK' : archetypeRoll < 0.75 ? 'RING_ATOLL' : 'CROSSWIND_STRAIT';

    const homeAxisAngle = (0.45 + rng() * 0.72) * Math.PI;
    const homeDist = archetype === 'RING_ATOLL' ? 18.0 + rng() * 1.6 : 17.2 + rng() * 2.0;

    const pHomeCx = clampGridCoord(center + Math.cos(homeAxisAngle) * homeDist, 8, gridSize);
    const pHomeCy = clampGridCoord(center + Math.sin(homeAxisAngle) * homeDist, 8, gridSize);
    const aHomeCx = mirrorCoord(pHomeCx, gridSize);
    const aHomeCy = mirrorCoord(pHomeCy, gridSize);

    const homeRx = 4.2 + rng() * 0.65;
    const homeRy = 4.1 + rng() * 0.65;
    const homeRot = rng() * Math.PI;
    const homeLobeFreq = rng() < 0.5 ? 3 : 4;
    const homeLobeAmp = 0.08 + rng() * 0.08;
    const homeLobePhase = rng() * Math.PI * 2;

    blueprints.push({
      name: pickUniqueName(HOME_NAMES, usedNames, rng),
      role: 'PLAYER_HOME',
      homeOwner: 'PLAYER',
      cx: pHomeCx,
      cy: pHomeCy,
      rx: homeRx,
      ry: homeRy,
      rot: homeRot,
      lobeFreq: homeLobeFreq,
      lobeAmp: homeLobeAmp,
      lobePhase: homeLobePhase,
    });

    blueprints.push({
      name: pickUniqueName(RIVAL_NAMES, usedNames, rng),
      role: 'AI_HOME',
      homeOwner: aiFactionIds[0],
      cx: aHomeCx,
      cy: aHomeCy,
      rx: homeRx,
      ry: homeRy,
      rot: homeRot,
      lobeFreq: homeLobeFreq,
      lobeAmp: homeLobeAmp,
      lobePhase: homeLobePhase + Math.PI,
    });

    const citRx = (archetype === 'RING_ATOLL' ? 3.5 : 3.9) + rng() * 0.65;
    const citRy = (archetype === 'RING_ATOLL' ? 3.5 : 3.9) + rng() * 0.65;
    blueprints.push({
      name: pickUniqueName(CITADEL_NAMES, usedNames, rng),
      role: 'CITADEL',
      cx: center,
      cy: center,
      rx: citRx,
      ry: citRy,
      rot: rng() * Math.PI,
      lobeFreq: rng() < 0.5 ? 4 : 5,
      lobeAmp: 0.1 + rng() * 0.08,
      lobePhase: rng() * Math.PI * 2,
    });

    const addMirroredPair = (
      role: 'GEYSER' | 'SHRINE',
      namePool: string[],
      angleOffsets: number[],
      distRange: [number, number],
      sizeRange: [number, number],
      isOutpost = false
    ): void => {
      const baseSign = rng() < 0.5 ? 1 : -1;
      for (let attempt = 0; attempt < 28; attempt++) {
        const offsetDeg = angleOffsets[0] + rng() * (angleOffsets[1] - angleOffsets[0]);
        const angle =
          homeAxisAngle +
          baseSign * ((offsetDeg * Math.PI) / 180) +
          (attempt > 14 ? (rng() - 0.5) * 0.6 : 0);
        const dist = distRange[0] + rng() * (distRange[1] - distRange[0]);
        const rx = sizeRange[0] + rng() * (sizeRange[1] - sizeRange[0]);
        const ry = sizeRange[0] + rng() * (sizeRange[1] - sizeRange[0]);
        const maxR = Math.max(rx, ry);

        const cx1 = clampGridCoord(center + Math.cos(angle) * dist, 7, gridSize);
        const cy1 = clampGridCoord(center + Math.sin(angle) * dist, 7, gridSize);
        const cx2 = mirrorCoord(cx1, gridSize);
        const cy2 = mirrorCoord(cy1, gridSize);

        if (Math.hypot(cx1 - cx2, cy1 - cy2) < maxR * 2 + 4) continue;
        if (!fitsWell(cx1, cy1, maxR, 2.9) || !fitsWell(cx2, cy2, maxR, 2.9)) continue;

        const rot = rng() * Math.PI;
        const lobeFreq = rng() < 0.5 ? 3 : 4;
        const lobeAmp = 0.09 + rng() * 0.09;
        const lobePhase = rng() * Math.PI * 2;

        blueprints.push({
          name: pickUniqueName(namePool, usedNames, rng),
          role,
          cx: cx1,
          cy: cy1,
          rx,
          ry,
          rot,
          lobeFreq,
          lobeAmp,
          lobePhase,
          isOutpost,
        });
        blueprints.push({
          name: pickUniqueName(namePool, usedNames, rng),
          role,
          cx: cx2,
          cy: cy2,
          rx,
          ry,
          rot,
          lobeFreq,
          lobeAmp,
          lobePhase: lobePhase + Math.PI,
          isOutpost,
        });
        return;
      }
    };

    if (archetype === 'CROSSWIND_STRAIT') {
      addMirroredPair('GEYSER', GEYSER_NAMES, [34, 56], [10.5, 13.5], [3.0, 3.6]);
    } else {
      addMirroredPair('GEYSER', GEYSER_NAMES, [38, 66], [12.0, 15.2], [3.0, 3.6]);
    }

    addMirroredPair('SHRINE', SHRINE_NAMES, [74, 118], [12.8, 16.4], [2.9, 3.4]);

    if (archetype === 'RING_ATOLL' || (archetype === 'CROSSWIND_STRAIT' && rng() < 0.55)) {
      addMirroredPair('GEYSER', OUTPOST_NAMES, [118, 152], [11.5, 15.5], [2.4, 2.9], true);
    }

    return blueprints;
  }

  // Multi-Opponent Radial Archipelago (2 to 6 AI rivals, dynamically expanded grid)
  const totalFactions = 1 + aiFactionIds.length; // 3..7
  const factionOrder: FactionId[] = ['PLAYER', ...aiFactionIds];
  const baseAngle = (0.55 + rng() * 0.45) * Math.PI; // Keeps Player in lower-western sector
  const homeRingR = Math.min(center - 8.5, 16.8 + aiFactionIds.length * 3.55);

  // 1. Central Super-Geyser Citadel
  const citRx = 4.0 + Math.min(0.9, aiFactionIds.length * 0.14) + rng() * 0.45;
  const citRy = 4.0 + Math.min(0.9, aiFactionIds.length * 0.14) + rng() * 0.45;
  blueprints.push({
    name: pickUniqueName(CITADEL_NAMES, usedNames, rng),
    role: 'CITADEL',
    cx: center,
    cy: center,
    rx: citRx,
    ry: citRy,
    rot: rng() * Math.PI,
    lobeFreq: rng() < 0.5 ? 4 : 5,
    lobeAmp: 0.09 + rng() * 0.07,
    lobePhase: rng() * Math.PI * 2,
  });

  // 2. Fair Outer Ring of Home Islands for Player + all AI Opponents
  const homeAngles: number[] = [];
  const homeRx = 4.25 + rng() * 0.5;
  const homeRy = 4.15 + rng() * 0.5;

  for (let i = 0; i < totalFactions; i++) {
    const owner = factionOrder[i];
    const idealAngle = baseAngle + (i / totalFactions) * Math.PI * 2;
    let placed = false;

    for (let attempt = 0; attempt < 20; attempt++) {
      const jitterAng = attempt === 0 ? (rng() - 0.5) * 0.1 : (rng() - 0.5) * 0.24;
      const jitterR = attempt === 0 ? (rng() - 0.5) * 1.4 : (rng() - 0.5) * 3.0;
      const angle = idealAngle + jitterAng;
      const radius = Math.max(15, Math.min(center - 8, homeRingR + jitterR));
      const cx = clampGridCoord(center + Math.cos(angle) * radius, 8, gridSize);
      const cy = clampGridCoord(center + Math.sin(angle) * radius, 8, gridSize);

      if (!fitsWell(cx, cy, Math.max(homeRx, homeRy), 3.4)) continue;

      homeAngles.push(angle);
      const profile = owner === 'PLAYER' ? null : AI_FACTION_PROFILES[owner];
      blueprints.push({
        name:
          owner === 'PLAYER'
            ? pickUniqueName(HOME_NAMES, usedNames, rng)
            : `${profile?.label ?? 'Rival'} ${pickUniqueName(['Sanctum', 'Keep', 'Perch', 'Citadel', 'Bastion', 'Eyrie'], usedNames, rng)}`,
        role: owner === 'PLAYER' ? 'PLAYER_HOME' : 'AI_HOME',
        homeOwner: owner,
        cx,
        cy,
        rx: homeRx,
        ry: homeRy,
        rot: rng() * Math.PI,
        lobeFreq: rng() < 0.5 ? 3 : 4,
        lobeAmp: 0.08 + rng() * 0.07,
        lobePhase: rng() * Math.PI * 2,
      });
      placed = true;
      break;
    }

    if (!placed) {
      const cx = clampGridCoord(center + Math.cos(idealAngle) * homeRingR, 8, gridSize);
      const cy = clampGridCoord(center + Math.sin(idealAngle) * homeRingR, 8, gridSize);
      homeAngles.push(idealAngle);
      const profile = owner === 'PLAYER' ? null : AI_FACTION_PROFILES[owner];
      blueprints.push({
        name:
          owner === 'PLAYER'
            ? pickUniqueName(HOME_NAMES, usedNames, rng)
            : `${profile?.label ?? 'Rival'} Bastion`,
        role: owner === 'PLAYER' ? 'PLAYER_HOME' : 'AI_HOME',
        homeOwner: owner,
        cx,
        cy,
        rx: homeRx,
        ry: homeRy,
        rot: rng() * Math.PI,
        lobeFreq: 3,
        lobeAmp: 0.08,
        lobePhase: rng() * Math.PI * 2,
      });
    }
  }

  // 3. Natural Geyser Isles (1 per faction on an inner-mid ring so everyone has fair nearby crystal expansion)
  const geyserRingR = Math.max(10.5, homeRingR * 0.55);
  for (let i = 0; i < totalFactions; i++) {
    const sectorAngle = (homeAngles[i] ?? baseAngle + (i / totalFactions) * Math.PI * 2) + (Math.PI / totalFactions) * 0.55;
    for (let attempt = 0; attempt < 24; attempt++) {
      const ang = sectorAngle + (rng() - 0.5) * (0.28 + attempt * 0.03);
      const dist = geyserRingR + (rng() - 0.5) * 4.2;
      const rx = 2.95 + rng() * 0.55;
      const ry = 2.95 + rng() * 0.55;
      const cx = clampGridCoord(center + Math.cos(ang) * dist, 7, gridSize);
      const cy = clampGridCoord(center + Math.sin(ang) * dist, 7, gridSize);

      if (!fitsWell(cx, cy, Math.max(rx, ry), 2.8)) continue;

      blueprints.push({
        name: pickUniqueName(GEYSER_NAMES, usedNames, rng),
        role: 'GEYSER',
        cx,
        cy,
        rx,
        ry,
        rot: rng() * Math.PI,
        lobeFreq: rng() < 0.5 ? 3 : 4,
        lobeAmp: 0.09 + rng() * 0.08,
        lobePhase: rng() * Math.PI * 2,
      });
      break;
    }
  }

  // 4. Shrine Isles (2 to 4 Rogue Priest shrines evenly spaced across the archipelago)
  const shrineCount = Math.min(4, Math.max(2, Math.ceil(totalFactions * 0.55)));
  const shrineRingR = Math.max(13.5, homeRingR * 0.74);
  const shrineOffset = baseAngle + Math.PI / totalFactions;

  for (let i = 0; i < shrineCount; i++) {
    const idealAng = shrineOffset + (i / shrineCount) * Math.PI * 2;
    for (let attempt = 0; attempt < 28; attempt++) {
      const ang = idealAng + (rng() - 0.5) * (0.25 + attempt * 0.04);
      const dist = shrineRingR + (rng() - 0.5) * 5.0;
      const rx = 2.9 + rng() * 0.45;
      const ry = 2.9 + rng() * 0.45;
      const cx = clampGridCoord(center + Math.cos(ang) * dist, 7, gridSize);
      const cy = clampGridCoord(center + Math.sin(ang) * dist, 7, gridSize);

      if (!fitsWell(cx, cy, Math.max(rx, ry), 2.8)) continue;

      blueprints.push({
        name: pickUniqueName(SHRINE_NAMES, usedNames, rng),
        role: 'SHRINE',
        cx,
        cy,
        rx,
        ry,
        rot: rng() * Math.PI,
        lobeFreq: rng() < 0.5 ? 3 : 4,
        lobeAmp: 0.09 + rng() * 0.08,
        lobePhase: rng() * Math.PI * 2,
      });
      break;
    }
  }

  // 5. Stepping-stone Outpost Isles on larger maps (3+ rivals) to enrich flank bridging
  const extraOutposts = Math.max(0, aiFactionIds.length - 1);
  for (let i = 0; i < extraOutposts; i++) {
    for (let attempt = 0; attempt < 26; attempt++) {
      const ang = rng() * Math.PI * 2;
      const dist = homeRingR * (0.36 + rng() * 0.46);
      const rx = 2.35 + rng() * 0.5;
      const ry = 2.35 + rng() * 0.5;
      const cx = clampGridCoord(center + Math.cos(ang) * dist, 7, gridSize);
      const cy = clampGridCoord(center + Math.sin(ang) * dist, 7, gridSize);

      if (!fitsWell(cx, cy, Math.max(rx, ry), 2.8)) continue;

      blueprints.push({
        name: pickUniqueName(OUTPOST_NAMES, usedNames, rng),
        role: 'GEYSER',
        cx,
        cy,
        rx,
        ry,
        rot: rng() * Math.PI,
        lobeFreq: 3,
        lobeAmp: 0.1,
        lobePhase: rng() * Math.PI * 2,
        isOutpost: true,
      });
      break;
    }
  }

  return blueprints;
}

export function createInitialWorld(
  playerFury: Fury,
  difficulty: Difficulty,
  requestedOpponents = 1,
  victoryRules: VictoryRules = DEFAULT_VICTORY_RULES
): WorldState {
  const opponentCount = clampOpponentCount(requestedOpponents);
  const gridSize = getGridSizeForOpponents(opponentCount);
  const center = Math.floor((gridSize - 1) / 2);
  const aiFactionIds = AI_FACTION_IDS.slice(0, opponentCount);
  const activeFactionIds: FactionId[] = ['PLAYER', ...aiFactionIds];

  const seed = ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1337;
  const rng = createRng(seed);
  const seedOffset = (seed % 9973) + 1;

  const tiles = createEmptyGrid(gridSize, seedOffset);
  const blueprints = generateArchipelagoBlueprints(rng, gridSize, aiFactionIds);
  const islands: IslandInfo[] = blueprints.map((bp, id) =>
    sculptOrganicIsland(tiles, gridSize, id, bp, seedOffset)
  );

  // Create pooled particles scaled with opponent count
  const particleCount = 240 + (opponentCount - 1) * 45;
  const particles: Particle[] = [];
  for (let i = 0; i < particleCount; i++) {
    particles.push({
      active: false,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 3,
      color: '#ffffff',
      alpha: 1,
      life: 0,
      maxLife: 1,
      gravity: 0,
    });
  }

  let nextId = 1;
  const structures: Structure[] = [];
  const priests: Priest[] = [];
  const golems: Golem[] = [];
  const geysers: Geyser[] = [];
  const crystals: Crystal[] = [];

  const occupiedTiles = new Set<string>();
  const tileKey = (tx: number, ty: number) => `${tx},${ty}`;

  const pickFreeTile = (
    island: IslandInfo,
    preferX: number,
    preferY: number,
    minDistFromCenter = 0
  ): { x: number; y: number } => {
    let best: { x: number; y: number; score: number } | null = null;
    for (const pt of island.tiles) {
      if (occupiedTiles.has(tileKey(pt.x, pt.y))) continue;
      const distCenter = Math.hypot(pt.x - island.centerX, pt.y - island.centerY);
      if (distCenter < minDistFromCenter) continue;
      const score = Math.hypot(pt.x - preferX, pt.y - preferY);
      if (!best || score < best.score) {
        best = { x: pt.x, y: pt.y, score };
      }
    }
    if (best) return { x: best.x, y: best.y };
    const anyFree = island.tiles.find((pt) => !occupiedTiles.has(tileKey(pt.x, pt.y)));
    return anyFree ?? { x: island.centerX, y: island.centerY };
  };

  const addStructure = (
    kind: StructureKind,
    owner: Owner,
    tx: number,
    ty: number,
    facing: 0 | 1 | 2 | 3 = 0
  ) => {
    const def = STRUCTURE_CATALOG[kind];
    occupiedTiles.add(tileKey(tx, ty));
    structures.push({
      id: nextId++,
      kind,
      owner,
      tx,
      ty,
      facing,
      hp: def.maxHp,
      maxHp: def.maxHp,
      cooldown: 0,
      powered: true,
      hitFlash: 0,
      recoil: 0,
      animPhase: rng() * Math.PI * 2,
      buildProgress: 1,
    });
  };

  const addGolem = (owner: Owner, x: number, y: number) => {
    golems.push({
      id: nextId++,
      owner,
      x,
      y,
      hp: 155,
      maxHp: 155,
      speed: 2.35,
      task: 'IDLE',
      targetCrystalId: null,
      carryingCrystalValue: 0,
      captureTargetPriestId: null,
      carryingPriestId: null,
      repairTarget: null,
      path: [],
      repathCooldown: 0,
      hitFlash: 0,
      slowTimer: 0,
      walkPhase: rng() * Math.PI * 2,
    });
  };

  const addPriest = (owner: Owner, isRogue: boolean, tx: number, ty: number) => {
    priests.push({
      id: nextId++,
      owner,
      isRogue,
      x: tx,
      y: ty,
      homeTx: tx,
      homeTy: ty,
      hp: isRogue ? 140 : 240,
      maxHp: isRogue ? 140 : 240,
      state: 'ACTIVE',
      stunTimer: 0,
      carriedByPriestId: null,
      captureTargetPriestId: null,
      carryingPriestId: null,
      returningToAltar: false,
      repathCooldown: 0,
      targetPath: [],
      hitFlash: 0,
      animPhase: rng() * Math.PI * 2,
      sacrificeTimer: 0,
      sacrificedBy: null,
      shieldTimer: 0,
      abilityCooldowns: {
        RECALL: 0,
        SANCTUARY: 0,
        TEMPEST_CAST: 0,
      },
    });
  };

  const addGeyser = (tx: number, ty: number, islandId: number, isSuper: boolean, eruptInterval: number) => {
    occupiedTiles.add(tileKey(tx, ty));
    geysers.push({
      id: nextId++,
      tx,
      ty,
      islandId,
      eruptTimer: 2.5 + rng() * 2,
      eruptInterval,
      isSuper,
      pulsePhase: rng() * Math.PI * 2,
    });
  };

  const addCrystal = (tx: number, ty: number, value: number) => {
    crystals.push({
      id: nextId++,
      tx,
      ty,
      x: tx,
      y: ty,
      value,
      claimedByGolemId: null,
      spawnAnim: 1,
      fromX: tx,
      fromY: ty,
      bobPhase: rng() * Math.PI * 2,
    });
  };

  const spawnCrystalsAround = (island: IslandInfo, gx: number, gy: number, count: number, value: number) => {
    const usedLocal = new Set<string>();
    for (let i = 0; i < count; i++) {
      let best: { x: number; y: number; d: number } | null = null;
      for (const pt of island.tiles) {
        const k = tileKey(pt.x, pt.y);
        if (occupiedTiles.has(k) || usedLocal.has(k)) continue;
        const d = Math.hypot(pt.x - gx, pt.y - gy);
        if (d < 0.8) continue;
        if (!best || d < best.d) best = { x: pt.x, y: pt.y, d };
      }
      if (best) {
        usedLocal.add(tileKey(best.x, best.y));
        addCrystal(best.x, best.y, value);
      }
    }
  };

  // Populate every generated island safely based on its role
  islands.forEach((island, idx) => {
    const bp = blueprints[idx];
    const toCenterX = center - island.centerX;
    const toCenterY = center - island.centerY;
    const toCenterLen = Math.hypot(toCenterX, toCenterY) || 1;
    const dirX = toCenterX / toCenterLen;
    const dirY = toCenterY / toCenterLen;
    const perpX = -dirY;
    const perpY = dirX;

    if (island.role === 'PLAYER_HOME' || island.role === 'AI_HOME') {
      const owner: FactionId = island.homeOwner ?? (island.role === 'PLAYER_HOME' ? 'PLAYER' : 'AI_1');

      const priestPos = pickFreeTile(island, island.centerX, island.centerY);
      const templePos = pickFreeTile(
        island,
        island.centerX - dirX * 1.6 + perpX * 1.2,
        island.centerY - dirY * 1.6 + perpY * 1.2,
        1.1
      );
      addStructure('TEMPLE', owner, templePos.x, templePos.y);

      const altarPos = pickFreeTile(
        island,
        island.centerX - dirX * 1.4 - perpX * 1.6,
        island.centerY - dirY * 1.4 - perpY * 1.6,
        1.2
      );
      addStructure('ALTAR', owner, altarPos.x, altarPos.y);

      const turretPos = pickFreeTile(
        island,
        island.centerX + dirX * 2.4,
        island.centerY + dirY * 2.4,
        1.4
      );
      addStructure('SUN_DISC', owner, turretPos.x, turretPos.y);

      const geyserPos = pickFreeTile(
        island,
        island.centerX - dirX * 2.2 + perpX * 2.2,
        island.centerY - dirY * 2.2 + perpY * 2.2,
        1.5
      );
      addGeyser(geyserPos.x, geyserPos.y, island.id, false, 9.5);
      spawnCrystalsAround(island, geyserPos.x, geyserPos.y, 2, 45);

      const finalPriestPos = occupiedTiles.has(tileKey(priestPos.x, priestPos.y))
        ? pickFreeTile(island, island.centerX, island.centerY)
        : priestPos;
      addPriest(owner, false, finalPriestPos.x, finalPriestPos.y);

      const g1 = pickFreeTile(island, templePos.x + dirX, templePos.y + dirY);
      const g2 = pickFreeTile(island, altarPos.x + dirX, altarPos.y + dirY);
      addGolem(owner, g1.x, g1.y);
      addGolem(owner, g2.x, g2.y);
    } else if (island.role === 'CITADEL') {
      const geyserPos = pickFreeTile(island, island.centerX, island.centerY);
      addGeyser(geyserPos.x, geyserPos.y, island.id, true, 6.0);
      spawnCrystalsAround(island, geyserPos.x, geyserPos.y, 4, 65);
    } else if (island.role === 'GEYSER') {
      const geyserPos = pickFreeTile(island, island.centerX, island.centerY);
      if (bp.isOutpost) {
        addGeyser(geyserPos.x, geyserPos.y, island.id, false, 10.5);
        spawnCrystalsAround(island, geyserPos.x, geyserPos.y, 2, 50);
      } else {
        addGeyser(geyserPos.x, geyserPos.y, island.id, false, 7.2);
        spawnCrystalsAround(island, geyserPos.x, geyserPos.y, 3, 55);
      }
    } else if (island.role === 'SHRINE') {
      const roguePos = pickFreeTile(island, island.centerX, island.centerY);
      occupiedTiles.add(tileKey(roguePos.x, roguePos.y));
      addPriest('NEUTRAL', true, roguePos.x, roguePos.y);

      const ob1 = pickFreeTile(island, island.centerX + perpX * 1.5, island.centerY + perpY * 1.5, 1.0);
      addStructure('STORM_OBELISK', 'NEUTRAL', ob1.x, ob1.y);

      const ob2 = pickFreeTile(island, island.centerX - perpX * 1.5, island.centerY - perpY * 1.5, 1.0);
      addStructure('STORM_OBELISK', 'NEUTRAL', ob2.x, ob2.y);
    }
  });

  const aiStartBonus = getDifficultyProfile(difficulty).startingAetherBonus;

  const factions = {} as Record<FactionId, FactionState>;
  factions.PLAYER = {
    owner: 'PLAYER',
    label: 'Allied',
    color: FURY_META[playerFury].color,
    fury: playerFury,
    stormPower: 220,
    knowledgeTier: 1,
    bridgeQueue: ['I4', 'L', randomTetrominoKey()],
    sacrificesCompleted: 0,
    crystalsHarvested: 0,
    bridgesPlaced: 0,
    towersDestroyed: 0,
    eliminated: false,
    dominanceSeconds: 0,
    unlockedTechs: getInitialUnlockedTechs(playerFury),
  };

  AI_FACTION_IDS.forEach((aiId, index) => {
    const profile = AI_FACTION_PROFILES[aiId];
    const active = index < opponentCount;
    const aiFury = getAiFuryForIndex(playerFury, index);
    factions[aiId] = {
      owner: aiId,
      label: profile.label,
      color: profile.color,
      fury: aiFury,
      stormPower: active ? 220 + aiStartBonus : 0,
      knowledgeTier: 1,
      bridgeQueue: ['I4', 'L', randomTetrominoKey()],
      sacrificesCompleted: 0,
      crystalsHarvested: 0,
      bridgesPlaced: 0,
      towersDestroyed: 0,
      eliminated: !active,
      dominanceSeconds: 0,
      unlockedTechs: getInitialUnlockedTechs(aiFury),
    };
  });

  const sacredSites: SacredSiteState[] = islands
    .filter((isl): isl is IslandInfo & { role: 'CITADEL' | 'SHRINE' } => isl.role === 'CITADEL' || isl.role === 'SHRINE')
    .sort((a, b) => (a.role === 'CITADEL' ? -1 : b.role === 'CITADEL' ? 1 : a.id - b.id))
    .map((isl) => ({
      islandId: isl.id,
      name: isl.name,
      role: isl.role,
      tx: isl.centerX,
      ty: isl.centerY,
      controller: null,
      contested: false,
      guardedByNeutral: isl.role === 'SHRINE',
    }));

  const fogGrid = new Uint8Array(gridSize * gridSize);
  fogGrid.fill(victoryRules.fogOfWar ? 0 : 2);

  const state: WorldState = {
    gridSize,
    opponentCount,
    activeFactionIds,
    aiFactionIds,
    tiles,
    islands,
    structures,
    priests,
    golems,
    aerialUnits: [],
    energyFences: [],
    geysers,
    crystals,
    projectiles: [],
    lightningArcs: [],
    sacrificeBeams: [],
    captureExplosions: [],
    impactEffects: [],
    particles,
    floatingTexts: [],
    factions,
    sacredSites,
    victoryRules: { ...victoryRules, priestSacrifice: true },
    fogGrid,
    pendingTechChoices: null,
    difficulty,
    elapsedSeconds: 0,
    nextEntityId: nextId,
    weather: createInitialWeatherState(),
  };

  recomputePowerGrids(state);
  return state;
}
