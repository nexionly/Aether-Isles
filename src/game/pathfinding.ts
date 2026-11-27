import {
  GRID_SIZE,
  TETROMINOES,
  getFactionBit,
  isFactionId,
  rotateCells,
} from './catalog';
import type { Direction, FactionId, Owner, TetrominoKey } from './types';
import type { WorldState } from './worldGen';

const CARDINAL_DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

export function inBounds(tx: number, ty: number, gridSize = GRID_SIZE): boolean {
  return tx >= 0 && ty >= 0 && tx < gridSize && ty < gridSize;
}

export function isWalkable(state: WorldState, tx: number, ty: number): boolean {
  if (!inBounds(tx, ty, state.gridSize)) return false;
  const kind = state.tiles[ty][tx].kind;
  return kind === 'LAND' || kind === 'BRIDGE';
}

export function hasStructureAt(state: WorldState, tx: number, ty: number): boolean {
  return state.structures.some((s) => s.tx === tx && s.ty === ty);
}

export function getStructureAt(state: WorldState, tx: number, ty: number) {
  return state.structures.find((s) => s.tx === tx && s.ty === ty) ?? null;
}

export function hasGeyserAt(state: WorldState, tx: number, ty: number): boolean {
  return state.geysers.some((g) => g.tx === tx && g.ty === ty);
}

/**
 * Flood-fills Aether power connectivity from each active faction's High Temple
 * across LAND tiles and bridges owned by that faction.
 */
export function recomputePowerGrids(state: WorldState): void {
  const gs = state.gridSize;
  for (let y = 0; y < gs; y++) {
    const row = state.tiles[y];
    for (let x = 0; x < gs; x++) {
      row[x].poweredMask = 0;
    }
  }

  const runBfs = (owner: FactionId) => {
    const faction = state.factions[owner];
    if (!faction || faction.eliminated) return;
    const hubs = state.structures.filter(
      (s) => (s.kind === 'TEMPLE' || s.kind === 'OUTPOST') && s.owner === owner
    );
    if (hubs.length === 0) return;
    const bit = getFactionBit(owner);
    const queue: Array<{ x: number; y: number }> = [];
    for (const hub of hubs) {
      if ((state.tiles[hub.ty][hub.tx].poweredMask & bit) === 0) {
        state.tiles[hub.ty][hub.tx].poweredMask |= bit;
        queue.push({ x: hub.tx, y: hub.ty });
      }
    }

    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      for (const d of CARDINAL_DIRS) {
        const nx = cur.x + d.dx;
        const ny = cur.y + d.dy;
        if (!inBounds(nx, ny, gs)) continue;
        const tile = state.tiles[ny][nx];
        if (tile.kind === 'VOID') continue;
        if (tile.kind === 'BRIDGE' && tile.owner !== owner) continue;
        if ((tile.poweredMask & bit) !== 0) continue;
        tile.poweredMask |= bit;
        queue.push({ x: nx, y: ny });
      }
    }
  };

  for (const owner of state.activeFactionIds) {
    runBfs(owner);
  }

  // Update powered state on all structures
  for (const s of state.structures) {
    if (s.owner === 'NEUTRAL') {
      s.powered = true;
    } else if (isFactionId(s.owner)) {
      s.powered = isTilePoweredBy(state, s.tx, s.ty, s.owner);
    } else {
      s.powered = false;
    }
  }
}

export function isTilePoweredBy(state: WorldState, tx: number, ty: number, owner: FactionId): boolean {
  if (!inBounds(tx, ty, state.gridSize)) return false;
  const bit = getFactionBit(owner);
  return (state.tiles[ty][tx].poweredMask & bit) !== 0;
}

export function countConnectedIslands(state: WorldState, owner: FactionId): number {
  let count = 0;
  for (const island of state.islands) {
    const connected = island.tiles.some((pt) => isTilePoweredBy(state, pt.x, pt.y, owner));
    if (connected) count++;
  }
  return count;
}

/**
 * Validates tetromino bridge placement:
 * - Every piece cell must be in-bounds VOID (cannot overlap land or existing bridges)
 * - At least one piece cell must be cardinally adjacent to a tile powered by `owner`
 */
export function getBridgePlacementCells(
  pieceKey: TetrominoKey,
  rotation: Direction,
  anchorTx: number,
  anchorTy: number
): Array<{ x: number; y: number }> {
  const rotated = rotateCells(TETROMINOES[pieceKey].cells, rotation);
  return rotated.map((c) => ({ x: anchorTx + c.x, y: anchorTy + c.y }));
}

export function canPlaceBridge(
  state: WorldState,
  owner: FactionId,
  pieceKey: TetrominoKey,
  rotation: Direction,
  anchorTx: number,
  anchorTy: number
): { valid: boolean; cells: Array<{ x: number; y: number }>; reason?: string } {
  const cells = getBridgePlacementCells(pieceKey, rotation, anchorTx, anchorTy);
  let touchesPowered = false;

  for (const cell of cells) {
    if (!inBounds(cell.x, cell.y, state.gridSize)) {
      return { valid: false, cells, reason: 'Out of sky bounds' };
    }
    const tile = state.tiles[cell.y][cell.x];
    if (tile.kind !== 'VOID') {
      return { valid: false, cells, reason: 'Must span open sky' };
    }
    for (const d of CARDINAL_DIRS) {
      const nx = cell.x + d.dx;
      const ny = cell.y + d.dy;
      if (isTilePoweredBy(state, nx, ny, owner)) {
        touchesPowered = true;
      }
    }
  }

  if (!touchesPowered) {
    return { valid: false, cells, reason: 'Must attach to powered island or bridge' };
  }

  return { valid: true, cells };
}

