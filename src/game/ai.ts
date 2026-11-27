import {
  AETHER_OVERLOAD_TARGET,
  FURY_META,
  GOLEM_COST,
  MAX_GOLEMS,
  STRUCTURE_CATALOG,
  TETROMINOES,
} from './catalog';
import { getDifficultyProfile } from './difficulty';
import {
  canPlaceBridge,
  canPlaceStructure,
  hasGeyserAt,
  hasStructureAt,
  isTilePoweredBy,
} from './pathfinding';
import type { AiFactionId, BuildOptionKind, Direction, FactionId, IslandInfo } from './types';
import type { WorldState } from './worldGen';

export interface AiCallbacks {
  placeBridge: (
    owner: FactionId,
    queueIndex: number,
    rotation: Direction,
    anchorTx: number,
    anchorTy: number
  ) => boolean;
  placeStructure: (
    owner: FactionId,
    kind: BuildOptionKind,
    tx: number,
    ty: number,
    facing: Direction
  ) => boolean;
  summonGolem: (owner: FactionId) => boolean;
}

export class AiCommander {
  private thinkTimers: Partial<Record<AiFactionId, number>> = {};

  public reset(): void {
    this.thinkTimers = {};
  }

  public update(state: WorldState, dt: number, actions: AiCallbacks): void {
    const profile = getDifficultyProfile(state.difficulty);
    const cadence = profile.actionCadenceSeconds;
    const jitter = profile.actionJitterSeconds;

    state.aiFactionIds.forEach((aiId, index) => {
      const faction = state.factions[aiId];
      if (!faction || faction.eliminated) return;

      if (this.thinkTimers[aiId] === undefined) {
        // Give players opening breathing room scaled by difficulty and stagger multi-rival AI frames
        this.thinkTimers[aiId] = profile.openingGraceSeconds + index * 0.65;
      }

      const remaining = (this.thinkTimers[aiId] ?? profile.openingGraceSeconds) - dt;
      if (remaining > 0) {
        this.thinkTimers[aiId] = remaining;
        return;
      }

      this.thinkTimers[aiId] = cadence + Math.random() * jitter;
      this.thinkForFaction(state, aiId, actions);
    });
  }

  private thinkForFaction(state: WorldState, aiId: AiFactionId, actions: AiCallbacks): void {
    const profile = getDifficultyProfile(state.difficulty);
    const faction = state.factions[aiId];
    const aiGolems = state.golems.filter((g) => g.owner === aiId);
    const desiredGolems = profile.desiredGolems;

    // 1. Keep economy moving with Golems
    if (aiGolems.length < desiredGolems && aiGolems.length < MAX_GOLEMS && faction.stormPower >= GOLEM_COST + 30) {
      if (actions.summonGolem(aiId)) return;
    }

    // 2. React defensively if any rival or player bridges/structures approach our powered islands
    if (this.tryBuildDefenseAgainstThreat(state, aiId, actions)) {
      return;
    }

    // If Aether Overload is enabled and difficulty permits hoarding, conserve reserves unless defending home
    const overloadTarget = state.victoryRules.aetherOverloadTarget || AETHER_OVERLOAD_TARGET;
    if (
      state.victoryRules.aetherOverload &&
      profile.overloadHoardEnabled &&
      faction.stormPower >= overloadTarget * 0.78
    ) {
      return;
    }

    // 3. Build an Aether Mill if sitting on surplus Aether
    const aiWindmills = state.structures.filter((s) => s.owner === aiId && s.kind === 'WINDMILL').length;
    const maxWindmills = profile.maxWindmills;
    if (aiWindmills < maxWindmills && faction.stormPower >= 145) {
      if (this.tryBuildEconomyStructure(state, aiId, actions)) return;
    }

    // 4. Attack neutral Shrine Monoliths / Rogue Priest or hostile High Priests when within reach
    if (this.tryAttackShrineOrHostileFront(state, aiId, actions)) {
      return;
    }

    // 5. Expand via Polyomino Bridges toward next unreached target island
    if (this.tryExpandBridge(state, aiId, actions)) {
      return;
    }

    // 6. Reinforce frontline with extra elemental towers if overflowing with Aether
    if (faction.stormPower >= 165) {
      this.tryBuildForwardTower(state, aiId, actions);
    }
  }

