import { TILE_H, TILE_W } from './catalog';
import aetherMillImgUrl from '../assets/images/sprite_aether_mill_1795781456398.jpg';
import aetherVentImgUrl from '../assets/images/sprite_aether_vent_1795780774704.jpg';
import altarImgUrl from '../assets/images/sprite_sacrificial_altar_1795728910727.jpg';
import arcSpireImgUrl from '../assets/images/sprite_arc_spire_1795781456393.jpg';
import arcaneSpireImgUrl from '../assets/images/sprite_arcane_spire_1795728912213.jpg';
import cycloneSpireImgUrl from '../assets/images/sprite_cyclone_spire_1795781454495.jpg';
import galeBallistaBackImgUrl from '../assets/images/sprite_gale_ballista_back_1795782051628.jpg';
import galeBallistaImgUrl from '../assets/images/sprite_gale_ballista_1795781445637.jpg';
import glacialBulwarkImgUrl from '../assets/images/sprite_glacial_bulwark_1795780769956.jpg';
import golemImgUrl from '../assets/images/sprite_aether_golem_1795780160212.jpg';
import highTempleImgUrl from '../assets/images/sprite_high_temple_1795728909463.jpg';
import manOWarImgUrl from '../assets/images/sprite_man_o_war_1795780772116.jpg';
import priestRainImgUrl from '../assets/images/sprite_priest_rain_1795780169134.jpg';
import priestRogueImgUrl from '../assets/images/sprite_priest_rogue_1795780166273.jpg';
import priestThunderImgUrl from '../assets/images/sprite_priest_thunder_1795780165880.jpg';
import priestWindImgUrl from '../assets/images/sprite_priest_wind_1795780164467.jpg';
import sanctuaryWorkshopImgUrl from '../assets/images/sprite_sanctuary_workshop_1795728913151.jpg';
import shrineMonolithImgUrl from '../assets/images/sprite_shrine_monolith_1795780773817.jpg';
import siegePedestalImgUrl from '../assets/images/sprite_siege_pedestal_1795780768115.jpg';
import stoneBastionImgUrl from '../assets/images/sprite_stone_bastion_1795728910989.jpg';
import sunDiscTowerImgUrl from '../assets/images/sprite_sun_disc_tower_1795780767101.jpg';
import tidalMortarImgUrl from '../assets/images/sprite_tidal_mortar_1795781449558.jpg';
import voltCannonBackImgUrl from '../assets/images/sprite_volt_cannon_back_1795782063214.jpg';
import voltCannonImgUrl from '../assets/images/sprite_volt_cannon_1795781450921.jpg';
import zephyrLanceBackImgUrl from '../assets/images/sprite_zephyr_lance_back_1795782054942.jpg';
import aetherDirigibleImgUrl from '../assets/images/sprite_aether_dirigible_1795795675486.jpg';
import aetherMineImgUrl from '../assets/images/sprite_aether_mine_1795795671422.jpg';
import aetherRelayImgUrl from '../assets/images/sprite_aether_relay_1795795665683.jpg';
import fencePylonImgUrl from '../assets/images/sprite_fence_pylon_1795795669582.jpg';
import skyLeviathanImgUrl from '../assets/images/sprite_sky_leviathan_1795795679966.jpg';
import skyObservatoryImgUrl from '../assets/images/sprite_sky_observatory_1795795667389.jpg';
import solarSkiffImgUrl from '../assets/images/sprite_solar_skiff_1795795673484.jpg';
import tempestVortexImgUrl from '../assets/images/sprite_tempest_vortex_1795795677919.jpg';
import zephyrLanceImgUrl from '../assets/images/sprite_zephyr_lance_1795781449252.jpg';

export type BespokeStructureKey =
  | 'temple'
  | 'altar'
  | 'bastion'
  | 'spire'
  | 'workshop'
  | 'aetherMill'
  | 'aetherRelay'
  | 'skyObservatory'
  | 'fencePylon'
  | 'aetherMine'
  | 'sunDisc'
  | 'siegePedestal'
  | 'galeBallista'
  | 'galeBallistaBack'
  | 'zephyrLance'
  | 'zephyrLanceBack'
  | 'cycloneSpire'
  | 'tidalMortar'
  | 'glacialBulwark'
  | 'manOWar'
  | 'voltCannon'
  | 'voltCannonBack'
  | 'arcSpire'
  | 'shrineMonolith'
  | 'aetherVent';