export function canPlaceStructure(
  state: WorldState,
  owner: FactionId,
  tx: number,
  ty: number,
  canBuildOnBridge: boolean
): { valid: boolean; reason?: string } {
  if (!inBounds(tx, ty, state.gridSize)) return { valid: false, reason: 'Out of bounds' };
  const tile = state.tiles[ty][tx];
  if (tile.kind === 'VOID') return { valid: false, reason: 'Cannot build on open sky' };
  if (tile.kind === 'BRIDGE' && !canBuildOnBridge) {
    return { valid: false, reason: 'Must be built on solid island ground' };
  }
  if (!isTilePoweredBy(state, tx, ty, owner)) {
    return { valid: false, reason: 'Tile has no Aether power connection' };
  }
  if (hasStructureAt(state, tx, ty) || hasGeyserAt(state, tx, ty)) {
    return { valid: false, reason: 'Tile is occupied' };
  }
  return { valid: true };
}

/**
 * Fast A* tile pathfinder across walkable tiles (LAND + any intact BRIDGE).
 * Avoids tiles blocked by impassable enemy structures unless it's the goal.
 */
export function findTilePath(
  state: WorldState,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  maxExplored?: number
): Array<{ x: number; y: number }> | null {
  const gs = state.gridSize;
  const exploreBudget = maxExplored ?? Math.max(700, Math.round(gs * gs * 0.28));

  const sx = Math.round(startX);
  const sy = Math.round(startY);
  const gx = Math.round(goalX);
  const gy = Math.round(goalY);

  if (!isWalkable(state, sx, sy) || !isWalkable(state, gx, gy)) return null;
  if (sx === gx && sy === gy) return [{ x: gx, y: gy }];

  const key = (x: number, y: number) => y * gs + x;
  const totalCells = gs * gs;
  const gScore = new Float32Array(totalCells);
  gScore.fill(1e9);
  const cameFrom = new Int32Array(totalCells);
  cameFrom.fill(-1);
  const closed = new Uint8Array(totalCells);

  // Build quick occupancy set for structures (still allow walking on start/goal/temple/altar/mines)
  const blocked = new Uint8Array(totalCells);
  for (const s of state.structures) {
    if (s.kind !== 'TEMPLE' && s.kind !== 'ALTAR' && s.kind !== 'BRIDGE_MINE') {
      blocked[key(s.tx, s.ty)] = 1;
    }
  }
  blocked[key(sx, sy)] = 0;
  blocked[key(gx, gy)] = 0;

  const open: Array<{ x: number; y: number; f: number }> = [];
  const startKey = key(sx, sy);
  gScore[startKey] = 0;
  open.push({ x: sx, y: sy, f: Math.abs(gx - sx) + Math.abs(gy - sy) });

  let explored = 0;
  while (open.length > 0 && explored < exploreBudget) {
    // Pop lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const cur = open[bestIdx];
    open[bestIdx] = open[open.length - 1];
    open.pop();

    const ck = key(cur.x, cur.y);
    if (closed[ck]) continue;
    closed[ck] = 1;
    explored++;

    if (cur.x === gx && cur.y === gy) {
      const path: Array<{ x: number; y: number }> = [];
      let trace = ck;
      while (trace !== -1 && trace !== startKey) {
        const px = trace % gs;
        const py = Math.floor(trace / gs);
        path.push({ x: px, y: py });
        trace = cameFrom[trace];
      }
      path.reverse();
      return path;
    }

    for (const d of CARDINAL_DIRS) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (!isWalkable(state, nx, ny)) continue;
      const nk = key(nx, ny);
      if (closed[nk]) continue;
      // Soft penalty for stepping through a structure tile (allows squeezing around bridges when needed)
      const stepCost = blocked[nk] ? 6.0 : 1.0;
      const tentativeG = gScore[ck] + stepCost;
      if (tentativeG < gScore[nk]) {
        cameFrom[nk] = ck;
        gScore[nk] = tentativeG;
        const h = Math.abs(gx - nx) + Math.abs(gy - ny);
        open.push({ x: nx, y: ny, f: tentativeG + h });
      }
    }
  }

  return null;
}

export function findNearestWalkableFreeTile(
  state: WorldState,
  cx: number,
  cy: number,
  owner?: Owner
): { x: number; y: number } {
  for (let radius = 0; radius <= 5; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tx = Math.round(cx + dx);
        const ty = Math.round(cy + dy);
        if (!isWalkable(state, tx, ty)) continue;
        if (hasStructureAt(state, tx, ty) || hasGeyserAt(state, tx, ty)) continue;
        if (owner && isFactionId(owner) && !isTilePoweredBy(state, tx, ty, owner)) continue;
        return { x: tx, y: ty };
      }
    }
  }
  return { x: Math.round(cx), y: Math.round(cy) };
}