  private getHomeIslandFor(state: WorldState, owner: FactionId): IslandInfo | null {
    return (
      state.islands.find((isl) => isl.homeOwner === owner) ??
      state.islands.find((isl) => (owner === 'PLAYER' ? isl.role === 'PLAYER_HOME' : isl.role === 'AI_HOME')) ??
      state.islands[0] ??
      null
    );
  }

  private getNearestEnemyHome(state: WorldState, aiId: AiFactionId, fromX: number, fromY: number): IslandInfo | null {
    let best: { island: IslandInfo; dist: number } | null = null;
    for (const isl of state.islands) {
      if (isl.role !== 'PLAYER_HOME' && isl.role !== 'AI_HOME') continue;
      if (isl.homeOwner === aiId) continue;
      if (isl.homeOwner && state.factions[isl.homeOwner]?.eliminated) continue;
      const d = Math.hypot(isl.centerX - fromX, isl.centerY - fromY);
      if (!best || d < best.dist) {
        best = { island: isl, dist: d };
      }
    }
    return best?.island ?? this.getHomeIslandFor(state, 'PLAYER');
  }

  private getNextTargetIsland(state: WorldState, aiId: AiFactionId): IslandInfo | null {
    const myHome = this.getHomeIslandFor(state, aiId);
    if (!myHome) return this.getHomeIslandFor(state, 'PLAYER');

    const anchors: Array<{ x: number; y: number }> = [];
    for (const isl of state.islands) {
      if (isl.tiles.some((pt) => isTilePoweredBy(state, pt.x, pt.y, aiId))) {
        anchors.push({ x: isl.centerX, y: isl.centerY });
      }
    }
    if (anchors.length === 0) anchors.push({ x: myHome.centerX, y: myHome.centerY });

    const tier = state.factions[aiId].knowledgeTier;
    let best: { island: IslandInfo; score: number } | null = null;

    for (const island of state.islands) {
      if (island.homeOwner === aiId) continue;
      if (island.homeOwner && state.factions[island.homeOwner]?.eliminated) continue;
      const connected = island.tiles.some((pt) => isTilePoweredBy(state, pt.x, pt.y, aiId));
      if (connected) continue;

      let minDist = Infinity;
      for (const a of anchors) {
        const d = Math.hypot(island.centerX - a.x, island.centerY - a.y);
        if (d < minDist) minDist = d;
      }

      const site = state.victoryRules.altarDominance
        ? state.sacredSites.find((s) => s.islandId === island.id)
        : undefined;
      const enemyDominanceThreat =
        state.victoryRules.altarDominance &&
        state.activeFactionIds.some(
          (id) => id !== aiId && !state.factions[id].eliminated && state.factions[id].dominanceSeconds >= 16
        );
      const siteHeldByRival = site !== undefined && site.controller !== null && site.controller !== aiId;

      let roleBias = 3.2;
      if (island.role === 'GEYSER') {
        roleBias = -3.4;
      } else if (island.role === 'CITADEL') {
        roleBias = state.victoryRules.altarDominance
          ? siteHeldByRival && enemyDominanceThreat
            ? -7.5
            : siteHeldByRival
              ? -4.0
              : -2.4
          : -1.8;
      } else if (island.role === 'SHRINE') {
        roleBias =
          state.victoryRules.altarDominance && siteHeldByRival && enemyDominanceThreat
            ? -6.5
            : tier < 2
              ? -2.8
              : siteHeldByRival
                ? -3.5
                : -0.9;
      }

      const score = minDist + roleBias;
      if (!best || score < best.score) {
        best = { island, score };
      }
    }

    return best?.island ?? this.getNearestEnemyHome(state, aiId, myHome.centerX, myHome.centerY);
  }