export type BespokeUnitKey =
  | 'golem'
  | 'priestWind'
  | 'priestRain'
  | 'priestThunder'
  | 'priestRogue'
  | 'solarSkiff'
  | 'aetherDirigible'
  | 'tempestVortex'
  | 'skyLeviathan';

export interface ProcessedStructureSprite {
  canvas: HTMLCanvasElement;
  flashCanvas: HTMLCanvasElement;
  frostCanvas?: HTMLCanvasElement;
  width: number;
  height: number;
  ready: boolean;
}

export interface SpriteAtlas {
  landTiles: HTMLCanvasElement[];
  cobbleTiles: HTMLCanvasElement[];
  flagstoneTile: HTMLCanvasElement;
  sunlitClouds: HTMLCanvasElement[];
  stormClouds: HTMLCanvasElement[];
  cloudShadow: HTMLCanvasElement;
  distantIslets: HTMLCanvasElement[];
  structures: Record<BespokeStructureKey, ProcessedStructureSprite>;
  units: Record<BespokeUnitKey, ProcessedStructureSprite>;
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface BespokeSpriteOptions {
  aggressiveHaloKey?: boolean;
  removeEnclosedMagenta?: boolean;
  sampleSize?: number;
  buildFrostTint?: boolean;
}

/**
 * Loads a bespoke illustration on a flat magenta chroma-key backdrop,
 * strips the background via border flood-fill (plus optional enclosed pocket keying
 * for characters with gaps between limbs/staff), performs 2-pass anti-aliased edge
 * despill, crops tightly to the artwork bounds, and builds cached hit-flash / frost silhouettes.
 */
function createBespokeStructureSprite(
  url: string,
  options: boolean | BespokeSpriteOptions = false
): ProcessedStructureSprite {
  const opts: BespokeSpriteOptions =
    typeof options === 'boolean' ? { aggressiveHaloKey: options } : options;
  const aggressiveHaloKey = opts.aggressiveHaloKey ?? false;
  const removeEnclosedMagenta = opts.removeEnclosedMagenta ?? false;
  const sampleSize = opts.sampleSize ?? 192;
  const buildFrostTint = opts.buildFrostTint ?? false;

  const placeholder = document.createElement('canvas');
  placeholder.width = 2;
  placeholder.height = 2;
  const flashPlaceholder = document.createElement('canvas');
  flashPlaceholder.width = 2;
  flashPlaceholder.height = 2;

  const entry: ProcessedStructureSprite = {
    canvas: placeholder,
    flashCanvas: flashPlaceholder,
    width: 2,
    height: 2,
    ready: false,
  };

  if (typeof Image === 'undefined') return entry;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const size = sampleSize;
      const work = document.createElement('canvas');
      work.width = size;
      work.height = size;
      const wctx = work.getContext('2d', { willReadFrequently: true });
      if (!wctx) return;

      wctx.drawImage(img, 0, 0, size, size);
      const imgData = wctx.getImageData(0, 0, size, size);
      const data = imgData.data;

      // Sample average of the 4 corners to detect the exact chroma backdrop color
      const cornerIndices = [
        0,
        (size - 1) * 4,
        (size - 1) * size * 4,
        ((size - 1) * size + (size - 1)) * 4,
      ];
      let bgR = 0;
      let bgG = 0;
      let bgB = 0;
      for (const ci of cornerIndices) {
        bgR += data[ci];
        bgG += data[ci + 1];
        bgB += data[ci + 2];
      }
      bgR /= 4;
      bgG /= 4;
      bgB /= 4;

      const isBackdropPixel = (idx: number): boolean => {
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const dr = r - bgR;
        const dg = g - bgG;
        const db = b - bgB;
        const distSq = dr * dr + dg * dg + db * db;
        if (distSq < 125 * 125) return true;

        // Catch magenta-pink compression or bloom halo pixels connected to the outer border
        const magentaExcess = Math.min(r, b) - g;
        if (r > 155 && b > 145 && magentaExcess > 48) return true;
        if (aggressiveHaloKey && r > 185 && b > 170 && magentaExcess > 18) return true;
        return false;
      };

      // BFS flood-fill from every edge pixel so interior artwork colors are never touched
      const visited = new Uint8Array(size * size);
      const isBg = new Uint8Array(size * size);
      const queue = new Int32Array(size * size);
      let qHead = 0;
      let qTail = 0;

      const enqueue = (x: number, y: number) => {
        const p = y * size + x;
        if (visited[p]) return;
        visited[p] = 1;
        if (isBackdropPixel(p * 4)) {
          isBg[p] = 1;
          queue[qTail++] = p;
        }
      };

      for (let x = 0; x < size; x++) {
        enqueue(x, 0);
        enqueue(x, size - 1);
      }
      for (let y = 1; y < size - 1; y++) {
        enqueue(0, y);
        enqueue(size - 1, y);
      }

      // For character units, also seed unmistakable interior magenta pockets (between limbs/staff)
      if (removeEnclosedMagenta) {
        for (let y = 2; y < size - 2; y++) {
          for (let x = 2; x < size - 2; x++) {
            const p = y * size + x;
            if (visited[p]) continue;
            const idx = p * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const magentaExcess = Math.min(r, b) - g;
            if (r > 180 && b > 170 && magentaExcess > 65) {
              visited[p] = 1;
              isBg[p] = 1;
              queue[qTail++] = p;
            }
          }
        }
      }

      while (qHead < qTail) {
        const p = queue[qHead++];
        const x = p % size;
        const y = (p - x) / size;
        if (x > 0) enqueue(x - 1, y);
        if (x < size - 1) enqueue(x + 1, y);
        if (y > 0) enqueue(x, y - 1);
        if (y < size - 1) enqueue(x, y + 1);
      }

      // Clear background pixels
      for (let p = 0; p < size * size; p++) {
        if (isBg[p]) {
          data[p * 4 + 3] = 0;
        }
      }

      // 2-pass silhouette despill & anti-aliased alpha feathering for ultra-clean edges
      const despillPasses = removeEnclosedMagenta ? 2 : 1;
      for (let pass = 0; pass < despillPasses; pass++) {
        const alphaSnapshot = new Uint8Array(size * size);
        for (let p = 0; p < size * size; p++) {
          alphaSnapshot[p] = data[p * 4 + 3];
        }

        for (let y = 1; y < size - 1; y++) {
          for (let x = 1; x < size - 1; x++) {
            const p = y * size + x;
            if (alphaSnapshot[p] === 0) continue;

            let bgNeighbors = 0;
            if (alphaSnapshot[p - 1] < 48) bgNeighbors++;
            if (alphaSnapshot[p + 1] < 48) bgNeighbors++;
            if (alphaSnapshot[p - size] < 48) bgNeighbors++;
            if (alphaSnapshot[p + size] < 48) bgNeighbors++;
            if (alphaSnapshot[p - size - 1] < 48) bgNeighbors++;
            if (alphaSnapshot[p - size + 1] < 48) bgNeighbors++;
            if (alphaSnapshot[p + size - 1] < 48) bgNeighbors++;
            if (alphaSnapshot[p + size + 1] < 48) bgNeighbors++;

            if (bgNeighbors > 0) {
              const idx = p * 4;
              let r = data[idx];
              let g = data[idx + 1];
              let b = data[idx + 2];
              const magentaSpill = Math.min(r, b) - g;

              if (magentaSpill > 10) {
                const spillFactor = Math.min(1, (magentaSpill - 8) / 68);
                const prevAlpha = data[idx + 3];
                const newAlpha = Math.round(prevAlpha * Math.max(0, 1 - spillFactor * 0.92));
                data[idx + 3] = newAlpha;
                const targetCh = Math.min(255, g + 14);
                r = Math.min(r, Math.round(r * (1 - spillFactor) + targetCh * spillFactor));
                b = Math.min(b, Math.round(b * (1 - spillFactor) + targetCh * spillFactor));
                data[idx] = r;
                data[idx + 2] = b;
              } else if (pass === 0 && bgNeighbors >= 4) {
                data[idx + 3] = Math.round(data[idx + 3] * 0.72);
              }
            }
          }
        }
      }

      wctx.putImageData(imgData, 0, 0);

      // Compute tight opaque bounding box
      let minX = size;
      let minY = size;
      let maxX = 0;
      let maxY = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const a = data[(y * size + x) * 4 + 3];
          if (a > 24) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX <= minX || maxY <= minY) return;

