import { getWorldIsoBounds } from './catalog';
import type {
  Fury,
  IslandInfo,
  StormCell,
  WeatherHudSummary,
  WeatherPhase,
  WeatherState,
  WorldLightningBolt,
} from './types';
import { tileToIso } from './worldGen';

interface WeatherPhaseTargets {
  overcast: number;
  rainIntensity: number;
  stormIntensity: number;
  windStrength: number;
  sunVisibility: number;
}

const PHASE_TARGETS: Record<WeatherPhase, WeatherPhaseTargets> = {
  CALM: {
    overcast: 0.0,
    rainIntensity: 0.0,
    stormIntensity: 0.0,
    windStrength: 0.22,
    sunVisibility: 1.0,
  },
  LIGHT_RAIN: {
    overcast: 0.52,
    rainIntensity: 0.48,
    stormIntensity: 0.16,
    windStrength: 0.58,
    sunVisibility: 0.36,
  },
  THUNDERSTORM: {
    overcast: 0.84,
    rainIntensity: 0.84,
    stormIntensity: 1.0,
    windStrength: 0.96,
    sunVisibility: 0.1,
  },
};

export interface WeatherStrikeEvent {
  isoX: number;
  isoY: number;
  intensity: number;
}

export function getWeatherLabel(phase: WeatherPhase): string {
  switch (phase) {
    case 'CALM':
      return 'Calm Skies';
    case 'LIGHT_RAIN':
      return 'Light Rain';
    case 'THUNDERSTORM':
      return 'Thunderstorm';
  }
}

export function createInitialWeatherState(): WeatherState {
  return {
    phase: 'CALM',
    nextPhase: 'LIGHT_RAIN',
    phaseElapsed: 0,
    // Start in bright calm skies, then begin transitioning into light rain within ~24-30s
    phaseDuration: 24 + Math.random() * 6,
    overcast: 0,
    rainIntensity: 0,
    stormIntensity: 0,
    windStrength: 0.22,
    sunVisibility: 1,
    globalFlash: 0,
    cells: [],
    nextCellId: 1,
    driftTime: 0,
  };
}

function chooseNextPhase(current: WeatherPhase, prevWasStorm: boolean): WeatherPhase {
  if (current === 'CALM') {
    return 'LIGHT_RAIN';
  }
  if (current === 'LIGHT_RAIN') {
    // After a thunderstorm, clear back to calm skies; otherwise escalate into a thunderstorm most of the time
    if (prevWasStorm) return 'CALM';
    return Math.random() < 0.78 ? 'THUNDERSTORM' : 'CALM';
  }
  // THUNDERSTORM always softens through LIGHT_RAIN before clearing
  return 'LIGHT_RAIN';
}

function getDurationForPhase(phase: WeatherPhase): number {
  switch (phase) {
    case 'CALM':
      return 38 + Math.random() * 18;
    case 'LIGHT_RAIN':
      return 30 + Math.random() * 14;
    case 'THUNDERSTORM':
      return 34 + Math.random() * 14;
  }
}

function spawnStormCell(
  weather: WeatherState,
  gridSize: number,
  islands: IslandInfo[],
  cameraIso?: { x: number; y: number }
): StormCell {
  const bounds = getWorldIsoBounds(gridSize);
  const existing = weather.cells;

  // Pick a scenic target island so localized storms actually sweep across occupied sky-islands
  let targetIsoX = (bounds.minX + bounds.maxX) * 0.5;
  let targetIsoY = (bounds.minY + bounds.maxY) * 0.5;

  if (islands.length > 0) {
    // Score candidates to spread cells out across different sectors of the archipelago
    let bestScore = -Infinity;
    let bestIso = { x: targetIsoX, y: targetIsoY };
    const sampleCount = Math.min(islands.length, 8);
    for (let s = 0; s < sampleCount; s++) {
      const isl = islands[Math.floor(Math.random() * islands.length)];
      const iso = tileToIso(isl.centerX, isl.centerY);
      let minDist = Infinity;
      for (const c of existing) {
        const d = Math.hypot(c.isoX - iso.x, c.isoY - iso.y);
        if (d < minDist) minDist = d;
      }
      // Mild preference for first storm cell to drift near the player's current view so it's immediately atmospheric
      let camBonus = 0;
      if (existing.length === 0 && cameraIso) {
        const camDist = Math.hypot(cameraIso.x - iso.x, cameraIso.y - iso.y);
        camBonus = camDist < 900 ? 220 : -camDist * 0.08;
      }
      const score = (Number.isFinite(minDist) ? Math.min(minDist, 1200) : 600) + camBonus + Math.random() * 240;
      if (score > bestScore) {
        bestScore = score;
        bestIso = iso;
      }
    }
    targetIsoX = bestIso.x + (Math.random() - 0.5) * 160;
    targetIsoY = bestIso.y + (Math.random() - 0.5) * 110;
  }

  // Storms drift predominantly west-to-east with gentle diagonal sweep across the isometric plane
  const speed = 20 + Math.random() * 14;
  const angle = -0.18 + (Math.random() - 0.5) * 0.36;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed * 0.65;
  const maxAge = 24 + Math.random() * 14;

  // Offset starting position slightly upwind so the cell glides right over the target island mid-life
  const startX = Math.max(bounds.minX - 180, Math.min(bounds.maxX + 180, targetIsoX - vx * (maxAge * 0.32)));
  const startY = Math.max(bounds.minY - 120, Math.min(bounds.maxY + 120, targetIsoY - vy * (maxAge * 0.32)));

  return {
    id: weather.nextCellId++,
    isoX: startX,
    isoY: startY,
    vx,
    vy,
    radiusIso: 295 + Math.random() * 135,
    age: 0,
    maxAge,
    intensity: 0.01,
    lightningCooldown: 1.6 + Math.random() * 2.4,
    flash: 0,
    bolts: [],
    seed: Math.random() * 1000,
  };
}

