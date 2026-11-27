import {
  GRID_SIZE,
  TETROMINOES,
  getFactionBit,
  isFactionId,
  rotateCells,
} from './catalog';
import type { Direction, FactionId, Owner, Structure, TetrominoKey } from './types';
import type { WorldState } from './worldGen';

const CARDINAL_DX = [1, -1, 0, 0];
const CARDINAL_DY = [0, 0, 1, -1];

// Reusable module-scoped scratch buffers for zero-allocation BFS and A* pathfinding
let scratchCapacity = 0;
let bfsQueue = new Int32Array(0);
let gScoreBuf = new Float32Array(0);
let cameFromBuf = new Int32Array(0);
let gGenBuf = new Uint32Array(0);
let closedGenBuf = new Uint32Array(0);
let heapKeys = new Int32Array(0);
let heapF = new Float32Array(0);
let pathGeneration = 1;

function ensurePathScratch(totalCells: number): void {
  if (scratchCapacity < totalCells) {
    scratchCapacity = totalCells;
    bfsQueue = new Int32Array(totalCells);
    gScoreBuf = new Float32Array(totalCells);
    cameFromBuf = new Int32Array(totalCells);
    gGenBuf = new Uint32Array(totalCells);
    closedGenBuf = new Uint32Array(totalCells);
    heapKeys = new Int32Array(totalCells * 2);
    heapF = new Float32Array(totalCells * 2);
    pathGeneration = 1;
    return;
  }
  pathGeneration++;
  if (pathGeneration >= 0xfffffffe) {
    gGenBuf.fill(0);
    closedGenBuf.fill(0);
    pathGeneration = 1;
  }
}

export function inBounds(tx: number, ty: number, gridSize = GRID_SIZE): boolean {
  return tx >= 0 && ty >= 0 && tx < gridSize && ty < gridSize;
}

export function isWalkable(state: WorldState, tx: number, ty: number): boolean {
  if (!inBounds(tx, ty, state.gridSize)) return false;
  const kind = state.tiles[ty][tx].kind;
  return kind === 'LAND' || kind === 'BRIDGE';
}

export function registerStructureOnGrid(state: WorldState, s: Structure): void {
  const gs = state.gridSize;
  if (s.tx >= 0 && s.ty >= 0 && s.tx < gs && s.ty < gs) {
    state.structureGrid[s.ty * gs + s.tx] = s;
  }
}

export function unregisterStructureOnGrid(state: WorldState, tx: number, ty: number, id?: number): void {
  const gs = state.gridSize;
  if (tx >= 0 && ty >= 0 && tx < gs && ty < gs) {
    const idx = ty * gs + tx;
    const cur = state.structureGrid[idx];
    if (cur && (id === undefined || cur.id === id)) {
      state.structureGrid[idx] = null;
    }
  }
}

export function hasStructureAt(state: WorldState, tx: number, ty: number): boolean {
  const gs = state.gridSize;
  if (tx < 0 || ty < 0 || tx >= gs || ty >= gs) return false;
  return state.structureGrid[ty * gs + tx] !== null;
}

export function getStructureAt(state: WorldState, tx: number, ty: number): Structure | null {
  const gs = state.gridSize;
  if (tx < 0 || ty < 0 || tx >= gs || ty >= gs) return null;
  return state.structureGrid[ty * gs + tx] ?? null;
}

export function hasGeyserAt(state: WorldState, tx: number, ty: number): boolean {
  const gs = state.gridSize;
  if (tx < 0 || ty < 0 || tx >= gs || ty >= gs) return false;
  return state.geyserGrid[ty * gs + tx] === 1;
}

/**
 * Flood-fills Aether power connectivity from each active faction's High Temple & Outposts
 * across LAND tiles and bridges owned by that faction (using zero-allocation typed BFS queue).
 */
