import {
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
  CaptureExplosion,
  Crystal,
  Direction,
  Geyser,
  Golem,
  ImpactEffect,
  Owner,
  PlacementMode,
  Priest,
  Projectile,
  RangeOverlayState,
  Structure,
  Tile,
} from './types';
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
  selectedKind: 'STRUCTURE' | 'PRIEST' | 'GOLEM' | 'GEYSER' | null;
  hoveredId: number | null;
  hoveredKind: 'STRUCTURE' | 'PRIEST' | 'GOLEM' | 'GEYSER' | null;
  rangeOverlay: RangeOverlayState;
  time: number;
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

const islandLabelAnchorCache = new WeakMap<object, { x: number; y: number }>();

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

  // 1. Cached Dual Sunlit Golden-Hour Sky & Eastern Rolling Storm Front
  const playerFury = state.factions.PLAYER.fury;
  const skyCanvas = getSkyBackdropCanvas(width, height, playerFury);
  ctx.drawImage(skyCanvas, 0, 0, width, height);

  // Angled volumetric golden sunbeams streaming across the sunlit sky (cached offscreen)
  drawVolumetricSunbeams(ctx, width, height, time);

  // Periodic branching golden storm lightning crackling in the eastern thunderhead
  drawEasternStormFront(ctx, width, height, time, playerFury);

  // 2. World Camera Transform
  ctx.save();
  ctx.translate(width * 0.5, height * 0.5);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x + camera.shakeX, -camera.y + camera.shakeY);

  // Deep Abyss Layer: Culled Sunlit Cumulus / Eastern Thunderclouds + Distant Floating Islets + Soaring Sky-Birds
  drawParallaxClouds(ctx, atlas, time, camera, width, height, 0);
  drawDistantIslets(ctx, atlas, time, camera, width, height);
  drawSkyBirds(ctx, time, camera, width);
  drawParallaxClouds(ctx, atlas, time, camera, width, height, 1);

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

  // O(1) per-frame lookup sets for sacred flagstones, occupied tiles, & island centers
  const nearSacredSet = new Set<number>();
  const occupiedTileSet = new Set<number>();
  for (const s of state.structures) {
    occupiedTileSet.add(s.ty * gs + s.tx);
    if (s.kind === 'TEMPLE' || s.kind === 'ALTAR') {
      for (let dy = -1; dy <= 1; dy++) {
        const ny = s.ty + dy;
        if (ny < 0 || ny >= gs) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = s.tx + dx;
          if (nx >= 0 && nx < gs) {
            nearSacredSet.add(ny * gs + nx);
          }
        }
      }
    }
  }
  for (const g of state.geysers) {
    occupiedTileSet.add(g.ty * gs + g.tx);
  }
  const islandCenterById = new Map<number, { cx: number; cy: number }>();
  for (const isl of state.islands) {
    islandCenterById.set(isl.id, { cx: Math.round(isl.centerX), cy: Math.round(isl.centerY) });
  }

  // 3. Draw Visible Floating Islands & Vaulted Arched Stone Sky-Bridges in Isometric Painter's Order
  const minSum = minTx + minTy;
  const maxSum = maxTx + maxTy;
  for (let sum = minSum; sum <= maxSum; sum++) {
    const startX = Math.max(minTx, sum - maxTy);
    const endX = Math.min(maxTx, sum - minTy);
    for (let x = startX; x <= endX; x++) {
      const y = sum - x;
      const tile = state.tiles[y][x];
      if (tile.kind === 'VOID') continue;

      const pos = tileToIso(x, y);
      if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;

      if (tile.kind === 'LAND') {
        const nearSacred = nearSacredSet.has(y * gs + x);
        const islCenter = islandCenterById.get(tile.islandId);
        const isCobbleRoad =
          !nearSacred &&
          islCenter !== undefined &&
          ((x === islCenter.cx && Math.abs(y - islCenter.cy) <= 3) ||
            (y === islCenter.cy && Math.abs(x - islCenter.cx) <= 3));
        drawLandTile(ctx, atlas, state, tile, pos.x, pos.y, nearSacred, isCobbleRoad, playerColor, time);
      } else {
        drawBridgeTile(ctx, state, tile, pos.x, pos.y, time);
      }
    }
  }

  // 3b. Drifting Soft Cloud Shadows Gliding Across the Archipelago
  drawCloudShadows(ctx, atlas, state, minIsoX, maxIsoX, minIsoY, maxIsoY, time);

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
    const site = state.victoryRules.altarDominance
      ? state.sacredSites.find((s) => s.islandId === island.id)
      : undefined;
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
      if (occupiedTileSet.has(pt.y * gs + pt.x)) continue;

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
    const pos = tileToIso(s.tx, s.ty);
    if (pos.x < minIsoX || pos.x > maxIsoX || pos.y < minIsoY || pos.y > maxIsoY) continue;
    const isSelected = info.selectedKind === 'STRUCTURE' && info.selectedId === s.id;
    renderables.push({
      depth: s.tx + s.ty + 0.05,
      draw: () => drawStructure(ctx, atlas, state, s, pos.x, pos.y, time, isSelected),
    });
  }

  for (const g of state.golems) {
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

  // 7. Projectiles, Lightning Arcs, Sacrifice Beams, Particles & Floating Text
  for (const proj of state.projectiles) {
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

  // High-altitude wispy foreground clouds & drifting golden sunlit lantern motes
  drawParallaxClouds(ctx, atlas, time, camera, width, height, 2);
  drawAmbientSkyMotes(ctx, time, camera, width, height);

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

function drawVolumetricSunbeams(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number
): void {
  const cached = getSunbeamCanvas(width, height);
  const shimmer = 0.78 + 0.22 * Math.sin(time * 0.45);
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
  playerFury: 'WIND' | 'RAIN' | 'THUNDER'
): void {
  // Periodic branching golden-amber lightning forks crackling in the eastern thunderclouds
  const cyclePeriod = playerFury === 'THUNDER' ? 4.4 : 6.2;
  const cycleIdx = Math.floor(time / cyclePeriod);
  const localT = (time % cyclePeriod) / cyclePeriod;
  const flashEnv =
    localT < 0.065
      ? Math.sin((localT / 0.065) * Math.PI)
      : localT > 0.085 && localT < 0.13
        ? Math.sin(((localT - 0.085) / 0.045) * Math.PI) * 0.72
        : 0;

  if (flashEnv <= 0.02) return;

  const anchorX = width * (0.76 + ((cycleIdx * 37) % 18) * 0.01);
  const anchorY = height * (0.04 + ((cycleIdx * 23) % 10) * 0.01);

  // Internal cloud illumination glow behind the lightning fork
  const glow = ctx.createRadialGradient(anchorX, anchorY + height * 0.12, 8, anchorX, anchorY + height * 0.12, width * 0.24);
  glow.addColorStop(0, `rgba(255, 224, 130, ${flashEnv * 0.34})`);
  glow.addColorStop(0.55, `rgba(245, 176, 65, ${flashEnv * 0.14})`);
  glow.addColorStop(1, 'rgba(245, 176, 65, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

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
  layer: number
): void {
  const parallax = layer === 0 ? 0.28 : layer === 1 ? 0.52 : 1.15;
  const invZoom = 1 / Math.max(0.35, camera.zoom);
  const halfWorldW = viewW * 0.5 * invZoom;
  const halfWorldH = viewH * 0.5 * invZoom;
  const visCenterX = camera.x * parallax;
  const visCenterY = camera.y * parallax;

  ctx.save();
  ctx.translate(camera.x * (1 - parallax), camera.y * (1 - parallax));

  for (const c of CLOUDS) {
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

    // Position relative to viewport horizontal center decides sunlit cumulus vs eastern storm front
    const relScreenX = cx - visCenterX;
    const isEasternStorm = layer !== 2 && relScreenX > halfWorldW * 0.14;
    const sprite = isEasternStorm
      ? atlas.stormClouds[c.spriteIdx % atlas.stormClouds.length]
      : atlas.sunlitClouds[c.spriteIdx % atlas.sunlitClouds.length];

    const w = sprite.width * c.scale;
    const h = sprite.height * c.scale;
    ctx.globalAlpha = layer === 2 ? 0.13 : isEasternStorm ? Math.min(0.88, c.alpha + 0.12) : c.alpha;
    ctx.drawImage(sprite, cx - w * 0.5, cy - h * 0.5, w, h);
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

  // Swirling sunlit white mist plumes blooming at the bottom of the cascade
  const puffPulse = Math.sin(time * 2.6 + seed * 11) * 2.4;
  const mistY = y + fallH * 0.76;
  const mistGrad = ctx.createRadialGradient(x, mistY, 2, x, mistY, 18 + puffPulse);
  mistGrad.addColorStop(0, 'rgba(246, 252, 255, 0.62)');
  mistGrad.addColorStop(0.55, 'rgba(222, 242, 255, 0.28)');
  mistGrad.addColorStop(1, 'rgba(222, 242, 255, 0)');
  ctx.fillStyle = mistGrad;
  ctx.beginPath();
  ctx.ellipse(x, mistY, 17 + puffPulse, 10 + puffPulse * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawLandTile(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  state: WorldState,
  tile: Tile,
  cx: number,
  cy: number,
  nearSacred: boolean,
  isCobbleRoad: boolean,
  playerColor: string,
  time: number
): void {
  const hw = TILE_W * 0.5;
  const hh = TILE_H * 0.5;
  const gs = state.gridSize;

  const southVoid = !inBounds(tile.x, tile.y + 1, gs) || state.tiles[tile.y + 1][tile.x].kind === 'VOID';
  const eastVoid = !inBounds(tile.x + 1, tile.y, gs) || state.tiles[tile.y][tile.x + 1].kind === 'VOID';
  const cliffDepth = 36 + tile.variant * 24;

  // Faceted Warm Ochre-Sandstone & Slate Craggy Floating Island Undersides (gradient-free layered facets)
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

    // Scenic cascading cliffside waterfalls spilling into foaming cloud mist
    const waterfallHash = (tile.x * 7 + tile.y * 13) % 11;
    if ((waterfallHash === 0 && tile.variant > 0.25) || (tile.variant > 0.93 && (tile.x + tile.y) % 3 === 0)) {
      drawCliffWaterfall(ctx, cx - hw * 0.48, cy + hh * 0.52, 78 + tile.variant * 26, time, tile.variant);
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

  // Blit Pre-Rendered Painterly Sunlit Emerald Turf, Cobbled Path, or Marble Flagstone Sprite
  const sprite = nearSacred
    ? atlas.flagstoneTile
    : isCobbleRoad
      ? atlas.cobbleTiles[Math.floor(tile.variant * atlas.cobbleTiles.length) % atlas.cobbleTiles.length]
      : atlas.landTiles[Math.floor(tile.variant * atlas.landTiles.length) % atlas.landTiles.length];
  ctx.drawImage(sprite, cx - sprite.width * 0.5, cy - sprite.height * 0.5);

  // Subtle carved elemental territory shimmer
  const mask = tile.poweredMask;
  const poweredByPlayer = (mask & PLAYER_POWER_BIT) !== 0;
  const contested = mask !== 0 && (mask & (mask - 1)) !== 0;
  const aiVisual = mask > 0 && !poweredByPlayer ? getPoweredAiVisual(state, mask) : null;

  if (contested) {
    drawIsoDiamond(ctx, cx, cy, TILE_W - 6, TILE_H - 3);
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  } else if (poweredByPlayer) {
    drawIsoDiamond(ctx, cx, cy, TILE_W - 8, TILE_H - 4);
    ctx.fillStyle = playerColor;
    ctx.globalAlpha = 0.06;
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (aiVisual) {
    drawIsoDiamond(ctx, cx, cy, TILE_W - 8, TILE_H - 4);
    ctx.fillStyle = aiVisual.color;
    ctx.globalAlpha = 0.07;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Faint ancient carved rune glow on powered sacred tiles
  if (nearSacred && mask !== 0) {
    const pulse = 0.28 + Math.sin(time * 2.5 + tile.x) * 0.1;
    drawIsoDiamond(ctx, cx, cy, TILE_W * 0.5, TILE_H * 0.5);
    ctx.strokeStyle = poweredByPlayer ? playerColor : (aiVisual?.color ?? '#ef4444');
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 1.3;
    ctx.stroke();
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
    const unlocked = def.tier <= state.factions.PLAYER.knowledgeTier;
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
    }

    // Translucent bespoke sprite preview of the tower being placed (with true 4-way facing)
    const preview = getBuildPreviewSprite(atlas, placement.kind, placement.facing);
    if (preview && preview.sprite.ready) {
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.globalAlpha = ok ? 0.72 : 0.36;
      if (def.directional) {
        drawDirectionalAimChevron(ctx, placement.facing, ok ? ALIGNMENT_COLORS[def.alignment] : '#f87171', true, time);
      }
      drawBespokeSprite(ctx, preview.sprite, preview.width, 17, false, false, preview.flipX);
      ctx.restore();
    }

    if (!ok) {
      const reason = !unlocked
        ? 'Sacrifice a Rogue Priest to unlock'
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
    }
  };

  if (info.selectedKind === 'STRUCTURE' && info.selectedId !== null) {
    const s = state.structures.find((st) => st.id === info.selectedId);
    if (s) drawRangeForStructure(s, false);
  }

  // Also preview hovered entity highlight & attack/aura range when not overlapping active structure placement
  if (info.hoveredKind !== null && info.hoveredId !== null) {
    const sameAsSelected = info.hoveredKind === info.selectedKind && info.hoveredId === info.selectedId;
    if (info.hoveredKind === 'STRUCTURE' && !sameAsSelected && info.placement.type !== 'STRUCTURE') {
      const s = state.structures.find((st) => st.id === info.hoveredId);
      if (s) drawRangeForStructure(s, true);
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

  // Radiant golden sunlight aura spilling across surrounding island moss
  const groundHalo = ctx.createRadialGradient(x, y, 4, x, y, r * (1.95 + eruptSoon * 0.4));
  groundHalo.addColorStop(0, `rgba(255, 236, 138, ${0.42 + pulse * 0.18 + eruptSoon * 0.2})`);
  groundHalo.addColorStop(0.55, `rgba(245, 180, 48, ${0.18 + pulse * 0.08 + eruptSoon * 0.1})`);
  groundHalo.addColorStop(1, 'rgba(245, 180, 48, 0)');
  ctx.fillStyle = groundHalo;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 2.05, r * 1.1, 0, 0, Math.PI * 2);
  ctx.fill();

  const ventSprite = atlas.structures.aetherVent;
  if (ventSprite.ready) {
    const drawW = g.isSuper ? 68 : 54;
    const drawH = drawW * (ventSprite.height / Math.max(1, ventSprite.width));
    ctx.drawImage(ventSprite.canvas, x - drawW * 0.5, y + (g.isSuper ? 17 : 13) - drawH, drawW, drawH);

    // Molten golden geothermal pulse breathing inside the painted crater mouth
    const coreGrad = ctx.createRadialGradient(x, y - 2, 1, x, y - 2, r * (0.72 + eruptSoon * 0.26));
    coreGrad.addColorStop(0, `rgba(255, 254, 230, ${0.58 + pulse * 0.25 + eruptSoon * 0.15})`);
    coreGrad.addColorStop(0.55, `rgba(251, 191, 36, ${0.32 + eruptSoon * 0.28})`);
    coreGrad.addColorStop(1, 'rgba(217, 119, 6, 0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.ellipse(x, y - 2, r * 0.72, r * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
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

    const grad = ctx.createRadialGradient(x, y - 1, 2, x, y - 1, r * 0.92);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, '#fef08a');
    grad.addColorStop(0.72, '#f59e0b');
    grad.addColorStop(1, 'rgba(217, 119, 6, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(x, y - 1, r * 0.85, r * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
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
      const puffGrad = ctx.createRadialGradient(sx, sy, 1, sx, sy, puffR);
      puffGrad.addColorStop(0, `rgba(255, 250, 224, ${(1 - sp) * 0.52 * eruptSoon})`);
      puffGrad.addColorStop(0.6, `rgba(253, 224, 71, ${(1 - sp) * 0.26 * eruptSoon})`);
      puffGrad.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = puffGrad;
      ctx.beginPath();
      ctx.arc(sx, sy, puffR, 0, Math.PI * 2);
      ctx.fill();
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
  const halo = ctx.createRadialGradient(x, y + 1, 2, x, y + 1, 16);
  halo.addColorStop(0, 'rgba(255, 232, 128, 0.48)');
  halo.addColorStop(1, 'rgba(245, 180, 48, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 16, 8.5, 0, 0, Math.PI * 2);
  ctx.fill();

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
        const glow = ctx.createRadialGradient(0, -34 + hover, 2, 0, -34 + hover, 22);
        glow.addColorStop(0, 'rgba(255, 248, 198, 0.62)');
        glow.addColorStop(0.55, 'rgba(245, 186, 54, 0.22)');
        glow.addColorStop(1, 'rgba(245, 186, 54, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, -34 + hover, 22, 0, Math.PI * 2);
        ctx.fill();

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
          const winGlow = ctx.createRadialGradient(2, -24, 1, 2, -24, 14 * pulse);
          winGlow.addColorStop(0, 'rgba(255, 248, 196, 0.58)');
          winGlow.addColorStop(0.6, 'rgba(245, 184, 50, 0.22)');
          winGlow.addColorStop(1, 'rgba(245, 184, 50, 0)');
          ctx.fillStyle = winGlow;
          ctx.beginPath();
          ctx.arc(2, -24, 14 * pulse, 0, Math.PI * 2);
          ctx.fill();

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
          const sunGlow = ctx.createRadialGradient(0, -42, 2, 0, -42, 18 * pulse);
          sunGlow.addColorStop(0, 'rgba(255, 252, 214, 0.72)');
          sunGlow.addColorStop(0.55, 'rgba(245, 184, 50, 0.25)');
          sunGlow.addColorStop(1, 'rgba(245, 184, 50, 0)');
          ctx.fillStyle = sunGlow;
          ctx.beginPath();
          ctx.arc(0, -42, 18 * pulse, 0, Math.PI * 2);
          ctx.fill();

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
          const mGlow = ctx.createRadialGradient(muzzleX, muzzleY, 1, muzzleX, muzzleY, flare);
          mGlow.addColorStop(0, 'rgba(240, 253, 250, 0.95)');
          mGlow.addColorStop(0.5, isZephyr ? 'rgba(94, 234, 212, 0.65)' : 'rgba(45, 212, 191, 0.55)');
          mGlow.addColorStop(1, 'rgba(45, 212, 191, 0)');
          ctx.fillStyle = mGlow;
          ctx.beginPath();
          ctx.arc(muzzleX, muzzleY, flare, 0, Math.PI * 2);
          ctx.fill();
        } else if (s.powered) {
          const pulse = 0.72 + 0.28 * Math.sin(time * 4.6 + s.animPhase);
          const readyGlow = ctx.createRadialGradient(muzzleX, muzzleY, 1, muzzleX, muzzleY, (isZephyr ? 11 : 8) * pulse);
          readyGlow.addColorStop(0, 'rgba(204, 251, 241, 0.55)');
          readyGlow.addColorStop(1, 'rgba(45, 212, 191, 0)');
          ctx.fillStyle = readyGlow;
          ctx.beginPath();
          ctx.arc(muzzleX, muzzleY, (isZephyr ? 11 : 8) * pulse, 0, Math.PI * 2);
          ctx.fill();
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
          const orbGlow = ctx.createRadialGradient(0, -37 + recoilLift, 2, 0, -37 + recoilLift, 16 * pulse);
          orbGlow.addColorStop(0, 'rgba(224, 242, 254, 0.55)');
          orbGlow.addColorStop(0.55, 'rgba(56, 189, 248, 0.22)');
          orbGlow.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = orbGlow;
          ctx.beginPath();
          ctx.arc(0, -37 + recoilLift, 16 * pulse, 0, Math.PI * 2);
          ctx.fill();

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
          const glow = ctx.createRadialGradient(0, -37 + hover, 2, 0, -37 + hover, 20);
          glow.addColorStop(0, 'rgba(186, 230, 253, 0.52)');
          glow.addColorStop(0.55, 'rgba(56, 189, 248, 0.2)');
          glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(0, -37 + hover, 20, 0, Math.PI * 2);
          ctx.fill();

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
          const mGlow = ctx.createRadialGradient(muzzleX, muzzleY, 1, muzzleX, muzzleY, flare);
          mGlow.addColorStop(0, 'rgba(255, 252, 224, 0.98)');
          mGlow.addColorStop(0.45, 'rgba(250, 204, 21, 0.72)');
          mGlow.addColorStop(0.8, 'rgba(192, 132, 252, 0.35)');
          mGlow.addColorStop(1, 'rgba(192, 132, 252, 0)');
          ctx.fillStyle = mGlow;
          ctx.beginPath();
          ctx.arc(muzzleX, muzzleY, flare, 0, Math.PI * 2);
          ctx.fill();
        } else if (s.powered) {
          const pulse = 0.75 + 0.25 * Math.sin(time * 9 + s.animPhase);
          const chargeGlow = ctx.createRadialGradient(muzzleX, muzzleY, 1, muzzleX, muzzleY, 10 * pulse);
          chargeGlow.addColorStop(0, 'rgba(254, 249, 195, 0.65)');
          chargeGlow.addColorStop(0.55, 'rgba(245, 158, 11, 0.25)');
          chargeGlow.addColorStop(1, 'rgba(245, 158, 11, 0)');
          ctx.fillStyle = chargeGlow;
          ctx.beginPath();
          ctx.arc(muzzleX, muzzleY, 10 * pulse, 0, Math.PI * 2);
          ctx.fill();
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
        const crownGlow = ctx.createRadialGradient(0, topY, 1, 0, topY, pulse * 2.2);
        crownGlow.addColorStop(0, isArc ? 'rgba(255, 250, 200, 0.85)' : 'rgba(216, 180, 254, 0.78)');
        crownGlow.addColorStop(0.5, isArc ? 'rgba(250, 204, 21, 0.34)' : 'rgba(168, 85, 247, 0.3)');
        crownGlow.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = crownGlow;
        ctx.beginPath();
        ctx.arc(0, topY, pulse * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'STORM_OBELISK': {
      if (drawBespokeSprite(ctx, atlas.structures.shrineMonolith, 74, 16, flash, !s.powered)) {
        const hover = Math.sin(time * 3 + s.animPhase) * 2.2;
        const glow = ctx.createRadialGradient(0, -48 + hover, 2, 0, -48 + hover, 17);
        glow.addColorStop(0, 'rgba(233, 213, 255, 0.72)');
        glow.addColorStop(0.55, 'rgba(168, 85, 247, 0.28)');
        glow.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, -48 + hover, 17, 0, Math.PI * 2);
        ctx.fill();
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
  }

  // Progressive Damage Weathering: stone cracks, rising smoke & flickering fire embers
  const hpRatio = s.hp / Math.max(1, s.maxHp);
  if (hpRatio < 0.65 && s.buildProgress >= 0.99) {
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

  // Unpowered Warning Seal
  if (!s.powered && s.owner !== 'NEUTRAL') {
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

  const baseGlow = ctx.createRadialGradient(0, 2, 2, 0, 2, 16);
  baseGlow.addColorStop(0, `${teamCol}44`);
  baseGlow.addColorStop(1, `${teamCol}00`);
  ctx.fillStyle = baseGlow;
  ctx.beginPath();
  ctx.ellipse(0, 2, 15.5, 7.6, 0, 0, Math.PI * 2);
  ctx.fill();
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
    const coreGlow = ctx.createRadialGradient(coreX, coreY, 1, coreX, coreY, 8.5 * corePulse);
    coreGlow.addColorStop(0, '#ffffff');
    coreGlow.addColorStop(0.35, teamCol);
    coreGlow.addColorStop(1, `${teamCol}00`);
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(coreX, coreY, 8.5 * corePulse, 0, Math.PI * 2);
    ctx.fill();

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
    const aura = ctx.createRadialGradient(0, cy - 4, 2, 0, cy - 4, 18);
    aura.addColorStop(0, 'rgba(255, 248, 196, 0.72)');
    aura.addColorStop(0.55, 'rgba(245, 186, 54, 0.25)');
    aura.addColorStop(1, 'rgba(245, 186, 54, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, cy - 4, 18, 0, Math.PI * 2);
    ctx.fill();
    drawCrystalSpire(ctx, 0, cy, 6.8, 17, 0.35);
  }

  if (g.hp < g.maxHp) {
    const ratio = Math.max(0, g.hp / g.maxHp);
    const barY = g.carryingCrystalValue > 0 ? -62 : -47;
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

  // Grounded Faction Sanctum Magic Circle beneath Priest
  ctx.save();
  const ringRx = isSelected ? 19 : 16.5;
  const ringRy = isSelected ? 9.4 : 8.1;
  const ringGlow = ctx.createRadialGradient(0, 2, 2, 0, 2, ringRx);
  ringGlow.addColorStop(0, `${robeCol}55`);
  ringGlow.addColorStop(0.65, `${robeCol}22`);
  ringGlow.addColorStop(1, `${robeCol}00`);
  ctx.fillStyle = ringGlow;
  ctx.beginPath();
  ctx.ellipse(0, 2, ringRx, ringRy, 0, 0, Math.PI * 2);
  ctx.fill();

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
    const haloGrad = ctx.createRadialGradient(0, haloY, 3, 0, haloY, 24);
    haloGrad.addColorStop(0, `${robeCol}58`);
    haloGrad.addColorStop(0.55, `${robeCol}22`);
    haloGrad.addColorStop(1, `${robeCol}00`);
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(0, haloY, 24, 0, Math.PI * 2);
    ctx.fill();

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

    const staffGlow = ctx.createRadialGradient(
      staffTipX,
      staffTipY,
      1,
      staffTipX,
      staffTipY,
      11.5 * orbPulse
    );
    staffGlow.addColorStop(0, 'rgba(255, 255, 240, 0.92)');
    staffGlow.addColorStop(0.45, `${orbColor}88`);
    staffGlow.addColorStop(1, `${orbColor}00`);
    ctx.fillStyle = staffGlow;
    ctx.beginPath();
    ctx.arc(staffTipX, staffTipY, 11.5 * orbPulse, 0, Math.PI * 2);
    ctx.fill();

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
    const bindGlow = ctx.createRadialGradient(0, floatY, 3, 0, floatY, 19);
    bindGlow.addColorStop(0, `${prisonerCol}30`);
    bindGlow.addColorStop(0.7, 'rgba(253, 224, 71, 0.25)');
    bindGlow.addColorStop(1, 'rgba(253, 224, 71, 0)');
    ctx.fillStyle = bindGlow;
    ctx.beginPath();
    ctx.arc(0, floatY, 19, 0, Math.PI * 2);
    ctx.fill();

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
    const halo = ctx.createRadialGradient(0, 0, 1, 0, 0, 11);
    halo.addColorStop(0, 'rgba(255, 252, 220, 0.85)');
    halo.addColorStop(1, 'rgba(245, 180, 48, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();

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

    const sGlow = ctx.createRadialGradient(0, 0, 2, 0, 0, 12);
    sGlow.addColorStop(0, '#ffffff');
    sGlow.addColorStop(0.45, '#facc15');
    sGlow.addColorStop(0.8, '#a855f7');
    sGlow.addColorStop(1, 'rgba(168, 85, 247, 0)');
    ctx.fillStyle = sGlow;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
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
    const scorch = ctx.createRadialGradient(0, 0, 2, 0, 0, rx);
    scorch.addColorStop(0, `rgba(18, 15, 22, ${(fade * 0.62).toFixed(2)})`);
    scorch.addColorStop(0.65, `rgba(48, 32, 24, ${(fade * 0.36).toFixed(2)})`);
    scorch.addColorStop(1, 'rgba(18, 15, 22, 0)');
    ctx.fillStyle = scorch;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

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
    const dustGrad = ctx.createRadialGradient(0, -6, 2, 0, -6, dustR);
    dustGrad.addColorStop(0, `rgba(226, 214, 192, ${((1 - t) * 0.52).toFixed(2)})`);
    dustGrad.addColorStop(0.6, `rgba(176, 162, 138, ${((1 - t) * 0.28).toFixed(2)})`);
    dustGrad.addColorStop(1, 'rgba(176, 162, 138, 0)');
    ctx.fillStyle = dustGrad;
    ctx.beginPath();
    ctx.ellipse(0, -6, dustR, dustR * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();

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
  time: number
): void {
  const bounds = getWorldIsoBounds(state.gridSize);
  const spanX = Math.max(1200, bounds.maxX - bounds.minX + 600);
  const spanY = Math.max(700, bounds.maxY - bounds.minY + 400);

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
}

function drawSkyBirds(
  ctx: CanvasRenderingContext2D,
  time: number,
  camera: CameraState,
  viewW: number
): void {
  const span = Math.max(2200, viewW * 2.2);
  ctx.save();
  ctx.strokeStyle = 'rgba(248, 244, 232, 0.58)';
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
  viewH: number
): void {
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
    const twinkle = 0.25 + 0.55 * Math.abs(Math.sin(time * 1.8 + i * 1.7));
    ctx.fillStyle = i % 3 === 0 ? `rgba(255, 248, 196, ${twinkle.toFixed(2)})` : `rgba(255, 255, 240, ${(twinkle * 0.7).toFixed(2)})`;
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

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: WorldState,
  camera: CameraState,
  viewW: number,
  viewH: number
): void {
  // Dual sunlit-sky-to-storm-front minimap backdrop
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#2a5f99');
  bgGrad.addColorStop(0.55, '#254c78');
  bgGrad.addColorStop(1, '#142238');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  const bounds = getWorldIsoBounds(state.gridSize);
  const gs = state.gridSize;

  const mapX = (tx: number, ty: number) => {
    const iso = tileToIso(tx, ty);
    return ((iso.x - bounds.minX) / bounds.spanX) * width;
  };
  const mapY = (tx: number, ty: number) => {
    const iso = tileToIso(tx, ty);
    return ((iso.y - bounds.minY) / bounds.spanY) * height;
  };

  const landDotW = Math.max(2.0, 3.6 * (50 / gs));
  const landDotH = Math.max(1.6, 2.8 * (50 / gs));
  const bridgeDotW = Math.max(1.8, 3.0 * (50 / gs));
  const bridgeDotH = Math.max(1.5, 2.4 * (50 / gs));

  for (let y = 0; y < gs; y++) {
    for (let x = 0; x < gs; x++) {
      const tile = state.tiles[y][x];
      if (tile.kind === 'VOID') continue;
      const mx = mapX(x, y);
      const my = mapY(x, y);
      if (tile.kind === 'LAND') {
        const poweredByPlayer = (tile.poweredMask & PLAYER_POWER_BIT) !== 0;
        if (poweredByPlayer) {
          ctx.fillStyle = '#62b858';
        } else if (tile.poweredMask !== 0) {
          const aiVis = getPoweredAiVisual(state, tile.poweredMask);
          ctx.fillStyle = aiVis?.landTint ?? '#9e5054';
        } else {
          ctx.fillStyle = '#6da654';
        }
        ctx.fillRect(mx - landDotW * 0.5, my - landDotH * 0.5, landDotW, landDotH);
      } else {
        ctx.fillStyle = getOwnerColor(state, tile.owner);
        ctx.fillRect(mx - bridgeDotW * 0.5, my - bridgeDotH * 0.5, bridgeDotW, bridgeDotH);
      }
    }
  }

  for (const g of state.geysers) {
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

  for (const p of state.priests) {
    if (p.state === 'SACRIFICED') continue;
    ctx.fillStyle = p.isRogue ? '#c084fc' : p.owner === 'PLAYER' ? '#ffffff' : getOwnerColor(state, p.owner);
    ctx.beginPath();
    ctx.arc(mapX(p.x, p.y), mapY(p.x, p.y), 3.0, 0, Math.PI * 2);
    ctx.fill();
  }

  const camLeft = ((camera.x - (viewW * 0.5) / camera.zoom - bounds.minX) / bounds.spanX) * width;
  const camTop = ((camera.y - (viewH * 0.5) / camera.zoom - bounds.minY) / bounds.spanY) * height;
  const camW = ((viewW / camera.zoom) / bounds.spanX) * width;
  const camH = ((viewH / camera.zoom) / bounds.spanY) * height;

  ctx.strokeStyle = 'rgba(245, 223, 170, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(camLeft, camTop, camW, camH);
}