function createWorldLightningBolt(cell: StormCell, playerFury: Fury): WorldLightningBolt {
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.sqrt(Math.random()) * cell.radiusIso * 0.62;
  const impactX = cell.isoX + Math.cos(angle) * dist;
  const impactY = cell.isoY + Math.sin(angle) * dist * 0.52;

  const startX = impactX + (Math.random() - 0.5) * 95 - 35;
  const startY = impactY - (220 + Math.random() * 75);

  const segments = 7;
  const points: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  const branches: Array<Array<{ x: number; y: number }>> = [];

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const jitter = i === segments ? 0 : (1 - Math.abs(t - 0.45)) * 42;
    const px = startX + (impactX - startX) * t + (Math.random() - 0.5) * jitter;
    const py = startY + (impactY - startY) * t + (Math.random() - 0.5) * (jitter * 0.25);
    points.push({ x: px, y: py });

    if ((i === 2 || i === 4) && Math.random() < 0.8) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const b1x = px + dir * (20 + Math.random() * 24);
      const b1y = py + (24 + Math.random() * 22);
      const b2x = b1x + dir * (10 + Math.random() * 20);
      const b2y = b1y + (20 + Math.random() * 20);
      branches.push([
        { x: px, y: py },
        { x: b1x, y: b1y },
        { x: b2x, y: b2y },
      ]);
    }
  }

  const hueRoll = Math.random();
  let hue: 'GOLD' | 'CYAN' | 'VIOLET' = 'CYAN';
  if (playerFury === 'THUNDER') {
    hue = hueRoll < 0.48 ? 'VIOLET' : hueRoll < 0.78 ? 'GOLD' : 'CYAN';
  } else if (playerFury === 'WIND') {
    hue = hueRoll < 0.5 ? 'GOLD' : 'CYAN';
  } else {
    hue = hueRoll < 0.65 ? 'CYAN' : 'GOLD';
  }

  return {
    points,
    branches,
    impactX,
    impactY,
    life: 0.34,
    maxLife: 0.34,
    hue,
  };
}

/**
 * Advances the purely visual weather cycle, smoothly interpolating sky/rain/wind
 * factors and drifting localized thunderstorm cells across the isometric archipelago.
 * Returns any lightning strikes that occurred this frame for spatial thunder audio & flash.
 */