      const pad = 2;
      const sx = Math.max(0, minX - pad);
      const sy = Math.max(0, minY - pad);
      const sw = Math.min(size - sx, maxX - minX + 1 + pad * 2);
      const sh = Math.min(size - sy, maxY - minY + 1 + pad * 2);

      const cropped = document.createElement('canvas');
      cropped.width = sw;
      cropped.height = sh;
      const cctx = cropped.getContext('2d');
      if (!cctx) return;
      cctx.drawImage(work, sx, sy, sw, sh, 0, 0, sw, sh);

      // Build cached white hit-flash silhouette
      const flashCanvas = document.createElement('canvas');
      flashCanvas.width = sw;
      flashCanvas.height = sh;
      const fctx = flashCanvas.getContext('2d');
      if (fctx) {
        fctx.drawImage(cropped, 0, 0);
        fctx.globalCompositeOperation = 'source-in';
        fctx.fillStyle = '#ffffff';
        fctx.fillRect(0, 0, sw, sh);
        fctx.globalCompositeOperation = 'source-over';
      }

      if (buildFrostTint) {
        const frostCanvas = document.createElement('canvas');
        frostCanvas.width = sw;
        frostCanvas.height = sh;
        const frCtx = frostCanvas.getContext('2d');
        if (frCtx) {
          frCtx.drawImage(cropped, 0, 0);
          frCtx.globalCompositeOperation = 'source-in';
          frCtx.fillStyle = '#7dd3fc';
          frCtx.fillRect(0, 0, sw, sh);
          frCtx.globalCompositeOperation = 'source-over';
        }
        entry.frostCanvas = frostCanvas;
      }