export function recomputePowerGrids(state: WorldState): void {
  const gs = state.gridSize;
  const totalCells = gs * gs;
  ensurePathScratch(totalCells);

  for (let y = 0; y < gs; y++) {
    const row = state.tiles[y];
    for (let x = 0; x < gs; x++) {
      row[x].poweredMask = 0;
    }
  }

  for (const owner of state.activeFactionIds) {
    const faction = state.factions[owner];
    if (!faction || faction.eliminated) continue;
    const bit = getFactionBit(owner);

    let head = 0;
    let tail = 0;
    for (let i = 0; i < state.structures.length; i++) {
      const s = state.structures[i];
      if (s.owner !== owner || (s.kind !== 'TEMPLE' && s.kind !== 'OUTPOST')) continue;
      const tile = state.tiles[s.ty][s.tx];
      if ((tile.poweredMask & bit) === 0) {
        tile.poweredMask |= bit;
        bfsQueue[tail++] = s.ty * gs + s.tx;
      }
    }
    if (tail === 0) continue;

    while (head < tail) {
      const idx = bfsQueue[head++];
      const cx = idx % gs;
      const cy = (idx - cx) / gs;
      for (let d = 0; d < 4; d++) {
        const nx = cx + CARDINAL_DX[d];
        const ny = cy + CARDINAL_DY[d];
        if (nx < 0 || ny < 0 || nx >= gs || ny >= gs) continue;
        const tile = state.tiles[ny][nx];
        if (tile.kind === 'VOID') continue;
        if (tile.kind === 'BRIDGE' && tile.owner !== owner) continue;
        if ((tile.poweredMask & bit) !== 0) continue;
        tile.poweredMask |= bit;
        bfsQueue[tail++] = ny * gs + nx;
      }
    }
  }

  // Update powered state on all structures
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (s.owner === 'NEUTRAL') {
      s.powered = true;
    } else if (isFactionId(s.owner)) {
      s.powered = (state.tiles[s.ty][s.tx].poweredMask & getFactionBit(s.owner)) !== 0;
    } else {
      s.powered = false;
    }
  }

  state.terrainVersion++;
}

export function isTilePoweredBy(state: WorldState, tx: number, ty: number, owner: FactionId): boolean {
  if (!inBounds(tx, ty, state.gridSize)) return false;
  const bit = getFactionBit(owner);
  return (state.tiles[ty][tx].poweredMask & bit) !== 0;
}