export function updateWeatherState(
  weather: WeatherState,
  dt: number,
  gridSize: number,
  islands: IslandInfo[],
  playerFury: Fury,
  cameraIso?: { x: number; y: number }
): WeatherStrikeEvent[] {
  if (dt <= 0) return [];
  const strikes: WeatherStrikeEvent[] = [];

  weather.driftTime += dt;
  weather.phaseElapsed += dt;

  if (weather.phaseElapsed >= weather.phaseDuration) {
    const prevWasStorm = weather.phase === 'THUNDERSTORM';
    weather.phase = weather.nextPhase;
    weather.nextPhase = chooseNextPhase(weather.phase, prevWasStorm);
    weather.phaseElapsed = 0;
    weather.phaseDuration = getDurationForPhase(weather.phase);
  }

  // Anticipatory transition blend during the final 25% of each phase for seamless atmospheric crossfades
  const progress = Math.min(1, weather.phaseElapsed / Math.max(1, weather.phaseDuration));
  const blendFactor = progress > 0.75 ? ((progress - 0.75) / 0.25) * 0.45 : 0;

  const curT = PHASE_TARGETS[weather.phase];
  const nxtT = PHASE_TARGETS[weather.nextPhase];
  const targetOvercast = curT.overcast + (nxtT.overcast - curT.overcast) * blendFactor;
  const targetRain = curT.rainIntensity + (nxtT.rainIntensity - curT.rainIntensity) * blendFactor;
  const targetStorm = curT.stormIntensity + (nxtT.stormIntensity - curT.stormIntensity) * blendFactor;
  const targetWind = curT.windStrength + (nxtT.windStrength - curT.windStrength) * blendFactor;
  const targetSun = curT.sunVisibility + (nxtT.sunVisibility - curT.sunVisibility) * blendFactor;

  const ease = 1 - Math.exp(-dt * 0.38);
  weather.overcast += (targetOvercast - weather.overcast) * ease;
  weather.rainIntensity += (targetRain - weather.rainIntensity) * ease;
  weather.stormIntensity += (targetStorm - weather.stormIntensity) * ease;
  weather.windStrength += (targetWind - weather.windStrength) * ease;
  weather.sunVisibility += (targetSun - weather.sunVisibility) * ease;

  // Decay global sheet-lightning flash smoothly
  if (weather.globalFlash > 0.001) {
    weather.globalFlash = Math.max(0, weather.globalFlash - dt * 2.6);
  } else {
    weather.globalFlash = 0;
  }

  // Desired localized storm cells: 0 in calm, 0-1 building squall late in light rain, 2 active cells in thunderstorm
  const maxDesiredCells =
    weather.phase === 'THUNDERSTORM'
      ? gridSize >= 60
        ? 3
        : 2
      : weather.phase === 'LIGHT_RAIN' && weather.nextPhase === 'THUNDERSTORM' && progress > 0.62
        ? 1
        : 0;

  if (weather.cells.length < maxDesiredCells) {
    weather.cells.push(spawnStormCell(weather, gridSize, islands, cameraIso));
  }

  // Update active localized thunderstorm cells
  const survivingCells: StormCell[] = [];
  for (const cell of weather.cells) {
    cell.age += dt;
    cell.isoX += cell.vx * dt;
    cell.isoY += cell.vy * dt;

    // Smooth fade-in and fade-out lifecycle envelope
    const fadeIn = Math.min(1, cell.age / 4.2);
    const fadeOut = Math.min(1, Math.max(0, (cell.maxAge - cell.age) / 5.2));
    // Dampen slightly if phase has already transitioned back to calm/light rain
    const phaseCap = weather.phase === 'THUNDERSTORM' ? 1 : weather.phase === 'LIGHT_RAIN' ? 0.72 : 0.45;
    cell.intensity = Math.min(fadeIn, fadeOut) * phaseCap;

    if (cell.flash > 0.001) {
      cell.flash = Math.max(0, cell.flash - dt * 3.1);
    } else {
      cell.flash = 0;
    }

    // Update existing world bolts
    for (let i = cell.bolts.length - 1; i >= 0; i--) {
      cell.bolts[i].life -= dt;
      if (cell.bolts[i].life <= 0) {
        cell.bolts.splice(i, 1);
      }
    }

    // Trigger periodic localized lightning discharges when storm cell is matured
    if (cell.intensity > 0.32) {
      cell.lightningCooldown -= dt;
      if (cell.lightningCooldown <= 0) {
        cell.lightningCooldown = 2.6 + Math.random() * 4.2;
        const bolt = createWorldLightningBolt(cell, playerFury);
        cell.bolts.push(bolt);
        cell.flash = Math.min(1, 0.78 + cell.intensity * 0.22);
        strikes.push({
          isoX: bolt.impactX,
          isoY: bolt.impactY,
          intensity: cell.intensity,
        });
      }
    }

    if (cell.age < cell.maxAge) {
      survivingCells.push(cell);
    }
  }
  weather.cells = survivingCells;

  return strikes;
}

/**
 * Computes how strongly a given isometric world point (e.g. camera center or tile)
 * lies under any localized thunderstorm cell (0..1).
 */
export function getLocalizedStormFactorAtIso(
  weather: WeatherState,
  isoX: number,
  isoY: number
): number {
  let maxFactor = 0;
  for (const cell of weather.cells) {
    if (cell.intensity <= 0.01) continue;
    const dx = isoX - cell.isoX;
    const dy = (isoY - cell.isoY) * 1.45; // Isometric foreshortening
    const dist = Math.hypot(dx, dy);
    if (dist >= cell.radiusIso) continue;
    const radial = 1 - dist / cell.radiusIso;
    const f = radial * radial * cell.intensity;
    if (f > maxFactor) maxFactor = f;
  }
  return maxFactor;
}

export function buildWeatherHudSummary(weather: WeatherState): WeatherHudSummary {
  return {
    phase: weather.phase,
    label: getWeatherLabel(weather.phase),
    rainIntensity: Number(weather.rainIntensity.toFixed(2)),
    stormIntensity: Number(weather.stormIntensity.toFixed(2)),
    activeStormCells: weather.cells.filter((c) => c.intensity > 0.15).length,
  };
}