  private tryExpandBridge(state: WorldState, aiId: AiFactionId, actions: AiCallbacks): boolean {
    const gs = state.gridSize;
    const faction = state.factions[aiId];
    const targetIsland = this.getNextTargetIsland(state, aiId);
    if (!targetIsland) return false;

    // Find powered tiles for this AI closest to the target island
    const poweredTiles: Array<{ x: number; y: number; dist: number }> = [];
    for (let y = 1; y < gs - 1; y++) {
      for (let x = 1; x < gs - 1; x++) {
        if (!isTilePoweredBy(state, x, y, aiId)) continue;
        const hasVoidNeighbor =
          state.tiles[y - 1][x].kind === 'VOID' ||
          state.tiles[y + 1][x].kind === 'VOID' ||
          state.tiles[y][x - 1].kind === 'VOID' ||
          state.tiles[y][x + 1].kind === 'VOID';
        if (!hasVoidNeighbor) continue;
        const d = Math.hypot(x - targetIsland.centerX, y - targetIsland.centerY);
        poweredTiles.push({ x, y, dist: d });
      }
    }

    if (poweredTiles.length === 0) return false;
    poweredTiles.sort((a, b) => a.dist - b.dist);
    const frontier = poweredTiles.slice(0, 8);

    let bestMove: {
      queueIndex: number;
      rotation: Direction;
      ax: number;
      ay: number;
      score: number;
    } | null = null;

    const currentBestDist = frontier[0].dist;

    for (let qi = 0; qi < faction.bridgeQueue.length; qi++) {
      const pieceKey = faction.bridgeQueue[qi];
      const cost = TETROMINOES[pieceKey].cost;
      if (faction.stormPower < cost) continue;

      for (let rot = 0 as Direction; rot < 4; rot = (rot + 1) as Direction) {
        for (const f of frontier) {
          for (let oy = -3; oy <= 2; oy++) {
            for (let ox = -3; ox <= 2; ox++) {
              const ax = f.x + ox;
              const ay = f.y + oy;
              const check = canPlaceBridge(state, aiId, pieceKey, rot, ax, ay);
              if (!check.valid) continue;

              let minCellDist = 999;
              let touchesTarget = false;
              for (const cell of check.cells) {
                const dist = Math.hypot(cell.x - targetIsland.centerX, cell.y - targetIsland.centerY);
                if (dist < minCellDist) minCellDist = dist;
                const neighbors = [
                  [cell.x + 1, cell.y],
                  [cell.x - 1, cell.y],
                  [cell.x, cell.y + 1],
                  [cell.x, cell.y - 1],
                ];
                for (const [nx, ny] of neighbors) {
                  if (
                    nx >= 0 &&
                    ny >= 0 &&
                    nx < gs &&
                    ny < gs &&
                    state.tiles[ny][nx].islandId === targetIsland.id
                  ) {
                    touchesTarget = true;
                  }
                }
              }

              const gain = currentBestDist - minCellDist;
              const score = gain * 10 + (touchesTarget ? 60 : 0) + (pieceKey === 'I4' ? 3 : 0);
              if (score > 4 && (!bestMove || score > bestMove.score)) {
                bestMove = { queueIndex: qi, rotation: rot, ax, ay, score };
              }
            }
          }
        }
      }
    }

    if (bestMove) {
      return actions.placeBridge(aiId, bestMove.queueIndex, bestMove.rotation, bestMove.ax, bestMove.ay);
    }
    return false;
  }

