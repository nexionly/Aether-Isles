import {
  AERIAL_CATALOG,
  AETHER_OVERLOAD_TARGET,
  AI_FACTION_PROFILES,
  ALIGNMENT_COLORS,
  ALTAR_DOMINANCE_DURATION,
  FURY_META,
  PLAYER_POWER_BIT,
  STRUCTURE_CATALOG,
  TETROMINOES,
  TILE_H,
  TILE_W,
  directionVector,
  getFactionBit,
  getWorldIsoBounds,
  isAiFaction,
  isFactionId,
} from './catalog';
import { canPlaceBridge, canPlaceStructure, inBounds, isTilePoweredBy } from './pathfinding';
import { getSpriteAtlas, type ProcessedStructureSprite, type SpriteAtlas } from './sprites';
import type {
  AerialUnit,
  CaptureExplosion,
  Crystal,
  Direction,
  Geyser,
  Golem,
  ImpactEffect,
  IslandInfo,
  Owner,
  PlacementMode,
  Priest,
  Projectile,
  RangeOverlayState,
  Structure,
  Tile,
  VictoryCelebrationParticle,
  VictoryCelebrationRing,
  VictoryCelebrationState,
  WeatherState,
} from './types';
import { getLocalizedStormFactorAtIso } from './weather';
import { isoToTile, tileToIso, type WorldState } from './worldGen';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  shakeX: number;
  shakeY: number;
}

export interface RenderContextInfo {
  camera: CameraState;
  hoverTile: { tx: number; ty: number } | null;
  placement: PlacementMode;
  selectedId: number | null;
  selectedKind: 'STRUCTURE' | 'PRIEST' | 'GOLEM' | 'AERIAL' | 'GEYSER' | null;
  hoveredId: number | null;
  hoveredKind: 'STRUCTURE' | 'PRIEST' | 'GOLEM' | 'AERIAL' | 'GEYSER' | null;
  rangeOverlay: RangeOverlayState;
  time: number;
  victoryCelebration?: VictoryCelebrationState | null;
}

interface CloudInstance {
  x: number;
  y: number;
  scale: number;
  speed: number;
  layer: number;
  spriteIdx: number;
  alpha: number;
}

interface DistantIsletInstance {
  x: number;
  y: number;
  scale: number;
  bobSpeed: number;
  bobPhase: number;
  spriteIdx: number;
}

const CLOUDS: CloudInstance[] = Array.from({ length: 52 }, (_, i) => {
  const layer = i % 3;
  return {
    x: ((i * 541) % 6600) - 3300,
    y: ((i * 317) % 3400) - 260,
    scale: layer === 0 ? 1.95 : layer === 1 ? 1.3 : 0.88,
    speed: layer === 0 ? 4.2 : layer === 1 ? 8.2 : 13.5,
    layer,
    spriteIdx: i % 4,
    alpha: layer === 0 ? 0.64 : layer === 1 ? 0.74 : 0.78,
  };
});

const DISTANT_ISLETS: DistantIsletInstance[] = Array.from({ length: 16 }, (_, i) => ({
  x: ((i * 683) % 5200) - 2600,
  y: ((i * 397) % 2700) + 120,
  scale: 0.52 + (i % 4) * 0.22,
  bobSpeed: 0.45 + (i % 3) * 0.2,
  bobPhase: i * 1.7,
  spriteIdx: i % 3,
}));

// Offscreen caches for static full-viewport sky backdrop & sunbeam rays (rebuilt only on resize or fury change)
let skyBackdropCache: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fury: 'WIND' | 'RAIN' | 'THUNDER';
} | null = null;

let sunbeamCache: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
} | null = null;

let stormVignetteCache: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
} | null = null;

let stormTopBandCache: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
} | null = null;

const islandLabelAnchorCache = new WeakMap<object, { x: number; y: number }>();

// Reusable per-frame lookup collections (avoids Set/Map GC churn in renderWorld)
const reusableNearSacredSet = new Set<number>();
const reusableOccupiedTileSet = new Set<number>();
const reusableSacredSiteByIslandId = new Map<number, WorldState['sacredSites'][number]>();

// Bounded Pre-Baked Radial Glow Stamp Cache (replaces dozens of per-frame createRadialGradient calls)
const GLOW_STAMP_SIZE = 64;
const MAX_GLOW_STAMPS = 128;
const glowStampCache = new Map<string, HTMLCanvasElement>();

function getGlowStamp(
  innerColor: string,
  midColor: string | null,
  outerColor: string,
  midStop = 0.55
): HTMLCanvasElement {
  const key = `${innerColor}|${midColor ?? ''}|${outerColor}|${midStop}`;
  const existing = glowStampCache.get(key);
  if (existing) return existing;

  if (glowStampCache.size >= MAX_GLOW_STAMPS) {
    const oldest = glowStampCache.keys().next().value;
    if (oldest !== undefined) glowStampCache.delete(oldest);
  }

  const canvas = document.createElement('canvas');
  canvas.width = GLOW_STAMP_SIZE;
  canvas.height = GLOW_STAMP_SIZE;
  const gctx = canvas.getContext('2d');
  if (gctx) {
    const half = GLOW_STAMP_SIZE * 0.5;
    const grad = gctx.createRadialGradient(half, half, 1.5, half, half, half);
    grad.addColorStop(0, innerColor);
    if (midColor) {
      grad.addColorStop(midStop, midColor);
    }
    grad.addColorStop(1, outerColor);
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, GLOW_STAMP_SIZE, GLOW_STAMP_SIZE);
  }
  glowStampCache.set(key, canvas);
  return canvas;
}

function drawGlowCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
  innerColor: string,
  midColor: string | null,
  outerColor: string,
  midStop = 0.55
): void {
  if (radius <= 0.5 || alpha <= 0.005) return;
  const stamp = getGlowStamp(innerColor, midColor, outerColor, midStop);
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * Math.min(1, alpha);
  ctx.drawImage(stamp, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prevAlpha;
}

function drawGlowEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  alpha: number,
  innerColor: string,
  midColor: string | null,
  outerColor: string,
  midStop = 0.55
): void {
  if (rx <= 0.5 || ry <= 0.5 || alpha <= 0.005) return;
  const stamp = getGlowStamp(innerColor, midColor, outerColor, midStop);
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * Math.min(1, alpha);
  ctx.drawImage(stamp, x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = prevAlpha;
}

function getStormVignetteCanvas(width: number, height: number): HTMLCanvasElement {
  const cw = Math.max(1, Math.round(width * 0.5));
  const ch = Math.max(1, Math.round(height * 0.5));
  if (stormVignetteCache && stormVignetteCache.width === cw && stormVignetteCache.height === ch) {
    return stormVignetteCache.canvas;
  }
  const canvas = stormVignetteCache?.canvas ?? document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const vctx = canvas.getContext('2d');
  if (vctx) {
    vctx.clearRect(0, 0, cw, ch);
    const rOuter = Math.hypot(cw, ch) * 0.62;
    const vig = vctx.createRadialGradient(cw * 0.5, ch * 0.5, rOuter * 0.46, cw * 0.5, ch * 0.5, rOuter);
    vig.addColorStop(0, 'rgba(12, 22, 38, 0)');
    vig.addColorStop(1, 'rgba(10, 18, 34, 1)');
    vctx.fillStyle = vig;
    vctx.fillRect(0, 0, cw, ch);
  }
  stormVignetteCache = { canvas, width: cw, height: ch };
  return canvas;
}

function getStormTopBandCanvas(width: number, height: number): HTMLCanvasElement {
  const cw = Math.max(1, Math.round(width * 0.25));
  const ch = Math.max(1, Math.round(height * 0.55 * 0.5));
  if (stormTopBandCache && stormTopBandCache.width === cw && stormTopBandCache.height === ch) {
    return stormTopBandCache.canvas;
  }
  const canvas = stormTopBandCache?.canvas ?? document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const bctx = canvas.getContext('2d');
  if (bctx) {
    bctx.clearRect(0, 0, cw, ch);
    const grad = bctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, 'rgba(12, 20, 36, 1)');
    grad.addColorStop(1, 'rgba(12, 20, 36, 0)');
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, cw, ch);
  }
  stormTopBandCache = { canvas, width: cw, height: ch };
  return canvas;
}

// Per-Island Offscreen Terrain Cache (2 layers: cliffs/moss/stalactites & top turf/cobble/flagstone)
// Separating cliffs (Pass 1) and turf (Pass 3) around bridges (Pass 2) guarantees 100% exact
// isometric painter's depth order even across narrow 1-tile gaps between islands.
interface IslandWaterfallAnchor {
  x: number;
  y: number;
  fallH: number;
  seed: number;
}

interface CachedIslandTerrain {
  cliffCanvas: HTMLCanvasElement;
  turfCanvas: HTMLCanvasElement;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  minIsoX: number;
  maxIsoX: number;
  minIsoY: number;
  maxIsoY: number;
  sortedTiles: Array<{ x: number; y: number }>;
  rimTiles: Array<{ x: number; y: number }>;
  waterfalls: IslandWaterfallAnchor[];
  cliffEdgeHash: number;
  sacredHash: number;
  lastCheckedVersion: number;
}

const islandTerrainCache = new WeakMap<IslandInfo, CachedIslandTerrain>();

function getSkyBackdropCanvas(
  width: number,
  height: number,
  playerFury: 'WIND' | 'RAIN' | 'THUNDER'
): HTMLCanvasElement {
  const cw = Math.max(1, Math.round(width));
  const ch = Math.max(1, Math.round(height));
  if (
    skyBackdropCache &&
    skyBackdropCache.width === cw &&
    skyBackdropCache.height === ch &&
    skyBackdropCache.fury === playerFury
  ) {
    return skyBackdropCache.canvas;
  }

  const canvas = skyBackdropCache?.canvas ?? document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const bctx = canvas.getContext('2d');
  if (bctx) {
    // 1. Dual Sunlit Golden-Hour Sky & Eastern Rolling Storm Front
    const skyGrad = bctx.createLinearGradient(0, 0, cw, ch * 0.82);
    skyGrad.addColorStop(0, '#367ec7');
    skyGrad.addColorStop(0.28, '#5ea7df');
    skyGrad.addColorStop(0.54, '#79bce8');
    skyGrad.addColorStop(0.76, '#334d70');
    skyGrad.addColorStop(1, '#18273e');
    bctx.fillStyle = skyGrad;
    bctx.fillRect(0, 0, cw, ch);

    // Luminous sunlit lower-left cloud-horizon lift transitioning into eastern storm depth
    const horizonGrad = bctx.createLinearGradient(0, ch * 0.35, cw * 0.88, ch);
    horizonGrad.addColorStop(0, 'rgba(182, 224, 248, 0.38)');
    horizonGrad.addColorStop(0.48, 'rgba(218, 236, 248, 0.22)');
    horizonGrad.addColorStop(0.82, 'rgba(34, 52, 78, 0.24)');
    horizonGrad.addColorStop(1, 'rgba(20, 32, 52, 0.42)');
    bctx.fillStyle = horizonGrad;
    bctx.fillRect(0, 0, cw, ch);

    // Subtle Aspect atmospheric tint
    if (playerFury === 'RAIN') {
      bctx.fillStyle = 'rgba(56, 148, 212, 0.08)';
      bctx.fillRect(0, 0, cw, ch);
    } else if (playerFury === 'THUNDER') {
      bctx.fillStyle = 'rgba(88, 62, 138, 0.07)';
      bctx.fillRect(0, 0, cw, ch);
    }

    // Radiant golden-hour sun bloom in upper-left sky
    const sunX = cw * 0.1;
    const sunY = ch * 0.06;
    const sunGrad = bctx.createRadialGradient(sunX, sunY, 16, sunX, sunY, cw * 0.64);
    sunGrad.addColorStop(0, 'rgba(255, 250, 218, 0.56)');
    sunGrad.addColorStop(0.24, 'rgba(255, 240, 186, 0.24)');
    sunGrad.addColorStop(0.55, 'rgba(230, 244, 255, 0.1)');
    sunGrad.addColorStop(1, 'rgba(180, 215, 240, 0)');
    bctx.fillStyle = sunGrad;
    bctx.fillRect(0, 0, cw, ch);

    // Brooding upper-right thunderhead mass framing the storm edge
    const stormGrad = bctx.createRadialGradient(
      cw * 0.92,
      ch * 0.14,
      cw * 0.04,
      cw * 0.88,
      ch * 0.18,
      cw * 0.46
    );
    stormGrad.addColorStop(0, 'rgba(18, 28, 46, 0.72)');
    stormGrad.addColorStop(0.5, 'rgba(28, 42, 64, 0.42)');
    stormGrad.addColorStop(1, 'rgba(28, 42, 64, 0)');
    bctx.fillStyle = stormGrad;
    bctx.fillRect(0, 0, cw, ch);
  }

  skyBackdropCache = { canvas, width: cw, height: ch, fury: playerFury };
  return canvas;
}

function getSunbeamCanvas(width: number, height: number): HTMLCanvasElement {
  const cw = Math.max(1, Math.round(width * 0.5));
  const ch = Math.max(1, Math.round(height * 0.5));
  if (sunbeamCache && sunbeamCache.width === cw && sunbeamCache.height === ch) {
    return sunbeamCache.canvas;
  }

  const canvas = sunbeamCache?.canvas ?? document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const sctx = canvas.getContext('2d');
  if (sctx) {
    sctx.clearRect(0, 0, cw, ch);
    const originX = cw * 0.06;
    const originY = -ch * 0.08;
    const rays = [
      { angle: 0.42, spread: 0.085, len: 0.92 },
      { angle: 0.62, spread: 0.11, len: 1.04 },
      { angle: 0.84, spread: 0.09, len: 0.86 },
      { angle: 1.06, spread: 0.075, len: 0.74 },
    ];
    const diag = Math.hypot(cw, ch);

    for (const ray of rays) {
      const len = diag * ray.len;
      const x1 = originX + Math.cos(ray.angle - ray.spread * 0.5) * len;
      const y1 = originY + Math.sin(ray.angle - ray.spread * 0.5) * len;
      const x2 = originX + Math.cos(ray.angle + ray.spread * 0.5) * len;
      const y2 = originY + Math.sin(ray.angle + ray.spread * 0.5) * len;

      const grad = sctx.createLinearGradient(originX, originY, (x1 + x2) * 0.5, (y1 + y2) * 0.5);
      grad.addColorStop(0, 'rgba(255, 249, 214, 0.19)');
      grad.addColorStop(0.45, 'rgba(255, 242, 196, 0.085)');
      grad.addColorStop(1, 'rgba(255, 242, 196, 0)');

      sctx.fillStyle = grad;
      sctx.beginPath();
      sctx.moveTo(originX, originY);
      sctx.lineTo(x1, y1);
      sctx.lineTo(x2, y2);
      sctx.closePath();
      sctx.fill();
    }
  }

  sunbeamCache = { canvas, width: cw, height: ch };
  return canvas;
}

function getOwnerColor(state: WorldState, owner: Owner | null): string {
  if (!owner || owner === 'NEUTRAL') return '#f0b429';
  return state.factions[owner]?.color ?? '#ef4444';
}

function getFogState(state: WorldState, tx: number, ty: number): number {
  if (!state.victoryRules.fogOfWar) return 2;
  const gs = state.gridSize;
  const rx = Math.round(tx);
  const ry = Math.round(ty);
  if (rx < 0 || ry < 0 || rx >= gs || ry >= gs) return 0;
  return state.fogGrid[ry * gs + rx] ?? 0;
}

function isTileFogVisible(state: WorldState, tx: number, ty: number): boolean {
  return getFogState(state, tx, ty) >= 2;
}

function getPoweredAiVisual(
  state: WorldState,
  poweredMask: number
): { color: string; landTint: string } | null {
  for (const aiId of state.aiFactionIds) {
    if ((poweredMask & getFactionBit(aiId)) !== 0) {
      return AI_FACTION_PROFILES[aiId];
    }
  }
  return null;
}

export function worldToScreen(
  isoX: number,
  isoY: number,
  camera: CameraState,
  viewW: number,
  viewH: number
): { sx: number; sy: number } {
  return {
    sx: (isoX - camera.x + camera.shakeX) * camera.zoom + viewW * 0.5,
    sy: (isoY - camera.y + camera.shakeY) * camera.zoom + viewH * 0.5,
  };
}

export function screenToWorldIso(
  sx: number,
  sy: number,
  camera: CameraState,
  viewW: number,
  viewH: number
): { isoX: number; isoY: number } {
  return {
    isoX: (sx - viewW * 0.5) / camera.zoom + camera.x - camera.shakeX,
    isoY: (sy - viewH * 0.5) / camera.zoom + camera.y - camera.shakeY,
  };
}

function drawIsoDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w = TILE_W,
  h = TILE_H
): void {
  const hw = w * 0.5;
  const hh = h * 0.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: WorldState,
  info: RenderContextInfo
): void {
  const { camera, time } = info;
  const atlas = getSpriteAtlas();
  const playerColor = FURY_META[state.factions.PLAYER.fury].color;
  const gs = state.gridSize;

  // 1. Cached Dual Sunlit Golden-Hour Sky & Dynamic Weather Atmospheric Mood
  const playerFury = state.factions.PLAYER.fury;
  const weather = state.weather;
  const skyCanvas = getSkyBackdropCanvas(width, height, playerFury);
  ctx.drawImage(skyCanvas, 0, 0, width, height);

  // Smooth weather overcast & storm sky tint + subtle sheet-lightning sky brightening
  if (weather.overcast > 0.01 || weather.globalFlash > 0.01) {
    drawWeatherSkyAtmosphere(ctx, width, height, weather);
  }

  // Angled volumetric golden sunbeams streaming across the sunlit sky (dims smoothly under rain/storms)
  drawVolumetricSunbeams(ctx, width, height, time, weather.sunVisibility);

  // Periodic branching golden storm lightning crackling in the eastern thunderhead
  drawEasternStormFront(ctx, width, height, time, playerFury, weather.stormIntensity);

  // 2. World Camera Transform
  ctx.save();
  ctx.translate(width * 0.5, height * 0.5);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x + camera.shakeX, -camera.y + camera.shakeY);

  // Deep Abyss Layer: Culled Sunlit Cumulus / Weather-Reactive Storm Clouds + Distant Floating Islets + Soaring Sky-Birds
  drawParallaxClouds(ctx, atlas, time, camera, width, height, 0, weather);
  drawDistantIslets(ctx, atlas, time, camera, width, height);
  drawSkyBirds(ctx, time, camera, width, weather.sunVisibility);
  drawParallaxClouds(ctx, atlas, time, camera, width, height, 1, weather);

  // Compute visible world bounds for culling
  const pad = 260 / camera.zoom;
  const minIsoX = camera.x - (width * 0.5) / camera.zoom - pad;
  const maxIsoX = camera.x + (width * 0.5) / camera.zoom + pad;
  const minIsoY = camera.y - (height * 0.5) / camera.zoom - pad;
  const maxIsoY = camera.y + (height * 0.5) / camera.zoom + pad;

  // Tight visible isometric tile bounds so we never scan off-screen tiles
  const cTL = isoToTile(minIsoX, minIsoY);
  const cTR = isoToTile(maxIsoX, minIsoY);
  const cBL = isoToTile(minIsoX, maxIsoY);
  const cBR = isoToTile(maxIsoX, maxIsoY);
  const tileMargin = 3;
  const minTx = Math.max(0, Math.floor(Math.min(cTL.tx, cTR.tx, cBL.tx, cBR.tx)) - tileMargin);
  const maxTx = Math.min(gs - 1, Math.ceil(Math.max(cTL.tx, cTR.tx, cBL.tx, cBR.tx)) + tileMargin);
  const minTy = Math.max(0, Math.floor(Math.min(cTL.ty, cTR.ty, cBL.ty, cBR.ty)) - tileMargin);
  const maxTy = Math.min(gs - 1, Math.ceil(Math.max(cTL.ty, cTR.ty, cBL.ty, cBR.ty)) + tileMargin);

  // O(1) per-frame lookup sets (reused module-scoped collections to avoid GC churn)
  reusableNearSacredSet.clear();
  reusableOccupiedTileSet.clear();
  for (const s of state.structures) {
    reusableOccupiedTileSet.add(s.ty * gs + s.tx);
    if (s.kind === 'TEMPLE' || s.kind === 'ALTAR') {
      for (let dy = -1; dy <= 1; dy++) {
        const ny = s.ty + dy;
        if (ny < 0 || ny >= gs) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = s.tx + dx;
          if (nx >= 0 && nx < gs) {
            reusableNearSacredSet.add(ny * gs + nx);
          }
        }
      }
    }
  }
  for (const g of state.geysers) {
    reusableOccupiedTileSet.add(g.ty * gs + g.tx);
  }
  reusableSacredSiteByIslandId.clear();
  if (state.victoryRules.altarDominance) {
    for (const s of state.sacredSites) {
      reusableSacredSiteByIslandId.set(s.islandId, s);
    }
  }

  // 3. Draw Visible Floating Islands (Cached Offscreen Layers) & Vaulted Arched Stone Sky-Bridges
  // Collect visible islands once for Pass 1 (cliffs + waterfalls) and Pass 3 (turf + territory shimmer)
  const visibleIslands: Array<{ island: IslandInfo; cached: CachedIslandTerrain }> = [];
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    const cached = getCachedIslandTerrain(island, state, atlas, reusableNearSacredSet);
    if (
      cached.maxIsoX < minIsoX ||
      cached.minIsoX > maxIsoX ||
      cached.maxIsoY < minIsoY ||
      cached.minIsoY > maxIsoY
    ) {
      continue;
    }
    visibleIslands.push({ island, cached });
  }

  // Pass 1: Pre-baked Island Cliffs, Moss Overhangs & Stalactites + Live Animated Waterfalls
  for (let i = 0; i < visibleIslands.length; i++) {
    const { cached } = visibleIslands[i];
    ctx.drawImage(cached.cliffCanvas, cached.offsetX, cached.offsetY);
    const wfs = cached.waterfalls;
    for (let w = 0; w < wfs.length; w++) {
      const wf = wfs[w];
      if (wf.x < minIsoX || wf.x > maxIsoX || wf.y + wf.fallH < minIsoY || wf.y > maxIsoY) continue;
      drawCliffWaterfall(ctx, wf.x, wf.y, wf.fallH, time, wf.seed);
    }
  }

  // Pass 2: Visible Vaulted Arched Stone Sky-Bridges in Isometric Painter's Order
  const minSum = minTx + minTy;
  const maxSum = maxTx + maxTy;
  for (let sum = minSum; sum <= maxSum; sum++) {
    const startX = Math.max(minTx, sum - maxTy);
    const endX = Math.min(maxTx, sum - minTy);
    for (let x = startX; x <= endX; x++) {
      const y = sum - x;
      const tile = state.tiles[y][x];
      if (tile.kind !== 'BRIDGE') continue;

      const pos = tileToIso(x, y);
      if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
      drawBridgeTile(ctx, state, tile, pos.x, pos.y, time);
    }
  }

  // Pass 3: Pre-baked Island Top Turf/Cobble/Flagstone + Batched Dynamic Territory Shimmer & Sacred Runes
  for (let i = 0; i < visibleIslands.length; i++) {
    const { island, cached } = visibleIslands[i];
    ctx.drawImage(cached.turfCanvas, cached.offsetX, cached.offsetY);
    drawIslandDynamicOverlay(ctx, state, island, cached, reusableNearSacredSet, playerColor, time);
  }

  // 3b. Drifting Soft Cloud Shadows & Localized Storm Cell Ground Shadows + Isometric Rain Ripples
  drawCloudShadows(ctx, atlas, state, minIsoX, maxIsoX, minIsoY, maxIsoY, time, weather);
  if (weather.cells.length > 0) {
    drawLocalizedStormGroundShadows(ctx, atlas, weather, minIsoX, maxIsoX, minIsoY, maxIsoY);
  }
  if (weather.rainIntensity > 0.08 || weather.cells.length > 0) {
    drawIsometricRainSplashes(ctx, state, minTx, maxTx, minTy, maxTy, weather, time);
  }

  // 4. Sacred Temple Site Sanctuary Rings (Altar Dominance sites on Citadel & Shrines)
  drawSacredSiteRings(ctx, state, minIsoX, maxIsoX, minIsoY, maxIsoY, time);

  // 4b. Island Cartography Plates (warm illuminated serif labels beneath islands)
  ctx.textAlign = 'center';
  for (const island of state.islands) {
    let anchor = islandLabelAnchorCache.get(island);
    if (!anchor) {
      let sumX = 0;
      let maxY = -Infinity;
      for (const pt of island.tiles) {
        const p = tileToIso(pt.x, pt.y);
        sumX += p.x;
        if (p.y > maxY) maxY = p.y;
      }
      anchor = {
        x: island.tiles.length > 0 ? sumX / island.tiles.length : tileToIso(island.centerX, island.centerY).x,
        y: island.tiles.length > 0 ? maxY + 42 : tileToIso(island.centerX, island.centerY + 4.7).y + 22,
      };
      islandLabelAnchorCache.set(island, anchor);
    }
    const labelX = anchor.x;
    const labelY = anchor.y;
    if (labelX < minIsoX || labelX > maxIsoX || labelY < minIsoY || labelY > maxIsoY) continue;
    ctx.font = '700 11.5px "Cinzel", Georgia, serif';
    ctx.fillStyle = 'rgba(10, 20, 36, 0.82)';
    ctx.fillText(island.name, labelX + 1.2, labelY + 1.2);
    ctx.fillStyle =
      island.role === 'PLAYER_HOME'
        ? '#fef0c7'
        : island.role === 'AI_HOME'
          ? island.homeOwner && state.factions[island.homeOwner]?.eliminated
            ? '#cbd5e1'
            : getOwnerColor(state, island.homeOwner ?? null)
          : '#f1f7fd';
    ctx.fillText(island.name, labelX, labelY);

    // Subtle Sacred Site control tag beneath Citadel & Shrine names when Altar Dominance is active
    const site = reusableSacredSiteByIslandId.get(island.id);
    if (site) {
      let tagText = 'SACRED SITE';
      let tagColor = '#e6c478';
      if (site.guardedByNeutral) {
        tagText = 'SACRED SITE · GUARDED';
        tagColor = '#f5d08a';
      } else if (site.contested) {
        tagText = 'SACRED SITE · CONTESTED';
        tagColor = '#fbbf24';
      } else if (site.controller === 'PLAYER') {
        tagText = 'ALLIED SACRED SITE';
        tagColor = playerColor;
      } else if (site.controller) {
        tagText = `${state.factions[site.controller].label.toUpperCase()} SACRED SITE`;
        tagColor = getOwnerColor(state, site.controller);
      }
      ctx.font = '600 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(10, 20, 36, 0.88)';
      ctx.fillText(tagText, labelX + 1, labelY + 14);
      ctx.fillStyle = tagColor;
      ctx.fillText(tagText, labelX, labelY + 13);
    }
  }

  // 5. Tactical Elemental Range Overlay, Placement Ghost & Selected Range Overlays
  drawTacticalRangeOverlay(ctx, state, info);
  drawPlacementOverlay(ctx, atlas, state, info, playerColor);
  drawSelectedRangeOverlay(ctx, state, info, playerColor);

  // 6. Depth-Sorted Entities + Lush Oak Canopies, Highland Conifers & Mossy Boulders
  interface Renderable {
    depth: number;
    draw: () => void;
  }
  const renderables: Renderable[] = [];

  // Scenic Island Rim Oaks, Conifers & Mossy Boulders (placed only on empty visible perimeter land tiles)
  for (const island of state.islands) {
    const icx = Math.round(island.centerX);
    const icy = Math.round(island.centerY);
    for (const pt of island.tiles) {
      if (pt.x < minTx || pt.x > maxTx || pt.y < minTy || pt.y > maxTy) continue;
      const tile = state.tiles[pt.y][pt.x];
      if (tile.variant < 0.79) continue;
      // Keep central sacred plazas, cobbled roads, structures & geysers clean
      const dxC = pt.x - island.centerX;
      const dyC = pt.y - island.centerY;
      if (dxC * dxC + dyC * dyC < 4.6225) continue;
      if (pt.x === icx || pt.y === icy) continue;
      if (reusableOccupiedTileSet.has(pt.y * gs + pt.x)) continue;

      const pos = tileToIso(pt.x, pt.y);
      if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
      renderables.push({
        depth: pt.x + pt.y - 0.22,
        draw: () => drawScenicProp(ctx, pos.x, pos.y, tile.variant, time),
      });
    }
  }

  for (const g of state.geysers) {
    const pos = tileToIso(g.tx, g.ty);
    if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
    renderables.push({
      depth: g.tx + g.ty - 0.15,
      draw: () => drawGeyser(ctx, atlas, g, pos.x, pos.y, time),
    });
  }

  for (const c of state.crystals) {
    const cx = c.fromX + (c.x - c.fromX) * c.spawnAnim;
    const cy = c.fromY + (c.y - c.fromY) * c.spawnAnim;
    const pos = tileToIso(cx, cy);
    if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
    renderables.push({
      depth: cx + cy - 0.05,
      draw: () => drawCrystal(ctx, c, pos.x, pos.y, time),
    });
  }

  for (const s of state.structures) {
    if (s.owner !== 'PLAYER') {
      if (s.kind === 'BRIDGE_MINE') continue;
      if (!isTileFogVisible(state, s.tx, s.ty)) continue;
    }
    const pos = tileToIso(s.tx, s.ty);
    if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
    const isSelected = info.selectedKind === 'STRUCTURE' && info.selectedId === s.id;
    renderables.push({
      depth: s.tx + s.ty + 0.05,
      draw: () => drawStructure(ctx, atlas, state, s, pos.x, pos.y, time, isSelected),
    });
  }

  for (const g of state.golems) {
    if (g.owner !== 'PLAYER' && !isTileFogVisible(state, g.x, g.y)) continue;
    const pos = tileToIso(g.x, g.y);
    if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
    const isSelected = info.selectedKind === 'GOLEM' && info.selectedId === g.id;
    renderables.push({
      depth: g.x + g.y + 0.25,
      draw: () => drawGolem(ctx, atlas, state, g, pos.x, pos.y, time, isSelected),
    });
  }

  for (const p of state.priests) {
    if (p.state === 'CARRIED' || p.state === 'SACRIFICED') continue;
    if (p.owner !== 'PLAYER' && !isTileFogVisible(state, p.x, p.y)) continue;
    // Draw subtle dotted golden route for allied High Priest when marching to capture or returning to Altar
    if (p.owner === 'PLAYER' && p.state === 'ACTIVE' && p.targetPath.length > 0) {
      ctx.save();
      ctx.strokeStyle = p.carryingPriestId !== null ? '#fde047' : '#f0b429';
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      const startPos = tileToIso(p.x, p.y);
      ctx.moveTo(startPos.x, startPos.y);
      for (const step of p.targetPath) {
        const sp = tileToIso(step.x, step.y);
        ctx.lineTo(sp.x, sp.y);
      }
      ctx.stroke();
      ctx.restore();
    }
    const pos = tileToIso(p.x, p.y);
    if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
    const isSelected = info.selectedKind === 'PRIEST' && info.selectedId === p.id;
    renderables.push({
      depth: p.x + p.y + 0.3,
      draw: () => drawPriest(ctx, atlas, state, p, pos.x, pos.y, time, isSelected),
    });
  }

  renderables.sort((a, b) => a.depth - b.depth);
  for (const r of renderables) r.draw();

  // 6b. Linked Barrier Pylon Energy Fences
  drawEnergyFences(ctx, state, minIsoX, maxIsoX, minIsoY, maxIsoY, time);

  // 6c. Airborne Sky Fleet Units (soaring over islands & void!)
  for (const a of state.aerialUnits) {
    if (a.owner !== 'PLAYER' && !isTileFogVisible(state, a.x, a.y)) continue;
    const pos = tileToIso(a.x, a.y);
    if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
    const isSelected = info.selectedKind === 'AERIAL' && info.selectedId === a.id;
    drawAerialUnit(ctx, atlas, state, a, pos.x, pos.y, time, isSelected);
  }

  // 7. Projectiles, Lightning Arcs, Sacrifice Beams, Particles & Floating Text
  for (const proj of state.projectiles) {
    if (proj.owner !== 'PLAYER' && !isTileFogVisible(state, proj.x, proj.y)) continue;
    drawProjectile(ctx, proj, time);
  }

  for (const arc of state.lightningArcs) {
    drawLightningArc(ctx, arc);
  }

  for (const beam of state.sacrificeBeams) {
    drawSacrificeBeam(ctx, beam, time);
  }

  for (const exp of state.captureExplosions) {
    drawCaptureExplosion(ctx, exp);
  }

  for (const fx of state.impactEffects) {
    drawImpactEffect(ctx, fx);
  }

  // Dynamic celestial light shafts reacting to Aether Overload or Altar Dominance progress
  drawVictoryLightShafts(ctx, state, minIsoX, maxIsoX, minIsoY, maxIsoY, time);

  // 7b. Optional Viewport-Culled Fog of War Cloud Shroud
  if (state.victoryRules.fogOfWar) {
    drawFogOfWarOverlay(ctx, state, minTx, maxTx, minTy, maxTy, minIsoX, maxIsoX, minIsoY, maxIsoY, time);
  }

  for (const pt of state.particles) {
    if (!pt.active) continue;
    const pos = tileToIso(pt.x, pt.y);
    if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
    const ratio = Math.max(0, pt.life / pt.maxLife);
    ctx.globalAlpha = pt.alpha * ratio;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y - pt.z, pt.size * (0.45 + 0.55 * ratio), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const ft of state.floatingTexts) {
    const pos = tileToIso(ft.x, ft.y);
    if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
    const progress = 1 - ft.life / ft.maxLife;
    ctx.globalAlpha = Math.max(0, 1 - progress * progress);
    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(8, 15, 26, 0.9)';
    ctx.fillText(ft.text, pos.x + 1, pos.y - 34 - progress * 26 + 1);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, pos.x, pos.y - 34 - progress * 26);
  }
  ctx.globalAlpha = 1;

  // 7c. Localized Drifting Thunderstorm Cells (Rain Curtains, World-Space Forked Lightning & Storm Canopy)
  if (weather.cells.length > 0) {
    drawLocalizedStormCells(ctx, atlas, weather, minIsoX, maxIsoX, minIsoY, maxIsoY, time);
  }

  // High-altitude wispy foreground clouds & drifting golden sunlit lantern motes
  drawParallaxClouds(ctx, atlas, time, camera, width, height, 2, weather);
  drawAmbientSkyMotes(ctx, time, camera, width, height, weather.sunVisibility);

  ctx.restore();

  // 7d. Screen-Space Batched Rainfall, Wind-Swept Mist & Sheet-Lightning Atmosphere
  drawWeatherScreenOverlay(ctx, width, height, weather, camera, time);

  // 8. Screen-Space Victory Celebration Particle & Sigil Overlay (Aether Collection vs Altar Ritual)
  if (info.victoryCelebration) {
    drawVictoryCelebration(ctx, width, height, info.victoryCelebration, time);
  }
}