export function countConnectedIslands(state: WorldState, owner: FactionId): number {
  const bit = getFactionBit(owner);
  let count = 0;
  for (let i = 0; i < state.islands.length; i++) {
    const tiles = state.islands[i].tiles;
    for (let j = 0; j < tiles.length; j++) {
      const pt = tiles[j];
      if ((state.tiles[pt.y][pt.x].poweredMask & bit) !== 0) {
        count++;
        break;
      }
    }
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
  const gs = state.gridSize;
  const bit = getFactionBit(owner);
  let touchesPowered = false;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.x < 0 || cell.y < 0 || cell.x >= gs || cell.y >= gs) {
      return { valid: false, cells, reason: 'Out of sky bounds' };
    }
    const tile = state.tiles[cell.y][cell.x];
    if (tile.kind !== 'VOID') {
      return { valid: false, cells, reason: 'Must span open sky' };
    }
    if (!touchesPowered) {
      for (let d = 0; d < 4; d++) {
        const nx = cell.x + CARDINAL_DX[d];
        const ny = cell.y + CARDINAL_DY[d];
        if (nx >= 0 && ny >= 0 && nx < gs && ny < gs && (state.tiles[ny][nx].poweredMask & bit) !== 0) {
          touchesPowered = true;
          break;
        }
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
 * Fast zero-allocation binary-heap A* tile pathfinder across walkable tiles (LAND + intact BRIDGE).
 * Uses generation-stamped typed scratch buffers and O(1) structureGrid occupancy checks.
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

  const totalCells = gs * gs;
  ensurePathScratch(totalCells);
  const gen = pathGeneration;
  const structureGrid = state.structureGrid;

  const startKey = sy * gs + sx;
  const goalKey = gy * gs + gx;
  gScoreBuf[startKey] = 0;
  gGenBuf[startKey] = gen;
  cameFromBuf[startKey] = -1;

  // Binary min-heap open set
  let heapSize = 1;
  heapKeys[0] = startKey;
  heapF[0] = Math.abs(gx - sx) + Math.abs(gy - sy);

  let explored = 0;
  while (heapSize > 0 && explored < exploreBudget) {
    // Pop min-f node
    const ck = heapKeys[0];
    heapSize--;
    if (heapSize > 0) {
      const lastKey = heapKeys[heapSize];
      const lastF = heapF[heapSize];
      let idx = 0;
      while (true) {
        const left = (idx << 1) + 1;
        if (left >= heapSize) break;
        const right = left + 1;
        let smallest = left;
        if (right < heapSize && heapF[right] < heapF[left]) {
          smallest = right;
        }
        if (lastF <= heapF[smallest]) break;
        heapKeys[idx] = heapKeys[smallest];
        heapF[idx] = heapF[smallest];
        idx = smallest;
      }
      heapKeys[idx] = lastKey;
      heapF[idx] = lastF;
    }

    if (closedGenBuf[ck] === gen) continue;
    closedGenBuf[ck] = gen;
    explored++;

    if (ck === goalKey) {
      const path: Array<{ x: number; y: number }> = [];
      let trace = ck;
      while (trace !== -1 && trace !== startKey) {
        const px = trace % gs;
        const py = (trace - px) / gs;
        path.push({ x: px, y: py });
        trace = cameFromBuf[trace];
      }
      path.reverse();
      return path;
    }

    const cx = ck % gs;
    const cy = (ck - cx) / gs;
    const curG = gScoreBuf[ck];

    for (let d = 0; d < 4; d++) {
      const nx = cx + CARDINAL_DX[d];
      const ny = cy + CARDINAL_DY[d];
      if (nx < 0 || ny < 0 || nx >= gs || ny >= gs) continue;
      const tileKind = state.tiles[ny][nx].kind;
      if (tileKind === 'VOID') continue;

      const nk = ny * gs + nx;
      if (closedGenBuf[nk] === gen) continue;

      // Soft penalty for stepping through impassable structures (allow start/goal/temple/altar/mine)
      let stepCost = 1.0;
      if (nk !== startKey && nk !== goalKey) {
        const occ = structureGrid[nk];
        if (occ !== null && occ.kind !== 'TEMPLE' && occ.kind !== 'ALTAR' && occ.kind !== 'BRIDGE_MINE') {
          stepCost = 6.0;
        }
      }

      const tentativeG = curG + stepCost;
      if (gGenBuf[nk] !== gen || tentativeG < gScoreBuf[nk]) {
        gGenBuf[nk] = gen;
        gScoreBuf[nk] = tentativeG;
        cameFromBuf[nk] = ck;
        const f = tentativeG + Math.abs(gx - nx) + Math.abs(gy - ny);

        // Ensure heap capacity if a pathological search pushes extra entries
        if (heapSize >= heapKeys.length) {
          const nextKeys = new Int32Array(heapKeys.length * 2);
          nextKeys.set(heapKeys);
          heapKeys = nextKeys;
          const nextF = new Float32Array(heapF.length * 2);
          nextF.set(heapF);
          heapF = nextF;
        }

        // Push to binary min-heap
        let idx = heapSize++;
        while (idx > 0) {
          const parent = (idx - 1) >> 1;
          if (f >= heapF[parent]) break;
          heapKeys[idx] = heapKeys[parent];
          heapF[idx] = heapF[parent];
          idx = parent;
        }
        heapKeys[idx] = nk;
        heapF[idx] = f;
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