      entry.canvas = cropped;
      entry.flashCanvas = flashCanvas;
      entry.width = sw;
      entry.height = sh;
      entry.ready = true;
    } catch {
      // Fallback remains active if canvas read fails
    }
  };
  img.src = url;

  return entry;
}

function createLandTileCanvas(
  variantIndex: number,
  style: 'GRASS' | 'COBBLE' | 'FLAGSTONE'
): HTMLCanvasElement {
  const padX = 8;
  const padY = 8;
  const w = TILE_W + padX * 2;
  const h = TILE_H + padY * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const cx = w * 0.5;
  const cy = h * 0.5;
  const hw = TILE_W * 0.5;
  const hh = TILE_H * 0.5;
  const styleOffset = style === 'FLAGSTONE' ? 99991 : style === 'COBBLE' ? 47713 : 0;
  const rand = seededRand(4217 + variantIndex * 7919 + styleOffset);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
  ctx.clip();

  if (style === 'FLAGSTONE') {
    // Sunlit Classical Cream-Marble Temple Paving
    const baseGrad = ctx.createLinearGradient(cx - hw, cy - hh, cx + hw, cy + hh);
    baseGrad.addColorStop(0, '#f2e8d2');
    baseGrad.addColorStop(0.52, '#d5c6a8');
    baseGrad.addColorStop(1, '#a99a7e');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, w, h);

    // Carved marble slab seams
    ctx.strokeStyle = 'rgba(72, 62, 48, 0.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.5, cy - hh * 0.5);
    ctx.lineTo(cx + hw * 0.5, cy + hh * 0.5);
    ctx.moveTo(cx + hw * 0.5, cy - hh * 0.5);
    ctx.lineTo(cx - hw * 0.5, cy + hh * 0.5);
    ctx.stroke();

    // Subtle sunlit highlights along seam lips
    ctx.strokeStyle = 'rgba(255, 250, 235, 0.35)';
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.5 + 1, cy - hh * 0.5);
    ctx.lineTo(cx + hw * 0.5 + 1, cy + hh * 0.5);
    ctx.stroke();

    // Marble mineral grain speckles
    for (let i = 0; i < 36; i++) {
      const px = cx + (rand() - 0.5) * TILE_W;
      const py = cy + (rand() - 0.5) * TILE_H;
      ctx.fillStyle = rand() > 0.5 ? 'rgba(255, 252, 240, 0.24)' : 'rgba(92, 80, 62, 0.14)';
      ctx.fillRect(px, py, 2.2, 1.4);
    }

    // Vibrant sunlit moss peeking along stone edges
    ctx.fillStyle = 'rgba(104, 174, 62, 0.42)';
    ctx.beginPath();
    ctx.ellipse(cx - 12, cy + 3, 6.5, 3, 0.25, 0, Math.PI * 2);
    ctx.ellipse(cx + 13, cy - 3, 5.5, 2.5, -0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (style === 'COBBLE') {
    // Lush emerald turf edge with warm sandstone cobblestone walkway through the center
    const grassGrad = ctx.createLinearGradient(cx - hw, cy - hh, cx + hw, cy + hh);
    grassGrad.addColorStop(0, '#96d44a');
    grassGrad.addColorStop(0.55, '#62ad3c');
    grassGrad.addColorStop(1, '#407f34');
    ctx.fillStyle = grassGrad;
    ctx.fillRect(0, 0, w, h);

    // Warm compacted sandstone road bed
    const bedGrad = ctx.createLinearGradient(cx - hw * 0.8, cy - hh * 0.8, cx + hw * 0.8, cy + hh * 0.8);
    bedGrad.addColorStop(0, '#dfd0b0');
    bedGrad.addColorStop(0.5, '#c4b18c');
    bedGrad.addColorStop(1, '#9d8a68');
    ctx.fillStyle = bedGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, hw * 0.78, hh * 0.76, 0, 0, Math.PI * 2);
    ctx.fill();

    // Individual hand-painted sunlit cobblestone pavers
    for (let i = 0; i < 16; i++) {
      const ang = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * 0.66;
      const px = cx + Math.cos(ang) * hw * dist;
      const py = cy + Math.sin(ang) * hh * dist;
      const rx = 4 + rand() * 3.8;
      const ry = 2.1 + rand() * 1.9;
      ctx.fillStyle = rand() > 0.45 ? 'rgba(246, 236, 210, 0.72)' : 'rgba(182, 164, 132, 0.78)';
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, (rand() - 0.5) * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(98, 84, 62, 0.42)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Lush emerald moss tufts encroaching around cobble perimeter
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rand() * 0.4;
      const mx = cx + Math.cos(a) * hw * 0.72;
      const my = cy + Math.sin(a) * hh * 0.72;
      ctx.fillStyle = rand() > 0.5 ? 'rgba(148, 214, 72, 0.55)' : 'rgba(68, 134, 48, 0.5)';
      ctx.beginPath();
      ctx.ellipse(mx, my, 4.5, 2.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Vibrant Sunlit Emerald & Chartreuse Mossy Floating Island Meadow (matching key art)
    const shift = (variantIndex - 3.5) * 4.5;
    const baseGrad = ctx.createLinearGradient(cx - hw, cy - hh, cx + hw, cy + hh);
    baseGrad.addColorStop(0, `rgb(${148 + shift}, ${212 + Math.round(shift * 0.7)}, ${74 + Math.round(shift * 0.5)})`);
    baseGrad.addColorStop(0.52, `rgb(${96 + shift}, ${168 + Math.round(shift * 0.7)}, ${60 + Math.round(shift * 0.5)})`);
    baseGrad.addColorStop(1, `rgb(${62 + Math.round(shift * 0.6)}, ${124 + Math.round(shift * 0.6)}, ${52 + Math.round(shift * 0.4)})`);
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, w, h);

    // Painterly organic sunlit meadow patches & mossy hollows
    for (let i = 0; i < 14; i++) {
      const bx = cx + (rand() - 0.5) * (TILE_W * 0.88);
      const by = cy + (rand() - 0.5) * (TILE_H * 0.88);
      const rx = 4.5 + rand() * 9;
      const ry = 2.2 + rand() * 4.5;
      const tone = rand();
      ctx.fillStyle =
        tone < 0.42
          ? 'rgba(188, 232, 92, 0.28)' // warm sunlit chartreuse grass
          : tone < 0.76
            ? 'rgba(46, 98, 42, 0.26)' // lush deep moss shadow
            : 'rgba(162, 138, 92, 0.16)'; // warm sunlit loam fleck
      ctx.beginPath();
      ctx.ellipse(bx, by, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    // Crisp painterly grass blades, warm limestone pebbles & subtle golden wildflowers
    for (let i = 0; i < 26; i++) {
      const gx = cx + (rand() - 0.5) * (TILE_W * 0.82);
      const gy = cy + (rand() - 0.5) * (TILE_H * 0.82);
      const pick = rand();
      if (pick > 0.18) {
        ctx.strokeStyle = pick > 0.58 ? 'rgba(218, 246, 132, 0.48)' : 'rgba(42, 86, 38, 0.36)';
        ctx.lineWidth = 1.05;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + (rand() - 0.5) * 3.2, gy - 2.6 - rand() * 2.2);
        ctx.stroke();
      } else if (pick > 0.07) {
        ctx.fillStyle = 'rgba(216, 202, 174, 0.52)';
        ctx.beginPath();
        ctx.ellipse(gx, gy, 2.3, 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Tiny warm sunlit meadow blossom dot
        ctx.fillStyle = 'rgba(255, 242, 168, 0.65)';
        ctx.beginPath();
        ctx.arc(gx, gy, 1.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Golden-hour northwest bevel highlight + subtle southeast cool rim
  ctx.strokeStyle = 'rgba(255, 250, 214, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - hw + 1, cy);
  ctx.lineTo(cx, cy - hh + 1);
  ctx.lineTo(cx + hw - 1, cy);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(26, 52, 34, 0.22)';
  ctx.beginPath();
  ctx.moveTo(cx + hw - 1, cy);
  ctx.lineTo(cx, cy + hh - 1);
  ctx.lineTo(cx - hw + 1, cy);
  ctx.stroke();

  ctx.restore();
  return canvas;
}

function createCloudClusterCanvas(seed: number, mood: 'SUNLIT' | 'STORM'): HTMLCanvasElement {
  const w = 420;
  const h = 210;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const rand = seededRand(seed);
  const puffs: Array<{ x: number; y: number; rx: number; ry: number }> = [];
  const count = mood === 'STORM' ? 16 : 15;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = 70 + t * 280 + (rand() - 0.5) * 34;
    const arch = Math.sin(t * Math.PI);
    const y = (mood === 'STORM' ? 124 : 118) - arch * (mood === 'STORM' ? 52 : 42) + (rand() - 0.5) * 24;
    const rx = 38 + arch * 38 + rand() * 20;
    const ry = 24 + arch * 22 + rand() * 12;
    puffs.push({ x, y, rx, ry });
  }

  if (mood === 'SUNLIT') {
    // Soft sky-blue cloud underbelly for sculpted golden-hour cumulus volume
    for (const p of puffs) {
      const g = ctx.createRadialGradient(p.x + p.rx * 0.12, p.y + p.ry * 0.38, 4, p.x, p.y + p.ry * 0.25, p.rx * 1.16);
      g.addColorStop(0, 'rgba(116, 162, 206, 0.44)');
      g.addColorStop(0.65, 'rgba(92, 142, 192, 0.24)');
      g.addColorStop(1, 'rgba(82, 134, 186, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 12, p.rx * 1.12, p.ry * 1.04, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Billowing warm-pearl cumulus body
    for (const p of puffs) {
      const g = ctx.createRadialGradient(p.x - p.rx * 0.22, p.y - p.ry * 0.28, 4, p.x, p.y, p.rx);
      g.addColorStop(0, 'rgba(255, 251, 240, 0.78)');
      g.addColorStop(0.58, 'rgba(232, 242, 252, 0.45)');
      g.addColorStop(1, 'rgba(200, 224, 246, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Golden-hour sunlit upper-left cream highlights
    for (let i = 1; i < puffs.length - 1; i += 2) {
      const p = puffs[i];
      const g = ctx.createRadialGradient(p.x - p.rx * 0.3, p.y - p.ry * 0.44, 2, p.x - 6, p.y - 8, p.rx * 0.76);
      g.addColorStop(0, 'rgba(255, 250, 224, 0.88)');
      g.addColorStop(0.55, 'rgba(255, 246, 218, 0.38)');
      g.addColorStop(1, 'rgba(255, 250, 232, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x - 6, p.y - 9, p.rx * 0.75, p.ry * 0.68, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Dramatic brooding slate-indigo storm thunderhead underbelly
    for (const p of puffs) {
      const g = ctx.createRadialGradient(p.x + p.rx * 0.15, p.y + p.ry * 0.32, 4, p.x, p.y + p.ry * 0.22, p.rx * 1.2);
      g.addColorStop(0, 'rgba(22, 34, 54, 0.78)');
      g.addColorStop(0.65, 'rgba(30, 46, 70, 0.44)');
      g.addColorStop(1, 'rgba(24, 38, 60, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 13, p.rx * 1.15, p.ry * 1.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Rolling steel-blue thundercloud body
    for (const p of puffs) {
      const g = ctx.createRadialGradient(p.x - p.rx * 0.18, p.y - p.ry * 0.22, 4, p.x, p.y, p.rx);
      g.addColorStop(0, 'rgba(72, 94, 122, 0.68)');
      g.addColorStop(0.62, 'rgba(46, 65, 92, 0.42)');
      g.addColorStop(1, 'rgba(34, 50, 74, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Subtle sunlit warm silver-amber edge along the western storm crest
    for (let i = 1; i < puffs.length - 3; i += 2) {
      const p = puffs[i];
      const g = ctx.createRadialGradient(p.x - p.rx * 0.34, p.y - p.ry * 0.4, 2, p.x - 8, p.y - 7, p.rx * 0.66);
      g.addColorStop(0, 'rgba(214, 198, 174, 0.46)');
      g.addColorStop(0.55, 'rgba(136, 154, 178, 0.2)');
      g.addColorStop(1, 'rgba(120, 140, 166, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x - 8, p.y - 8, p.rx * 0.65, p.ry * 0.56, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas;
}

function createDistantIsletCanvas(seed: number): HTMLCanvasElement {
  const w = 130;
  const h = 112;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const rand = seededRand(seed);
  const cx = w * 0.5;
  const topY = 30;
  const rw = 28 + rand() * 18;
  const rh = 11 + rand() * 6;
  const depth = 36 + rand() * 24;

  // Tapered rocky crag spire in soft atmospheric daylight haze
  ctx.beginPath();
  ctx.moveTo(cx - rw, topY);
  ctx.lineTo(cx - rw * 0.45, topY + depth * 0.7);
  ctx.lineTo(cx + (rand() - 0.5) * 10, topY + depth);
  ctx.lineTo(cx + rw * 0.46, topY + depth * 0.64);
  ctx.lineTo(cx + rw, topY);
  ctx.closePath();
  const rockGrad = ctx.createLinearGradient(cx - rw, topY, cx + rw, topY + depth);
  rockGrad.addColorStop(0, 'rgba(156, 148, 138, 0.56)');
  rockGrad.addColorStop(0.5, 'rgba(108, 122, 146, 0.48)');
  rockGrad.addColorStop(1, 'rgba(78, 102, 134, 0.24)');
  ctx.fillStyle = rockGrad;
  ctx.fill();

  // Hazy sunlit emerald plateau top
  ctx.beginPath();
  ctx.ellipse(cx, topY, rw, rh, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(130, 178, 128, 0.52)';
  ctx.fill();

  // Tiny hazy tree silhouettes along the distant ridge
  ctx.fillStyle = 'rgba(92, 140, 104, 0.48)';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(cx + i * 10 + (rand() - 0.5) * 4, topY - 4 - rand() * 3, 5 + rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

function createCloudShadowCanvas(): HTMLCanvasElement {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const cx = w * 0.5;
  const cy = h * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, h / w);
  const grad = ctx.createRadialGradient(0, 0, w * 0.08, 0, 0, w * 0.48);
  grad.addColorStop(0, 'rgba(14, 28, 52, 0.12)');
  grad.addColorStop(0.6, 'rgba(14, 28, 52, 0.06)');
  grad.addColorStop(1, 'rgba(14, 28, 52, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return canvas;
}

let cachedAtlas: SpriteAtlas | null = null;

export function getSpriteAtlas(): SpriteAtlas {
  if (cachedAtlas) return cachedAtlas;

  const landTiles: HTMLCanvasElement[] = [];
  for (let i = 0; i < 8; i++) {
    landTiles.push(createLandTileCanvas(i, 'GRASS'));
  }
  const cobbleTiles: HTMLCanvasElement[] = [];
  for (let i = 0; i < 4; i++) {
    cobbleTiles.push(createLandTileCanvas(i, 'COBBLE'));
  }
  const flagstoneTile = createLandTileCanvas(0, 'FLAGSTONE');

  const sunlitClouds: HTMLCanvasElement[] = [
    createCloudClusterCanvas(101, 'SUNLIT'),
    createCloudClusterCanvas(202, 'SUNLIT'),
    createCloudClusterCanvas(303, 'SUNLIT'),
    createCloudClusterCanvas(404, 'SUNLIT'),
  ];

  const stormClouds: HTMLCanvasElement[] = [
    createCloudClusterCanvas(511, 'STORM'),
    createCloudClusterCanvas(612, 'STORM'),
    createCloudClusterCanvas(713, 'STORM'),
    createCloudClusterCanvas(814, 'STORM'),
  ];

  const distantIslets: HTMLCanvasElement[] = [
    createDistantIsletCanvas(501),
    createDistantIsletCanvas(602),
    createDistantIsletCanvas(703),
  ];

  const cloudShadow = createCloudShadowCanvas();

  const structures: Record<BespokeStructureKey, ProcessedStructureSprite> = {
    temple: createBespokeStructureSprite(highTempleImgUrl, { sampleSize: 208 }),
    altar: createBespokeStructureSprite(altarImgUrl, { sampleSize: 192 }),
    bastion: createBespokeStructureSprite(stoneBastionImgUrl, { sampleSize: 192 }),
    spire: createBespokeStructureSprite(arcaneSpireImgUrl, {
      aggressiveHaloKey: true,
      sampleSize: 192,
    }),
    workshop: createBespokeStructureSprite(sanctuaryWorkshopImgUrl, { sampleSize: 192 }),
    aetherMill: createBespokeStructureSprite(aetherMillImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    aetherRelay: createBespokeStructureSprite(aetherRelayImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    skyObservatory: createBespokeStructureSprite(skyObservatoryImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    fencePylon: createBespokeStructureSprite(fencePylonImgUrl, {
      aggressiveHaloKey: true,
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    aetherMine: createBespokeStructureSprite(aetherMineImgUrl, {
      sampleSize: 192,
    }),
    sunDisc: createBespokeStructureSprite(sunDiscTowerImgUrl, {
      aggressiveHaloKey: true,
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    siegePedestal: createBespokeStructureSprite(siegePedestalImgUrl, {
      sampleSize: 192,
    }),
    galeBallista: createBespokeStructureSprite(galeBallistaImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    galeBallistaBack: createBespokeStructureSprite(galeBallistaBackImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    zephyrLance: createBespokeStructureSprite(zephyrLanceImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    zephyrLanceBack: createBespokeStructureSprite(zephyrLanceBackImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    cycloneSpire: createBespokeStructureSprite(cycloneSpireImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    tidalMortar: createBespokeStructureSprite(tidalMortarImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    glacialBulwark: createBespokeStructureSprite(glacialBulwarkImgUrl, {
      sampleSize: 192,
    }),
    manOWar: createBespokeStructureSprite(manOWarImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    voltCannon: createBespokeStructureSprite(voltCannonImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    voltCannonBack: createBespokeStructureSprite(voltCannonBackImgUrl, {
      aggressiveHaloKey: true,
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    arcSpire: createBespokeStructureSprite(arcSpireImgUrl, {
      aggressiveHaloKey: true,
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    // Keep removeEnclosedMagenta off so interior violet crystal & runes remain completely untouched
    shrineMonolith: createBespokeStructureSprite(shrineMonolithImgUrl, {
      sampleSize: 192,
    }),
    aetherVent: createBespokeStructureSprite(aetherVentImgUrl, {
      sampleSize: 192,
    }),
  };

  const units: Record<BespokeUnitKey, ProcessedStructureSprite> = {
    golem: createBespokeStructureSprite(golemImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
      buildFrostTint: true,
    }),
    priestWind: createBespokeStructureSprite(priestWindImgUrl, {
      aggressiveHaloKey: true,
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    priestRain: createBespokeStructureSprite(priestRainImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    priestThunder: createBespokeStructureSprite(priestThunderImgUrl, {
      aggressiveHaloKey: true,
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    priestRogue: createBespokeStructureSprite(priestRogueImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    solarSkiff: createBespokeStructureSprite(solarSkiffImgUrl, {
      aggressiveHaloKey: true,
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    aetherDirigible: createBespokeStructureSprite(aetherDirigibleImgUrl, {
      aggressiveHaloKey: true,
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    tempestVortex: createBespokeStructureSprite(tempestVortexImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
    skyLeviathan: createBespokeStructureSprite(skyLeviathanImgUrl, {
      removeEnclosedMagenta: true,
      sampleSize: 192,
    }),
  };

  cachedAtlas = {
    landTiles,
    cobbleTiles,
    flagstoneTile,
    sunlitClouds,
    stormClouds,
    cloudShadow,
    distantIslets,
    structures,
    units,
  };
  return cachedAtlas;
}