  private tryBuildDefenseAgainstThreat(state: WorldState, aiId: AiFactionId, actions: AiCallbacks): boolean {
    const faction = state.factions[aiId];
    const myHome = this.getHomeIslandFor(state, aiId);
    if (!myHome) return false;
    const myPriest = state.priests.find((p) => p.owner === aiId);

    // Hostile targets include Player structures AND other rival AI structures!
    const hostilePoints: Array<{ x: number; y: number; priority: number }> = [];
    for (const s of state.structures) {
      if (s.owner !== aiId && s.owner !== 'NEUTRAL') {
        if (s.kind === 'ALTAR') continue;
        if (s.kind === 'TEMPLE' && !state.victoryRules.templeDestruction) continue;
        const dHome = Math.hypot(s.tx - myHome.centerX, s.ty - myHome.centerY);
        hostilePoints.push({ x: s.tx, y: s.ty, priority: dHome < 12 ? 3 : 1 });
      }
    }
    if (hostilePoints.length === 0) return false;

    // Sort urgent home threats first
    hostilePoints.sort((a, b) => b.priority - a.priority);

    const homeDefenseCap = getDifficultyProfile(state.difficulty).homeDefenseTowerCap;
    let urgentThreat: { x: number; y: number } | null = null;
    for (const h of hostilePoints) {
      const nearbyAiTowers = state.structures.filter(
        (s) =>
          s.owner === aiId &&
          s.powered &&
          STRUCTURE_CATALOG[s.kind].fireRate > 0 &&
          Math.hypot(s.tx - h.x, s.ty - h.y) <= 7.5
      ).length;
      if (nearbyAiTowers < (h.priority >= 3 ? homeDefenseCap : 1)) {
        const hasPoweredNear = this.findBestBuildTileNear(state, aiId, h.x, h.y, 7.5, true);
        if (hasPoweredNear) {
          urgentThreat = h;
          break;
        }
      }
    }

    if (!urgentThreat) return false;

    const furyUnits = FURY_META[faction.fury].units;
    let chosenKind: BuildOptionKind = 'SUN_DISC';
    if (faction.knowledgeTier >= 2 && faction.stormPower >= STRUCTURE_CATALOG[furyUnits[2]].cost) {
      chosenKind = furyUnits[2];
    } else if (faction.stormPower >= STRUCTURE_CATALOG[furyUnits[0]].cost && Math.random() < 0.72) {
      chosenKind = furyUnits[0];
    } else if (faction.stormPower >= STRUCTURE_CATALOG[furyUnits[1]].cost && Math.random() < 0.5) {
      chosenKind = furyUnits[1];
    }

    const def = STRUCTURE_CATALOG[chosenKind];
    if (faction.stormPower < def.cost) return false;

    // If Priest is hurt, consider dropping a Bulwark right beside Priest
    if (myPriest && myPriest.hp < myPriest.maxHp * 0.75 && faction.stormPower >= 55) {
      const blockerKind: BuildOptionKind = faction.fury === 'RAIN' ? 'FROST_BLOCKER' : 'STONE_BLOCKER';
      const spot = this.findBestBuildTileNear(state, aiId, Math.round(myPriest.x), Math.round(myPriest.y), 2.5, false);
      if (spot && actions.placeStructure(aiId, blockerKind, spot.x, spot.y, 0)) {
        return true;
      }
    }

    if (def.directional) {
      const aligned = this.findDirectionalBuildTile(state, aiId, urgentThreat.x, urgentThreat.y, def.range - 0.5);
      if (aligned) {
        return actions.placeStructure(aiId, chosenKind, aligned.x, aligned.y, aligned.facing);
      }
      chosenKind = faction.fury === 'THUNDER' ? 'SPARK_PYLON' : faction.fury === 'RAIN' ? 'RAIN_CANNON' : 'SUN_DISC';
      if (faction.stormPower < STRUCTURE_CATALOG[chosenKind].cost) return false;
    }

    const spot = this.findBestBuildTileNear(
      state,
      aiId,
      urgentThreat.x,
      urgentThreat.y,
      STRUCTURE_CATALOG[chosenKind].range - 0.6,
      true
    );
    if (spot) {
      return actions.placeStructure(aiId, chosenKind, spot.x, spot.y, 0);
    }

    return false;
  }

  private tryAttackShrineOrHostileFront(state: WorldState, aiId: AiFactionId, actions: AiCallbacks): boolean {
    const faction = state.factions[aiId];
    const targets: Array<{ x: number; y: number }> = [];

    for (const s of state.structures) {
      if (s.owner === 'NEUTRAL') {
        targets.push({ x: s.tx, y: s.ty });
      }
    }
    for (const p of state.priests) {
      if (p.owner !== aiId && p.state === 'ACTIVE') {
        targets.push({ x: Math.round(p.x), y: Math.round(p.y) });
      }
    }

    for (const t of targets) {
      const existingOffense = state.structures.filter(
        (s) =>
          s.owner === aiId &&
          s.powered &&
          STRUCTURE_CATALOG[s.kind].fireRate > 0 &&
          Math.hypot(s.tx - t.x, s.ty - t.y) <= 6.5
      ).length;
      if (existingOffense >= 2) continue;

      const kind: BuildOptionKind =
        faction.fury === 'RAIN'
          ? 'RAIN_CANNON'
          : faction.fury === 'THUNDER'
            ? 'SPARK_PYLON'
            : 'SUN_DISC';
      const def = STRUCTURE_CATALOG[kind];
      if (faction.stormPower < def.cost) continue;

      const spot = this.findBestBuildTileNear(state, aiId, t.x, t.y, def.range - 0.5, true);
      if (spot) {
        return actions.placeStructure(aiId, kind, spot.x, spot.y, 0);
      }
    }
    return false;
  }