function drawVictoryCelebration(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cel: VictoryCelebrationState,
  time: number
): void {
  const minDim = Math.min(width, height);
  const fadeIn = Math.min(1, cel.elapsed / 0.45);
  const cx = width * 0.5;
  const cy = height * 0.5;

  ctx.save();

  // 1. Signature Ambient Backdrop Aura per Victory Type
  if (cel.theme === 'AETHER_COLLECTION') {
    // Rotating golden-amber prism sunburst rays behind the victory card
    const rayCount = 12;
    const outerR = Math.hypot(width, height) * 0.62;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time * 0.09);
    for (let i = 0; i < rayCount; i++) {
      const a = (i / rayCount) * Math.PI * 2;
      const spread = 0.085 + 0.02 * Math.sin(time * 1.6 + i);
      ctx.fillStyle = i % 3 === 0 ? '#67e8f9' : '#fde047';
      ctx.globalAlpha = (i % 2 === 0 ? 0.065 : 0.04) * fadeIn;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a - spread) * outerR, Math.sin(a - spread) * outerR);
      ctx.lineTo(Math.cos(a + spread) * outerR, Math.sin(a + spread) * outerR);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Soft golden core bloom
    ctx.globalAlpha = 0.14 * fadeIn;
    ctx.fillStyle = '#f0b429';
    ctx.beginPath();
    ctx.arc(cx, cy, minDim * 0.36, 0, Math.PI * 2);
    ctx.fill();
  } else if (cel.theme === 'ALTAR_RITUAL') {
    // Counter-rotating celestial Sanctuary Mandala framing the Altar Ritual victory
    const mandalaR = minDim * 0.41;
    const pulse = 0.85 + 0.15 * Math.sin(time * 2.1);

    // Amethyst sanctuary glow halo
    ctx.globalAlpha = 0.13 * fadeIn * pulse;
    ctx.fillStyle = '#a855f7';
    ctx.beginPath();
    ctx.arc(cx, cy, mandalaR * 1.12, 0, Math.PI * 2);
    ctx.fill();

    // Outer rotating rune circle
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time * 0.14);
    ctx.strokeStyle = '#c084fc';
    ctx.globalAlpha = 0.34 * fadeIn * pulse;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, mandalaR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#f0b429';
    ctx.globalAlpha = 0.24 * fadeIn;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.arc(0, 0, mandalaR * 1.07, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 12 carved ritual ticks & diamond nodes along outer ring
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const inner = mandalaR * 0.93;
      const outer = mandalaR * 1.04;
      ctx.strokeStyle = i % 3 === 0 ? '#fde047' : '#e879f9';
      ctx.globalAlpha = (i % 3 === 0 ? 0.55 : 0.32) * fadeIn;
      ctx.lineWidth = i % 3 === 0 ? 2 : 1.3;
      ctx.beginPath();
      ctx.moveTo(cos * inner, sin * inner);
      ctx.lineTo(cos * outer, sin * outer);
      ctx.stroke();

      if (i % 3 === 0) {
        const dx = cos * mandalaR;
        const dy = sin * mandalaR;
        ctx.fillStyle = '#fef08a';
        ctx.globalAlpha = 0.72 * fadeIn;
        ctx.beginPath();
        ctx.moveTo(dx, dy - 5);
        ctx.lineTo(dx + 4, dy);
        ctx.lineTo(dx, dy + 5);
        ctx.lineTo(dx - 4, dy);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();

    // Inner counter-rotating sacred 8-point altar star
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-time * 0.2);
    const innerR = mandalaR * 0.84;
    ctx.strokeStyle = '#f0b429';
    ctx.globalAlpha = 0.26 * fadeIn * pulse;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.stroke();

    for (let s = 0; s < 2; s++) {
      ctx.beginPath();
      const offset = (s * Math.PI) / 4;
      for (let k = 0; k < 4; k++) {
        const a = offset + (k * Math.PI) / 2;
        const px = Math.cos(a) * innerR;
        const py = Math.sin(a) * innerR;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = s === 0 ? '#c084fc' : '#f0b429';
      ctx.globalAlpha = 0.2 * fadeIn;
      ctx.stroke();
    }
    ctx.restore();
  } else {
    // Temple Siege warm triumph corona
    ctx.globalAlpha = 0.11 * fadeIn;
    ctx.fillStyle = cel.primaryColor;
    ctx.beginPath();
    ctx.arc(cx, cy, minDim * 0.34, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Expanding Thematic Resonance Rings
  for (const ring of cel.rings) {
    drawVictoryRing(ctx, width, height, minDim, ring);
  }

  // 3. Celebratory Particles (Faceted Aether Crystals, Ritual Wisps & Runes, Starlight Fireworks)
  for (const pt of cel.particles) {
    drawVictoryParticle(ctx, width, height, pt, cel.elapsed);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawVictoryRing(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  minDim: number,
  ring: VictoryCelebrationRing
): void {
  const ease = 1 - Math.pow(1 - ring.progress, 3);
  const fade = Math.max(0, 1 - ring.progress);
  const radius = Math.max(8, ring.maxRadius * minDim * ease);
  const x = ring.nx * width;
  const y = ring.ny * height;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ring.rotation);

  if (ring.style === 'CRYSTAL_PRISM') {
    // Rotating faceted diamond/octagonal Aether prism wave
    const drawOctagon = (r: number) => {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rr = i % 2 === 0 ? r : r * 0.88;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    ctx.strokeStyle = ring.color;
    ctx.globalAlpha = 0.72 * fade;
    ctx.lineWidth = 2.6 * fade + 0.8;
    drawOctagon(radius);
    ctx.stroke();

    ctx.strokeStyle = ring.secondaryColor;
    ctx.globalAlpha = 0.48 * fade;
    ctx.lineWidth = 1.4;
    drawOctagon(radius * 0.82);
    ctx.stroke();

    // 4 sparkling crystal nodes at major vertices
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.85 * fade;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const vx = Math.cos(a) * radius;
      const vy = Math.sin(a) * radius;
      const s = 4.2 * fade + 1.2;
      ctx.beginPath();
      ctx.moveTo(vx, vy - s);
      ctx.lineTo(vx + s * 0.65, vy);
      ctx.lineTo(vx, vy + s);
      ctx.lineTo(vx - s * 0.65, vy);
      ctx.closePath();
      ctx.fill();
    }
  } else if (ring.style === 'RITUAL_SIGIL') {
    // Double sacred altar circle with 6 orbiting rune orbs
    ctx.strokeStyle = ring.color;
    ctx.globalAlpha = 0.68 * fade;
    ctx.lineWidth = 2.2 * fade + 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = ring.secondaryColor;
    ctx.globalAlpha = 0.52 * fade;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const ox = Math.cos(a) * radius;
      const oy = Math.sin(a) * radius;
      ctx.fillStyle = i % 2 === 0 ? ring.secondaryColor : '#ffffff';
      ctx.globalAlpha = 0.82 * fade;
      ctx.beginPath();
      ctx.arc(ox, oy, 2.8 * fade + 1, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Siege firework starburst ring
    ctx.strokeStyle = ring.color;
    ctx.globalAlpha = 0.62 * fade;
    ctx.lineWidth = 2.4 * fade + 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = ring.secondaryColor;
    ctx.globalAlpha = 0.42 * fade;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawVictoryParticle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pt: VictoryCelebrationParticle,
  elapsed: number
): void {
  const lifeRatio = Math.max(0, Math.min(1, pt.life / pt.maxLife));
  // Smooth fade-in and graceful fade-out
  const alphaEnv = Math.min(1, (1 - lifeRatio) * 6) * Math.min(1, lifeRatio * 2.2);
  const twinkle = 0.72 + 0.28 * Math.sin(elapsed * pt.twinkleSpeed + pt.swayPhase);
  const alpha = alphaEnv * twinkle;
  if (alpha <= 0.01) return;

  const x = pt.nx * width;
  const y = pt.ny * height;
  const s = pt.size * (0.62 + 0.38 * Math.min(1, lifeRatio * 1.6));

  ctx.save();
  ctx.translate(x, y);

  if (pt.shape === 'CRYSTAL') {
    // Faceted 3D-style Aether Crystal Shard with bright specular left facet
    ctx.rotate(pt.rotation);

    // Subtle outer golden/cyan aura halo
    ctx.fillStyle = pt.color;
    ctx.globalAlpha = alpha * 0.24;
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.45, 0, Math.PI * 2);
    ctx.fill();

    // Full elongated diamond crystal silhouette
    ctx.globalAlpha = alpha * 0.94;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.35);
    ctx.lineTo(s * 0.72, -s * 0.12);
    ctx.lineTo(0, s * 1.25);
    ctx.lineTo(-s * 0.72, -s * 0.12);
    ctx.closePath();
    ctx.fill();

    // Bright upper-left specular facet
    ctx.fillStyle = pt.coreColor;
    ctx.globalAlpha = alpha * 0.78;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.35);
    ctx.lineTo(0, -s * 0.05);
    ctx.lineTo(-s * 0.72, -s * 0.12);
    ctx.closePath();
    ctx.fill();

    // Crisp rim highlight
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = alpha * 0.55;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.35);
    ctx.lineTo(s * 0.72, -s * 0.12);
    ctx.lineTo(0, s * 1.25);
    ctx.lineTo(-s * 0.72, -s * 0.12);
    ctx.closePath();
    ctx.stroke();
  } else if (pt.shape === 'WISP') {
    // Ascending ethereal ceremonial altar flame / spirit wisp
    const tilt = Math.max(-0.35, Math.min(0.35, pt.vx * 2.2));
    ctx.rotate(tilt);

    // Soft outer violet/gold aura
    ctx.fillStyle = pt.color;
    ctx.globalAlpha = alpha * 0.26;
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.65, 0, Math.PI * 2);
    ctx.fill();

    // Teardrop flame body pointing upward
    ctx.fillStyle = pt.color;
    ctx.globalAlpha = alpha * 0.88;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.45);
    ctx.quadraticCurveTo(s * 0.85, -s * 0.1, 0, s * 0.95);
    ctx.quadraticCurveTo(-s * 0.85, -s * 0.1, 0, -s * 1.45);
    ctx.closePath();
    ctx.fill();

    // Luminous inner soul core
    ctx.fillStyle = pt.coreColor;
    ctx.globalAlpha = alpha * 0.9;
    ctx.beginPath();
    ctx.arc(0, s * 0.12, s * 0.36, 0, Math.PI * 2);
    ctx.fill();
  } else if (pt.shape === 'RUNE') {
    // Floating carved Altar Ritual rune sigil
    ctx.rotate(pt.rotation);

    ctx.fillStyle = pt.color;
    ctx.globalAlpha = alpha * 0.18;
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = pt.color;
    ctx.globalAlpha = alpha * 0.92;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const r = s * 0.85;
    ctx.beginPath();
    if (pt.runeVariant === 0) {
      // Sacred diamond & vertical pillar
      ctx.moveTo(0, -r * 1.2);
      ctx.lineTo(0, r * 1.2);
      ctx.moveTo(0, -r * 0.72);
      ctx.lineTo(r * 0.68, 0);
      ctx.lineTo(0, r * 0.72);
      ctx.lineTo(-r * 0.68, 0);
      ctx.closePath();
    } else if (pt.runeVariant === 1) {
      // Altar chalice / crescent sigil
      ctx.moveTo(-r * 0.72, -r * 0.75);
      ctx.lineTo(0, 0);
      ctx.lineTo(r * 0.72, -r * 0.75);
      ctx.moveTo(0, 0);
      ctx.lineTo(0, r * 1.05);
      ctx.moveTo(-r * 0.5, r * 0.55);
      ctx.lineTo(r * 0.5, r * 0.55);
    } else if (pt.runeVariant === 2) {
      // Double ascending chevron
      ctx.moveTo(-r * 0.7, r * 0.15);
      ctx.lineTo(0, -r * 0.85);
      ctx.lineTo(r * 0.7, r * 0.15);
      ctx.moveTo(-r * 0.5, r * 0.85);
      ctx.lineTo(0, r * 0.05);
      ctx.lineTo(r * 0.5, r * 0.85);
    } else {
      // Sanctuary starburst cross
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.moveTo(-r * 0.75, 0);
      ctx.lineTo(r * 0.75, 0);
      ctx.moveTo(-r * 0.45, -r * 0.45);
      ctx.lineTo(r * 0.45, r * 0.45);
    }
    ctx.stroke();

    // Glowing gold core dot
    ctx.fillStyle = pt.coreColor;
    ctx.globalAlpha = alpha * 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (pt.shape === 'STAR') {
    // 4-point celestial sparkle star
    ctx.rotate(pt.rotation);
    ctx.fillStyle = pt.color;
    ctx.globalAlpha = alpha * 0.95;
    const outer = s * 1.3;
    const inner = s * 0.28;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rad = i % 2 === 0 ? outer : inner;
      const px = Math.cos(a) * rad;
      const py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = alpha * 0.85;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Streaking energy spark with velocity tail
    const tailX = -pt.vx * width * 0.032;
    const tailY = -pt.vy * height * 0.032;
    ctx.strokeStyle = pt.color;
    ctx.globalAlpha = alpha * 0.72;
    ctx.lineWidth = Math.max(1.4, s * 0.52);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    ctx.fillStyle = pt.coreColor;
    ctx.globalAlpha = alpha * 0.95;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.6, s * 0.45), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawSacredSiteRings(
  ctx: CanvasRenderingContext2D,
  state: WorldState,
  minIsoX: number,
  maxIsoX: number,
  minIsoY: number,
  maxIsoY: number,
  time: number
): void {
  if (!state.victoryRules.altarDominance) return;
  for (const site of state.sacredSites) {
    const pos = tileToIso(site.tx, site.ty);
    if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;

    const rx = (site.role === 'CITADEL' ? 2.55 : 2.15) * TILE_W * 0.5;
    const ry = rx * 0.5;
    const col = site.controller
      ? getOwnerColor(state, site.controller)
      : site.contested
        ? '#f59e0b'
        : '#e6c478';
    const pulse = 0.72 + 0.28 * Math.sin(time * (site.contested ? 6.5 : 2.6) + site.islandId);

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // Subtle luminous floor tint when exclusively claimed
    if (site.controller) {
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.1 + 0.04 * pulse;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Outer carved sanctuary ring
    ctx.strokeStyle = col;
    ctx.globalAlpha = site.controller ? 0.68 * pulse : site.contested ? 0.78 * pulse : 0.36;
    ctx.lineWidth = site.controller ? 2.2 : site.contested ? 2.0 : 1.4;
    if (!site.controller) {
      ctx.setLineDash(site.contested ? [7, 5] : [10, 7]);
    }
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Inner rotating runic cardinal ticks
    ctx.globalAlpha = site.controller ? 0.52 : 0.24;
    ctx.lineWidth = 1.2;
    const rot = time * (site.controller ? 0.45 : 0.14);
    for (let i = 0; i < 4; i++) {
      const a0 = rot + (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 0.86, ry * 0.86, 0, a0, a0 + 0.42);
      ctx.stroke();
    }

    // Active Altar Dominance sweeping progress arc when this faction is counting down
    if (site.controller) {
      const domSec = state.factions[site.controller]?.dominanceSeconds ?? 0;
      const ratio = Math.min(1, domSec / ALTAR_DOMINANCE_DURATION);
      if (ratio > 0.01) {
        ctx.strokeStyle = '#fef08a';
        ctx.globalAlpha = 0.92;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx + 4, ry + 2, 0, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * ratio);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

function drawWeatherSkyAtmosphere(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  weather: WeatherState
): void {
  if (weather.overcast > 0.01) {
    // Cool steel-slate sky darkening as rain and storm clouds gather
    const alpha = Math.min(0.5, weather.overcast * 0.4 + weather.stormIntensity * 0.14);
    ctx.fillStyle = `rgba(18, 30, 50, ${alpha.toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);

    if (weather.stormIntensity > 0.06) {
      // Brooding upper sky storm-band (pre-baked linear gradient canvas)
      const topBand = getStormTopBandCanvas(width, height);
      ctx.save();
      ctx.globalAlpha = weather.stormIntensity * 0.34;
      ctx.drawImage(topBand, 0, 0, width, height * 0.55);
      ctx.restore();
    }
  }

  if (weather.globalFlash > 0.01) {
    ctx.fillStyle = `rgba(214, 234, 255, ${(weather.globalFlash * 0.15).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
  }
}

function drawVolumetricSunbeams(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  sunVisibility: number
): void {
  if (sunVisibility <= 0.03) return;
  const cached = getSunbeamCanvas(width, height);
  const shimmer = (0.78 + 0.22 * Math.sin(time * 0.45)) * sunVisibility;
  ctx.save();
  ctx.globalAlpha = shimmer;
  ctx.drawImage(cached, 0, 0, width, height);
  ctx.restore();
}

function drawEasternStormFront(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  playerFury: 'WIND' | 'RAIN' | 'THUNDER',
  stormIntensity: number
): void {
  // Periodic branching golden-amber lightning forks crackling in the eastern thunderclouds
  const cyclePeriod = playerFury === 'THUNDER' ? 4.4 : 6.2;
  const cycleIdx = Math.floor(time / cyclePeriod);
  const localT = (time % cyclePeriod) / cyclePeriod;
  const rawFlashEnv =
    localT < 0.065
      ? Math.sin((localT / 0.065) * Math.PI)
      : localT > 0.085 && localT < 0.13
        ? Math.sin(((localT - 0.085) / 0.045) * Math.PI) * 0.72
        : 0;

  const flashEnv = rawFlashEnv * (0.48 + stormIntensity * 0.65);
  if (flashEnv <= 0.02) return;

  const anchorX = width * (0.76 + ((cycleIdx * 37) % 18) * 0.01);
  const anchorY = height * (0.04 + ((cycleIdx * 23) % 10) * 0.01);

  // Internal cloud illumination glow behind the lightning fork (cached glow stamp)
  drawGlowCircle(
    ctx,
    anchorX,
    anchorY + height * 0.12,
    width * 0.24,
    flashEnv * 0.38,
    'rgba(255, 224, 130, 0.9)',
    'rgba(245, 176, 65, 0.38)',
    'rgba(245, 176, 65, 0)',
    0.55
  );

  // Deterministic forked golden bolt path
  const segs = 7;
  const pts: Array<{ x: number; y: number }> = [{ x: anchorX, y: anchorY }];
  let px = anchorX;
  let py = anchorY;
  for (let i = 1; i <= segs; i++) {
    const hash = Math.sin(cycleIdx * 91.7 + i * 17.3);
    px += hash * 28 + 5;
    py += (height * 0.28) / segs + Math.abs(hash) * 8;
    pts.push({ x: px, y: py });
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Outer warm golden lightning bloom
  ctx.strokeStyle = `rgba(247, 189, 72, ${flashEnv * 0.75})`;
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();

  // Secondary branch fork
  const forkStart = pts[2];
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(forkStart.x, forkStart.y);
  ctx.lineTo(forkStart.x - 26, forkStart.y + 34);
  ctx.lineTo(forkStart.x - 16, forkStart.y + 62);
  ctx.moveTo(pts[4].x, pts[4].y);
  ctx.lineTo(pts[4].x + 24, pts[4].y + 28);
  ctx.stroke();

  // Crisp white-gold lightning core
  ctx.strokeStyle = `rgba(255, 252, 232, ${flashEnv * 0.96})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();
}

function drawParallaxClouds(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  time: number,
  camera: CameraState,
  viewW: number,
  viewH: number,
  layer: number,
  weather: WeatherState
): void {
  const parallax = layer === 0 ? 0.28 : layer === 1 ? 0.52 : 1.15;
  const invZoom = 1 / Math.max(0.35, camera.zoom);
  const halfWorldW = viewW * 0.5 * invZoom;
  const halfWorldH = viewH * 0.5 * invZoom;
  const visCenterX = camera.x * parallax;
  const visCenterY = camera.y * parallax;

  ctx.save();
  ctx.translate(camera.x * (1 - parallax), camera.y * (1 - parallax));

  for (let i = 0; i < CLOUDS.length; i++) {
    const c = CLOUDS[i];
    if (c.layer !== layer) continue;
    const cx = ((c.x + time * c.speed + 2800) % 5200) - 2600;
    const cy = c.y;

    const halfW = 210 * c.scale;
    const halfH = 105 * c.scale;
    if (
      cx + halfW < visCenterX - halfWorldW ||
      cx - halfW > visCenterX + halfWorldW ||
      cy + halfH < visCenterY - halfWorldH ||
      cy - halfH > visCenterY + halfWorldH
    ) {
      continue;
    }

    // Smoothly crossfade from sunlit cumulus to brooding storm clouds as overcast deepens
    const relScreenX = cx - visCenterX;
    const isEasternStorm = layer !== 2 && relScreenX > halfWorldW * 0.14;
    const cloudOrder = ((i * 37) % 100) / 100;
    const stormBlend = isEasternStorm
      ? 1
      : Math.max(0, Math.min(1, (weather.overcast * 1.15 - cloudOrder * 0.72) * 2.2));

    const sunSprite = atlas.sunlitClouds[c.spriteIdx % atlas.sunlitClouds.length];
    const stormSprite = atlas.stormClouds[c.spriteIdx % atlas.stormClouds.length];
    const w = sunSprite.width * c.scale;
    const h = sunSprite.height * c.scale;
    const baseAlpha =
      layer === 2
        ? 0.13 + weather.overcast * 0.11
        : isEasternStorm
          ? Math.min(0.9, c.alpha + 0.12)
          : c.alpha + weather.overcast * 0.08;

    if (stormBlend <= 0.02) {
      ctx.globalAlpha = baseAlpha;
      ctx.drawImage(sunSprite, cx - w * 0.5, cy - h * 0.5, w, h);
    } else if (stormBlend >= 0.98) {
      ctx.globalAlpha = Math.min(0.92, baseAlpha + (layer === 2 ? 0.04 : 0.08));
      ctx.drawImage(stormSprite, cx - w * 0.5, cy - h * 0.5, w, h);
    } else {
      ctx.globalAlpha = baseAlpha * (1 - stormBlend);
      ctx.drawImage(sunSprite, cx - w * 0.5, cy - h * 0.5, w, h);
      ctx.globalAlpha = Math.min(0.92, baseAlpha + 0.06) * stormBlend;
      ctx.drawImage(stormSprite, cx - w * 0.5, cy - h * 0.5, w, h);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawDistantIslets(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  time: number,
  camera: CameraState,
  viewW: number,
  viewH: number
): void {
  const parallax = 0.4;
  const invZoom = 1 / Math.max(0.35, camera.zoom);
  const halfWorldW = viewW * 0.5 * invZoom;
  const halfWorldH = viewH * 0.5 * invZoom;
  const visCenterX = camera.x * parallax;
  const visCenterY = camera.y * parallax;

  ctx.save();
  ctx.translate(camera.x * (1 - parallax), camera.y * (1 - parallax));
  for (const isl of DISTANT_ISLETS) {
    const sprite = atlas.distantIslets[isl.spriteIdx];
    const w = sprite.width * isl.scale;
    const h = sprite.height * isl.scale;
    if (
      isl.x + w * 0.5 < visCenterX - halfWorldW ||
      isl.x - w * 0.5 > visCenterX + halfWorldW ||
      isl.y + h * 0.5 + 8 < visCenterY - halfWorldH ||
      isl.y - h * 0.5 - 8 > visCenterY + halfWorldH
    ) {
      continue;
    }
    const bob = Math.sin(time * isl.bobSpeed + isl.bobPhase) * 6;
    ctx.drawImage(sprite, isl.x - w * 0.5, isl.y + bob - h * 0.5, w, h);
  }
  ctx.restore();
}

function drawCliffWaterfall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fallH: number,
  time: number,
  seed: number
): void {
  // Foaming turquoise-white water crest spilling over the mossy rock lip
  ctx.fillStyle = 'rgba(232, 252, 255, 0.9)';
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 7.5, 3.2, 0.22, 0, Math.PI * 2);
  ctx.fill();

  // Main cascading luminous turquoise water ribbon
  const wfGrad = ctx.createLinearGradient(x, y, x, y + fallH);
  wfGrad.addColorStop(0, 'rgba(220, 250, 255, 0.9)');
  wfGrad.addColorStop(0.28, 'rgba(116, 214, 245, 0.72)');
  wfGrad.addColorStop(0.72, 'rgba(84, 184, 232, 0.36)');
  wfGrad.addColorStop(1, 'rgba(218, 242, 255, 0)');
  ctx.fillStyle = wfGrad;
  ctx.beginPath();
  ctx.moveTo(x - 6, y);
  ctx.lineTo(x + 6, y + 3);
  ctx.lineTo(x + 4.5, y + fallH);
  ctx.lineTo(x - 4.5, y + fallH);
  ctx.closePath();
  ctx.fill();

  // Secondary glistening spray streaks racing downward
  const s1 = (time * 48 + seed * 37) % (fallH * 0.72);
  const s2 = (time * 62 + seed * 83 + 22) % (fallH * 0.75);
  const s3 = (time * 40 + seed * 51 + 41) % (fallH * 0.68);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.fillRect(x - 3.6, y + 2 + s1, 1.8, 12);
  ctx.fillRect(x + 0.4, y + 4 + s2, 2.1, 14);
  ctx.fillRect(x + 3.2, y + 3 + s3, 1.4, 9);

  // Swirling sunlit white mist plumes blooming at the bottom of the cascade (cached glow stamp)
  const puffPulse = Math.sin(time * 2.6 + seed * 11) * 2.4;
  const mistY = y + fallH * 0.76;
  drawGlowEllipse(
    ctx,
    x,
    mistY,
    18 + puffPulse,
    10.5 + puffPulse * 0.5,
    0.66,
    'rgba(246, 252, 255, 0.95)',
    'rgba(222, 242, 255, 0.44)',
    'rgba(222, 242, 255, 0)',
    0.55
  );
}

function drawLandTileCliffs(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  cx: number,
  cy: number,
  southVoid: boolean,
  eastVoid: boolean
): void {
  const hw = TILE_W * 0.5;
  const hh = TILE_H * 0.5;
  const cliffDepth = 36 + tile.variant * 24;

  // Faceted Warm Ochre-Sandstone & Slate Craggy Floating Island Undersides
  if (southVoid) {
    // Base slate-shadow cliff mass
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx, cy + hh + cliffDepth);
    ctx.lineTo(cx - hw * 0.44, cy + hh + cliffDepth * 0.92 + tile.variant * 12);
    ctx.lineTo(cx - hw, cy + cliffDepth * 0.7);
    ctx.closePath();
    ctx.fillStyle = '#5c606c';
    ctx.fill();

    // Warm sunlit ochre-sandstone upper rock band
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx, cy + hh + cliffDepth * 0.52);
    ctx.lineTo(cx - hw * 0.46, cy + hh * 0.52 + cliffDepth * 0.5);
    ctx.lineTo(cx - hw, cy + cliffDepth * 0.46);
    ctx.closePath();
    ctx.fillStyle = '#a8875b';
    ctx.fill();

    // Sunlit ochre cliff ridge highlight facet
    ctx.fillStyle = 'rgba(238, 206, 152, 0.32)';
    ctx.beginPath();
    ctx.moveTo(cx - hw + 2, cy + 4);
    ctx.lineTo(cx - hw * 0.48, cy + hh * 0.52 + 4);
    ctx.lineTo(cx - hw * 0.54, cy + hh * 0.52 + cliffDepth * 0.56);
    ctx.lineTo(cx - hw + 2, cy + cliffDepth * 0.52);
    ctx.closePath();
    ctx.fill();

    // Crisp faceted rock strata cracks
    ctx.strokeStyle = 'rgba(42, 32, 24, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - hw + 3, cy + 12);
    ctx.lineTo(cx - 2, cy + hh + 12);
    ctx.moveTo(cx - hw + 6, cy + 24);
    ctx.lineTo(cx - 5, cy + hh + 26);
    ctx.moveTo(cx - hw * 0.5, cy + hh * 0.5 + 4);
    ctx.lineTo(cx - hw * 0.45, cy + hh + cliffDepth * 0.85);
    ctx.stroke();

    // Lush overhanging sunlit emerald moss & hanging vine lip
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx, cy + hh + 6.2);
    ctx.lineTo(cx - hw * 0.32, cy + hh * 0.68 + 8.5);
    ctx.lineTo(cx - hw * 0.62, cy + hh * 0.38 + 5.2);
    ctx.lineTo(cx - hw, cy + 4.5);
    ctx.closePath();
    ctx.fillStyle = '#5da838';
    ctx.fill();

    // Chartreuse sunlit grass fringe on the upper lip
    ctx.strokeStyle = '#9be04a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - hw + 1, cy + 1);
    ctx.lineTo(cx - 1, cy + hh + 1);
    ctx.stroke();

    // Dramatic tapered crag stalactite shard beneath rim
    if (tile.variant > 0.3) {
      ctx.beginPath();
      ctx.moveTo(cx - hw * 0.78, cy + cliffDepth * 0.64);
      ctx.lineTo(cx - hw * 0.36, cy + hh + cliffDepth + 22 * tile.variant);
      ctx.lineTo(cx - hw * 0.04, cy + hh + cliffDepth * 0.85);
      ctx.closePath();
      ctx.fillStyle = '#474f5e';
      ctx.fill();
    }
  }

  if (eastVoid) {
    // Cool deep-slate eastern underside mass
    ctx.beginPath();
    ctx.moveTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx, cy + hh + cliffDepth);
    ctx.lineTo(cx + hw * 0.46, cy + hh + cliffDepth * 0.86 + tile.variant * 10);
    ctx.lineTo(cx + hw, cy + cliffDepth * 0.68);
    ctx.closePath();
    ctx.fillStyle = '#384356';
    ctx.fill();

    // Upper weathered limestone rim band
    ctx.beginPath();
    ctx.moveTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx, cy + hh + cliffDepth * 0.46);
    ctx.lineTo(cx + hw, cy + cliffDepth * 0.44);
    ctx.closePath();
    ctx.fillStyle = '#62636b';
    ctx.fill();

    // Cool vertical cliff seam shading
    ctx.strokeStyle = 'rgba(20, 28, 42, 0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + hw * 0.48, cy + hh * 0.52 + 4);
    ctx.lineTo(cx + hw * 0.46, cy + hh + cliffDepth * 0.82);
    ctx.stroke();

    // Shaded lush emerald turf overhang lip
    ctx.beginPath();
    ctx.moveTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx, cy + hh + 5.8);
    ctx.lineTo(cx + hw * 0.44, cy + hh * 0.56 + 7.5);
    ctx.lineTo(cx + hw, cy + 4.2);
    ctx.closePath();
    ctx.fillStyle = '#3c7a34';
    ctx.fill();

    if (tile.variant < 0.58) {
      ctx.beginPath();
      ctx.moveTo(cx + hw * 0.1, cy + hh + cliffDepth * 0.85);
      ctx.lineTo(cx + hw * 0.44, cy + hh + cliffDepth + 18 * (1 - tile.variant));
      ctx.lineTo(cx + hw * 0.78, cy + cliffDepth * 0.62);
      ctx.closePath();
      ctx.fillStyle = '#2d394d';
      ctx.fill();
    }
  }
}

function computeIslandEdgeHash(
  rimTiles: Array<{ x: number; y: number }>,
  state: WorldState
): number {
  const gs = state.gridSize;
  let h = 2166136261;
  for (let i = 0; i < rimTiles.length; i++) {
    const pt = rimTiles[i];
    const southVoid = !inBounds(pt.x, pt.y + 1, gs) || state.tiles[pt.y + 1][pt.x].kind === 'VOID' ? 1 : 0;
    const eastVoid = !inBounds(pt.x + 1, pt.y, gs) || state.tiles[pt.y][pt.x + 1].kind === 'VOID' ? 2 : 0;
    h = Math.imul(h ^ (southVoid | eastVoid), 16777619);
  }
  return h | 0;
}

function computeIslandSacredHash(
  sortedTiles: Array<{ x: number; y: number }>,
  gs: number,
  nearSacredSet: Set<number>
): number {
  let h = 2166136261;
  for (let i = 0; i < sortedTiles.length; i++) {
    const pt = sortedTiles[i];
    if (nearSacredSet.has(pt.y * gs + pt.x)) {
      h = Math.imul(h ^ (pt.y * gs + pt.x), 16777619);
    }
  }
  return h | 0;
}

function rebuildIslandCliffLayer(
  cache: CachedIslandTerrain,
  state: WorldState
): void {
  const gs = state.gridSize;
  const cctx = cache.cliffCanvas.getContext('2d');
  if (!cctx) return;
  cctx.clearRect(0, 0, cache.width, cache.height);
  cache.waterfalls.length = 0;

  const hw = TILE_W * 0.5;
  const hh = TILE_H * 0.5;
  const tiles = cache.sortedTiles;

  for (let i = 0; i < tiles.length; i++) {
    const pt = tiles[i];
    const tile = state.tiles[pt.y][pt.x];
    const southVoid = !inBounds(tile.x, tile.y + 1, gs) || state.tiles[tile.y + 1][tile.x].kind === 'VOID';
    const eastVoid = !inBounds(tile.x + 1, tile.y, gs) || state.tiles[tile.y][tile.x + 1].kind === 'VOID';
    if (!southVoid && !eastVoid) continue;

    const pos = tileToIso(pt.x, pt.y);
    drawLandTileCliffs(cctx, tile, pos.x - cache.offsetX, pos.y - cache.offsetY, southVoid, eastVoid);

    if (southVoid) {
      const waterfallHash = (tile.x * 7 + tile.y * 13) % 11;
      if ((waterfallHash === 0 && tile.variant > 0.25) || (tile.variant > 0.93 && (tile.x + tile.y) % 3 === 0)) {
        cache.waterfalls.push({
          x: pos.x - hw * 0.48,
          y: pos.y + hh * 0.52,
          fallH: 78 + tile.variant * 26,
          seed: tile.variant,
        });
      }
    }
  }
}

function rebuildIslandTurfLayer(
  cache: CachedIslandTerrain,
  island: IslandInfo,
  state: WorldState,
  atlas: SpriteAtlas,
  nearSacredSet: Set<number>
): void {
  const gs = state.gridSize;
  const tctx = cache.turfCanvas.getContext('2d');
  if (!tctx) return;
  tctx.clearRect(0, 0, cache.width, cache.height);

  const icx = Math.round(island.centerX);
  const icy = Math.round(island.centerY);
  const tiles = cache.sortedTiles;

  for (let i = 0; i < tiles.length; i++) {
    const pt = tiles[i];
    const tile = state.tiles[pt.y][pt.x];
    const pos = tileToIso(pt.x, pt.y);
    const lx = pos.x - cache.offsetX;
    const ly = pos.y - cache.offsetY;
    const nearSacred = nearSacredSet.has(pt.y * gs + pt.x);
    const isCobbleRoad =
      !nearSacred &&
      ((pt.x === icx && Math.abs(pt.y - icy) <= 3) ||
        (pt.y === icy && Math.abs(pt.x - icx) <= 3));

    const sprite = nearSacred
      ? atlas.flagstoneTile
      : isCobbleRoad
        ? atlas.cobbleTiles[Math.floor(tile.variant * atlas.cobbleTiles.length) % atlas.cobbleTiles.length]
        : atlas.landTiles[Math.floor(tile.variant * atlas.landTiles.length) % atlas.landTiles.length];
    tctx.drawImage(sprite, lx - sprite.width * 0.5, ly - sprite.height * 0.5);
  }
}

function getCachedIslandTerrain(
  island: IslandInfo,
  state: WorldState,
  atlas: SpriteAtlas,
  nearSacredSet: Set<number>
): CachedIslandTerrain {
  const gs = state.gridSize;
  let cache = islandTerrainCache.get(island);

  if (!cache) {
    const sortedTiles = [...island.tiles].sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
    const rimTiles: Array<{ x: number; y: number }> = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < sortedTiles.length; i++) {
      const pt = sortedTiles[i];
      const pos = tileToIso(pt.x, pt.y);
      if (pos.x < minX) minX = pos.x;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.y > maxY) maxY = pos.y;

      // Only tiles whose S or E neighbor is not LAND can ever toggle southVoid / eastVoid
      const sNotLand = !inBounds(pt.x, pt.y + 1, gs) || state.tiles[pt.y + 1][pt.x].kind !== 'LAND';
      const eNotLand = !inBounds(pt.x + 1, pt.y, gs) || state.tiles[pt.y][pt.x + 1].kind !== 'LAND';
      if (sNotLand || eNotLand) rimTiles.push(pt);
    }

    const padLeft = Math.ceil(TILE_W * 0.5 + 12);
    const padRight = Math.ceil(TILE_W * 0.5 + 12);
    const padTop = Math.ceil(TILE_H * 0.5 + 12);
    // Enough vertical margin beneath bottom-most tile for max cliff depth (60) + stalactite (22) + hh (16)
    const padBottom = 112;

    const offsetX = Math.floor(minX - padLeft);
    const offsetY = Math.floor(minY - padTop);
    const width = Math.max(1, Math.ceil(maxX + padRight - offsetX));
    const height = Math.max(1, Math.ceil(maxY + padBottom - offsetY));

    const cliffCanvas = document.createElement('canvas');
    cliffCanvas.width = width;
    cliffCanvas.height = height;

    const turfCanvas = document.createElement('canvas');
    turfCanvas.width = width;
    turfCanvas.height = height;

    const cliffEdgeHash = computeIslandEdgeHash(rimTiles, state);
    const sacredHash = computeIslandSacredHash(sortedTiles, gs, nearSacredSet);

    cache = {
      cliffCanvas,
      turfCanvas,
      offsetX,
      offsetY,
      width,
      height,
      minIsoX: offsetX,
      maxIsoX: offsetX + width,
      minIsoY: offsetY,
      maxIsoY: offsetY + height + 36, // include waterfall cascade reach for culling
      sortedTiles,
      rimTiles,
      waterfalls: [],
      cliffEdgeHash,
      sacredHash,
      lastCheckedVersion: state.terrainVersion,
    };

    rebuildIslandCliffLayer(cache, state);
    rebuildIslandTurfLayer(cache, island, state, atlas, nearSacredSet);
    islandTerrainCache.set(island, cache);
    return cache;
  }

  // Only re-check perimeter/sacred hashes when terrainVersion actually changed
  if (cache.lastCheckedVersion !== state.terrainVersion) {
    cache.lastCheckedVersion = state.terrainVersion;
    const nextEdgeHash = computeIslandEdgeHash(cache.rimTiles, state);
    if (nextEdgeHash !== cache.cliffEdgeHash) {
      cache.cliffEdgeHash = nextEdgeHash;
      rebuildIslandCliffLayer(cache, state);
    }
    const nextSacredHash = computeIslandSacredHash(cache.sortedTiles, gs, nearSacredSet);
    if (nextSacredHash !== cache.sacredHash) {
      cache.sacredHash = nextSacredHash;
      rebuildIslandTurfLayer(cache, island, state, atlas, nearSacredSet);
    }
  }

  return cache;
}

function drawIslandDynamicOverlay(
  ctx: CanvasRenderingContext2D,
  state: WorldState,
  _island: IslandInfo,
  cached: CachedIslandTerrain,
  nearSacredSet: Set<number>,
  playerColor: string,
  time: number
): void {
  const gs = state.gridSize;
  const tiles = cached.sortedTiles;
  const hwTint = (TILE_W - 8) * 0.5;
  const hhTint = (TILE_H - 4) * 0.5;
  const hwCont = (TILE_W - 6) * 0.5;
  const hhCont = (TILE_H - 3) * 0.5;

  let hasPlayer = false;
  let hasContested = false;
  let aiColorMap: Map<string, Array<{ x: number; y: number }>> | null = null;
  let sacredRunes: Array<{ x: number; y: number; tileX: number; color: string }> | null = null;

  // First pass: batch player territory path directly & collect any contested / AI / sacred tiles
  ctx.beginPath();
  for (let i = 0; i < tiles.length; i++) {
    const pt = tiles[i];
    const tile = state.tiles[pt.y][pt.x];
    const mask = tile.poweredMask;
    if (mask === 0) continue;

    const pos = tileToIso(pt.x, pt.y);
    const poweredByPlayer = (mask & PLAYER_POWER_BIT) !== 0;
    const contested = (mask & (mask - 1)) !== 0;

    if (contested) {
      hasContested = true;
    } else if (poweredByPlayer) {
      hasPlayer = true;
      ctx.moveTo(pos.x, pos.y - hhTint);
      ctx.lineTo(pos.x + hwTint, pos.y);
      ctx.lineTo(pos.x, pos.y + hhTint);
      ctx.lineTo(pos.x - hwTint, pos.y);
      ctx.closePath();
    } else {
      const aiVisual = getPoweredAiVisual(state, mask);
      if (aiVisual) {
        if (!aiColorMap) aiColorMap = new Map();
        let list = aiColorMap.get(aiVisual.color);
        if (!list) {
          list = [];
          aiColorMap.set(aiVisual.color, list);
        }
        list.push(pos);
      }
    }

    if (nearSacredSet.has(pt.y * gs + pt.x)) {
      const aiVis = !poweredByPlayer ? getPoweredAiVisual(state, mask) : null;
      if (!sacredRunes) sacredRunes = [];
      sacredRunes.push({
        x: pos.x,
        y: pos.y,
        tileX: tile.x,
        color: poweredByPlayer ? playerColor : (aiVis?.color ?? '#ef4444'),
      });
    }
  }

  if (hasPlayer) {
    ctx.fillStyle = playerColor;
    ctx.globalAlpha = 0.06;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (aiColorMap) {
    ctx.globalAlpha = 0.07;
    for (const [col, pts] of aiColorMap) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        ctx.moveTo(p.x, p.y - hhTint);
        ctx.lineTo(p.x + hwTint, p.y);
        ctx.lineTo(p.x, p.y + hhTint);
        ctx.lineTo(p.x - hwTint, p.y);
        ctx.closePath();
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (hasContested) {
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < tiles.length; i++) {
      const pt = tiles[i];
      const mask = state.tiles[pt.y][pt.x].poweredMask;
      if (mask !== 0 && (mask & (mask - 1)) !== 0) {
        const pos = tileToIso(pt.x, pt.y);
        ctx.moveTo(pos.x, pos.y - hhCont);
        ctx.lineTo(pos.x + hwCont, pos.y);
        ctx.lineTo(pos.x, pos.y + hhCont);
        ctx.lineTo(pos.x - hwCont, pos.y);
        ctx.closePath();
      }
    }
    ctx.stroke();
  }

  if (sacredRunes) {
    ctx.lineWidth = 1.3;
    for (let i = 0; i < sacredRunes.length; i++) {
      const sr = sacredRunes[i];
      const pulse = 0.28 + Math.sin(time * 2.5 + sr.tileX) * 0.1;
      drawIsoDiamond(ctx, sr.x, sr.y, TILE_W * 0.5, TILE_H * 0.5);
      ctx.strokeStyle = sr.color;
      ctx.globalAlpha = pulse;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function drawBridgeTile(
  ctx: CanvasRenderingContext2D,
  state: WorldState,
  tile: Tile,
  cx: number,
  cy: number,
  time: number
): void {
  const hw = TILE_W * 0.5;
  const hh = TILE_H * 0.5;
  const slabH = 22;
  const gs = state.gridSize;
  const powered = tile.owner && isFactionId(tile.owner) ? isTilePoweredBy(state, tile.x, tile.y, tile.owner) : false;
  const ownerColor = getOwnerColor(state, tile.owner);

  // Check cardinal connections so bridges fuse cleanly into continuous vaulted stone viaducts
  const connN = inBounds(tile.x, tile.y - 1, gs) && state.tiles[tile.y - 1][tile.x].kind !== 'VOID';
  const connS = inBounds(tile.x, tile.y + 1, gs) && state.tiles[tile.y + 1][tile.x].kind !== 'VOID';
  const connE = inBounds(tile.x + 1, tile.y, gs) && state.tiles[tile.y][tile.x + 1].kind !== 'VOID';
  const connW = inBounds(tile.x - 1, tile.y, gs) && state.tiles[tile.y][tile.x - 1].kind !== 'VOID';

  // Left-bottom (South-West) Sculpted Vaulted Limestone Arch Underside
  if (!connS) {
    // Deep recessed shadowed stone arch soffit interior
    ctx.beginPath();
    ctx.moveTo(cx - hw + 5, cy + slabH * 0.82);
    ctx.quadraticCurveTo(cx - hw * 0.48, cy + hh * 0.48 + 3, cx - 4, cy + hh + slabH * 0.82);
    ctx.lineTo(cx - 2, cy + hh + 5);
    ctx.lineTo(cx - hw + 2, cy + 5);
    ctx.closePath();
    ctx.fillStyle = '#334157';
    ctx.fill();

    // Sunlit warm limestone masonry arch spandrel & piers
    ctx.beginPath();
    ctx.moveTo(cx - hw + 1, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx, cy + hh + slabH);
    ctx.lineTo(cx - 6, cy + hh + slabH - 2);
    ctx.quadraticCurveTo(cx - hw * 0.5, cy + hh * 0.5 + 4, cx - hw + 6, cy + slabH - 2);
    ctx.lineTo(cx - hw + 1, cy + slabH - 4);
    ctx.closePath();
    ctx.fillStyle = powered ? '#b9a788' : '#6c6f78';
    ctx.fill();
    ctx.strokeStyle = 'rgba(46, 39, 31, 0.65)';
    ctx.lineWidth = 0.95;
    ctx.stroke();

    // Carved stone voussoir arch rib line
    ctx.strokeStyle = 'rgba(246, 236, 212, 0.42)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(cx - hw + 6, cy + slabH - 4);
    ctx.quadraticCurveTo(cx - hw * 0.5, cy + hh * 0.5 + 2, cx - 6, cy + hh + slabH - 4);
    ctx.stroke();
  } else {
    // Minimal continuous underside seam when connected southward
    ctx.beginPath();
    ctx.moveTo(cx - hw + 1, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx, cy + hh + 10);
    ctx.lineTo(cx - hw + 1, cy + 10);
    ctx.closePath();
    ctx.fillStyle = powered ? '#9c8c72' : '#585b63';
    ctx.fill();
  }

  // Right-bottom (South-East) Cool-Shaded Vaulted Stone Arch Underside
  if (!connE) {
    ctx.beginPath();
    ctx.moveTo(cx + hw - 5, cy + slabH * 0.82);
    ctx.quadraticCurveTo(cx + hw * 0.48, cy + hh * 0.48 + 3, cx + 4, cy + hh + slabH * 0.82);
    ctx.lineTo(cx + 2, cy + hh + 5);
    ctx.lineTo(cx + hw - 2, cy + 5);
    ctx.closePath();
    ctx.fillStyle = '#243044';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx + hw - 1, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx, cy + hh + slabH);
    ctx.lineTo(cx + 6, cy + hh + slabH - 2);
    ctx.quadraticCurveTo(cx + hw * 0.5, cy + hh * 0.5 + 4, cx + hw - 6, cy + slabH - 2);
    ctx.lineTo(cx + hw - 1, cy + slabH - 4);
    ctx.closePath();
    ctx.fillStyle = powered ? '#726f6e' : '#4c515e';
    ctx.fill();
    ctx.strokeStyle = 'rgba(26, 30, 38, 0.72)';
    ctx.lineWidth = 0.95;
    ctx.stroke();

    // Subtle shadowed arch rib highlight
    ctx.strokeStyle = 'rgba(186, 198, 214, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 6, cy + hh + slabH - 4);
    ctx.quadraticCurveTo(cx + hw * 0.5, cy + hh * 0.5 + 2, cx + hw - 6, cy + slabH - 4);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx + hw - 1, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx, cy + hh + 10);
    ctx.lineTo(cx + hw - 1, cy + 10);
    ctx.closePath();
    ctx.fillStyle = powered ? '#6b6764' : '#444852';
    ctx.fill();
  }

  // Sunlit Cobbled Limestone Bridge Deck (solid base + subtle NW highlight facet, zero per-tile gradient)
  drawIsoDiamond(ctx, cx, cy, TILE_W - 2, TILE_H - 1);
  if (tile.hitFlash > 0) {
    ctx.fillStyle = '#ffffff';
  } else {
    ctx.fillStyle = powered ? '#cbbca0' : '#6b6f78';
  }
  ctx.fill();

  if (tile.hitFlash <= 0) {
    ctx.fillStyle = powered ? 'rgba(245, 236, 212, 0.36)' : 'rgba(180, 188, 200, 0.18)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh + 0.5);
    ctx.lineTo(cx + hw - 1, cy);
    ctx.lineTo(cx - hw + 1, cy);
    ctx.closePath();
    ctx.fill();
  }

  // Hand-laid cobbled masonry paver joints
  ctx.strokeStyle = 'rgba(72, 60, 44, 0.35)';
  ctx.lineWidth = 0.95;
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.5, cy - hh * 0.5);
  ctx.lineTo(cx + hw * 0.5, cy + hh * 0.5);
  ctx.moveTo(cx + hw * 0.5, cy - hh * 0.5);
  ctx.lineTo(cx - hw * 0.5, cy + hh * 0.5);
  ctx.moveTo(cx - hw * 0.25, cy - hh * 0.75);
  ctx.lineTo(cx + hw * 0.75, cy + hh * 0.25);
  ctx.moveTo(cx - hw * 0.75, cy - hh * 0.25);
  ctx.lineTo(cx + hw * 0.25, cy + hh * 0.75);
  ctx.stroke();

  // Raised Carved Stone Parapet Curbs ONLY on exposed sky edges
  ctx.lineCap = 'round';
  const drawEdgeParapet = (x1: number, y1: number, x2: number, y2: number, lit: boolean) => {
    ctx.strokeStyle = 'rgba(42, 36, 28, 0.55)';
    ctx.lineWidth = 4.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1 + 0.5);
    ctx.lineTo(x2, y2 + 0.5);
    ctx.stroke();

    ctx.strokeStyle = lit ? '#f6eedb' : '#857c6c';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x1, y1 - 0.8);
    ctx.lineTo(x2, y2 - 0.8);
    ctx.stroke();
  };
  if (!connN) drawEdgeParapet(cx, cy - hh + 1, cx + hw - 1, cy, true);
  if (!connW) drawEdgeParapet(cx - hw + 1, cy, cx, cy - hh + 1, true);
  if (!connE) drawEdgeParapet(cx + hw - 1, cy, cx, cy + hh - 1, false);
  if (!connS) drawEdgeParapet(cx - hw + 1, cy, cx, cy + hh - 1, false);

  // Seamless Luminous Aether Conduit Veins linking connected bridge tiles
  const pulse = 0.68 + 0.28 * Math.sin(time * 5.2 + (tile.x + tile.y) * 0.55);
  ctx.strokeStyle = powered ? ownerColor : '#343942';
  ctx.lineWidth = powered ? 3.2 : 2;
  ctx.globalAlpha = powered ? pulse : 0.7;
  ctx.beginPath();
  if (connN) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + hw * 0.5, cy - hh * 0.5);
  }
  if (connS) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - hw * 0.5, cy + hh * 0.5);
  }
  if (connE) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + hw * 0.5, cy + hh * 0.5);
  }
  if (connW) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - hw * 0.5, cy - hh * 0.5);
  }
  ctx.stroke();

  // Central Gilded-Bronze Conduit Medallion
  drawIsoDiamond(ctx, cx, cy, 13.5, 6.8);
  ctx.fillStyle = powered ? ownerColor : '#363b45';
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = powered ? '#fff6d1' : '#6c727d';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Severed Bridge Decay Warning (pulsing amber/crimson fissure when unpowered!)
  if (tile.unpoweredSeconds > 1.2) {
    const decayPulse = 0.45 + 0.45 * Math.sin(time * 7.5 + tile.x + tile.y);
    ctx.save();
    drawIsoDiamond(ctx, cx, cy, TILE_W - 6, TILE_H - 3);
    ctx.strokeStyle = tile.unpoweredSeconds > 3.5 ? '#ef4444' : '#f59e0b';
    ctx.globalAlpha = decayPulse * 0.85;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  // Cracks & HP bar when damaged
  if (tile.hp < tile.maxHp) {
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy - 3);
    ctx.lineTo(cx - 2, cy + 2);
    ctx.lineTo(cx + 8, cy - 2);
    ctx.stroke();

    const ratio = Math.max(0, tile.hp / tile.maxHp);
    ctx.fillStyle = 'rgba(12, 18, 28, 0.88)';
    ctx.fillRect(cx - 14, cy - 13, 28, 4);
    ctx.fillStyle = ratio > 0.5 ? '#facc15' : '#ef4444';
    ctx.fillRect(cx - 13, cy - 12, 26 * ratio, 2);
  }
}

function drawScenicProp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  variant: number,
  time: number
): void {
  ctx.save();
  ctx.translate(x, y);
  if (variant > 0.945) {
    // Sunlit limestone boulder cluster draped in emerald moss
    ctx.fillStyle = 'rgba(16, 32, 24, 0.32)';
    ctx.beginPath();
    ctx.ellipse(2, 2.5, 11, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#8b8378';
    ctx.beginPath();
    ctx.ellipse(4, -2, 6, 4, 0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#b6a892';
    ctx.beginPath();
    ctx.ellipse(-2.5, -3.5, 8.2, 5.5, -0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ddd2be';
    ctx.beginPath();
    ctx.ellipse(-4.5, -5.5, 4.4, 2.4, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Lush emerald moss cushion on boulder shoulder
    ctx.fillStyle = '#6db83d';
    ctx.beginPath();
    ctx.ellipse(-1, -7.2, 4.6, 2.2, 0.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (variant < 0.885) {
    // Lush Sunlit Broadleaf Oak Tree (matching start screen meadows)
    const sway = Math.sin(time * 1.9 + variant * 25) * 1.1;
    ctx.fillStyle = 'rgba(14, 34, 20, 0.34)';
    ctx.beginPath();
    ctx.ellipse(3, 2.5, 11.5, 5.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Warm sunlit oak trunk & roots
    ctx.fillStyle = '#6b4a30';
    ctx.beginPath();
    ctx.moveTo(-2.6, 1.5);
    ctx.lineTo(-1.8, -11);
    ctx.lineTo(1.8, -11);
    ctx.lineTo(2.8, 1.5);
    ctx.closePath();
    ctx.fill();

    // Deep shaded lower foliage puffs
    ctx.fillStyle = '#2d632b';
    ctx.beginPath();
    ctx.arc(-5 + sway * 0.4, -12.5, 6.8, 0, Math.PI * 2);
    ctx.arc(5.5 + sway * 0.4, -12, 6.2, 0, Math.PI * 2);
    ctx.arc(0.5 + sway * 0.5, -10.5, 6.8, 0, Math.PI * 2);
    ctx.fill();

    // Mid emerald lush leafy crown
    ctx.fillStyle = '#53a136';
    ctx.beginPath();
    ctx.arc(-4.5 + sway * 0.7, -16, 6.8, 0, Math.PI * 2);
    ctx.arc(4.2 + sway * 0.7, -15.5, 6.4, 0, Math.PI * 2);
    ctx.arc(0 + sway * 0.9, -19.5, 7.2, 0, Math.PI * 2);
    ctx.fill();

    // Warm golden-hour chartreuse top-left canopy highlights
    ctx.fillStyle = '#a2dd4b';
    ctx.beginPath();
    ctx.arc(-4.2 + sway * 0.85, -19.5, 4.4, 0, Math.PI * 2);
    ctx.arc(-0.5 + sway, -22.2, 4.6, 0, Math.PI * 2);
    ctx.arc(3.5 + sway * 0.8, -18.2, 3.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Wind-swept highland sky-conifer with sunlit western edge
    const sway = Math.sin(time * 2.2 + variant * 20) * 1.4;
    ctx.fillStyle = 'rgba(14, 34, 24, 0.34)';
    ctx.beginPath();
    ctx.ellipse(3, 2, 9.5, 4.6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#5e422c';
    ctx.fillRect(-1.5, -9, 3, 10);

    const tiers = [
      { y: -7, w: 10.5, h: 9.5, leftCol: '#3f843a', rightCol: '#244d2e' },
      { y: -13.5, w: 8.4, h: 9.5, leftCol: '#559e40', rightCol: '#2d5e35' },
      { y: -20, w: 6, h: 8.5, leftCol: '#7cc246', rightCol: '#3b733c' },
    ];
    for (const t of tiers) {
      const tipX = sway * (Math.abs(t.y) / 18);
      // Right shadow half
      ctx.fillStyle = t.rightCol;
      ctx.beginPath();
      ctx.moveTo(tipX, t.y - t.h);
      ctx.lineTo(t.w, t.y);
      ctx.lineTo(0, t.y + 1);
      ctx.closePath();
      ctx.fill();
      // Left sunlit half
      ctx.fillStyle = t.leftCol;
      ctx.beginPath();
      ctx.moveTo(tipX, t.y - t.h);
      ctx.lineTo(0, t.y + 1);
      ctx.lineTo(-t.w, t.y);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function getDirectionalTowerSprite(
  atlas: SpriteAtlas,
  kind: 'WIND_CROSSBOW' | 'ZEPHYR_CANNON' | 'THUNDER_CANNON',
  facing: Direction
): { sprite: ProcessedStructureSprite; flipX: boolean } {
  // facing 0 = North-East (up-right): back sprite, unflipped
  // facing 1 = South-East (down-right): front sprite, unflipped
  // facing 2 = South-West (down-left): front sprite, flipped horizontally
  // facing 3 = North-West (up-left): back sprite, flipped horizontally
  const isNorth = facing === 0 || facing === 3;
  const flipX = facing === 2 || facing === 3;
  if (kind === 'WIND_CROSSBOW') {
    const chosen = isNorth && atlas.structures.galeBallistaBack.ready
      ? atlas.structures.galeBallistaBack
      : atlas.structures.galeBallista;
    return { sprite: chosen, flipX };
  }
  if (kind === 'ZEPHYR_CANNON') {
    const chosen = isNorth && atlas.structures.zephyrLanceBack.ready
      ? atlas.structures.zephyrLanceBack
      : atlas.structures.zephyrLance;
    return { sprite: chosen, flipX };
  }
  const chosen = isNorth && atlas.structures.voltCannonBack.ready
    ? atlas.structures.voltCannonBack
    : atlas.structures.voltCannon;
  return { sprite: chosen, flipX };
}

function getBuildPreviewSprite(
  atlas: SpriteAtlas,
  kind: Structure['kind'],
  facing: Direction
): { sprite: ProcessedStructureSprite; width: number; flipX: boolean } | null {
  switch (kind) {
    case 'SUN_DISC':
      return { sprite: atlas.structures.sunDisc, width: 78, flipX: false };
    case 'STONE_BLOCKER':
      return { sprite: atlas.structures.bastion, width: 78, flipX: false };
    case 'WINDMILL':
      return { sprite: atlas.structures.aetherMill, width: 78, flipX: false };
    case 'WIND_CROSSBOW': {
      const dir = getDirectionalTowerSprite(atlas, 'WIND_CROSSBOW', facing);
      return { sprite: dir.sprite, width: 76, flipX: dir.flipX };
    }
    case 'WHIRLWIND_SPIRE':
      return { sprite: atlas.structures.cycloneSpire, width: 80, flipX: false };
    case 'ZEPHYR_CANNON': {
      const dir = getDirectionalTowerSprite(atlas, 'ZEPHYR_CANNON', facing);
      return { sprite: dir.sprite, width: 84, flipX: dir.flipX };
    }
    case 'RAIN_CANNON':
      return { sprite: atlas.structures.tidalMortar, width: 80, flipX: false };
    case 'FROST_BLOCKER':
      return { sprite: atlas.structures.glacialBulwark, width: 76, flipX: false };
    case 'MAN_O_WAR':
      return { sprite: atlas.structures.manOWar, width: 78, flipX: false };
    case 'THUNDER_CANNON': {
      const dir = getDirectionalTowerSprite(atlas, 'THUNDER_CANNON', facing);
      return { sprite: dir.sprite, width: 78, flipX: dir.flipX };
    }
    case 'OUTPOST':
      return { sprite: atlas.structures.aetherRelay, width: 82, flipX: false };
    case 'WATCHTOWER':
      return { sprite: atlas.structures.skyObservatory, width: 78, flipX: false };
    case 'BARRIER_PYLON':
      return { sprite: atlas.structures.fencePylon, width: 74, flipX: false };
    case 'BRIDGE_MINE':
      return { sprite: atlas.structures.aetherMine, width: 42, flipX: false };
    case 'SPARK_PYLON':
      return { sprite: atlas.structures.spire, width: 60, flipX: false };
    case 'ARC_SPIRE':
      return { sprite: atlas.structures.arcSpire, width: 78, flipX: false };
    default:
      return null;
  }
}

function drawPlacementOverlay(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  state: WorldState,
  info: RenderContextInfo,
  playerColor: string
): void {
  const { hoverTile, placement, time } = info;
  if (!hoverTile || placement.type === 'SELECT') return;

  if (placement.type === 'BRIDGE') {
    const pieceKey = state.factions.PLAYER.bridgeQueue[placement.queueIndex];
    if (!pieceKey) return;
    const def = TETROMINOES[pieceKey];
    const check = canPlaceBridge(state, 'PLAYER', pieceKey, placement.rotation, hoverTile.tx, hoverTile.ty);
    const canAfford = state.factions.PLAYER.stormPower >= def.cost;
    const ok = check.valid && canAfford;

    for (const cell of check.cells) {
      const pos = tileToIso(cell.x, cell.y);
      drawIsoDiamond(ctx, pos.x, pos.y, TILE_W - 2, TILE_H - 1);
      ctx.fillStyle = ok ? 'rgba(45, 212, 191, 0.34)' : 'rgba(239, 68, 68, 0.36)';
      ctx.fill();
      ctx.strokeStyle = ok ? playerColor : '#f87171';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (!ok) {
      const anchorPos = tileToIso(hoverTile.tx, hoverTile.ty);
      const reason = !canAfford ? `Need ${def.cost} AE` : check.reason ?? 'Invalid placement';
      drawHintChip(ctx, anchorPos.x, anchorPos.y - 22, reason, '#fca5a5');
    }
    return;
  }

  if (placement.type === 'STRUCTURE') {
    const def = STRUCTURE_CATALOG[placement.kind];
    const check = canPlaceStructure(state, 'PLAYER', hoverTile.tx, hoverTile.ty, def.canBuildOnBridge);
    const canAfford = state.factions.PLAYER.stormPower >= def.cost;
    const unlocked = state.factions.PLAYER.unlockedTechs.includes(placement.kind);
    const ok = check.valid && canAfford && unlocked;

    const pos = tileToIso(hoverTile.tx, hoverTile.ty);
    drawIsoDiamond(ctx, pos.x, pos.y, TILE_W - 2, TILE_H - 1);
    ctx.fillStyle = ok ? 'rgba(240, 180, 41, 0.32)' : 'rgba(239, 68, 68, 0.35)';
    ctx.fill();
    ctx.strokeStyle = ok ? '#f0b429' : '#f87171';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (def.range > 0) {
      if (def.directional) {
        drawDirectionalLane(ctx, hoverTile.tx, hoverTile.ty, placement.facing, def.range, ok ? playerColor : '#f87171', time, state.gridSize);
      } else {
        drawIsoRangeEllipse(ctx, pos.x, pos.y, def.range, ok ? playerColor : '#f87171');
      }
    } else if (placement.kind === 'WATCHTOWER' && def.visionRadius) {
      drawIsoRangeEllipse(ctx, pos.x, pos.y, def.visionRadius, ok ? '#38bdf8' : '#f87171');
    }

    // Preview prospective Energy Fence links when hovering a Barrier Pylon placement
    if (placement.kind === 'BARRIER_PYLON' && ok) {
      for (const existing of state.structures) {
        if (existing.owner !== 'PLAYER' || existing.kind !== 'BARRIER_PYLON' || !existing.powered) continue;
        const sameCol = existing.tx === hoverTile.tx;
        const sameRow = existing.ty === hoverTile.ty;
        if (!sameCol && !sameRow) continue;
        const span = Math.abs(existing.tx - hoverTile.tx) + Math.abs(existing.ty - hoverTile.ty);
        if (span < 2 || span > 5) continue;
        const otherPos = tileToIso(existing.tx, existing.ty);
        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = 2.4;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y - 46);
        ctx.lineTo(otherPos.x, otherPos.y - 46);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Translucent bespoke sprite preview of the tower being placed (with true 4-way facing)
    const preview = getBuildPreviewSprite(atlas, placement.kind, placement.facing);
    if (preview && preview.sprite.ready) {
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.globalAlpha = ok ? 0.74 : 0.36;
      if (def.directional) {
        drawDirectionalAimChevron(ctx, placement.facing, ok ? ALIGNMENT_COLORS[def.alignment] : '#f87171', true, time);
      }
      const bottomY = placement.kind === 'BRIDGE_MINE' ? 10 : 17;
      drawBespokeSprite(ctx, preview.sprite, preview.width, bottomY, false, false, preview.flipX);
      ctx.restore();
    }

    if (!ok) {
      const reason = !unlocked
        ? 'Unlock via Altar Knowledge Sacrifice'
        : !canAfford
          ? `Need ${def.cost} AE`
          : check.reason ?? 'Cannot build here';
      drawHintChip(ctx, pos.x, pos.y - 24, reason, '#fca5a5');
    }
  }
}

function drawTacticalRangeOverlay(
  ctx: CanvasRenderingContext2D,
  state: WorldState,
  info: RenderContextInfo
): void {
  if (!info.rangeOverlay.enabled) return;

  for (const s of state.structures) {
    const def = STRUCTURE_CATALOG[s.kind];
    if (def.alignment !== 'WIND' && def.alignment !== 'RAIN' && def.alignment !== 'THUNDER') {
      continue;
    }
    if (!info.rangeOverlay[def.alignment]) continue;

    const effectiveRange = def.range > 0 ? def.range : (def.slowAuraRadius ?? 0);
    if (effectiveRange <= 0) continue;

    const pos = tileToIso(s.tx, s.ty);
    const elemColor = ALIGNMENT_COLORS[def.alignment];
    const isEnemy = isAiFaction(s.owner);
    const factionCol = getOwnerColor(state, s.owner);
    const powerScale = s.powered ? 1 : 0.35;

    ctx.save();

    // Base alignment ring on tower footprint so overlapping rings trace cleanly to their source
    drawIsoDiamond(ctx, pos.x, pos.y, TILE_W * 0.88, TILE_H * 0.88);
    ctx.strokeStyle = isEnemy ? factionCol : elemColor;
    ctx.globalAlpha = 0.65 * powerScale;
    ctx.lineWidth = isEnemy ? 1.8 : 1.5;
    if (isEnemy) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (def.directional) {
      const { dx, dy } = directionVector(s.facing);
      const steps = Math.floor(effectiveRange);
      for (let i = 1; i <= steps; i++) {
        const cx = s.tx + dx * i;
        const cy = s.ty + dy * i;
        if (!inBounds(cx, cy, state.gridSize)) break;
        const tilePos = tileToIso(cx, cy);
        drawIsoDiamond(ctx, tilePos.x, tilePos.y, TILE_W * 0.76, TILE_H * 0.76);
        const pulse = 0.1 + 0.05 * Math.sin(info.time * 4.5 - i * 0.55);
        ctx.fillStyle = elemColor;
        ctx.globalAlpha = pulse * powerScale;
        ctx.fill();
        ctx.strokeStyle = elemColor;
        ctx.globalAlpha = (isEnemy ? 0.68 : 0.52) * powerScale;
        ctx.lineWidth = 1.25;
        if (isEnemy) ctx.setLineDash([5, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Subtle directional firing line down the corridor center
      const endPos = tileToIso(s.tx + dx * effectiveRange, s.ty + dy * effectiveRange);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(endPos.x, endPos.y);
      ctx.strokeStyle = isEnemy ? factionCol : elemColor;
      ctx.globalAlpha = 0.42 * powerScale;
      ctx.lineWidth = 1.4;
      ctx.setLineDash(isEnemy ? [6, 4] : [3, 3]);
      ctx.stroke();
    } else {
      const rx = effectiveRange * TILE_W * 0.5 * Math.SQRT2;
      const ry = effectiveRange * TILE_H * 0.5 * Math.SQRT2;

      // Soft tinted coverage area
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = elemColor;
      ctx.globalAlpha = (isEnemy ? 0.075 : 0.055) * powerScale;
      ctx.fill();

      // Crisp elemental perimeter ring (solid for allied, dashed for enemy)
      ctx.strokeStyle = elemColor;
      ctx.globalAlpha = (isEnemy ? 0.68 : 0.56) * powerScale;
      ctx.lineWidth = isEnemy ? 1.85 : 1.5;
      if (isEnemy) ctx.setLineDash([8, 5]);
      ctx.stroke();

      // Subtle rival-colored inner accent ring for enemy towers so ownership is obvious even in mirrors
      if (isEnemy && s.powered) {
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y, Math.max(4, rx - 2.5), Math.max(2, ry - 1.25), 0, 0, Math.PI * 2);
        ctx.strokeStyle = factionCol;
        ctx.globalAlpha = 0.32;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 7]);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

function drawSelectedRangeOverlay(
  ctx: CanvasRenderingContext2D,
  state: WorldState,
  info: RenderContextInfo,
  playerColor: string
): void {
  const drawRangeForStructure = (s: Structure, isHoverOnly: boolean) => {
    const def = STRUCTURE_CATALOG[s.kind];
    const pos = tileToIso(s.tx, s.ty);
    const col = s.owner === 'PLAYER' ? playerColor : getOwnerColor(state, s.owner);
    if (isHoverOnly) {
      ctx.save();
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1.8;
      drawIsoDiamond(ctx, pos.x, pos.y, TILE_W * 0.94, TILE_H * 0.94);
      ctx.stroke();
      ctx.restore();
    }
    if (def.range > 0) {
      if (def.directional) {
        drawDirectionalLane(ctx, s.tx, s.ty, s.facing, def.range, col, info.time, state.gridSize);
      } else {
        drawIsoRangeEllipse(ctx, pos.x, pos.y, def.range, col);
      }
    } else if (def.slowAuraRadius && def.slowAuraRadius > 0) {
      drawIsoRangeEllipse(ctx, pos.x, pos.y, def.slowAuraRadius, '#38bdf8');
    } else if (s.kind === 'WATCHTOWER' && def.visionRadius) {
      drawIsoRangeEllipse(ctx, pos.x, pos.y, def.visionRadius, '#67e8f9');
    }
  };

  if (info.selectedKind === 'STRUCTURE' && info.selectedId !== null) {
    const s = state.structures.find((st) => st.id === info.selectedId);
    if (s) drawRangeForStructure(s, false);
  }

  if (info.selectedKind === 'AERIAL' && info.selectedId !== null) {
    const a = state.aerialUnits.find((u) => u.id === info.selectedId);
    if (a) {
      const def = AERIAL_CATALOG[a.kind];
      const pos = tileToIso(a.x, a.y);
      const col = a.owner === 'PLAYER' ? playerColor : getOwnerColor(state, a.owner);
      if (def.range > 0) {
        drawIsoRangeEllipse(ctx, pos.x, pos.y, def.range, col);
      }
      // Waypoint flight tether
      if (a.owner === 'PLAYER' && Math.hypot(a.targetX - a.x, a.targetY - a.y) > 0.4) {
        const dst = tileToIso(a.targetX, a.targetY);
        ctx.save();
        ctx.strokeStyle = '#67e8f9';
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y - 30);
        ctx.lineTo(dst.x, dst.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(dst.x, dst.y, 12, 6, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // Also preview hovered entity highlight & attack/aura range when not overlapping active structure placement
  if (info.hoveredKind !== null && info.hoveredId !== null) {
    const sameAsSelected = info.hoveredKind === info.selectedKind && info.hoveredId === info.selectedId;
    if (info.hoveredKind === 'STRUCTURE' && !sameAsSelected && info.placement.type !== 'STRUCTURE') {
      const s = state.structures.find((st) => st.id === info.hoveredId);
      if (s) drawRangeForStructure(s, true);
    } else if (info.hoveredKind === 'AERIAL' && !sameAsSelected) {
      const a = state.aerialUnits.find((u) => u.id === info.hoveredId);
      if (a) {
        const def = AERIAL_CATALOG[a.kind];
        const pos = tileToIso(a.x, a.y);
        const col = a.owner === 'PLAYER' ? playerColor : getOwnerColor(state, a.owner);
        if (def.range > 0) drawIsoRangeEllipse(ctx, pos.x, pos.y, def.range, col);
      }
    } else if (info.hoveredKind === 'PRIEST' && !sameAsSelected) {
      const p = state.priests.find((pr) => pr.id === info.hoveredId);
      if (p) {
        const pos = tileToIso(p.x, p.y);
        const col = p.isRogue ? '#c084fc' : getOwnerColor(state, p.owner);
        ctx.save();
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y + 2, 20, 10, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        if (p.state === 'ACTIVE' && !p.isRogue) {
          drawIsoRangeEllipse(ctx, pos.x, pos.y, 2.2, col);
        }
      }
    } else if (info.hoveredKind === 'GOLEM' && !sameAsSelected) {
      const g = state.golems.find((go) => go.id === info.hoveredId);
      if (g) {
        const pos = tileToIso(g.x, g.y);
        const col = getOwnerColor(state, g.owner);
        ctx.save();
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y + 2, 18, 9, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    } else if (info.hoveredKind === 'GEYSER' && !sameAsSelected && info.placement.type !== 'STRUCTURE') {
      const g = state.geysers.find((ge) => ge.id === info.hoveredId);
      if (g) {
        const pos = tileToIso(g.tx, g.ty);
        ctx.save();
        ctx.strokeStyle = '#facc15';
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.8;
        drawIsoDiamond(ctx, pos.x, pos.y, TILE_W * 0.94, TILE_H * 0.94);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

function drawDirectionalLane(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  facing: Direction,
  range: number,
  color: string,
  time: number,
  gridSize: number
): void {
  const { dx, dy } = directionVector(facing);
  const steps = Math.floor(range);
  for (let i = 1; i <= steps; i++) {
    const cx = tx + dx * i;
    const cy = ty + dy * i;
    if (!inBounds(cx, cy, gridSize)) break;
    const pos = tileToIso(cx, cy);
    drawIsoDiamond(ctx, pos.x, pos.y, TILE_W * 0.72, TILE_H * 0.72);
    const wave = 0.16 + 0.12 * Math.sin(time * 6 - i * 0.6);
    ctx.fillStyle = color;
    ctx.globalAlpha = wave;
    ctx.fill();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawIsoRangeEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rangeTiles: number,
  color: string
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.48;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  // A tile-space circle dx^2 + dy^2 = R^2 projects under tileToIso to an ellipse
  // with semi-axes (R * sqrt(2) * TILE_W / 2, R * sqrt(2) * TILE_H / 2).
  ctx.ellipse(
    cx,
    cy,
    rangeTiles * TILE_W * 0.5 * Math.SQRT2,
    rangeTiles * TILE_H * 0.5 * Math.SQRT2,
    0,
    0,
    Math.PI * 2
  );
  ctx.stroke();
  ctx.restore();
}

function drawHintChip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
  const tw = ctx.measureText(text).width + 14;
  ctx.fillStyle = 'rgba(13, 21, 33, 0.92)';
  ctx.fillRect(x - tw * 0.5, y - 13, tw, 18);
  ctx.strokeStyle = 'rgba(248, 113, 113, 0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - tw * 0.5, y - 13, tw, 18);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y - 1);
}

function drawCrystalSpire(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  w: number,
  h: number,
  tilt = 0
): void {
  const tipX = bx + tilt;
  const tipY = by - h;
  const midY = by - h * 0.32;

  // Shaded right amber facet
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(bx + w, midY);
  ctx.lineTo(bx + w * 0.45, by);
  ctx.lineTo(bx - w * 0.45, by);
  ctx.lineTo(bx - w, midY);
  ctx.closePath();
  ctx.fillStyle = '#d97706';
  ctx.fill();

  // Warm sunlit gold left facet
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(bx + tilt * 0.25, by);
  ctx.lineTo(bx - w * 0.45, by);
  ctx.lineTo(bx - w, midY);
  ctx.closePath();
  ctx.fillStyle = '#fbbf24';
  ctx.fill();

  // Luminous cream-gold upper specular facet
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(bx + w * 0.62, midY - h * 0.14);
  ctx.lineTo(bx + tilt * 0.3, midY + h * 0.04);
  ctx.lineTo(bx - w * 0.55, midY - h * 0.08);
  ctx.closePath();
  ctx.fillStyle = '#fef9c3';
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 253, 232, 0.85)';
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(bx + w, midY);
  ctx.lineTo(bx + w * 0.45, by);
  ctx.lineTo(bx - w * 0.45, by);
  ctx.lineTo(bx - w, midY);
  ctx.closePath();
  ctx.stroke();
}

function drawGeyser(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  g: Geyser,
  x: number,
  y: number,
  time: number
): void {
  const pulse = (Math.sin(time * 3.4 + g.pulsePhase) + 1) * 0.5;
  const eruptSoon = Math.max(0, Math.min(1, (2.6 - g.eruptTimer) / 2.6));
  const r = g.isSuper ? 26 : 19;

  // Radiant golden sunlight aura spilling across surrounding island moss (cached glow stamp)
  const haloAlpha = Math.min(1, 0.44 + pulse * 0.18 + eruptSoon * 0.22);
  drawGlowEllipse(
    ctx,
    x,
    y,
    r * (2.05 + eruptSoon * 0.32),
    r * (1.1 + eruptSoon * 0.18),
    haloAlpha,
    'rgba(255, 236, 138, 0.96)',
    'rgba(245, 180, 48, 0.44)',
    'rgba(245, 180, 48, 0)',
    0.55
  );

  const ventSprite = atlas.structures.aetherVent;
  if (ventSprite.ready) {
    const drawW = g.isSuper ? 68 : 54;
    const drawH = drawW * (ventSprite.height / Math.max(1, ventSprite.width));
    ctx.drawImage(ventSprite.canvas, x - drawW * 0.5, y + (g.isSuper ? 17 : 13) - drawH, drawW, drawH);

    // Molten golden geothermal pulse breathing inside the painted crater mouth
    const coreAlpha = Math.min(1, 0.62 + pulse * 0.24 + eruptSoon * 0.14);
    drawGlowEllipse(
      ctx,
      x,
      y - 2,
      r * (0.72 + eruptSoon * 0.16),
      r * (0.36 + eruptSoon * 0.08),
      coreAlpha,
      'rgba(255, 254, 230, 0.96)',
      'rgba(251, 191, 36, 0.55)',
      'rgba(217, 119, 6, 0)',
      0.55
    );
  } else {
    // Fallback crater while bespoke vent sprite loads
    ctx.fillStyle = '#6a6357';
    ctx.beginPath();
    ctx.ellipse(x, y + 1.5, r + 4.5, (r + 4.5) * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#a4947b';
    ctx.beginPath();
    ctx.ellipse(x, y - 0.5, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    drawGlowEllipse(
      ctx,
      x,
      y - 1,
      r * 0.85,
      r * 0.44,
      1,
      '#ffffff',
      '#fef08a',
      'rgba(217, 119, 6, 0)',
      0.45
    );
  }

  // Faceted golden-amber crystal spires peeking around the vent rim
  const shards = g.isSuper ? 5 : 3;
  for (let i = 0; i < shards; i++) {
    const a = (i / shards) * Math.PI * 2 + 0.45;
    const sx = x + Math.cos(a) * (r * 0.56);
    const sy = y - 1 + Math.sin(a) * (r * 0.28);
    const sh = (g.isSuper ? 16 : 11.5) + (i % 2) * 4 + eruptSoon * 3.5;
    const sw = g.isSuper ? 3.8 : 3.0;
    const tilt = Math.cos(a) * 3.8;
    drawCrystalSpire(ctx, sx, sy, sw, sh, tilt);
  }

  // Pressurized pre-eruption golden steam plumes billowing out as eruption approaches
  if (eruptSoon > 0.05) {
    for (let s = 0; s < 4; s++) {
      const sp = (time * (1.2 + eruptSoon * 1.4) + s * 0.25 + g.pulsePhase) % 1;
      const sx = x + Math.sin(time * 3 + s * 1.9) * (3 + sp * 7);
      const sy = y - 4 - sp * (24 + eruptSoon * 20);
      const puffR = 4.5 + sp * (8 + eruptSoon * 5);
      drawGlowCircle(
        ctx,
        sx,
        sy,
        puffR,
        (1 - sp) * 0.55 * eruptSoon,
        'rgba(255, 250, 224, 0.95)',
        'rgba(253, 224, 71, 0.48)',
        'rgba(253, 224, 71, 0)',
        0.6
      );
    }
  }

  // Rising concentric golden Aether vortex rings
  for (let ring = 0; ring < 2; ring++) {
    const phase = (time * (0.85 + eruptSoon * 0.7) + ring * 0.5 + g.pulsePhase) % 1;
    ctx.strokeStyle = g.isSuper ? '#fef9c3' : '#fde047';
    ctx.globalAlpha = (1 - phase) * (0.68 + eruptSoon * 0.24);
    ctx.lineWidth = g.isSuper ? 2.2 : 1.6;
    ctx.beginPath();
    ctx.ellipse(x, y - 4 - phase * 28, r * 0.42 + phase * 12, r * 0.21 + phase * 6, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Floating golden sunlight motes above the crystal cluster
  for (let m = 0; m < 3; m++) {
    const mp = (time * 0.75 + m * 0.33 + g.pulsePhase) % 1;
    const mx = x + Math.sin(time * 2.4 + m * 2.1) * (r * 0.45);
    const my = y - 8 - mp * 34;
    ctx.fillStyle = `rgba(255, 250, 210, ${(1 - mp) * 0.9})`;
    ctx.beginPath();
    ctx.arc(mx, my, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCrystal(ctx: CanvasRenderingContext2D, c: Crystal, x: number, y: number, time: number): void {
  const arcLift = Math.sin(c.spawnAnim * Math.PI) * 34;
  const bob = Math.sin(time * 4.2 + c.bobPhase) * 2.2;
  const baseY = y - 1 - arcLift - bob;

  // Warm golden sunlight bloom on moss beneath crystal cluster
  drawGlowEllipse(
    ctx,
    x,
    y + 1,
    16,
    8.5,
    0.5,
    'rgba(255, 232, 128, 0.96)',
    null,
    'rgba(245, 180, 48, 0)'
  );

  // Multi-spire radiant golden crystal cluster (flanking shards + tall central prism)
  drawCrystalSpire(ctx, x - 5.5, baseY + 1, 3.3, 12.5, -3.2);
  drawCrystalSpire(ctx, x + 5.2, baseY + 1.5, 3.2, 11.5, 3.0);
  drawCrystalSpire(ctx, x, baseY + 2, 5.4, 21.5, 0.5);

  // Twinkling sunlit star glint near the central spire apex
  const glint = 0.45 + 0.55 * Math.sin(time * 6.5 + c.bobPhase);
  if (glint > 0.55) {
    const gx = x + 0.5;
    const gy = baseY - 17;
    const s = 3.2 * glint;
    ctx.strokeStyle = `rgba(255, 255, 240, ${glint})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(gx - s, gy);
    ctx.lineTo(gx + s, gy);
    ctx.moveTo(gx, gy - s);
    ctx.lineTo(gx, gy + s);
    ctx.stroke();
  }
}

function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  height: number,
  topCol: string,
  leftCol: string,
  rightCol: string,
  strokeCol?: string
): void {
  const hw = w * 0.5;
  const hh = h * 0.5;

  // Left face
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy - height);
  ctx.lineTo(cx, cy + hh - height);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
  ctx.fillStyle = leftCol;
  ctx.fill();
  if (strokeCol) {
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // Right face
  ctx.beginPath();
  ctx.moveTo(cx + hw, cy - height);
  ctx.lineTo(cx, cy + hh - height);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx + hw, cy);
  ctx.closePath();
  ctx.fillStyle = rightCol;
  ctx.fill();
  if (strokeCol) {
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // Top face
  drawIsoDiamond(ctx, cx, cy - height, w, h);
  ctx.fillStyle = topCol;
  ctx.fill();
  if (strokeCol) {
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function drawBespokeSprite(
  ctx: CanvasRenderingContext2D,
  sprite: ProcessedStructureSprite,
  targetW: number,
  bottomY: number,
  flash: boolean,
  dimUnpowered: boolean,
  flipX = false,
  offsetX = 0,
  offsetY = 0
): boolean {
  if (!sprite.ready) return false;
  const aspect = sprite.height / Math.max(1, sprite.width);
  const drawW = targetW;
  const drawH = drawW * aspect;

  ctx.save();
  if (offsetX !== 0 || offsetY !== 0) {
    ctx.translate(offsetX, offsetY);
  }
  if (flipX) {
    ctx.scale(-1, 1);
  }
  if (dimUnpowered) {
    ctx.globalAlpha = 0.82;
  }
  ctx.drawImage(flash ? sprite.flashCanvas : sprite.canvas, -drawW * 0.5, bottomY - drawH, drawW, drawH);
  ctx.restore();
  return true;
}

function drawDirectionalAimChevron(
  ctx: CanvasRenderingContext2D,
  facing: Direction,
  color: string,
  powered: boolean,
  time: number
): void {
  const dirIso = directionIsoVector(facing);
  const ang = Math.atan2(dirIso.y, dirIso.x);
  const pulse = powered ? 0.8 + 0.2 * Math.sin(time * 5.2) : 0.42;
  const dist = 25;

  ctx.save();
  ctx.translate(dirIso.x * dist, dirIso.y * dist + 1);
  ctx.rotate(ang);
  ctx.globalAlpha = pulse;

  // Crisp glowing aiming chevron on tile rim showing exact firing lane
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(6.5, 0);
  ctx.lineTo(-2.5, -4.6);
  ctx.lineTo(-0.4, 0);
  ctx.lineTo(-2.5, 4.6);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 252, 232, 0.9)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.restore();
}

function drawFactionPennant(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  teamCol: string,
  time: number,
  phase: number
): void {
  const wave = Math.sin(time * 5.2 + phase) * 2.2;
  ctx.save();
  ctx.strokeStyle = '#d6b46c';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, y + 6);
  ctx.lineTo(x, y - 13);
  ctx.stroke();

  ctx.fillStyle = teamCol;
  ctx.beginPath();
  ctx.moveTo(x, y - 13);
  ctx.quadraticCurveTo(x + 7, y - 13 + wave * 0.5, x + 13, y - 10 + wave);
  ctx.lineTo(x + 10.5, y - 7 + wave * 0.6);
  ctx.lineTo(x + 13, y - 4 + wave);
  ctx.quadraticCurveTo(x + 6, y - 5 + wave * 0.3, x, y - 5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 248, 220, 0.78)';
  ctx.lineWidth = 0.75;
  ctx.stroke();
  ctx.restore();
}

function drawStructure(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  state: WorldState,
  s: Structure,
  x: number,
  y: number,
  time: number,
  isSelected: boolean
): void {
  const def = STRUCTURE_CATALOG[s.kind];
  const teamCol = s.owner === 'NEUTRAL' ? '#d6bc86' : getOwnerColor(state, s.owner);
  const alignCol = ALIGNMENT_COLORS[def.alignment];
  const buildEased = 1 - Math.pow(1 - Math.max(0, Math.min(1, s.buildProgress)), 2.2);
  const scale = 0.62 + 0.38 * buildEased;
  const riseOffset = (1 - buildEased) * 14;
  const flash = s.hitFlash > 0;

  // Every structure in the game has its own dedicated bespoke illustrated sprite
  const usesBespokeArt =
    (s.kind === 'TEMPLE' && atlas.structures.temple.ready) ||
    (s.kind === 'ALTAR' && atlas.structures.altar.ready) ||
    (s.kind === 'STONE_BLOCKER' && atlas.structures.bastion.ready) ||
    (s.kind === 'FROST_BLOCKER' && atlas.structures.glacialBulwark.ready) ||
    (s.kind === 'WINDMILL' && atlas.structures.aetherMill.ready) ||
    (s.kind === 'SUN_DISC' && atlas.structures.sunDisc.ready) ||
    (s.kind === 'WIND_CROSSBOW' && atlas.structures.galeBallista.ready) ||
    (s.kind === 'ZEPHYR_CANNON' && atlas.structures.zephyrLance.ready) ||
    (s.kind === 'WHIRLWIND_SPIRE' && atlas.structures.cycloneSpire.ready) ||
    (s.kind === 'RAIN_CANNON' && atlas.structures.tidalMortar.ready) ||
    (s.kind === 'MAN_O_WAR' && atlas.structures.manOWar.ready) ||
    (s.kind === 'THUNDER_CANNON' && atlas.structures.voltCannon.ready) ||
    (s.kind === 'SPARK_PYLON' && atlas.structures.spire.ready) ||
    (s.kind === 'ARC_SPIRE' && atlas.structures.arcSpire.ready) ||
    (s.kind === 'STORM_OBELISK' && atlas.structures.shrineMonolith.ready);

  ctx.save();
  ctx.translate(x, y);

  // Golden masonry summoning ring while structure rises into place
  if (s.buildProgress < 0.99) {
    const bp = s.buildProgress;
    ctx.save();
    ctx.strokeStyle = '#fde047';
    ctx.globalAlpha = (1 - bp) * 0.88;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(0, 1, 24 + bp * 10, 12 + bp * 5, 0, 0, Math.PI * 2);
    ctx.stroke();

    for (let k = 0; k < 5; k++) {
      const a = time * 4 + (k * Math.PI * 2) / 5;
      const mx = Math.cos(a) * (20 - bp * 4);
      const my = 1 + Math.sin(a) * (10 - bp * 2) - bp * 24;
      ctx.fillStyle = '#fef9c3';
      ctx.beginPath();
      ctx.arc(mx, my, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.translate(0, riseOffset);
  ctx.scale(scale, scale);

  if (isSelected) {
    drawIsoDiamond(ctx, 0, 0, TILE_W - 2, TILE_H - 1);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  // Soft grounded contact shadow cast southeast
  ctx.fillStyle = 'rgba(12, 24, 34, 0.36)';
  ctx.beginPath();
  ctx.ellipse(5, 4, usesBespokeArt ? 27 : 24, usesBespokeArt ? 13.5 : 12, 0.12, 0, Math.PI * 2);
  ctx.fill();

  if (usesBespokeArt) {
    // Crisp faction border diamond beneath bespoke structure footprints for instant team readability
    drawIsoDiamond(ctx, 0, 1, 52, 26);
    ctx.strokeStyle = teamCol;
    ctx.globalAlpha = s.powered ? 0.85 : 0.42;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else {
    // Warm sunlit carved limestone foundation pedestal with team banner rim
    drawIsoBox(
      ctx,
      0,
      2,
      46,
      23,
      6,
      flash ? '#ffffff' : s.powered ? '#dcd0b8' : '#7b7d85',
      flash ? '#ffffff' : '#b2a389',
      flash ? '#ffffff' : '#717887',
      '#3a352e'
    );
    drawIsoDiamond(ctx, 0, -4, 42, 21);
    ctx.strokeStyle = teamCol;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  switch (s.kind) {
    case 'TEMPLE': {
      if (drawBespokeSprite(ctx, atlas.structures.temple, 88, 17, flash, !s.powered)) {
        // Animated sacred orbiting faction halo & radiant golden crystal bloom over sanctuary
        const hover = Math.sin(time * 3.0 + s.animPhase) * 2.8;
        drawGlowCircle(
          ctx,
          0,
          -34 + hover,
          22,
          0.65,
          'rgba(255, 248, 198, 0.95)',
          'rgba(245, 186, 54, 0.34)',
          'rgba(245, 186, 54, 0)',
          0.55
        );

        ctx.strokeStyle = teamCol;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.82;
        ctx.beginPath();
        ctx.ellipse(0, -42 + hover, 16, 6.5, Math.sin(time * 1.4) * 0.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Aether Overload Surge Glow when rule is active and faction hoards >= 60% of target
        if (state.victoryRules.aetherOverload && isFactionId(s.owner)) {
          const target = state.victoryRules.aetherOverloadTarget || AETHER_OVERLOAD_TARGET;
          const overloadRatio = Math.min(1, state.factions[s.owner].stormPower / target);
          if (overloadRatio >= 0.6) {
            const surge = (overloadRatio - 0.6) / 0.4;
            const pulse = 0.72 + 0.28 * Math.sin(time * (4 + surge * 5));
            const pillarH = 70 + surge * 95;
            const pillarGrad = ctx.createLinearGradient(0, -pillarH, 0, 0);
            pillarGrad.addColorStop(0, 'rgba(254, 240, 138, 0)');
            pillarGrad.addColorStop(0.55, `rgba(250, 204, 21, ${(0.22 + surge * 0.35) * pulse})`);
            pillarGrad.addColorStop(1, `rgba(255, 251, 220, ${(0.35 + surge * 0.4) * pulse})`);
            ctx.fillStyle = pillarGrad;
            ctx.beginPath();
            ctx.ellipse(0, -pillarH * 0.42, 16 + surge * 12, pillarH * 0.55, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#fef08a';
            ctx.lineWidth = 1.6 + surge * 1.4;
            ctx.globalAlpha = (0.45 + surge * 0.45) * pulse;
            ctx.beginPath();
            ctx.ellipse(0, -18 - (time * 32) % 44, 18 + surge * 10, 8 + surge * 4, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }

        drawFactionPennant(ctx, 20, -28, teamCol, time, s.animPhase);
        break;
      }

      // Painterly fallback marble High Temple
      drawIsoBox(ctx, 0, -4, 42, 21, 9, flash ? '#ffffff' : '#ede4d0', '#c7baa0', '#8d887e', '#4c453b');
      drawIsoBox(ctx, 0, -13, 30, 15, 8, flash ? '#ffffff' : '#f7f0e0', '#d8cbb2', '#a0988c', '#5a5247');
      for (const [px, py] of [
        [-11, -18],
        [11, -18],
        [0, -24],
        [0, -12],
      ]) {
        const colGrad = ctx.createLinearGradient(px - 3, 0, px + 3, 0);
        colGrad.addColorStop(0, '#fcf7eb');
        colGrad.addColorStop(0.6, '#cbbca2');
        colGrad.addColorStop(1, '#7e7971');
        ctx.fillStyle = flash ? '#ffffff' : colGrad;
        ctx.fillRect(px - 2.6, py - 15, 5.2, 15);
        ctx.fillStyle = '#e5be67';
        ctx.fillRect(px - 3.4, py - 17, 6.8, 2.5);
      }
      const hover = Math.sin(time * 3.2) * 3.2;
      drawCrystalSpire(ctx, 0, -30 + hover, 8, 22, 0);
      break;
    }

    case 'ALTAR': {
      if (drawBespokeSprite(ctx, atlas.structures.altar, 80, 16, flash, !s.powered)) {
        // Pulsing faction summoning ring & golden altar embers
        const pulse = 0.5 + 0.5 * Math.sin(time * 4.2 + s.animPhase);
        ctx.strokeStyle = teamCol;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.78;
        ctx.beginPath();
        ctx.ellipse(0, -22 - pulse * 3, 17, 8.2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        for (let k = 0; k < 3; k++) {
          const ep = (time * 0.9 + k * 0.33 + s.animPhase) % 1;
          const ex = Math.sin(time * 3.2 + k * 2.1) * 7;
          const ey = -22 - ep * 24;
          ctx.fillStyle = `rgba(255, 236, 150, ${(1 - ep) * 0.92})`;
          ctx.beginPath();
          ctx.arc(ex, ey, 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }

      // Painterly fallback Ritual Altar
      drawIsoBox(ctx, 0, -4, 38, 19, 8, flash ? '#ffffff' : '#cbbba0', '#9f8f75', '#686b78', '#332e28');
      drawIsoBox(ctx, 0, -12, 24, 12, 5, flash ? '#ffffff' : '#e5c16c', '#b78d3c', '#7c5f28', '#453518');
      const pulse = 0.5 + 0.5 * Math.sin(time * 4.2);
      ctx.strokeStyle = teamCol;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, -17 - pulse * 2.5, 16, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case 'STONE_BLOCKER':
    case 'FROST_BLOCKER': {
      const isFrost = s.kind === 'FROST_BLOCKER';
      if (isFrost && s.powered) {
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.42)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(0, 0, 50, 25, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (isFrost) {
        if (drawBespokeSprite(ctx, atlas.structures.glacialBulwark, 76, 16, flash, !s.powered)) {
          drawFactionPennant(ctx, 0, -48, teamCol, time, s.animPhase);
          if (s.powered) {
            for (let m = 0; m < 3; m++) {
              const a = time * 2.1 + m * 2.1 + s.animPhase;
              const fx = Math.cos(a) * 20;
              const fy = -22 + Math.sin(a * 1.4) * 9;
              ctx.fillStyle = 'rgba(224, 242, 254, 0.85)';
              ctx.beginPath();
              ctx.arc(fx, fy, 1.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else {
          // Multi-prism Glacial Ice Bastion fallback
          drawIsoBox(ctx, 0, -4, 34, 17, 22, flash ? '#ffffff' : '#d8f3ff', '#56ccf2', '#1d82c4', '#f0f9ff');
          ctx.fillStyle = flash ? '#ffffff' : '#effaff';
          ctx.beginPath();
          ctx.moveTo(-9, -24);
          ctx.lineTo(-4, -40);
          ctx.lineTo(1, -24);
          ctx.moveTo(2, -24);
          ctx.lineTo(8, -37);
          ctx.lineTo(13, -24);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#7dd3fc';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      } else if (drawBespokeSprite(ctx, atlas.structures.bastion, 78, 16, flash, !s.powered)) {
        drawFactionPennant(ctx, 0, -44, teamCol, time, s.animPhase);
      } else {
        drawIsoBox(ctx, 0, -4, 36, 18, 22, flash ? '#ffffff' : '#ddd1bb', '#b4a58d', '#747882', '#3a3630');
        ctx.strokeStyle = '#c98842';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-18, -14);
        ctx.lineTo(0, -5);
        ctx.lineTo(18, -14);
        ctx.stroke();
        drawIsoBox(ctx, -9, -26, 10, 5, 6, '#e8dec8', '#baab94', '#7b7f8a', '#3d3832');
        drawIsoBox(ctx, 9, -26, 10, 5, 6, '#e8dec8', '#baab94', '#7b7f8a', '#3d3832');
        drawIsoBox(ctx, 0, -21, 10, 5, 6, '#e8dec8', '#baab94', '#7b7f8a', '#3d3832');
      }
      break;
    }

    case 'WINDMILL': {
      if (drawBespokeSprite(ctx, atlas.structures.aetherMill, 78, 17, flash, !s.powered)) {
        if (s.powered) {
          // Warm pulsing golden glow around the Aether crystal window & subtle rising breeze motes
          const pulse = 0.78 + 0.22 * Math.sin(time * 3.8 + s.animPhase);
          drawGlowCircle(
            ctx,
            2,
            -24,
            14 * pulse,
            0.6,
            'rgba(255, 248, 196, 0.96)',
            'rgba(245, 184, 50, 0.36)',
            'rgba(245, 184, 50, 0)',
            0.6
          );

          for (let i = 0; i < 3; i++) {
            const p = (time * 0.55 + i * 0.33 + s.animPhase) % 1;
            const mx = -14 + p * 28 + Math.sin(time * 3 + i) * 3;
            const my = -34 - p * 18 + Math.cos(time * 2.4 + i) * 3;
            ctx.fillStyle = `rgba(254, 249, 195, ${((1 - p) * 0.75).toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        drawFactionPennant(ctx, 18, -32, teamCol, time, s.animPhase);
      } else {
        const towerGrad = ctx.createLinearGradient(-12, 0, 12, 0);
        towerGrad.addColorStop(0, '#ebe0cb');
        towerGrad.addColorStop(0.55, '#bca98d');
        towerGrad.addColorStop(1, '#787d89');
        ctx.fillStyle = flash ? '#ffffff' : towerGrad;
        ctx.beginPath();
        ctx.moveTo(-12, -4);
        ctx.lineTo(-7, -34);
        ctx.lineTo(7, -34);
        ctx.lineTo(12, -4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#c85d3b';
        ctx.beginPath();
        ctx.moveTo(0, -44);
        ctx.lineTo(10, -33);
        ctx.lineTo(-10, -33);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }

    case 'SUN_DISC': {
      if (drawBespokeSprite(ctx, atlas.structures.sunDisc, 78, 17, flash, !s.powered)) {
        if (s.powered) {
          const pulse = 0.8 + Math.sin(time * 4.5 + s.animPhase) * 0.2;
          drawGlowCircle(
            ctx,
            0,
            -42,
            18 * pulse,
            0.74,
            'rgba(255, 252, 214, 0.96)',
            'rgba(245, 184, 50, 0.34)',
            'rgba(245, 184, 50, 0)',
            0.55
          );

          for (let k = 0; k < 2; k++) {
            const ang = time * 4.2 + s.animPhase + k * Math.PI;
            ctx.fillStyle = '#fffef0';
            ctx.beginPath();
            ctx.arc(Math.cos(ang) * 12.5, -42 + Math.sin(ang) * 5.8, 2.0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        drawIsoBox(ctx, 0, -4, 26, 13, 16, flash ? '#ffffff' : '#e4d3b0', '#ba9f70', '#7e715c', '#3d3324');
        ctx.save();
        ctx.translate(0, -23);
        ctx.fillStyle = '#8e6228';
        ctx.beginPath();
        ctx.ellipse(0, 3, 16, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        const discGrad = ctx.createRadialGradient(-4, -2, 2, 0, 0, 15);
        discGrad.addColorStop(0, '#fffef2');
        discGrad.addColorStop(0.55, '#f6be32');
        discGrad.addColorStop(1, '#c46312');
        ctx.fillStyle = flash ? '#ffffff' : discGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, 15, 7.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff7cc';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
      break;
    }

    case 'WIND_CROSSBOW':
    case 'ZEPHYR_CANNON': {
      const isZephyr = s.kind === 'ZEPHYR_CANNON';
      const dirIso = directionIsoVector(s.facing);
      const { sprite, flipX } = getDirectionalTowerSprite(atlas, s.kind, s.facing);
      const recoilX = -dirIso.x * s.recoil * 3.2;
      const recoilY = -dirIso.y * s.recoil * 3.2;

      drawDirectionalAimChevron(ctx, s.facing, isZephyr ? '#5eead4' : '#2dd4bf', s.powered, time);

      if (drawBespokeSprite(ctx, sprite, isZephyr ? 84 : 76, 17, flash, !s.powered, flipX, recoilX, recoilY)) {
        const muzzleX = dirIso.x * (isZephyr ? 26 : 22) + recoilX;
        const muzzleY = (isZephyr ? -36 : -33) + dirIso.y * (isZephyr ? 17 : 14) + recoilY;
        if (s.recoil > 0.12) {
          const flare = 7 + s.recoil * 9;
          drawGlowCircle(
            ctx,
            muzzleX,
            muzzleY,
            flare,
            0.96,
            'rgba(240, 253, 250, 0.98)',
            isZephyr ? 'rgba(94, 234, 212, 0.68)' : 'rgba(45, 212, 191, 0.58)',
            'rgba(45, 212, 191, 0)',
            0.5
          );
        } else if (s.powered) {
          const pulse = 0.72 + 0.28 * Math.sin(time * 4.6 + s.animPhase);
          drawGlowCircle(
            ctx,
            muzzleX,
            muzzleY,
            (isZephyr ? 11 : 8) * pulse,
            0.56,
            'rgba(204, 251, 241, 0.98)',
            null,
            'rgba(45, 212, 191, 0)'
          );
        }
      } else {
        drawIsoBox(ctx, 0, -4, 28, 14, 14, flash ? '#ffffff' : '#ddd0b7', '#b1a186', '#747a87', '#38332c');
      }
      break;
    }

    case 'WHIRLWIND_SPIRE': {
      if (drawBespokeSprite(ctx, atlas.structures.cycloneSpire, 80, 17, flash, !s.powered)) {
        if (s.powered) {
          // Subtle swirling emerald-mint breeze motes orbiting the sculpted Cyclone Spire
          for (let i = 0; i < 4; i++) {
            const a = time * 3.4 + i * (Math.PI * 0.5) + s.animPhase;
            const r = 14 + (i % 2) * 5;
            const wy = -20 - i * 7 + Math.sin(time * 5 + i) * 2;
            ctx.strokeStyle = i % 2 === 0 ? 'rgba(94, 234, 212, 0.65)' : 'rgba(224, 253, 250, 0.55)';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(0, wy, r, a, a + 1.15);
            ctx.stroke();
          }
        }
      } else {
        drawIsoBox(ctx, 0, -4, 24, 12, 10, '#dfd2b8', '#b5a58b', '#757b88', '#39342d');
      }
      break;
    }

    case 'RAIN_CANNON': {
      const recoilLift = -s.recoil * 3.5;
      if (drawBespokeSprite(ctx, atlas.structures.tidalMortar, 80, 17, flash, !s.powered, false, 0, recoilLift)) {
        if (s.powered) {
          const pulse = 0.8 + 0.2 * Math.sin(time * 4.2 + s.animPhase);
          drawGlowCircle(
            ctx,
            0,
            -37 + recoilLift,
            16 * pulse,
            0.58,
            'rgba(224, 242, 254, 0.95)',
            'rgba(56, 189, 248, 0.38)',
            'rgba(56, 189, 248, 0)',
            0.55
          );

          for (let d = 0; d < 2; d++) {
            const p = (time * 0.9 + d * 0.5 + s.animPhase) % 1;
            const dx = Math.sin(time * 3.5 + d * 2.6) * 10;
            const dy = -34 - p * 18;
            ctx.fillStyle = `rgba(186, 230, 253, ${((1 - p) * 0.85).toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(dx, dy, 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        drawIsoBox(ctx, 0, -4, 28, 14, 15, flash ? '#ffffff' : '#d8ccb4', '#ab9d86', '#697486', '#333740');
      }
      break;
    }

    case 'MAN_O_WAR': {
      const hover = Math.sin(time * 3.1 + s.animPhase) * 2.2;
      if (drawBespokeSprite(ctx, atlas.structures.manOWar, 78, 17, flash, !s.powered)) {
        if (s.powered) {
          drawGlowCircle(
            ctx,
            0,
            -37 + hover,
            20,
            0.54,
            'rgba(186, 230, 253, 0.95)',
            'rgba(56, 189, 248, 0.38)',
            'rgba(56, 189, 248, 0)',
            0.55
          );

          // Tiny electric bioluminescent motes drifting around the tendrils
          for (let i = 0; i < 3; i++) {
            const a = time * 2.8 + i * 2.1 + s.animPhase;
            ctx.fillStyle = '#e0f2fe';
            ctx.beginPath();
            ctx.arc(Math.cos(a) * 18, -22 + Math.sin(a * 1.5) * 8, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        drawIsoBox(ctx, 0, -4, 22, 11, 7, '#d8ccb5', '#ac9d86', '#697385', '#343840');
      }
      break;
    }

    case 'THUNDER_CANNON': {
      const dirIso = directionIsoVector(s.facing);
      const { sprite, flipX } = getDirectionalTowerSprite(atlas, 'THUNDER_CANNON', s.facing);
      const recoilX = -dirIso.x * s.recoil * 3.8;
      const recoilY = -dirIso.y * s.recoil * 3.8;

      drawDirectionalAimChevron(ctx, s.facing, '#facc15', s.powered, time);

      if (drawBespokeSprite(ctx, sprite, 78, 17, flash, !s.powered, flipX, recoilX, recoilY)) {
        const muzzleX = dirIso.x * 23 + recoilX;
        const muzzleY = -36 + dirIso.y * 15 + recoilY;
        if (s.recoil > 0.12) {
          const flare = 9 + s.recoil * 12;
          drawGlowCircle(
            ctx,
            muzzleX,
            muzzleY,
            flare,
            0.98,
            'rgba(255, 252, 224, 0.98)',
            'rgba(250, 204, 21, 0.72)',
            'rgba(192, 132, 252, 0)',
            0.48
          );
        } else if (s.powered) {
          const pulse = 0.75 + 0.25 * Math.sin(time * 9 + s.animPhase);
          drawGlowCircle(
            ctx,
            muzzleX,
            muzzleY,
            10 * pulse,
            0.68,
            'rgba(254, 249, 195, 0.95)',
            'rgba(245, 158, 11, 0.36)',
            'rgba(245, 158, 11, 0)',
            0.55
          );
        }
      } else {
        drawIsoBox(ctx, 0, -4, 30, 15, 15, flash ? '#ffffff' : '#cbbca6', '#9d8e7a', '#5f6374', '#2e2c36');
      }
      break;
    }

    case 'SPARK_PYLON':
    case 'ARC_SPIRE': {
      const isArc = s.kind === 'ARC_SPIRE';
      const sprite = isArc ? atlas.structures.arcSpire : atlas.structures.spire;
      const drewSpire = drawBespokeSprite(ctx, sprite, isArc ? 78 : 60, isArc ? 17 : 15, flash, !s.powered);
      const topY = isArc ? -54 : -44;

      if (!drewSpire) {
        drawIsoBox(ctx, 0, -4, 26, 13, 10, '#d8cab2', '#a89983', '#666a78', '#323038');
      }

      if (s.powered) {
        // Subtle pulsing electric corona around the spire's painted plasma crown
        const pulse = (isArc ? 6.4 : 5.0) + Math.sin(time * 11 + s.animPhase) * 1.6;
        drawGlowCircle(
          ctx,
          0,
          topY,
          pulse * 2.2,
          isArc ? 0.86 : 0.8,
          isArc ? 'rgba(255, 250, 200, 0.98)' : 'rgba(216, 180, 254, 0.96)',
          isArc ? 'rgba(250, 204, 21, 0.4)' : 'rgba(168, 85, 247, 0.38)',
          'rgba(168, 85, 247, 0)',
          0.5
        );
      }
      break;
    }

    case 'STORM_OBELISK': {
      if (drawBespokeSprite(ctx, atlas.structures.shrineMonolith, 74, 16, flash, !s.powered)) {
        const hover = Math.sin(time * 3 + s.animPhase) * 2.2;
        drawGlowCircle(
          ctx,
          0,
          -48 + hover,
          17,
          0.74,
          'rgba(233, 213, 255, 0.96)',
          'rgba(168, 85, 247, 0.38)',
          'rgba(168, 85, 247, 0)',
          0.55
        );
      } else {
        drawIsoBox(ctx, 0, -4, 24, 12, 8, '#cfc1a8', '#9f917a', '#636875', '#2d3038');
        const monGrad = ctx.createLinearGradient(-8, -32, 8, -10);
        monGrad.addColorStop(0, '#c2b49d');
        monGrad.addColorStop(0.55, '#868078');
        monGrad.addColorStop(1, '#4c525e');
        ctx.fillStyle = flash ? '#ffffff' : monGrad;
        ctx.beginPath();
        ctx.moveTo(-8, -10);
        ctx.lineTo(-4, -32);
        ctx.lineTo(4, -32);
        ctx.lineTo(8, -10);
        ctx.closePath();
        ctx.fill();
        const hover = Math.sin(time * 3 + s.animPhase) * 2.5;
        drawCrystalSpire(ctx, 0, -32 + hover, 6.2, 14, 0);
      }
      break;
    }

    case 'OUTPOST': {
      if (drawBespokeSprite(ctx, atlas.structures.aetherRelay, 82, 17, flash, !s.powered)) {
        if (s.powered) {
          const pulse = 0.8 + 0.2 * Math.sin(time * 3.6 + s.animPhase);
          drawGlowCircle(
            ctx,
            0,
            -34,
            20 * pulse,
            0.76,
            'rgba(255, 250, 205, 0.96)',
            'rgba(245, 184, 50, 0.38)',
            'rgba(245, 184, 50, 0)',
            0.5
          );

          for (let m = 0; m < 3; m++) {
            const mp = (time * 0.68 + m * 0.33 + s.animPhase) % 1;
            const mx = Math.sin(time * 2.5 + m * 2.2) * 11;
            const my = -24 - mp * 32;
            ctx.fillStyle = `rgba(254, 249, 195, ${((1 - mp) * 0.85).toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(mx, my, 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        drawFactionPennant(ctx, 22, -38, teamCol, time, s.animPhase);
      } else {
        drawIsoBox(ctx, 0, -4, 34, 17, 10, flash ? '#ffffff' : '#ede4d0', '#c7baa0', '#8d887e', '#4c453b');
        drawCrystalSpire(ctx, 0, -24 + Math.sin(time * 2.8 + s.animPhase) * 2.5, 7, 18, 0);
      }
      break;
    }

    case 'WATCHTOWER': {
      if (drawBespokeSprite(ctx, atlas.structures.skyObservatory, 78, 17, flash, !s.powered)) {
        if (s.powered) {
          const pulse = 0.78 + 0.22 * Math.sin(time * 3.2 + s.animPhase);
          drawGlowCircle(
            ctx,
            0,
            -52,
            15 * pulse,
            0.76,
            'rgba(224, 242, 254, 0.96)',
            'rgba(56, 189, 248, 0.36)',
            'rgba(56, 189, 248, 0)',
            0.55
          );

          // Gentle sweeping horizon glint from the sapphire spyglass lens
          const sweep = time * 1.1 + s.animPhase;
          ctx.save();
          ctx.translate(0, -52);
          ctx.rotate(sweep);
          const beamGrad = ctx.createLinearGradient(0, 0, 26, 0);
          beamGrad.addColorStop(0, 'rgba(186, 230, 253, 0.42)');
          beamGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = beamGrad;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(26, -5);
          ctx.lineTo(26, 5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        drawFactionPennant(ctx, 16, -42, teamCol, time, s.animPhase);
      } else {
        drawIsoBox(ctx, 0, -4, 24, 12, 28, flash ? '#ffffff' : '#dfd4be', '#b8a88e', '#747a87', '#3f382e');
      }
      break;
    }

    case 'BARRIER_PYLON': {
      if (drawBespokeSprite(ctx, atlas.structures.fencePylon, 74, 17, flash, !s.powered)) {
        if (s.powered) {
          const hum = 0.78 + 0.22 * Math.sin(time * 7.2 + s.animPhase);
          drawGlowCircle(
            ctx,
            0,
            -52,
            16 * hum,
            0.8,
            'rgba(240, 253, 255, 0.96)',
            'rgba(56, 189, 248, 0.42)',
            'rgba(56, 189, 248, 0)',
            0.5
          );

          for (let k = 0; k < 2; k++) {
            const ang = time * 4.8 + s.animPhase + k * Math.PI;
            ctx.fillStyle = '#e0f2fe';
            ctx.beginPath();
            ctx.arc(Math.cos(ang) * 9.5, -52 + Math.sin(ang) * 4.5, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        drawIsoBox(ctx, 0, -4, 24, 12, 20, flash ? '#ffffff' : '#94a3b8', '#64748b', '#475569', '#1e293b');
      }
      break;
    }

    case 'BRIDGE_MINE': {
      const pulse = 0.65 + 0.35 * Math.sin(time * 5.2 + s.animPhase);
      if (drawBespokeSprite(ctx, atlas.structures.aetherMine, 42, 10, flash, false)) {
        // Warm pulsing fiery-amber crystal glint at the recessed trigger core
        drawGlowCircle(
          ctx,
          0,
          -5,
          10 * pulse,
          0.8,
          'rgba(254, 240, 138, 0.96)',
          'rgba(249, 115, 22, 0.4)',
          'rgba(249, 115, 22, 0)',
          0.55
        );

        // Subtle dashed armed perimeter ring visible to owner
        ctx.strokeStyle = '#fb923c';
        ctx.globalAlpha = 0.42 * pulse;
        ctx.lineWidth = 1.1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.ellipse(0, 0, 19, 9.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = '#452b1f';
        ctx.beginPath();
        ctx.ellipse(0, 0, 12.5, 6.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      break;
    }
  }

  // Progressive Damage Weathering: stone cracks, rising smoke & flickering fire embers
  const hpRatio = s.hp / Math.max(1, s.maxHp);
  if (hpRatio < 0.65 && s.buildProgress >= 0.99 && s.kind !== 'BRIDGE_MINE') {
    const severity = Math.min(1, (0.65 - hpRatio) / 0.55);
    ctx.save();
    // Fracture cracks across the facade
    ctx.strokeStyle = `rgba(24, 18, 16, ${(0.45 + severity * 0.4).toFixed(2)})`;
    ctx.lineWidth = 1.2 + severity * 0.6;
    ctx.beginPath();
    ctx.moveTo(-9, -12);
    ctx.lineTo(-4, -20);
    ctx.lineTo(-7, -27);
    if (severity > 0.35) {
      ctx.moveTo(7, -9);
      ctx.lineTo(4, -18);
      ctx.lineTo(9, -25);
    }
    ctx.stroke();

    // Rising dark smoke puffs
    const puffCount = severity > 0.5 ? 3 : 2;
    for (let i = 0; i < puffCount; i++) {
      const sp = (time * 0.65 + i / puffCount + s.animPhase) % 1;
      const sx = Math.sin(time * 2 + i * 2.3 + s.id) * (4 + sp * 7);
      const sy = -20 - sp * (24 + severity * 18);
      ctx.fillStyle = `rgba(28, 30, 38, ${((1 - sp) * (0.28 + severity * 0.32)).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5 + sp * 6.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Flickering orange-gold fire embers when critically damaged (< 38% HP)
    if (hpRatio < 0.38) {
      for (let e = 0; e < 3; e++) {
        const ep = (time * 1.4 + e * 0.33 + s.animPhase) % 1;
        const ex = Math.cos(time * 4.5 + e * 2.1) * 9;
        const ey = -16 - ep * 28;
        ctx.fillStyle = e % 2 === 0 ? '#fb923c' : '#fde047';
        ctx.globalAlpha = 1 - ep;
        ctx.beginPath();
        ctx.arc(ex, ey, 1.8 * (1 - ep * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Unpowered Warning Seal (not shown on self-armed Bridge Mines)
  if (!s.powered && s.owner !== 'NEUTRAL' && s.kind !== 'BRIDGE_MINE') {
    ctx.fillStyle = 'rgba(15, 23, 36, 0.94)';
    ctx.beginPath();
    ctx.arc(0, -44, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = '#fca5a5';
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('!', 0, -40.5);
  }

  // Subtle alignment jewel on pedestal front
  if (s.powered && s.kind !== 'TEMPLE' && s.kind !== 'ALTAR') {
    ctx.fillStyle = alignCol;
    ctx.beginPath();
    ctx.arc(0, 8, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 252, 235, 0.85)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  // Health Bar
  if (s.hp < s.maxHp) {
    const ratio = Math.max(0, s.hp / s.maxHp);
    const barY = usesBespokeArt ? -62 : -52;
    ctx.fillStyle = 'rgba(10, 16, 26, 0.9)';
    ctx.fillRect(-19, barY, 38, 5);
    ctx.fillStyle = s.owner === 'NEUTRAL' ? '#f59e0b' : teamCol;
    ctx.fillRect(-18, barY + 1, 36 * ratio, 3);
  }

  ctx.restore();
}

const unitFacingCache = new Map<string, 1 | -1>();

function resolveUnitFacing(
  cacheKey: string,
  curX: number,
  curY: number,
  nextStep: { x: number; y: number } | undefined,
  defaultDir: 1 | -1
): 1 | -1 {
  if (nextStep) {
    const isoDelta = tileToIso(nextStep.x - curX, nextStep.y - curY);
    if (Math.abs(isoDelta.x) > 1.2) {
      const dir: 1 | -1 = isoDelta.x >= 0 ? 1 : -1;
      unitFacingCache.set(cacheKey, dir);
      return dir;
    }
  }
  return unitFacingCache.get(cacheKey) ?? defaultDir;
}

function getPriestSpriteInfo(
  atlas: SpriteAtlas,
  state: WorldState,
  p: Priest
): {
  sprite: ProcessedStructureSprite;
  /** Native artwork look direction: -1 faces left, +1 faces right */
  nativeFacing: 1 | -1;
  /** Staff orb offset in normalized sprite coords (from center-bottom, before horizontal flip) */
  staffOrbNormX: number;
  staffOrbNormY: number;
  element: 'WIND' | 'RAIN' | 'THUNDER' | 'ROGUE';
} {
  if (p.isRogue || p.owner === 'NEUTRAL') {
    return {
      sprite: atlas.units.priestRogue,
      nativeFacing: -1,
      staffOrbNormX: -0.35,
      staffOrbNormY: -0.78,
      element: 'ROGUE',
    };
  }
  const fury = state.factions[p.owner]?.fury ?? 'WIND';
  if (fury === 'RAIN') {
    return {
      sprite: atlas.units.priestRain,
      nativeFacing: 1,
      staffOrbNormX: 0.36,
      staffOrbNormY: -0.82,
      element: 'RAIN',
    };
  }
  if (fury === 'THUNDER') {
    return {
      sprite: atlas.units.priestThunder,
      nativeFacing: 1,
      staffOrbNormX: 0.36,
      staffOrbNormY: -0.82,
      element: 'THUNDER',
    };
  }
  return {
    sprite: atlas.units.priestWind,
    nativeFacing: -1,
    staffOrbNormX: -0.34,
    staffOrbNormY: -0.82,
    element: 'WIND',
  };
}

function drawGolem(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  state: WorldState,
  g: Golem,
  x: number,
  y: number,
  time: number,
  isSelected: boolean
): void {
  const teamCol = getOwnerColor(state, g.owner);
  const isMoving = g.path.length > 0;
  const bounce = isMoving ? Math.abs(Math.sin(g.walkPhase)) * 3.2 : Math.sin(time * 2.2 + g.id) * 0.7;
  const stride = isMoving ? Math.sin(g.walkPhase) : 0;
  const defaultFacing: 1 | -1 = g.owner === 'PLAYER' ? 1 : -1;
  const desiredFacing = resolveUnitFacing(`g:${g.id}`, g.x, g.y, g.path[0], defaultFacing);
  // Golem artwork natively faces front-left (-1), so flip when moving right (+1)
  const flipX = desiredFacing === 1 ? -1 : 1;

  ctx.save();
  ctx.translate(x, y);

  // Subtle sculpted faction base ring for unmistakable team readability
  ctx.save();
  ctx.strokeStyle = teamCol;
  ctx.globalAlpha = isSelected ? 0.95 : 0.72;
  ctx.lineWidth = isSelected ? 2.2 : 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 2, 15.5, 7.6, 0, 0, Math.PI * 2);
  ctx.stroke();

  drawGlowEllipse(ctx, 0, 2, 15.5, 7.6, 0.32, teamCol, null, `${teamCol}00`);
  ctx.restore();

  if (isSelected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.ellipse(0, 2, 19.5, 9.6, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Heavy grounded drop shadow (softens slightly at peak stride)
  const shadowScale = 1 - bounce * 0.03;
  ctx.fillStyle = 'rgba(10, 18, 28, 0.44)';
  ctx.beginPath();
  ctx.ellipse(1.5, 3, 13.5 * shadowScale, 6.4 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Faint sunlit dust puffs on heavy stone footsteps while marching
  if (isMoving) {
    const stepPulse = Math.abs(Math.cos(g.walkPhase));
    if (stepPulse > 0.72) {
      const alpha = (stepPulse - 0.72) * 1.4;
      ctx.fillStyle = `rgba(232, 222, 196, ${(alpha * 0.42).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(-desiredFacing * 7, 2.5, 2.8 + alpha * 2, 0, Math.PI * 2);
      ctx.arc(-desiredFacing * 11, 1.5, 2.0 + alpha * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const golemSprite = atlas.units.golem;
  if (golemSprite.ready) {
    const drawH = 44;
    const drawW = drawH * (golemSprite.width / Math.max(1, golemSprite.height));
    const squashX = isMoving ? 1 + (1 - Math.abs(stride)) * 0.035 : 1;
    const squashY = isMoving ? 1 - (1 - Math.abs(stride)) * 0.035 : 1;
    const tilt = stride * 0.055 * desiredFacing;

    ctx.save();
    ctx.translate(0, 4 - bounce);
    ctx.rotate(tilt);
    ctx.scale(flipX * squashX, squashY);

    ctx.drawImage(golemSprite.canvas, -drawW * 0.5, -drawH, drawW, drawH);

    // Chilled frost crystalline tint when slowed by Rain towers
    if (g.slowTimer > 0 && golemSprite.frostCanvas) {
      ctx.globalAlpha = 0.48;
      ctx.drawImage(golemSprite.frostCanvas, -drawW * 0.5, -drawH, drawW, drawH);
      ctx.globalAlpha = 1;
    }

    // Crisp hit-flash silhouette
    if (g.hitFlash > 0) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(golemSprite.flashCanvas, -drawW * 0.5, -drawH, drawW, drawH);
      ctx.globalAlpha = 1;
    }

    // Luminous faction-colored furnace core embedded right over the carved solar chest ring
    const coreX = -drawW * 0.04;
    const coreY = -drawH * 0.61;
    const corePulse = 0.85 + Math.sin(time * 5.2 + g.id) * 0.15;
    drawGlowCircle(ctx, coreX, coreY, 8.5 * corePulse, 0.96, '#ffffff', teamCol, `${teamCol}00`, 0.35);

    // Subtle glowing team visor glint
    ctx.fillStyle = teamCol;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(-drawW * 0.045, -drawH * 0.815, 1.5, 0, Math.PI * 2);
    ctx.arc(drawW * 0.015, -drawH * 0.815, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore();
  } else {
    // Graceful procedural fallback while bespoke sprite finishes loading
    const torsoGrad = ctx.createLinearGradient(-11, -24, 11, -6);
    torsoGrad.addColorStop(0, g.slowTimer > 0 ? '#d8f3ff' : '#e0d3bc');
    torsoGrad.addColorStop(0.55, g.slowTimer > 0 ? '#38bdf8' : '#a89a84');
    torsoGrad.addColorStop(1, '#5d626e');
    ctx.fillStyle = g.hitFlash > 0 ? '#ffffff' : torsoGrad;
    ctx.beginPath();
    ctx.roundRect(-11, -23 - bounce, 22, 17, 4);
    ctx.fill();
    ctx.strokeStyle = '#2c2925';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.fillStyle = teamCol;
    ctx.beginPath();
    ctx.arc(0, -14.5 - bounce, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Orbiting frost crystals when slowed
  if (g.slowTimer > 0) {
    for (let i = 0; i < 3; i++) {
      const a = time * 3.8 + (i * Math.PI * 2) / 3;
      const fx = Math.cos(a) * 14;
      const fy = -20 - bounce + Math.sin(a) * 5;
      ctx.fillStyle = '#bae6fd';
      ctx.beginPath();
      ctx.moveTo(fx, fy - 2.6);
      ctx.lineTo(fx + 2, fy);
      ctx.lineTo(fx, fy + 2.6);
      ctx.lineTo(fx - 2, fy);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Carried Radiant Golden Crystal Payload Overhead with warm light halo
  if (g.carryingCrystalValue > 0) {
    const cy = -42 - bounce + Math.sin(time * 5.2 + g.id) * 1.8;
    drawGlowCircle(
      ctx,
      0,
      cy - 4,
      18,
      0.74,
      'rgba(255, 248, 196, 0.96)',
      'rgba(245, 186, 54, 0.34)',
      'rgba(245, 186, 54, 0)',
      0.55
    );
    drawCrystalSpire(ctx, 0, cy, 6.8, 17, 0.35);
  }

  // Golem hauling a Captured Priest orb overhead!
  if (g.carryingPriestId !== null) {
    const py = -44 - bounce + Math.sin(time * 4.2 + g.id) * 2;
    ctx.fillStyle = 'rgba(192, 132, 252, 0.32)';
    ctx.beginPath();
    ctx.arc(0, py, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, py, 8.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(0, py, 4.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (g.task === 'REPAIRING') {
    // Subtle golden repair wrench/spark aura when mending structures/bridges
    ctx.strokeStyle = '#fde047';
    ctx.globalAlpha = 0.65 + 0.3 * Math.sin(time * 8 + g.id);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, -18 - bounce, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (g.hp < g.maxHp) {
    const ratio = Math.max(0, g.hp / g.maxHp);
    const barY = g.carryingCrystalValue > 0 || g.carryingPriestId !== null ? -62 : -47;
    ctx.fillStyle = 'rgba(10, 16, 26, 0.88)';
    ctx.beginPath();
    ctx.roundRect(-14, barY, 28, 4.5, 2);
    ctx.fill();
    ctx.fillStyle = teamCol;
    ctx.beginPath();
    ctx.roundRect(-13, barY + 1, 26 * ratio, 2.5, 1.2);
    ctx.fill();
  }

  ctx.restore();
}

function drawPriest(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  state: WorldState,
  p: Priest,
  x: number,
  y: number,
  time: number,
  isSelected: boolean
): void {
  const robeCol = p.isRogue ? '#a855f7' : getOwnerColor(state, p.owner);
  const isStunned = p.state === 'STUNNED';
  const hover = isStunned ? 0 : 4.5 + Math.sin(time * 3.1 + p.animPhase) * 3.4;
  const sway = isStunned ? 0.14 : Math.sin(time * 2.0 + p.animPhase) * 0.032;
  const spriteInfo = getPriestSpriteInfo(atlas, state, p);
  const defaultFacing: 1 | -1 = p.owner === 'PLAYER' ? 1 : -1;
  const desiredFacing = resolveUnitFacing(`p:${p.id}`, p.x, p.y, p.targetPath[0], defaultFacing);
  const flipX = desiredFacing === spriteInfo.nativeFacing ? 1 : -1;

  ctx.save();
  ctx.translate(x, y);

  // Sacred Channeling Repair Aura for Active High Priests
  if (p.state === 'ACTIVE' && !p.isRogue) {
    const auraPulse = 0.17 + Math.sin(time * 2.8 + p.animPhase) * 0.06;
    ctx.save();
    ctx.strokeStyle = p.owner === 'PLAYER' ? '#f0b429' : robeCol;
    ctx.globalAlpha = p.owner === 'PLAYER' ? auraPulse + 0.15 : auraPulse + 0.07;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, TILE_W * 1.45, TILE_H * 1.45, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Subtle rising golden sanctuary blessings inside the aura ring
    if (p.owner === 'PLAYER') {
      for (let i = 0; i < 3; i++) {
        const phase = (time * 0.55 + i * 0.33 + p.animPhase) % 1;
        const ang = i * 2.1 + time * 0.7;
        const sx = Math.cos(ang) * TILE_W * 0.92;
        const sy = Math.sin(ang) * TILE_H * 0.92 - phase * 18;
        ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.55;
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Active Sanctuary Aegis Ward Shield Dome
  if (p.shieldTimer > 0 && p.state === 'ACTIVE') {
    const sp = 0.72 + 0.28 * Math.sin(time * 6.5);
    ctx.save();
    ctx.fillStyle = 'rgba(253, 224, 71, 0.14)';
    ctx.strokeStyle = '#fde047';
    ctx.globalAlpha = 0.8 * sp;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.arc(0, -24 - hover, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#67e8f9';
    ctx.globalAlpha = 0.55 * sp;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(0, -24 - hover, 25, time * 1.5, time * 1.5 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Grounded Faction Sanctum Magic Circle beneath Priest
  ctx.save();
  const ringRx = isSelected ? 19 : 16.5;
  const ringRy = isSelected ? 9.4 : 8.1;
  drawGlowEllipse(ctx, 0, 2, ringRx, ringRy, 0.36, robeCol, `${robeCol}55`, `${robeCol}00`, 0.65);

  ctx.strokeStyle = robeCol;
  ctx.globalAlpha = isStunned ? 0.5 : 0.85;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(0, 2, 16, 7.8, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Rotating runic ticks around the ground sanctum ring
  if (!isStunned) {
    for (let i = 0; i < 4; i++) {
      const a = time * 1.15 + (i * Math.PI) / 2;
      const rx = Math.cos(a) * 16;
      const ry = 2 + Math.sin(a) * 7.8;
      ctx.fillStyle = '#fef3c7';
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(rx, ry, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  if (isSelected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 2, 21, 10.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Soft Levitating Drop Shadow (shrinks slightly as Priest floats higher)
  const shadowScale = Math.max(0.68, 1 - hover * 0.028);
  ctx.fillStyle = 'rgba(8, 15, 26, 0.42)';
  ctx.beginPath();
  ctx.ellipse(1.5, 3, 12.5 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Soft Faction Heraldic Halo Behind Priest (ensures instant team color readability in multi-rival battles)
  if (!isStunned) {
    const haloY = -36 - hover;
    drawGlowCircle(ctx, 0, haloY, 24, 0.36, robeCol, `${robeCol}55`, `${robeCol}00`, 0.55);

    // Fine rotating golden/faction crown halo arc behind the mitre
    ctx.save();
    ctx.strokeStyle = robeCol;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, haloY - 2, 13.5, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
    ctx.restore();
  }

  const drawH = p.isRogue ? 50 : 56;
  let staffTipX = 14 * desiredFacing;
  let staffTipY = -44 - hover;

  if (spriteInfo.sprite.ready) {
    const drawW = drawH * (spriteInfo.sprite.width / Math.max(1, spriteInfo.sprite.height));
    staffTipX = spriteInfo.staffOrbNormX * drawW * flipX;
    staffTipY = 2 - hover + spriteInfo.staffOrbNormY * drawH;

    ctx.save();
    ctx.translate(0, 2 - hover);
    ctx.rotate(sway);
    ctx.scale(flipX, 1);
    if (isStunned) {
      ctx.globalAlpha = 0.82;
    }

    ctx.drawImage(spriteInfo.sprite.canvas, -drawW * 0.5, -drawH, drawW, drawH);

    if (p.hitFlash > 0) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(spriteInfo.sprite.flashCanvas, -drawW * 0.5, -drawH, drawW, drawH);
    }
    ctx.restore();
  } else {
    // Graceful procedural fallback while sprite loads
    const robeGrad = ctx.createLinearGradient(-12, -34, 12, 0);
    robeGrad.addColorStop(0, p.hitFlash > 0 ? '#ffffff' : robeCol);
    robeGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = robeGrad;
    ctx.beginPath();
    ctx.moveTo(0, -37 - hover);
    ctx.lineTo(13, -2 - hover * 0.25);
    ctx.quadraticCurveTo(0, 2, -13, -2 - hover * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e6c478';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // Radiant Staff-Tip Elemental Bloom + Orbiting Aspect Motes for Active Priests
  if (p.state === 'ACTIVE') {
    const orbPulse = 0.8 + Math.sin(time * 5.5 + p.animPhase) * 0.2;
    const orbColor =
      spriteInfo.element === 'RAIN'
        ? '#38bdf8'
        : spriteInfo.element === 'ROGUE'
          ? '#f59e0b'
          : '#fde047';

    drawGlowCircle(
      ctx,
      staffTipX,
      staffTipY,
      11.5 * orbPulse,
      0.94,
      'rgba(255, 255, 240, 0.96)',
      `${orbColor}88`,
      `${orbColor}00`,
      0.45
    );

    // Subtle orbiting elemental motes around the hovering robes
    for (let i = 0; i < 3; i++) {
      const a = time * (spriteInfo.element === 'WIND' ? 2.8 : 2.1) + (i * Math.PI * 2) / 3 + p.animPhase;
      const mx = Math.cos(a) * 16;
      const my = -22 - hover + Math.sin(a * 1.4) * 6;
      ctx.save();
      ctx.globalAlpha = 0.72;
      if (spriteInfo.element === 'THUNDER') {
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(mx - 2, my - 2);
        ctx.lineTo(mx + 1, my);
        ctx.lineTo(mx - 1, my + 2.5);
        ctx.stroke();
      } else if (spriteInfo.element === 'RAIN') {
        ctx.fillStyle = '#7dd3fc';
        ctx.beginPath();
        ctx.ellipse(mx, my, 1.5, 2.3, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (spriteInfo.element === 'ROGUE') {
        ctx.fillStyle = '#c084fc';
        ctx.beginPath();
        ctx.arc(mx, my, 1.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(mx, my, 3.2, a, a + 1.4);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Bound Stunned Arcane Energy Cage & Beacon (lightweight glow strokes, no shadowBlur)
  if (isStunned) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 7);
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.36)';
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.ellipse(0, -15, 17 + pulse * 2.8, 7.5 + pulse * 1.3, Math.sin(time * 2) * 0.14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 2.1;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(245, 158, 11, 0.3)';
    ctx.lineWidth = 4.4;
    ctx.beginPath();
    ctx.ellipse(0, -31, 14.5 + pulse * 2.2, 6.2 + pulse, -Math.sin(time * 2) * 0.14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 1.7;
    ctx.stroke();

    // Vertical binding light pillars around stunned priest
    ctx.globalAlpha = 0.45 + pulse * 0.3;
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 4; i++) {
      const a = time * 1.6 + (i * Math.PI) / 2;
      const bx = Math.cos(a) * 14;
      const by = Math.sin(a) * 5.5;
      ctx.beginPath();
      ctx.moveTo(bx, -15 + by);
      ctx.lineTo(bx * 0.85, -31 + by * 0.85);
      ctx.stroke();
    }
    ctx.restore();

    const label = p.isRogue
      ? 'ROGUE STUNNED'
      : isAiFaction(p.owner)
        ? 'CAPTURE PRIEST!'
        : 'PRIEST STUNNED!';
    drawHintChip(ctx, 0, -64, `${label} ${Math.ceil(p.stunTimer)}s`, '#fde047');
  }

  // Captured Bound Priest levitating in golden storm-tether above carrying High Priest
  if (p.carryingPriestId !== null && p.state === 'ACTIVE') {
    const carried = state.priests.find((pr) => pr.id === p.carryingPriestId);
    const prisonerCol = carried?.isRogue ? '#a855f7' : getOwnerColor(state, carried?.owner ?? null);
    const floatY = -72 - hover + Math.sin(time * 5.5) * 2.6;

    // Crackling golden energy tether from staff orb to levitating captive
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(staffTipX, staffTipY);
    ctx.quadraticCurveTo(staffTipX * 0.5, floatY + 12, 0, floatY + 4);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.36)';
    ctx.lineWidth = 5.2;
    ctx.stroke();
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Levitating captive rendered with their own bespoke sprite bound in golden stasis rings
    const carriedInfo = carried ? getPriestSpriteInfo(atlas, state, carried) : null;
    if (carriedInfo && carriedInfo.sprite.ready) {
      const miniH = 30;
      const miniW = miniH * (carriedInfo.sprite.width / Math.max(1, carriedInfo.sprite.height));
      ctx.save();
      ctx.translate(0, floatY);
      ctx.rotate(Math.sin(time * 3.8) * 0.14 + 0.12);
      ctx.drawImage(carriedInfo.sprite.canvas, -miniW * 0.5, -miniH * 0.5, miniW, miniH);
      ctx.restore();
    } else {
      ctx.fillStyle = prisonerCol;
      ctx.beginPath();
      ctx.roundRect(-12, floatY - 5, 24, 10, 5);
      ctx.fill();
    }

    // Golden binding stasis sphere & rings around captive
    ctx.save();
    drawGlowCircle(
      ctx,
      0,
      floatY,
      19,
      0.34,
      prisonerCol,
      'rgba(253, 224, 71, 0.72)',
      'rgba(253, 224, 71, 0)',
      0.7
    );

    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.ellipse(0, floatY, 15.5, 6.2, time * 1.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, floatY, 15.5, 6.2, -time * 1.1 + 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    drawHintChip(ctx, 0, floatY - 22, 'CARRYING TO ALTAR', '#fde047');
  }

  // Clean Beveled Health Bar positioned cleanly above mitre crown
  const ratio = Math.max(0, p.hp / p.maxHp);
  const barY = isStunned ? -55 : -59 - hover * 0.45;
  ctx.fillStyle = 'rgba(10, 16, 26, 0.9)';
  ctx.beginPath();
  ctx.roundRect(-17, barY, 34, 5.5, 2.5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(214, 188, 134, 0.42)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = isStunned ? '#facc15' : robeCol;
  ctx.beginPath();
  ctx.roundRect(-15.5, barY + 1.2, 31 * ratio, 3.1, 1.5);
  ctx.fill();

  ctx.restore();
}

function drawProjectile(ctx: CanvasRenderingContext2D, proj: Projectile, time: number): void {
  const pos = tileToIso(proj.x, proj.y);
  const progress = Math.min(1, proj.age / Math.max(0.15, proj.maxLife));
  const arcOffset = proj.arcHeight > 0 ? Math.sin(progress * Math.PI) * proj.arcHeight : 0;
  const py = pos.y - 20 - arcOffset;
  const velIso = tileToIso(proj.vx, proj.vy);
  const velLen = Math.hypot(velIso.x, velIso.y) || 1;
  const dirX = velIso.x / velLen;
  const dirY = velIso.y / velLen;
  const ang = Math.atan2(velIso.y, velIso.x);

  // Ground shadow under arcing mortar shells (tightens as shell climbs)
  if (proj.arcHeight > 0) {
    const sScale = Math.max(0.55, 1 - arcOffset / 110);
    ctx.fillStyle = 'rgba(8, 16, 28, 0.34)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y - 2, 7.5 * sScale, 3.6 * sScale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const color = ALIGNMENT_COLORS[proj.alignment];
  ctx.save();
  ctx.translate(pos.x, py);

  if (proj.kind === 'DISC') {
    // Glowing sunlit motion ribbon behind spinning Sun Disc
    const ribbon = ctx.createLinearGradient(-dirX * 26, -dirY * 26, 0, 0);
    ribbon.addColorStop(0, 'rgba(253, 224, 71, 0)');
    ribbon.addColorStop(1, 'rgba(253, 224, 71, 0.72)');
    ctx.strokeStyle = ribbon;
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-dirX * 26, -dirY * 26);
    ctx.lineTo(0, 0);
    ctx.stroke();

    ctx.rotate(time * 20);
    drawGlowCircle(ctx, 0, 0, 11, 0.85, 'rgba(255, 252, 220, 0.98)', null, 'rgba(245, 180, 48, 0)');

    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.ellipse(0, 0, 8.5, 4.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  } else if (proj.kind === 'WIND_BOLT' || proj.kind === 'ZEPHYR_BLADE') {
    const isZephyr = proj.kind === 'ZEPHYR_BLADE';
    ctx.rotate(ang);
    const tailLen = isZephyr ? 34 : 24;
    const trailGrad = ctx.createLinearGradient(-tailLen, 0, 12, 0);
    trailGrad.addColorStop(0, 'rgba(45, 212, 191, 0)');
    trailGrad.addColorStop(0.6, isZephyr ? 'rgba(153, 246, 228, 0.78)' : 'rgba(45, 212, 191, 0.65)');
    trailGrad.addColorStop(1, '#ffffff');
    ctx.strokeStyle = trailGrad;
    ctx.lineWidth = isZephyr ? 5 : 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-tailLen, 0);
    ctx.lineTo(12, 0);
    ctx.stroke();

    // Swirling twin-helix wind wake around the lance
    ctx.strokeStyle = 'rgba(204, 251, 241, 0.72)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let s = 0; s <= 10; s++) {
      const lx = -tailLen * 0.85 + (s / 10) * (tailLen * 0.85 + 8);
      const ly = Math.sin(time * 24 + s * 0.9) * (isZephyr ? 4.8 : 3.0) * (1 - s / 12);
      if (s === 0) ctx.moveTo(lx, ly);
      else ctx.lineTo(lx, ly);
    }
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(11, 0, isZephyr ? 3.2 : 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (proj.kind === 'RAIN_ORB') {
    // Trailing shimmering mist droplets along arc wake
    for (let d = 1; d <= 4; d++) {
      const back = d * 7;
      ctx.fillStyle = `rgba(125, 211, 252, ${(0.62 - d * 0.13).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(-dirX * back, -dirY * back + d * 1.4, Math.max(1.4, 4.4 - d * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
    const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, 8.5);
    g.addColorStop(0, '#f0f9ff');
    g.addColorStop(0.5, '#38bdf8');
    g.addColorStop(1, '#0369a1');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 7.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(224, 242, 254, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else if (proj.kind === 'THUNDER_SHELL') {
    // Blazing violet-gold plasma trail + jagged crackling arc
    const tGrad = ctx.createLinearGradient(-dirX * 32, -dirY * 32, 0, 0);
    tGrad.addColorStop(0, 'rgba(192, 132, 252, 0)');
    tGrad.addColorStop(0.55, 'rgba(192, 132, 252, 0.72)');
    tGrad.addColorStop(1, 'rgba(250, 204, 21, 0.95)');
    ctx.strokeStyle = tGrad;
    ctx.lineWidth = 5.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-dirX * 32, -dirY * 32);
    ctx.lineTo(0, 0);
    ctx.stroke();

    // Jagged electric spark zigzag along tail
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-dirX * 10 + dirY * 4, -dirY * 10 - dirX * 4);
    ctx.lineTo(-dirX * 19 - dirY * 4, -dirY * 19 + dirX * 4);
    ctx.lineTo(-dirX * 28, -dirY * 28);
    ctx.stroke();

    drawGlowCircle(ctx, 0, 0, 12, 0.98, '#ffffff', '#facc15', 'rgba(168, 85, 247, 0)', 0.5);
  } else {
    // MANOWAR_BOLT & OBELISK_BOLT glowing plasma comet trail
    const cGrad = ctx.createLinearGradient(-dirX * 22, -dirY * 22, 0, 0);
    cGrad.addColorStop(0, `${color}00`);
    cGrad.addColorStop(1, color);
    ctx.strokeStyle = cGrad;
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-dirX * 22, -dirY * 22);
    ctx.lineTo(0, 0);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawLightningArc(
  ctx: CanvasRenderingContext2D,
  arc: { points: Array<{ x: number; y: number }>; color: string; life: number; maxLife: number; width: number }
): void {
  if (arc.points.length < 2) return;
  const alpha = Math.max(0, arc.life / arc.maxLife);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = arc.color;
  ctx.lineWidth = arc.width + 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  arc.points.forEach((pt, idx) => {
    const p = tileToIso(pt.x, pt.y);
    const jitterX = idx === 0 || idx === arc.points.length - 1 ? 0 : (Math.random() - 0.5) * 12;
    const jitterY = idx === 0 || idx === arc.points.length - 1 ? 0 : (Math.random() - 0.5) * 12;
    if (idx === 0) ctx.moveTo(p.x + jitterX, p.y - 28 + jitterY);
    else ctx.lineTo(p.x + jitterX, p.y - 28 + jitterY);
  });
  ctx.stroke();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.2, arc.width * 0.45);
  ctx.stroke();
  ctx.restore();
}

function drawSacrificeBeam(
  ctx: CanvasRenderingContext2D,
  beam: { tx: number; ty: number; fury: 'WIND' | 'RAIN' | 'THUNDER'; progress: number; isVictory: boolean },
  time: number
): void {
  const pos = tileToIso(beam.tx, beam.ty);
  const col = FURY_META[beam.fury].color;
  const intensity = Math.sin(beam.progress * Math.PI);
  const beamW = (beam.isVictory ? 62 : 38) * (0.4 + 0.6 * intensity);

  ctx.save();
  const grad = ctx.createLinearGradient(pos.x, pos.y - 540, pos.x, pos.y);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  grad.addColorStop(0.32, col);
  grad.addColorStop(0.84, '#ffffff');
  grad.addColorStop(1, col);

  ctx.globalAlpha = 0.85 * intensity;
  ctx.fillStyle = grad;
  ctx.fillRect(pos.x - beamW * 0.5, pos.y - 540, beamW, 540);

  // Expanding sky-shockwave ring on altar
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 3.2;
  ctx.globalAlpha = (1 - beam.progress) * 0.92;
  ctx.beginPath();
  ctx.ellipse(pos.x, pos.y - 10, 24 + beam.progress * 125, 12 + beam.progress * 62, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Rising spiral sacrifice embers
  for (let i = 0; i < 8; i++) {
    const a = time * 8.5 + i * 0.8;
    const h = (time * 195 + i * 55) % 280;
    ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#fde047';
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.arc(pos.x + Math.cos(a) * (16 + beamW * 0.35), pos.y - h, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCaptureExplosion(ctx: CanvasRenderingContext2D, exp: CaptureExplosion): void {
  const pos = tileToIso(exp.x, exp.y);
  const t = Math.max(0, Math.min(1, exp.progress));
  const easeOut = 1 - Math.pow(1 - t, 3);
  const easeOutQuad = 1 - (1 - t) * (1 - t);
  const scale = exp.isHighPriest ? 1.18 : 0.88;
  const centerY = pos.y - 24;

  ctx.save();

  // 1. Brief golden ascension light pillar as the bound Priest erupts skyward
  if (t < 0.72) {
    const pillarAlpha = Math.sin((t / 0.72) * Math.PI) * 0.72;
    const pillarW = (18 + easeOut * 34) * scale * (1 - t * 0.45);
    const pillarH = (120 + easeOut * 190) * scale;
    const pGrad = ctx.createLinearGradient(pos.x, centerY - pillarH, pos.x, pos.y + 8);
    pGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    pGrad.addColorStop(0.35, `${exp.primaryColor}88`);
    pGrad.addColorStop(0.75, '#fef08a');
    pGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.globalAlpha = pillarAlpha;
    ctx.fillStyle = pGrad;
    ctx.fillRect(pos.x - pillarW * 0.5, centerY - pillarH, pillarW, pillarH + 28);
  }

  // 2. Blinding golden-white core detonation flash & radial nova bloom
  if (t < 0.58) {
    const flashFade = Math.pow(1 - t / 0.58, 1.45);
    const blastR = (16 + easeOut * 78) * scale;
    const coreGrad = ctx.createRadialGradient(pos.x, centerY, 2, pos.x, centerY, blastR);
    coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
    coreGrad.addColorStop(0.28, 'rgba(254, 240, 138, 0.92)');
    coreGrad.addColorStop(0.62, `${exp.primaryColor}88`);
    coreGrad.addColorStop(1, `${exp.primaryColor}00`);
    ctx.globalAlpha = flashFade;
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(pos.x, centerY, blastR, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Expanding isometric ground shockwave rings (primary golden + trailing faction harmonic)
  const outerRx = (18 + easeOut * 112) * scale;
  const outerRy = outerRx * 0.5;
  ctx.save();
  const outerAlpha = Math.pow(1 - t, 1.35) * 0.95;
  ctx.beginPath();
  ctx.ellipse(pos.x, pos.y - 4, outerRx, outerRy, 0, 0, Math.PI * 2);
  ctx.globalAlpha = outerAlpha * 0.35;
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = Math.max(3, (10 - t * 6.5) * scale);
  ctx.stroke();
  ctx.globalAlpha = outerAlpha;
  ctx.strokeStyle = '#fef08a';
  ctx.lineWidth = Math.max(1.2, (5.2 - t * 3.8) * scale);
  ctx.stroke();

  // Inner bright white core shockwave rim
  if (t < 0.55) {
    const innerT = t / 0.55;
    const innerRx = (10 + (1 - Math.pow(1 - innerT, 2)) * 78) * scale;
    ctx.globalAlpha = (1 - innerT) * 0.9;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y - 4, innerRx, innerRx * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Trailing secondary faction-colored shockwave ring
  if (t > 0.08) {
    const t2 = Math.min(1, (t - 0.08) / 0.92);
    const e2 = 1 - Math.pow(1 - t2, 2.4);
    const rx2 = (14 + e2 * 96) * scale;
    const a2 = (1 - t2) * 0.82;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y - 4, rx2, rx2 * 0.5, 0, 0, Math.PI * 2);
    ctx.globalAlpha = a2 * 0.34;
    ctx.strokeStyle = exp.secondaryColor;
    ctx.lineWidth = Math.max(2.6, (7.4 - t2 * 4.6) * scale);
    ctx.stroke();
    ctx.globalAlpha = a2;
    ctx.lineWidth = Math.max(1, (3.6 - t2 * 2.4) * scale);
    ctx.stroke();
  }
  ctx.restore();

  // 4. Radiant starburst light spikes bursting outward from detonation center
  if (t < 0.68) {
    const rayT = t / 0.68;
    const rayAlpha = Math.pow(1 - rayT, 1.3) * 0.92;
    const rayCount = exp.isHighPriest ? 14 : 10;
    ctx.save();
    ctx.translate(pos.x, centerY);
    ctx.rotate(exp.seed + rayT * 0.25);
    ctx.globalAlpha = rayAlpha;
    for (let i = 0; i < rayCount; i++) {
      const angle = (i / rayCount) * Math.PI * 2;
      const isMajor = i % 2 === 0;
      const innerR = (6 + rayT * 18) * scale;
      const outerR = ((isMajor ? 26 : 18) + (1 - Math.pow(1 - rayT, 2.5)) * (isMajor ? 74 : 50)) * scale;
      const halfSpread = (isMajor ? 0.07 : 0.045) * (1 - rayT * 0.55);

      ctx.fillStyle = isMajor ? '#fef9c3' : exp.primaryColor;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle - halfSpread) * innerR, Math.sin(angle - halfSpread) * innerR * 0.72);
      ctx.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR * 0.72);
      ctx.lineTo(Math.cos(angle + halfSpread) * innerR, Math.sin(angle + halfSpread) * innerR * 0.72);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 5. Shattering arcane runic shards & fiery sparks flying outward on parabolic arcs
  const shardCount = exp.isHighPriest ? 14 : 10;
  for (let i = 0; i < shardCount; i++) {
    const ang = exp.seed + (i / shardCount) * Math.PI * 2 + (i % 3) * 0.17;
    const speedFactor = 0.7 + ((i * 37) % 10) * 0.065;
    const dist = (12 + easeOutQuad * 94 * speedFactor) * scale;
    const sx = pos.x + Math.cos(ang) * dist;
    const liftArc = Math.sin(t * Math.PI) * (36 + (i % 4) * 14) * scale;
    const sy = centerY + Math.sin(ang) * dist * 0.52 - liftArc + t * t * 18;
    const shardAlpha = Math.max(0, 1 - Math.pow(t, 1.6));
    const shardSize = (3.4 + (i % 3) * 1.4) * (1 - t * 0.55) * scale;

    const shardCol =
      i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? '#fde047' : i % 2 === 0 ? exp.primaryColor : exp.secondaryColor;

    // Velocity streak tail behind each shard
    const tailDist = Math.max(4, dist - 14 * (1 - t * 0.5));
    const tx = pos.x + Math.cos(ang) * tailDist;
    const ty = centerY + Math.sin(ang) * tailDist * 0.52 - liftArc * 0.85 + t * t * 14;

    ctx.save();
    ctx.globalAlpha = shardAlpha * 0.55;
    ctx.strokeStyle = shardCol;
    ctx.lineWidth = Math.max(1, shardSize * 0.45);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(sx, sy);
    ctx.stroke();

    // Rotating faceted diamond energy shard
    ctx.globalAlpha = shardAlpha;
    ctx.translate(sx, sy);
    ctx.rotate(ang + t * 5.5);
    ctx.fillStyle = shardCol;
    ctx.beginPath();
    ctx.moveTo(0, -shardSize * 1.35);
    ctx.lineTo(shardSize * 0.72, 0);
    ctx.lineTo(0, shardSize * 1.35);
    ctx.lineTo(-shardSize * 0.72, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

function drawImpactEffect(ctx: CanvasRenderingContext2D, fx: ImpactEffect): void {
  const pos = tileToIso(fx.x, fx.y);
  const t = Math.max(0, Math.min(1, fx.progress));
  const easeOut = 1 - Math.pow(1 - t, 2.6);
  const s = fx.scale;

  ctx.save();
  ctx.translate(pos.x, pos.y);

  if (fx.kind === 'BUILD_SNAP') {
    // Crisp expanding golden masonry diamond seal & rising construction sparks
    const w = (36 + easeOut * 34) * s;
    const h = w * 0.5;
    drawIsoDiamond(ctx, 0, 0, w, h);
    ctx.strokeStyle = fx.color;
    ctx.globalAlpha = (1 - t) * 0.82;
    ctx.lineWidth = 2.2 * (1 - t * 0.5);
    ctx.stroke();

    drawIsoDiamond(ctx, 0, 0, w * 0.72, h * 0.72);
    ctx.strokeStyle = '#fef9c3';
    ctx.globalAlpha = (1 - t) * 0.68;
    ctx.lineWidth = 1.3;
    ctx.stroke();
  } else if (fx.kind === 'RAIN_SPLASH') {
    // Shimmering translucent puddle ripple rings + arcing water splash droplets
    const rx = (12 + easeOut * 34) * s;
    const ry = rx * 0.5;
    ctx.fillStyle = `rgba(56, 189, 248, ${((1 - t) * 0.22).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.9, ry * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#bae6fd';
    ctx.globalAlpha = (1 - t) * 0.85;
    ctx.lineWidth = 1.8 * (1 - t * 0.5);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (t < 0.75) {
      const dt = t / 0.75;
      for (let i = 0; i < 6; i++) {
        const a = fx.seed + (i / 6) * Math.PI * 2;
        const d = (6 + dt * 24) * s;
        const lift = Math.sin(dt * Math.PI) * 18 * s;
        ctx.fillStyle = i % 2 === 0 ? '#e0f2fe' : '#38bdf8';
        ctx.globalAlpha = (1 - dt) * 0.9;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d * 0.5 - lift, 2.0 * (1 - dt * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (fx.kind === 'SCORCH_RING') {
    // Lingering charred blast crater + glowing amber ember rim
    const fade = 1 - Math.pow(t, 1.5);
    const rx = (16 + Math.min(1, t * 2.5) * 20) * s;
    const ry = rx * 0.5;
    drawGlowEllipse(
      ctx,
      0,
      0,
      rx,
      ry,
      fade * 0.65,
      'rgba(18, 15, 22, 0.96)',
      'rgba(48, 32, 24, 0.56)',
      'rgba(18, 15, 22, 0)',
      0.65
    );

    if (t < 0.55) {
      const rt = t / 0.55;
      ctx.strokeStyle = '#fbbf24';
      ctx.globalAlpha = (1 - rt) * 0.88;
      ctx.lineWidth = 2.4 * (1 - rt * 0.6);
      ctx.beginPath();
      ctx.ellipse(0, 0, (12 + rt * 36) * s, (6 + rt * 18) * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (fx.kind === 'WIND_BURST') {
    // Swirling twin emerald-cyan gale arcs
    const r = (10 + easeOut * 28) * s;
    ctx.globalAlpha = (1 - t) * 0.85;
    ctx.strokeStyle = '#99f6e4';
    ctx.lineWidth = 2.1 * (1 - t * 0.5);
    for (let i = 0; i < 2; i++) {
      const startA = fx.seed + t * 5 + i * Math.PI;
      ctx.beginPath();
      ctx.ellipse(0, -10, r, r * 0.5, 0, startA, startA + 1.85);
      ctx.stroke();
    }
  } else if (fx.kind === 'CRUMBLE') {
    // Monumental crumbling limestone masonry blocks + sunlit dust cloud + shockwave
    const dustR = (14 + easeOut * 38) * s;
    drawGlowEllipse(
      ctx,
      0,
      -6,
      dustR,
      dustR * 0.62,
      (1 - t) * 0.54,
      'rgba(226, 214, 192, 0.96)',
      'rgba(176, 162, 138, 0.52)',
      'rgba(176, 162, 138, 0)',
      0.6
    );

    if (t < 0.6) {
      const rt = t / 0.6;
      ctx.strokeStyle = fx.color;
      ctx.globalAlpha = (1 - rt) * 0.78;
      ctx.lineWidth = 2.6 * s * (1 - rt * 0.5);
      ctx.beginPath();
      ctx.ellipse(0, 0, (14 + rt * 44) * s, (7 + rt * 22) * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Tumbling carved limestone masonry debris chunks
    const chunks = s > 1.3 ? 11 : 7;
    for (let i = 0; i < chunks; i++) {
      const ang = fx.seed + (i / chunks) * Math.PI * 2 + (i % 3) * 0.2;
      const dist = (8 + easeOut * (36 + (i % 4) * 10)) * s;
      const cx = Math.cos(ang) * dist;
      const arc = Math.abs(Math.sin(t * Math.PI * 1.15)) * (26 + (i % 3) * 12) * s * (1 - t * 0.45);
      const cy = Math.sin(ang) * dist * 0.5 - arc;
      const size = (3.4 + (i % 3) * 1.4) * (1 - t * 0.45) * Math.min(1.3, s);

      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - Math.pow(t, 1.8));
      ctx.translate(cx, cy);
      ctx.rotate(ang + t * (i % 2 === 0 ? 7 : -6));
      ctx.fillStyle = i % 3 === 0 ? '#e6dac4' : i % 3 === 1 ? '#b8a88e' : '#7b808c';
      ctx.fillRect(-size, -size * 0.75, size * 2, size * 1.5);
      ctx.strokeStyle = '#3b352d';
      ctx.lineWidth = 0.7;
      ctx.strokeRect(-size, -size * 0.75, size * 2, size * 1.5);
      ctx.restore();
    }
  }

  ctx.restore();
}

function drawCloudShadows(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  state: WorldState,
  minIsoX: number,
  maxIsoX: number,
  minIsoY: number,
  maxIsoY: number,
  time: number,
  weather: WeatherState
): void {
  const bounds = getWorldIsoBounds(state.gridSize);
  const spanX = Math.max(1200, bounds.maxX - bounds.minX + 600);
  const spanY = Math.max(700, bounds.maxY - bounds.minY + 400);
  const shadowAlpha = Math.min(1, 0.85 + weather.overcast * 0.35);

  ctx.save();
  ctx.globalAlpha = shadowAlpha;
  for (let i = 0; i < 6; i++) {
    const rawX = ((i * 530 + time * (11 + (i % 3) * 4)) % spanX) + bounds.minX - 300;
    const rawY = bounds.minY + ((i * 230 + 140) % spanY);
    const rx = 145 + (i % 3) * 45;
    const ry = rx * 0.46;
    if (rawX + rx < minIsoX || rawX - rx > maxIsoX || rawY + ry < minIsoY || rawY - ry > maxIsoY) {
      continue;
    }
    ctx.save();
    ctx.translate(rawX, rawY);
    ctx.rotate(-0.18);
    ctx.drawImage(atlas.cloudShadow, -rx, -ry, rx * 2, ry * 2);
    ctx.restore();
  }
  ctx.restore();
}

function drawLocalizedStormGroundShadows(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  weather: WeatherState,
  minIsoX: number,
  maxIsoX: number,
  minIsoY: number,
  maxIsoY: number
): void {
  ctx.save();
  for (const cell of weather.cells) {
    if (cell.intensity <= 0.02) continue;
    const rx = cell.radiusIso * 1.12;
    const ry = cell.radiusIso * 0.62;
    if (
      cell.isoX + rx < minIsoX ||
      cell.isoX - rx > maxIsoX ||
      cell.isoY + ry < minIsoY ||
      cell.isoY - ry > maxIsoY
    ) {
      continue;
    }

    // Layered brooding shadow cast onto islands beneath the drifting thunderhead
    ctx.globalAlpha = Math.min(0.9, cell.intensity * 0.68);
    ctx.drawImage(atlas.cloudShadow, cell.isoX - rx, cell.isoY - ry, rx * 2, ry * 2);
    ctx.globalAlpha = Math.min(0.65, cell.intensity * 0.44);
    ctx.drawImage(
      atlas.cloudShadow,
      cell.isoX - rx * 0.72,
      cell.isoY - ry * 0.72,
      rx * 1.44,
      ry * 1.44
    );

    // Localized terrain flash illumination whenever this cell discharges lightning
    if (cell.flash > 0.03) {
      const flashR = cell.radiusIso * 0.85;
      ctx.globalAlpha = 1;
      drawGlowEllipse(
        ctx,
        cell.isoX,
        cell.isoY,
        flashR,
        flashR * 0.54,
        cell.flash * 0.3,
        'rgba(205, 232, 255, 0.95)',
        'rgba(147, 197, 253, 0.38)',
        'rgba(147, 197, 253, 0)',
        0.55
      );
    }
  }
  ctx.restore();
}

function drawIsometricRainSplashes(
  ctx: CanvasRenderingContext2D,
  state: WorldState,
  minTx: number,
  maxTx: number,
  minTy: number,
  maxTy: number,
  weather: WeatherState,
  time: number
): void {
  // Lightweight deterministic raindrop splash rings on visible LAND and BRIDGE tiles
  const spanX = Math.max(1, maxTx - minTx + 1);
  const spanY = Math.max(1, maxTy - minTy + 1);
  const stride = Math.max(1, Math.floor(Math.sqrt((spanX * spanY) / 140)));

  ctx.save();
  ctx.lineWidth = 1.1;
  let drawn = 0;
  const maxRipples = 44;

  for (let ty = minTy; ty <= maxTy && drawn < maxRipples; ty += stride) {
    for (let tx = minTx; tx <= maxTx && drawn < maxRipples; tx += stride) {
      const tile = state.tiles[ty][tx];
      if (tile.kind === 'VOID') continue;

      const pos = tileToIso(tx, ty);
      const localStorm = getLocalizedStormFactorAtIso(weather, pos.x, pos.y);
      const effectiveRain = Math.min(1, weather.rainIntensity + localStorm * 0.65);
      if (effectiveRain < 0.08) continue;

      const hash = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
      const threshold = effectiveRain * 0.42;
      const slot = (hash % 1000) / 1000;
      if (slot > threshold) continue;

      const rate = 1.65 + (hash % 7) * 0.18 + localStorm * 0.65;
      const phase = (time * rate + slot * 13.7) % 1;
      if (phase > 0.62) continue;

      const p = phase / 0.62;
      const offX = (((hash >> 5) % 23) - 11) * 1.15;
      const offY = (((hash >> 11) % 13) - 6) * 1.05;
      const rx = 2.4 + p * (7.2 + localStorm * 2.5);
      const ry = rx * 0.5;
      const alpha = (1 - p) * (0.28 + effectiveRain * 0.28);

      ctx.strokeStyle =
        localStorm > 0.25
          ? `rgba(202, 232, 255, ${alpha.toFixed(3)})`
          : `rgba(186, 224, 248, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(pos.x + offX, pos.y + offY, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      drawn++;
    }
  }
  ctx.restore();
}

function drawLocalizedStormCells(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  weather: WeatherState,
  minIsoX: number,
  maxIsoX: number,
  minIsoY: number,
  maxIsoY: number,
  time: number
): void {
  ctx.save();
  const windSlant = 34 + weather.windStrength * 36;

  for (const cell of weather.cells) {
    if (cell.intensity <= 0.02) continue;
    const pad = cell.radiusIso + 240;
    if (
      cell.isoX + pad < minIsoX ||
      cell.isoX - pad > maxIsoX ||
      cell.isoY + pad < minIsoY ||
      cell.isoY - pad - 240 > maxIsoY
    ) {
      continue;
    }

    // 1. Localized Downpour Rain Curtain falling directly beneath this storm cell (single batched stroke)
    const dropCount = Math.floor(28 + cell.intensity * 36);
    ctx.strokeStyle = `rgba(186, 222, 248, ${(0.18 + cell.intensity * 0.24).toFixed(3)})`;
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    for (let i = 0; i < dropCount; i++) {
      const h1 = Math.sin(cell.seed + i * 12.9898) * 43758.5453;
      const f1 = h1 - Math.floor(h1);
      const h2 = Math.sin(cell.seed * 1.37 + i * 78.233) * 24634.6345;
      const f2 = h2 - Math.floor(h2);

      const angle = f1 * Math.PI * 2;
      const rad = Math.sqrt(f2) * cell.radiusIso * 0.86;
      const groundX = cell.isoX + Math.cos(angle) * rad;
      const groundY = cell.isoY + Math.sin(angle) * rad * 0.5;

      const fallProgress = (time * (1.8 + (i % 5) * 0.22) + f1 * 5.3 + f2 * 3.1) % 1;
      const topX = groundX - windSlant;
      const topY = groundY - 210;
      const headX = topX + (groundX - topX) * fallProgress;
      const headY = topY + (groundY - topY) * fallProgress;
      const streakFrac = 0.13 + (i % 3) * 0.03;
      const tailX = headX - (groundX - topX) * streakFrac;
      const tailY = headY - (groundY - topY) * streakFrac;

      ctx.moveTo(tailX, tailY);
      ctx.lineTo(headX, headY);
    }
    ctx.stroke();

    // 2. World-Space Forked Lightning Bolts discharging from the storm canopy
    for (const bolt of cell.bolts) {
      const ratio = Math.max(0, bolt.life / bolt.maxLife);
      const flicker = ratio > 0.72 ? 1 : ratio * (0.72 + 0.28 * Math.sin(time * 95 + cell.seed));
      const glowColor =
        bolt.hue === 'GOLD'
          ? `rgba(251, 191, 36, ${(flicker * 0.78).toFixed(3)})`
          : bolt.hue === 'VIOLET'
            ? `rgba(192, 132, 252, ${(flicker * 0.78).toFixed(3)})`
            : `rgba(103, 232, 249, ${(flicker * 0.78).toFixed(3)})`;
      const coreColor = `rgba(248, 252, 255, ${(flicker * 0.96).toFixed(3)})`;

      // Impact ring where the bolt meets the island / cloud sea
      const ringR = 14 + (1 - ratio) * 34;
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 2.2 * ratio + 0.6;
      ctx.beginPath();
      ctx.ellipse(bolt.impactX, bolt.impactY, ringR, ringR * 0.48, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = `rgba(240, 249, 255, ${(flicker * 0.55).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(bolt.impactX, bolt.impactY, ringR * 0.42, ringR * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Main bolt outer bloom
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 5.2 * flicker + 1.2;
      ctx.beginPath();
      bolt.points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();

      // Forked secondary branches
      ctx.lineWidth = 2.4 * flicker + 0.7;
      ctx.beginPath();
      for (const br of bolt.branches) {
        br.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      }
      ctx.stroke();

      // Crisp incandescent core
      ctx.strokeStyle = coreColor;
      ctx.lineWidth = 1.9 * flicker + 0.5;
      ctx.beginPath();
      bolt.points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }

    // 3. Elevated Billowing Storm Cloud Canopy hovering high above the cell
    const canopyY = cell.isoY - 210;
    const baseScale = (cell.radiusIso / 290) * 1.05;
    const lobes = [
      { ox: -cell.radiusIso * 0.32, oy: 12, s: 0.92, idx: 0, alpha: 0.72 },
      { ox: cell.radiusIso * 0.28, oy: 16, s: 0.88, idx: 1, alpha: 0.7 },
      { ox: 0, oy: -12, s: 1.12, idx: 2, alpha: 0.82 },
    ];

    for (const lobe of lobes) {
      const sprite = atlas.stormClouds[(Math.floor(cell.seed) + lobe.idx) % atlas.stormClouds.length];
      const sway = Math.sin(time * 0.55 + cell.seed + lobe.idx * 2.1) * 8;
      const w = sprite.width * baseScale * lobe.s;
      const h = sprite.height * baseScale * lobe.s;
      ctx.globalAlpha = cell.intensity * lobe.alpha;
      ctx.drawImage(
        sprite,
        cell.isoX + lobe.ox + sway - w * 0.5,
        canopyY + lobe.oy - h * 0.5,
        w,
        h
      );
    }

    // Internal thunderhead sheet-lightning glow when discharging
    if (cell.flash > 0.03) {
      const glowR = cell.radiusIso * 0.66;
      ctx.globalAlpha = 1;
      drawGlowEllipse(
        ctx,
        cell.isoX,
        canopyY + 6,
        glowR,
        glowR * 0.48,
        cell.flash * 0.48,
        'rgba(224, 242, 254, 0.96)',
        'rgba(147, 197, 253, 0.4)',
        'rgba(147, 197, 253, 0)',
        0.55
      );
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawWeatherScreenOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  weather: WeatherState,
  camera: CameraState,
  time: number
): void {
  const localStorm = getLocalizedStormFactorAtIso(weather, camera.x, camera.y);
  const effectiveRain = Math.min(1, weather.rainIntensity + localStorm * 0.48);
  const effectiveStorm = Math.min(1, weather.stormIntensity * 0.72 + localStorm * 0.58);

  if (effectiveRain <= 0.025 && effectiveStorm <= 0.04 && weather.globalFlash <= 0.01) {
    return;
  }

  ctx.save();

  // 1. Two-Layer Batched Screen-Space Rainfall (camera-coupled so panning stays silky & grounded)
  if (effectiveRain > 0.025) {
    const windDx = 0.16 + weather.windStrength * 0.22 + localStorm * 0.1;
    const camShiftX = camera.x * camera.zoom;
    const camShiftY = camera.y * camera.zoom;

    // Back layer: finer atmospheric mist-rain streaks
    const backCount = Math.floor(42 + effectiveRain * 78);
    const backLen = 14 + effectiveRain * 12;
    const backSpeed = 520 + weather.windStrength * 240;
    const backAlpha = Math.min(0.32, 0.09 + effectiveRain * 0.19);
    ctx.strokeStyle = `rgba(198, 226, 248, ${backAlpha.toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < backCount; i++) {
      const seedX = (i * 197.37) % width;
      const seedY = (i * 313.19) % height;
      const speedVar = 0.85 + (i % 5) * 0.08;
      const x =
        (((seedX - camShiftX * 0.25 + time * backSpeed * windDx * speedVar) % width) + width) %
        width;
      const y =
        (((seedY - camShiftY * 0.25 + time * backSpeed * speedVar) % height) + height) % height;
      ctx.moveTo(x, y);
      ctx.lineTo(x + backLen * windDx, y + backLen);
    }
    ctx.stroke();

    // Front layer: crisper foreground raindrops
    const frontCount = Math.floor(24 + effectiveRain * 64);
    const frontLen = 20 + effectiveRain * 18;
    const frontSpeed = 760 + weather.windStrength * 310;
    const frontAlpha = Math.min(0.46, 0.13 + effectiveRain * 0.28);
    ctx.strokeStyle = `rgba(224, 242, 255, ${frontAlpha.toFixed(3)})`;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (let i = 0; i < frontCount; i++) {
      const seedX = (i * 271.91 + 43) % width;
      const seedY = (i * 179.47 + 29) % height;
      const speedVar = 0.88 + (i % 4) * 0.09;
      const x =
        (((seedX - camShiftX * 0.45 + time * frontSpeed * windDx * speedVar) % width) + width) %
        width;
      const y =
        (((seedY - camShiftY * 0.45 + time * frontSpeed * speedVar) % height) + height) % height;
      ctx.moveTo(x, y);
      ctx.lineTo(x + frontLen * windDx, y + frontLen);
    }
    ctx.stroke();
  }

  // 2. Subtle atmospheric storm edge vignette for depth (cached offscreen canvas)
  if (effectiveStorm > 0.08) {
    const vigCanvas = getStormVignetteCanvas(width, height);
    ctx.globalAlpha = effectiveStorm * 0.28;
    ctx.drawImage(vigCanvas, 0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  // 3. Gentle sheet-lightning ambient flash when a localized bolt cracks on/near screen
  if (weather.globalFlash > 0.015) {
    ctx.fillStyle = `rgba(218, 238, 255, ${(weather.globalFlash * 0.11).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.restore();
}

function drawSkyBirds(
  ctx: CanvasRenderingContext2D,
  time: number,
  camera: CameraState,
  viewW: number,
  sunVisibility: number
): void {
  if (sunVisibility <= 0.12) return;
  const span = Math.max(2200, viewW * 2.2);
  ctx.save();
  ctx.strokeStyle = `rgba(248, 244, 232, ${(0.58 * sunVisibility).toFixed(3)})`;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';

  for (let flock = 0; flock < 3; flock++) {
    const speed = 26 + flock * 9;
    const baseX = camera.x * 0.65 - span * 0.5 + ((time * speed + flock * 740) % span);
    const baseY = camera.y * 0.65 - 260 + flock * 240 + Math.sin(time * 0.45 + flock) * 32;

    for (let b = 0; b < 4; b++) {
      const bx = baseX - b * 16 - (b % 2) * 5;
      const by = baseY + (b - 1.5) * 9 + Math.sin(time * 2.2 + b) * 3;
      const flap = Math.sin(time * 6.5 + b * 1.4 + flock * 2) * 3.2;
      const wing = 5.5 - b * 0.5;
      ctx.beginPath();
      ctx.moveTo(bx - wing, by + flap);
      ctx.quadraticCurveTo(bx - wing * 0.4, by - 2.4, bx, by);
      ctx.quadraticCurveTo(bx + wing * 0.4, by - 2.4, bx + wing, by + flap);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawAmbientSkyMotes(
  ctx: CanvasRenderingContext2D,
  time: number,
  camera: CameraState,
  viewW: number,
  viewH: number,
  sunVisibility: number
): void {
  if (sunVisibility <= 0.14) return;
  const halfW = (viewW * 0.6) / Math.max(0.4, camera.zoom);
  const halfH = (viewH * 0.6) / Math.max(0.4, camera.zoom);
  ctx.save();
  for (let i = 0; i < 14; i++) {
    const px =
      camera.x -
      halfW +
      (((i * 197.3 + time * (10 + (i % 4) * 3)) % (halfW * 2)) + halfW * 2) % (halfW * 2);
    const py =
      camera.y -
      halfH +
      (((i * 131.7 - time * (6 + (i % 3) * 2.5)) % (halfH * 2)) + halfH * 2) % (halfH * 2);
    const twinkle = (0.25 + 0.55 * Math.abs(Math.sin(time * 1.8 + i * 1.7))) * sunVisibility;
    ctx.fillStyle =
      i % 3 === 0
        ? `rgba(255, 248, 196, ${twinkle.toFixed(2)})`
        : `rgba(255, 255, 240, ${(twinkle * 0.7).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(px, py, 1.3 + (i % 2) * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawVictoryLightShafts(
  ctx: CanvasRenderingContext2D,
  state: WorldState,
  minIsoX: number,
  maxIsoX: number,
  minIsoY: number,
  maxIsoY: number,
  time: number
): void {
  // 1. Radiant golden skybeam descending onto any High Temple approaching Aether Overload (>= 60%)
  if (state.victoryRules.aetherOverload) {
    const target = state.victoryRules.aetherOverloadTarget || AETHER_OVERLOAD_TARGET;
    for (const fid of state.activeFactionIds) {
      const f = state.factions[fid];
      if (!f || f.eliminated) continue;
      const ratio = f.stormPower / target;
      if (ratio < 0.6) continue;
      const temple = state.structures.find((s) => s.owner === fid && s.kind === 'TEMPLE');
      if (!temple) continue;
      const pos = tileToIso(temple.tx, temple.ty);
      if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;

      const intensity = Math.min(1, (ratio - 0.6) / 0.4);
      const pulse = 0.82 + Math.sin(time * 3.4) * 0.18;
      const beamW = (28 + intensity * 34) * pulse;
      ctx.save();
      const grad = ctx.createLinearGradient(pos.x, pos.y - 380, pos.x, pos.y);
      grad.addColorStop(0, 'rgba(255, 250, 210, 0)');
      grad.addColorStop(0.55, `rgba(253, 224, 71, ${(0.12 + intensity * 0.22).toFixed(2)})`);
      grad.addColorStop(1, `rgba(255, 252, 224, ${(0.22 + intensity * 0.26).toFixed(2)})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pos.x - beamW * 0.85, pos.y - 380);
      ctx.lineTo(pos.x + beamW * 0.85, pos.y - 380);
      ctx.lineTo(pos.x + beamW * 0.5, pos.y + 4);
      ctx.lineTo(pos.x - beamW * 0.5, pos.y + 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // 2. Celestial sanctuary columns above controlled Sacred Sites when Altar Dominance timer is climbing
  if (state.victoryRules.altarDominance) {
    let leadOwner: Owner | null = null;
    let leadRatio = 0;
    for (const fid of state.activeFactionIds) {
      const f = state.factions[fid];
      if (!f || f.eliminated) continue;
      const r = f.dominanceSeconds / ALTAR_DOMINANCE_DURATION;
      if (r > leadRatio) {
        leadRatio = r;
        leadOwner = fid;
      }
    }
    if (leadOwner && leadRatio >= 0.2) {
      const col = getOwnerColor(state, leadOwner);
      const intensity = Math.min(1, (leadRatio - 0.2) / 0.8);
      for (const site of state.sacredSites) {
        if (site.controller !== leadOwner) continue;
        const pos = tileToIso(site.tx, site.ty);
        if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
        const beamW = 24 + intensity * 24;
        ctx.save();
        const grad = ctx.createLinearGradient(pos.x, pos.y - 320, pos.x, pos.y);
        grad.addColorStop(0, `${col}00`);
        grad.addColorStop(0.6, `${col}26`);
        grad.addColorStop(1, `${col}48`);
        ctx.fillStyle = grad;
        ctx.fillRect(pos.x - beamW * 0.5, pos.y - 320, beamW, 320);
        ctx.restore();
      }
    }
  }
}

function directionIsoVector(facing: Direction): { x: number; y: number } {
  const { dx, dy } = directionVector(facing);
  const v = tileToIso(dx, dy);
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

function drawEnergyFences(
  ctx: CanvasRenderingContext2D,
  state: WorldState,
  minIsoX: number,
  maxIsoX: number,
  minIsoY: number,
  maxIsoY: number,
  time: number
): void {
  if (state.energyFences.length === 0) return;
  for (const fence of state.energyFences) {
    if (!fence.active) continue;
    if (
      fence.owner !== 'PLAYER' &&
      !isTileFogVisible(state, fence.ax, fence.ay) &&
      !isTileFogVisible(state, fence.bx, fence.by)
    ) {
      continue;
    }
    const a = tileToIso(fence.ax, fence.ay);
    const b = tileToIso(fence.bx, fence.by);
    if (
      Math.max(a.x, b.x) < minIsoX ||
      Math.min(a.x, b.x) > maxIsoX ||
      Math.max(a.y, b.y) < minIsoY ||
      Math.min(a.y, b.y) > maxIsoY
    ) {
      continue;
    }
    const teamCol = getOwnerColor(state, fence.owner);
    const pulse = 0.72 + 0.28 * Math.sin(time * 9 + fence.pylonAId);

    ctx.save();
    // Translucent barrier ribbon aligned with the Fence Pylon conductor orbs
    const ribGrad = ctx.createLinearGradient(a.x, a.y - 52, a.x, a.y - 10);
    ribGrad.addColorStop(0, 'rgba(56, 189, 248, 0.28)');
    ribGrad.addColorStop(0.55, `${teamCol}28`);
    ribGrad.addColorStop(1, 'rgba(56, 189, 248, 0.06)');
    ctx.fillStyle = ribGrad;
    ctx.globalAlpha = 0.92 * pulse;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 52);
    ctx.lineTo(b.x, b.y - 52);
    ctx.lineTo(b.x, b.y - 12);
    ctx.lineTo(a.x, a.y - 12);
    ctx.closePath();
    ctx.fill();

    // Dual crackling Aether energy rails spanning pylon-to-pylon
    const midX = (a.x + b.x) * 0.5;
    const midY = (a.y + b.y) * 0.5;
    const wave = Math.sin(time * 13 + fence.pylonAId * 1.7) * 2.6;

    ctx.strokeStyle = '#38bdf8';
    ctx.globalAlpha = 0.88 * pulse;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 51);
    ctx.quadraticCurveTo(midX, midY - 51 + wave, b.x, b.y - 51);
    ctx.moveTo(a.x, a.y - 31);
    ctx.quadraticCurveTo(midX, midY - 31 - wave * 0.8, b.x, b.y - 31);
    ctx.stroke();

    // Crisp luminous white-gold inner plasma filaments
    ctx.strokeStyle = '#f0fdfa';
    ctx.globalAlpha = 0.82 * pulse;
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 51);
    ctx.quadraticCurveTo(midX, midY - 51 + wave, b.x, b.y - 51);
    ctx.moveTo(a.x, a.y - 31);
    ctx.quadraticCurveTo(midX, midY - 31 - wave * 0.8, b.x, b.y - 31);
    ctx.stroke();

    // Drifting spark mote traveling along the top rail
    const sparkT = (time * 1.15 + fence.pylonAId * 0.37) % 1;
    const sx = a.x + (b.x - a.x) * sparkT;
    const sy = a.y - 51 + (b.y - a.y) * sparkT;
    ctx.fillStyle = '#fef9c3';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(sx, sy, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawAerialUnit(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  state: WorldState,
  a: AerialUnit,
  x: number,
  y: number,
  time: number,
  isSelected: boolean
): void {
  const teamCol = getOwnerColor(state, a.owner);
  const bob = Math.sin(a.animPhase) * (a.kind === 'SKY_LEVIATHAN' ? 4.2 : 3.0);
  const alt = (a.kind === 'ROVING_WHIRLWIND' ? 14 : a.kind === 'SKY_LEVIATHAN' ? 34 : 30) + bob;
  const flash = a.hitFlash > 0;

  // Isometric horizontal flight direction (> 0 means moving right on screen)
  const isoDirX = Math.cos(a.heading) - Math.sin(a.heading);
  const flipX = isoDirX > 0.08;

  ctx.save();
  ctx.translate(x, y);

  // Soft painterly shadow projected far beneath airborne craft
  ctx.fillStyle = 'rgba(14, 24, 42, 0.3)';
  ctx.beginPath();
  ctx.ellipse(
    5,
    3,
    a.kind === 'SKY_LEVIATHAN' ? 23 : a.kind === 'SKY_TRANSPORT' ? 20 : 15,
    a.kind === 'SKY_LEVIATHAN' ? 11 : a.kind === 'SKY_TRANSPORT' ? 9 : 7,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // Subtle faction ground projection ring so airborne units are easy to locate & click
  ctx.strokeStyle = teamCol;
  ctx.globalAlpha = isSelected ? 0.92 : 0.48;
  ctx.lineWidth = isSelected ? 2.2 : 1.35;
  ctx.beginPath();
  ctx.ellipse(0, 2, isSelected ? 23 : 17, isSelected ? 11.5 : 8.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.translate(0, -alt);

  let hpBarY = -58;

  if (a.kind === 'SUN_FLYER') {
    hpBarY = -58;
    const drew = drawBespokeSprite(ctx, atlas.units.solarSkiff, 66, 20, flash, false, flipX);
    if (drew) {
      // Glowing rear sun-crystal engine thruster bloom & faction pennant
      const thrustX = flipX ? -22 : 22;
      const thrustY = -20;
      const pulse = 0.8 + 0.2 * Math.sin(time * 9 + a.id);
      drawGlowCircle(
        ctx,
        thrustX,
        thrustY,
        12 * pulse,
        0.86,
        'rgba(255, 252, 214, 0.98)',
        'rgba(245, 184, 50, 0.42)',
        'rgba(245, 184, 50, 0)',
        0.5
      );

      drawFactionPennant(ctx, flipX ? -8 : 8, -32, teamCol, time, a.id * 0.7);
    } else {
      ctx.fillStyle = flash ? '#ffffff' : '#f59e0b';
      ctx.beginPath();
      ctx.ellipse(0, -8, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (a.kind === 'SKY_TRANSPORT') {
    hpBarY = -74;
    // Glowing Aether grapple tether & bound Priest orb when airlifting a captured Priest
    if (a.carryingPriestId !== null) {
      const sway = Math.sin(time * 4.2 + a.id) * 2.5;
      ctx.save();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, 12);
      ctx.lineTo(sway, 29);
      ctx.stroke();

      drawGlowCircle(
        ctx,
        sway,
        31,
        13,
        0.95,
        'rgba(254, 249, 195, 0.98)',
        'rgba(192, 132, 252, 0.58)',
        'rgba(192, 132, 252, 0)',
        0.5
      );

      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(sway, 31, 4.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const drew = drawBespokeSprite(ctx, atlas.units.aetherDirigible, 76, 22, flash, false, flipX);
    if (drew) {
      // Warm golden lantern bloom under the wooden gondola
      const pulse = 0.8 + 0.2 * Math.sin(time * 4.5 + a.id);
      drawGlowCircle(
        ctx,
        0,
        8,
        13 * pulse,
        0.66,
        'rgba(255, 250, 200, 0.96)',
        'rgba(245, 180, 48, 0.34)',
        'rgba(245, 180, 48, 0)',
        0.55
      );

      drawFactionPennant(ctx, flipX ? -18 : 18, -46, teamCol, time, a.id * 0.6);
    } else {
      ctx.fillStyle = flash ? '#ffffff' : '#e8dec8';
      ctx.beginPath();
      ctx.ellipse(0, -14, 20, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (a.kind === 'ROVING_WHIRLWIND') {
    hpBarY = -66;
    const swayX = Math.sin(time * 7.5 + a.id) * 2.4;
    const scalePulse = 1 + Math.sin(time * 9 + a.id) * 0.035;
    ctx.save();
    ctx.translate(swayX, 0);
    ctx.scale(scalePulse, 1);
    const drew = drawBespokeSprite(ctx, atlas.units.tempestVortex, 68, 18, flash, false, false);
    ctx.restore();

    if (drew) {
      // Swirling painterly emerald-mint wind ribbons & emerald core shimmer
      for (let i = 0; i < 3; i++) {
        const ang = time * 5.2 + i * 2.1 + a.id;
        const r = 18 + i * 5;
        const wy = -14 - i * 11;
        ctx.strokeStyle = i % 2 === 0 ? 'rgba(94, 234, 212, 0.6)' : 'rgba(240, 253, 250, 0.5)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(swayX, wy, r, ang, ang + 1.1);
        ctx.stroke();
      }
      // Subtle faction crest dot at crown
      ctx.fillStyle = teamCol;
      ctx.beginPath();
      ctx.arc(swayX, -52, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fef9c3';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#5eead4';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(0, -12, 16, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    // SKY_LEVIATHAN — Soaring bioluminescent Sky Man-o-War Cruiser
    hpBarY = -74;
    const drew = drawBespokeSprite(ctx, atlas.units.skyLeviathan, 78, 28, flash, false, flipX);
    if (drew) {
      const pulse = 0.8 + 0.2 * Math.sin(time * 3.4 + a.id);
      drawGlowCircle(
        ctx,
        0,
        -34,
        24 * pulse,
        0.58,
        'rgba(186, 230, 253, 0.96)',
        'rgba(56, 189, 248, 0.38)',
        'rgba(56, 189, 248, 0)',
        0.55
      );

      for (let i = 0; i < 3; i++) {
        const ang = time * 2.9 + i * 2.1 + a.id;
        ctx.fillStyle = '#e0f2fe';
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * 20, -10 + Math.sin(ang * 1.4) * 9, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      drawFactionPennant(ctx, flipX ? -18 : 18, -46, teamCol, time, a.id * 0.5);
    } else {
      ctx.fillStyle = flash ? '#ffffff' : 'rgba(56, 189, 248, 0.72)';
      ctx.beginPath();
      ctx.arc(0, -10, 18, Math.PI, 0);
      ctx.fill();
    }
  }

  // Health Bar
  if (a.hp < a.maxHp) {
    const ratio = Math.max(0, a.hp / a.maxHp);
    ctx.fillStyle = 'rgba(10, 16, 26, 0.9)';
    ctx.fillRect(-16, hpBarY, 32, 4.5);
    ctx.fillStyle = teamCol;
    ctx.fillRect(-15, hpBarY + 1, 30 * ratio, 2.5);
  }

  ctx.restore();
}

function drawFogOfWarOverlay(
  ctx: CanvasRenderingContext2D,
  state: WorldState,
  minTx: number,
  maxTx: number,
  minTy: number,
  maxTy: number,
  minIsoX: number,
  maxIsoX: number,
  minIsoY: number,
  maxIsoY: number,
  _time: number
): void {
  const gs = state.gridSize;
  const grid = state.fogGrid;
  if (grid.length !== gs * gs) return;

  ctx.save();
  // Batch explored-shroud tiles (fog === 1)
  ctx.fillStyle = 'rgba(12, 22, 38, 0.44)';
  ctx.beginPath();
  for (let y = minTy; y <= maxTy; y++) {
    const row = y * gs;
    for (let x = minTx; x <= maxTx; x++) {
      if (grid[row + x] !== 1) continue;
      if (state.tiles[y][x].kind === 'VOID') continue;
      const pos = tileToIso(x, y);
      if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
      const hw = TILE_W * 0.54;
      const hh = TILE_H * 0.54;
      ctx.moveTo(pos.x, pos.y - hh);
      ctx.lineTo(pos.x + hw, pos.y);
      ctx.lineTo(pos.x, pos.y + hh);
      ctx.lineTo(pos.x - hw, pos.y);
      ctx.closePath();
    }
  }
  ctx.fill();

  // Batch unexplored deep storm-cloud shroud tiles (fog === 0)
  ctx.fillStyle = 'rgba(15, 28, 48, 0.86)';
  ctx.beginPath();
  for (let y = minTy; y <= maxTy; y++) {
    const row = y * gs;
    for (let x = minTx; x <= maxTx; x++) {
      if (grid[row + x] !== 0) continue;
      const pos = tileToIso(x, y);
      if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
      const hw = TILE_W * 0.62;
      const hh = TILE_H * 0.62;
      ctx.moveTo(pos.x, pos.y - hh);
      ctx.lineTo(pos.x + hw, pos.y);
      ctx.lineTo(pos.x, pos.y + hh);
      ctx.lineTo(pos.x - hw, pos.y);
      ctx.closePath();
    }
  }
  ctx.fill();
  ctx.restore();
}

let minimapTerrainCache: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  gridSize: number;
  terrainVersion: number;
  fogOfWar: boolean;
  stateRef: WorldState;
} | null = null;

function getMinimapTerrainCanvas(
  width: number,
  height: number,
  state: WorldState,
  bounds: { minX: number; minY: number; spanX: number; spanY: number }
): HTMLCanvasElement {
  const cw = Math.max(1, Math.round(width));
  const ch = Math.max(1, Math.round(height));
  const gs = state.gridSize;
  const fogEnabled = state.victoryRules.fogOfWar;

  if (
    minimapTerrainCache &&
    minimapTerrainCache.width === cw &&
    minimapTerrainCache.height === ch &&
    minimapTerrainCache.gridSize === gs &&
    minimapTerrainCache.terrainVersion === state.terrainVersion &&
    minimapTerrainCache.fogOfWar === fogEnabled &&
    minimapTerrainCache.stateRef === state
  ) {
    return minimapTerrainCache.canvas;
  }

  const canvas = minimapTerrainCache?.canvas ?? document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const mctx = canvas.getContext('2d');
  if (mctx) {
    // Dual sunlit-sky-to-storm-front minimap backdrop
    const bgGrad = mctx.createLinearGradient(0, 0, cw, ch);
    bgGrad.addColorStop(0, '#2a5f99');
    bgGrad.addColorStop(0.55, '#254c78');
    bgGrad.addColorStop(1, '#142238');
    mctx.fillStyle = bgGrad;
    mctx.fillRect(0, 0, cw, ch);

    const landDotW = Math.max(2.0, 3.6 * (50 / gs));
    const landDotH = Math.max(1.6, 2.8 * (50 / gs));
    const bridgeDotW = Math.max(1.8, 3.0 * (50 / gs));
    const bridgeDotH = Math.max(1.5, 2.4 * (50 / gs));
    const invSpanX = cw / bounds.spanX;
    const invSpanY = ch / bounds.spanY;

    for (let y = 0; y < gs; y++) {
      const row = state.tiles[y];
      for (let x = 0; x < gs; x++) {
        const tile = row[x];
        if (tile.kind === 'VOID') continue;
        const fog = fogEnabled ? getFogState(state, x, y) : 2;
        if (fog === 0) continue;
        const iso = tileToIso(x, y);
        const mx = (iso.x - bounds.minX) * invSpanX;
        const my = (iso.y - bounds.minY) * invSpanY;
        if (tile.kind === 'LAND') {
          const poweredByPlayer = (tile.poweredMask & PLAYER_POWER_BIT) !== 0;
          if (fog === 1) {
            mctx.fillStyle = '#334d5c';
          } else if (poweredByPlayer) {
            mctx.fillStyle = '#62b858';
          } else if (tile.poweredMask !== 0) {
            const aiVis = getPoweredAiVisual(state, tile.poweredMask);
            mctx.fillStyle = aiVis?.landTint ?? '#9e5054';
          } else {
            mctx.fillStyle = '#6da654';
          }
          mctx.fillRect(mx - landDotW * 0.5, my - landDotH * 0.5, landDotW, landDotH);
        } else {
          if (tile.owner !== 'PLAYER' && fog < 2) continue;
          mctx.fillStyle = getOwnerColor(state, tile.owner);
          mctx.fillRect(mx - bridgeDotW * 0.5, my - bridgeDotH * 0.5, bridgeDotW, bridgeDotH);
        }
      }
    }
  }

  minimapTerrainCache = {
    canvas,
    width: cw,
    height: ch,
    gridSize: gs,
    terrainVersion: state.terrainVersion,
    fogOfWar: fogEnabled,
    stateRef: state,
  };
  return canvas;
}

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: WorldState,
  camera: CameraState,
  viewW: number,
  viewH: number
): void {
  const bounds = getWorldIsoBounds(state.gridSize);
  const fogEnabled = state.victoryRules.fogOfWar;

  // Blit cached static minimap terrain/bridge/fog backdrop (rebuilt only on terrainVersion/fog/resize changes)
  const terrainCanvas = getMinimapTerrainCanvas(width, height, state, bounds);
  ctx.drawImage(terrainCanvas, 0, 0, width, height);

  const mapX = (tx: number, ty: number) => {
    const iso = tileToIso(tx, ty);
    return ((iso.x - bounds.minX) / bounds.spanX) * width;
  };
  const mapY = (tx: number, ty: number) => {
    const iso = tileToIso(tx, ty);
    return ((iso.y - bounds.minY) / bounds.spanY) * height;
  };

  for (const g of state.geysers) {
    if (fogEnabled && getFogState(state, g.tx, g.ty) === 0) continue;
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(mapX(g.tx, g.ty), mapY(g.tx, g.ty), g.isSuper ? 2.8 : 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sacred Site diamond beacons when Altar Dominance is active
  if (state.victoryRules.altarDominance) {
    for (const site of state.sacredSites) {
      const sx = mapX(site.tx, site.ty);
      const sy = mapY(site.tx, site.ty);
      const r = site.role === 'CITADEL' ? 4.4 : 3.4;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy);
      ctx.lineTo(sx, sy + r);
      ctx.lineTo(sx - r, sy);
      ctx.closePath();
      ctx.fillStyle = site.controller
        ? getOwnerColor(state, site.controller)
        : site.contested
          ? '#f59e0b'
          : '#f5dfaa';
      ctx.fill();
      ctx.strokeStyle = '#0c1522';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Aerial Units on minimap
  for (const a of state.aerialUnits) {
    if (a.owner !== 'PLAYER' && !isTileFogVisible(state, a.x, a.y)) continue;
    const ax = mapX(a.x, a.y);
    const ay = mapY(a.x, a.y);
    ctx.fillStyle = a.owner === 'PLAYER' ? '#67e8f9' : getOwnerColor(state, a.owner);
    ctx.beginPath();
    ctx.moveTo(ax, ay - 3);
    ctx.lineTo(ax + 3, ay + 2);
    ctx.lineTo(ax - 3, ay + 2);
    ctx.closePath();
    ctx.fill();
  }

  for (const p of state.priests) {
    if (p.state === 'SACRIFICED') continue;
    if (p.owner !== 'PLAYER' && !isTileFogVisible(state, p.x, p.y)) continue;
    ctx.fillStyle = p.isRogue ? '#c084fc' : p.owner === 'PLAYER' ? '#ffffff' : getOwnerColor(state, p.owner);
    ctx.beginPath();
    ctx.arc(mapX(p.x, p.y), mapY(p.x, p.y), 3.0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Localized Thunderstorm Cells drifting across the minimap
  if (state.weather.cells.length > 0) {
    ctx.save();
    for (const cell of state.weather.cells) {
      if (cell.intensity <= 0.08) continue;
      const cx = ((cell.isoX - bounds.minX) / bounds.spanX) * width;
      const cy = ((cell.isoY - bounds.minY) / bounds.spanY) * height;
      const rx = Math.max(6, (cell.radiusIso / bounds.spanX) * width);
      const ry = Math.max(4, ((cell.radiusIso * 0.6) / bounds.spanY) * height);
      ctx.fillStyle =
        cell.flash > 0.15
          ? `rgba(186, 230, 253, ${(0.24 + cell.flash * 0.28).toFixed(3)})`
          : `rgba(15, 23, 42, ${(cell.intensity * 0.42).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle =
        cell.flash > 0.15
          ? `rgba(253, 224, 71, ${(0.45 + cell.flash * 0.45).toFixed(3)})`
          : `rgba(125, 211, 252, ${(cell.intensity * 0.42).toFixed(3)})`;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    ctx.restore();
  }

  const camLeft = ((camera.x - (viewW * 0.5) / camera.zoom - bounds.minX) / bounds.spanX) * width;
  const camTop = ((camera.y - (viewH * 0.5) / camera.zoom - bounds.minY) / bounds.spanY) * height;
  const camW = ((viewW / camera.zoom) / bounds.spanX) * width;
  const camH = ((viewH / camera.zoom) / bounds.spanY) * height;

  ctx.strokeStyle = 'rgba(245, 223, 170, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(camLeft, camTop, camW, camH);
}