  private tryBuildEconomyStructure(state: WorldState, aiId: AiFactionId, actions: AiCallbacks): boolean {
    const home = this.getHomeIslandFor(state, aiId);
    if (!home) return false;
    for (const pt of home.tiles) {
      if (canPlaceStructure(state, aiId, pt.x, pt.y, false).valid) {
        return actions.placeStructure(aiId, 'WINDMILL', pt.x, pt.y, 0);
      }
    }
    return false;
  }

  private tryBuildForwardTower(state: WorldState, aiId: AiFactionId, actions: AiCallbacks): boolean {
    const gs = state.gridSize;
    const faction = state.factions[aiId];
    const myHome = this.getHomeIslandFor(state, aiId);
    const enemyHome = this.getNearestEnemyHome(state, aiId, myHome?.centerX ?? 0, myHome?.centerY ?? 0);
    if (!enemyHome) return false;

    const furyUnits = FURY_META[faction.fury].units;
    const kind: BuildOptionKind =
      faction.knowledgeTier >= 2 && faction.stormPower >= STRUCTURE_CATALOG[furyUnits[2]].cost
        ? furyUnits[2]
        : faction.fury === 'RAIN'
          ? 'RAIN_CANNON'
          : faction.fury === 'THUNDER'
            ? 'SPARK_PYLON'
            : 'WHIRLWIND_SPIRE';

    const def = STRUCTURE_CATALOG[kind];
    if (faction.stormPower < def.cost) return false;

    let best: { x: number; y: number; d: number } | null = null;
    for (let y = 1; y < gs - 1; y++) {
      for (let x = 1; x < gs - 1; x++) {
        if (!isTilePoweredBy(state, x, y, aiId)) continue;
        if (!canPlaceStructure(state, aiId, x, y, def.canBuildOnBridge).valid) continue;
        const d = Math.hypot(x - enemyHome.centerX, y - enemyHome.centerY);
        if (!best || d < best.d) {
          best = { x, y, d };
        }
      }
    }
    if (!best) return false;

    let facing: Direction = 3;
    const dx = enemyHome.centerX - best.x;
    const dy = enemyHome.centerY - best.y;
    if (Math.abs(dx) > Math.abs(dy)) facing = dx > 0 ? 1 : 3;
    else facing = dy > 0 ? 2 : 0;

    return actions.placeStructure(aiId, kind, best.x, best.y, facing);
  }

  private findDirectionalBuildTile(
    state: WorldState,
    aiId: AiFactionId,
    targetX: number,
    targetY: number,
    maxRange: number
  ): { x: number; y: number; facing: Direction } | null {
    const dirs: Array<{ dx: number; dy: number; facing: Direction }> = [
      { dx: 0, dy: 1, facing: 0 },
      { dx: -1, dy: 0, facing: 1 },
      { dx: 0, dy: -1, facing: 2 },
      { dx: 1, dy: 0, facing: 3 },
    ];

    for (let dist = 2; dist <= Math.floor(maxRange); dist++) {
      for (const d of dirs) {
        const tx = targetX + d.dx * dist;
        const ty = targetY + d.dy * dist;
        if (canPlaceStructure(state, aiId, tx, ty, true).valid) {
          return { x: tx, y: ty, facing: d.facing };
        }
      }
    }
    return null;
  }

  private findBestBuildTileNear(
    state: WorldState,
    aiId: AiFactionId,
    targetX: number,
    targetY: number,
    maxRange: number,
    allowBridge: boolean
  ): { x: number; y: number } | null {
    let best: { x: number; y: number; dist: number } | null = null;
    const r = Math.ceil(maxRange);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = targetX + dx;
        const ty = targetY + dy;
        const dist = Math.hypot(dx, dy);
        if (dist < 1.5 || dist > maxRange) continue;
        if (hasStructureAt(state, tx, ty) || hasGeyserAt(state, tx, ty)) continue;
        if (!canPlaceStructure(state, aiId, tx, ty, allowBridge).valid) continue;
        if (!best || Math.abs(dist - maxRange * 0.65) < Math.abs(best.dist - maxRange * 0.65)) {
          best = { x: tx, y: ty, dist };
        }
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }
}
