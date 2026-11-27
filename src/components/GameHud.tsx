import React, { useEffect, useRef, useState } from 'react';
import {
  Compass,
  Crosshair,
  Crown,
  FastForward,
  Heart,
  Lock,
  MousePointer2,
  Pause,
  Radar,
  RotateCw,
  Settings,
  Target,
  Volume2,
  VolumeX,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  FURY_META,
  SPEED_STEPS,
  STRUCTURE_CATALOG,
  TETROMINOES,
  directionLabel,
  getNextSpeedMultiplier,
  getPaletteForFury,
  isAiFaction,
} from '../game/catalog';
import type { BuildOptionKind, Fury, HudSnapshot, PlacementMode } from '../game/types';
import {
  GolemGlyph,
  StormCrystalIcon,
  StructureGlyph,
  TetrominoPreview,
} from './Icons';

interface GameHudProps {
  hud: HudSnapshot;
  onBindMinimap: (canvas: HTMLCanvasElement | null) => void;
  onMinimapClick: (nx: number, ny: number) => void;
  onSetPlacement: (mode: PlacementMode) => void;
  onRotate: () => void;
  onSummonGolem: () => void;
  onToggleSpeed: () => void;
  onToggleMute: () => void;
  onToggleRangeOverlay: () => void;
  onToggleRangeFury: (fury: Fury) => void;
  onOpenSettings: () => void;
  onPause: () => void;
  onCenterHome: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCapturePriest: (priestId: number) => void;
  onFocusSacredSite: () => void;
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function GameHud({
  hud,
  onBindMinimap,
  onMinimapClick,
  onSetPlacement,
  onRotate,
  onSummonGolem,
  onToggleSpeed,
  onToggleMute,
  onToggleRangeOverlay,
  onToggleRangeFury,
  onOpenSettings,
  onPause,
  onCenterHome,
  onZoomIn,
  onZoomOut,
  onCapturePriest,
  onFocusSacredSite,
}: GameHudProps) {
  const hudRootRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const draggingMinimap = useRef(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );
  const [uiTooltip, setUiTooltip] = useState<{
    key: string;
    rect: { left: number; right: number; top: number; bottom: number; width: number };
  } | null>(null);

  const showUiTooltip = (key: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setUiTooltip({
      key,
      rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width },
    });
  };

  const hideUiTooltip = (key: string) => {
    setUiTooltip((prev) => (prev?.key === key ? null : prev));
  };

  const tipProps = (key: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showUiTooltip(key, e.currentTarget),
    onMouseLeave: () => hideUiTooltip(key),
    onFocus: (e: React.FocusEvent<HTMLElement>) => showUiTooltip(key, e.currentTarget),
    onBlur: () => hideUiTooltip(key),
  });

  useEffect(() => {
    onBindMinimap(minimapRef.current);
    return () => onBindMinimap(null);
  }, [onBindMinimap]);

  useEffect(() => {
    const el = hudRootRef.current;
    const syncWidth = () => {
      const next = el?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1280);
      setViewportWidth((prev) => (prev === next ? prev : next));
    };
    syncWidth();
    if (typeof ResizeObserver !== 'undefined' && el) {
      const ro = new ResizeObserver(syncWidth);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', syncWidth);
    return () => window.removeEventListener('resize', syncWidth);
  }, []);

  const furyMeta = FURY_META[hud.playerFury];
  const palette = getPaletteForFury(hud.playerFury);

  // Proportional scaling so top HUD & bottom dock stay cohesive and never clip off-screen
  const isCompactTop = viewportWidth < 768;
  const isUltraCompactTop = viewportWidth < 520;
  const padX = viewportWidth < 640 ? 20 : 28;
  const topNaturalSpan = isUltraCompactTop
    ? 424
    : isCompactTop
      ? 554
      : hud.opponentCount > 1
        ? 1034
        : 984;
  const topScale = Math.min(1, Math.max(0.7, (viewportWidth - padX) / topNaturalSpan));
  const centerInline = viewportWidth >= (hud.opponentCount > 1 ? 1420 : 1360);
  const minimapReserve = viewportWidth >= 640 ? Math.ceil(224 * topScale) : 12;
  const centerMaxWidth = centerInline
    ? Math.min(440, Math.max(240, viewportWidth - topNaturalSpan - 48))
    : Math.min(440, Math.max(180, viewportWidth - minimapReserve * 2 - 12));
  const dockScale =
    viewportWidth >= 640 ? Math.min(1, Math.max(0.68, (viewportWidth - padX) / 965)) : 1;

  const handleMinimapClientCoords = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    onMinimapClick(nx, ny);
  };

  // Determine compact active placement / inspector readout above bottom dock
  let contextLine: { title: string; detail: string; accent?: string; actionId?: number } | null = null;
  if (hud.placement.type === 'BRIDGE') {
    const key = hud.bridgeQueue[hud.placement.queueIndex];
    const def = TETROMINOES[key];
    contextLine = {
      title: `Placing ${def.label} (${def.cost} AE)`,
      detail: 'Drag map to pan · Tap/click sky edge to place · R or Rotate to turn',
      accent: furyMeta.color,
    };
  } else if (hud.placement.type === 'STRUCTURE') {
    const def = STRUCTURE_CATALOG[hud.placement.kind];
    const rangeTag = def.range > 0 ? ` · Range ${def.range} (${def.directional ? 'Lane' : '360°'})` : '';
    contextLine = {
      title: `${def.name} (${def.cost} AE${rangeTag})`,
      detail: def.directional
        ? `${def.description} Facing ${directionLabel(hud.placement.facing)} (R to rotate).`
        : def.description,
      accent: furyMeta.color,
    };
  } else if (hud.selected) {
    contextLine = {
      title: `${hud.selected.title} · HP ${hud.selected.hp}/${hud.selected.maxHp}`,
      detail: `${hud.selected.statusText} — ${hud.selected.subtitle}`,
      accent: hud.selected.factionColor ?? (isAiFaction(hud.selected.owner) ? '#f87171' : '#f0b429'),
      actionId: hud.selected.canCommandCapture ? hud.selected.id : undefined,
    };
  }

  const hovered = hud.hovered;
  let hoverStyle: React.CSSProperties | undefined;
  if (hovered && !uiTooltip) {
    const cardW = 264;
    const cardH = 148;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
    // Offset cleanly to the right of the hovered unit; flip left near right edge
    const preferRight = hovered.screenX + 28 + cardW <= vw - 14;
    const left = preferRight
      ? Math.max(14, hovered.screenX + 28)
      : Math.max(14, hovered.screenX - cardW - 28);
    // Keep cleanly below top HUD bar and above bottom command dock
    const top = Math.max(66, Math.min(vh - cardH - 128, hovered.screenY - 56));
    hoverStyle = { left, top, width: cardW };
  }

  // Resolve live UI tooltip content from key + current HUD snapshot
  interface UiTooltipContent {
    title: string;
    badge?: string;
    accent?: string;
    body: string;
    meta?: string;
    rivals?: HudSnapshot['rivals'];
    sites?: HudSnapshot['victoryProgress']['sites'];
  }

  const nextSpeed = getNextSpeedMultiplier(hud.speedMultiplier);
  const vp = hud.victoryProgress;
  const overloadPct = Math.min(100, Math.floor((vp.playerAether / Math.max(1, vp.aetherTarget)) * 100));
  const rivalOverloadWarning =
    vp.leadingOverloadOwner !== 'PLAYER' && vp.leadingOverloadAether >= vp.aetherTarget * 0.6;
  const domLeaderIsPlayer = vp.dominanceLeaderOwner === 'PLAYER';
  const domActive = vp.dominanceLeaderOwner !== null && vp.dominanceLeaderSeconds >= 0.5;
  const domRemainingSec = Math.max(0, Math.ceil(vp.dominanceDuration - vp.dominanceLeaderSeconds));
  const domRatio = Math.min(1, vp.dominanceLeaderSeconds / Math.max(1, vp.dominanceDuration));

  const resolveUiTooltip = (key: string): UiTooltipContent | null => {
    switch (key) {
      case 'aether':
        return {
          title: 'Aether Energy',
          badge: `${hud.stormPower} AE`,
          accent: '#f0b429',
          body: 'Core resource spent to forge Sky-Bridges, build structures, and summon Aether Golems.',
          meta: hud.victoryRules.aetherOverload
            ? vp.aetherOverloadAchieved
              ? 'Aether Overload milestone already achieved this match — continuing toward remaining victory paths.'
              : `Harvested from Geysers and Windmills. Hoard ${vp.aetherTarget.toLocaleString()} AE to win via Aether Overload!`
            : 'Harvested from Geysers and Aether Mills.',
        };
      case 'win_overload': {
        const leaderLine =
          !vp.aetherOverloadAchieved && vp.leadingOverloadOwner !== 'PLAYER'
            ? ` Current leader: ${vp.leadingOverloadLabel} (${vp.leadingOverloadAether.toLocaleString()} AE).`
            : '';
        return {
          title: 'Aether Overload Victory',
          badge: vp.aetherOverloadAchieved
            ? 'Achieved ✓'
            : `${vp.playerAether.toLocaleString()} / ${vp.aetherTarget.toLocaleString()} AE`,
          accent: '#f0b429',
          body: vp.aetherOverloadAchieved
            ? `You already triggered Aether Overload (${vp.aetherTarget.toLocaleString()} AE) and chose to continue playing.`
            : `Hoard ${vp.aetherTarget.toLocaleString()} unspent Aether Energy to overload the sky-grid and claim economic victory.${leaderLine}`,
          meta: vp.aetherOverloadAchieved
            ? 'Keep fighting to finish rivals via High Priest Sacrifice or other active victory paths.'
            : 'Expand to Geyser Isles, summon Golems, and build Aether Mills—you can continue playing even after reaching this goal.',
        };
      }
      case 'win_dominance': {
        const timerStatus = vp.altarDominanceAchieved
          ? 'You already achieved Altar Dominance this match and chose to continue playing.'
          : domActive
            ? `${domLeaderIsPlayer ? 'You are' : `${vp.dominanceLeaderLabel} is`} holding majority control — ${formatClock(domRemainingSec)} remaining!`
            : `Link & hold exclusive powered control of at least ${vp.requiredSites} of ${vp.totalSites} Sacred Sites for ${vp.dominanceDuration}s to win.`;
        return {
          title: 'Altar Dominance Victory',
          badge: vp.altarDominanceAchieved
            ? 'Achieved ✓'
            : `${vp.playerControlledSites} / ${vp.requiredSites} Sites`,
          accent: domActive && !domLeaderIsPlayer ? (vp.dominanceLeaderColor ?? '#f87171') : '#67e8f9',
          body: timerStatus,
          sites: vp.sites,
          meta: 'Clear neutral Shrine Monoliths and sever rival bridges to hold a site uncontested. Click to cycle camera across Sacred Sites.',
        };
      }
      case 'golems':
        return {
          title: 'Aether Golems',
          badge: `${hud.golemCount} / ${hud.maxGolems}`,
          accent: '#dce6f2',
          body: 'Autonomous stone workers that gather Aether Crystals from erupting Geysers and carry them back to your High Temple.',
          meta: `Summon more from the bottom dock (${hud.golemCost} AE, Key G).`,
        };
      case 'islands':
        return {
          title: 'Connected Sky-Islands',
          badge: `${hud.connectedIslands} / ${hud.totalIslands}`,
          accent: '#67e8f9',
          body: 'Islands linked to your High Temple through powered Sky-Bridges.',
          meta: 'Linking new islands powers your forward defenses and lets Golems reach distant Geysers.',
        };
      case 'aspect': {
        const t2Def = STRUCTURE_CATALOG[furyMeta.tier2Unit];
        return {
          title: furyMeta.name,
          badge: `Tier ${hud.knowledgeTier}`,
          accent: furyMeta.color,
          body: furyMeta.tagline,
          meta:
            hud.knowledgeTier < 2
              ? `Sacrifice a Rogue/rival Priest or shatter a rival High Temple to unlock Tier 2 (${t2Def.name}).`
              : `Tier 2 Mastery active — ${t2Def.name} is unlocked in your build dock.`,
        };
      }
      case 'priests': {
        const aliveRivals = hud.rivals.filter((r) => !r.eliminated).length;
        return {
          title: hud.opponentCount === 1 ? 'High Priests' : 'High Priests & Rivals',
          badge: hud.opponentCount === 1 ? '1v1 Duel' : `${aliveRivals}/${hud.opponentCount} Active`,
          accent: '#a7f3d0',
          body: `Your High Priest: ${
            hud.playerPriestState === 'STUNNED'
              ? 'STUNNED — protect them!'
              : `${hud.playerPriestHp}/${hud.playerPriestMaxHp} HP`
          }.`,
          rivals: hud.rivals,
          meta: 'Eliminate rivals by shattering their High Temple or capturing & sacrificing their stunned High Priest at your Altar.',
        };
      }
      case 'clock':
        return {
          title: 'Skirmish Timer',
          badge: `${hud.speedMultiplier}x Speed`,
          accent: '#d3dfec',
          body: `Elapsed battle time on this ${hud.gridSize}×${hud.gridSize} archipelago.`,
          meta: `Active speed options: ${SPEED_STEPS.map((s) => `${s}x`).join(' · ')}.`,
        };
      case 'zoom_out':
        return {
          title: 'Zoom Out',
          badge: 'Key -',
          accent: '#cbd8e6',
          body: 'Pull the camera back to survey more islands and incoming bridge assaults.',
          meta: 'You can also scroll down with the mouse wheel or pinch on touch screens.',
        };
      case 'zoom_in':
        return {
          title: 'Zoom In',
          badge: 'Key +',
          accent: '#cbd8e6',
          body: 'Move closer for precise Sky-Bridge snapping and turret placement.',
          meta: 'You can also scroll up with the mouse wheel.',
        };
      case 'center_home':
        return {
          title: 'Center on Home Island',
          badge: 'Space',
          accent: '#f0b429',
          body: 'Snap the camera straight back to your High Temple and Sacrificial Altar.',
        };
      case 'ranges':
        return {
          title: 'Tower Range Overlay',
          badge: hud.rangeOverlay.enabled ? 'ON · Key V' : 'OFF · Key V',
          accent: '#f0b429',
          body: 'Displays firing range circles and directional lanes for placed Wind, Rain, and Thunder towers across the sky.',
          meta: 'Solid rings mark allied towers; dashed rings mark enemy towers. Filter individual elements below when enabled.',
        };
      case 'speed':
        return {
          title: 'Game Speed',
          badge: `${hud.speedMultiplier}x · Key F`,
          accent: '#f0b429',
          body: `Controls simulation speed (${SPEED_STEPS.map((s) => `${s}x`).join(', ')}). Click to switch to ${nextSpeed}x.`,
          meta: 'Higher speeds accelerate crystal harvesting, bridge battles, and AI actions.',
        };
      case 'mute':
        return {
          title: hud.muted ? 'Unmute Audio' : 'Mute Audio',
          badge: hud.muted
            ? 'Muted'
            : `Music ${Math.round(hud.musicVolume * 100)}% · SFX ${Math.round(hud.sfxVolume * 100)}%`,
          accent: '#cbd8e6',
          body: 'Toggle the original soundtrack, combat effects, sacrifices, and sky-island ambience.',
          meta: `Now Playing: ${hud.currentTrackTitle}`,
        };
      case 'settings':
        return {
          title: 'Settings & Credits',
          badge: `Music ${Math.round(hud.musicVolume * 100)}% · SFX ${Math.round(hud.sfxVolume * 100)}%`,
          accent: '#f5dfaa',
          body: 'Adjust Music and Sound FX volume independently, skip tracks, or open the Game Credits screen.',
          meta: `Now Playing: ${hud.currentTrackTitle}`,
        };
      case 'pause':
        return {
          title: 'Pause Skirmish',
          badge: 'Esc',
          accent: '#cbd8e6',
          body: 'Pause the battle to adjust settings, restart the match, or return to the title screen.',
        };
      case 'rotate':
        return {
          title: 'Rotate Placement',
          badge: 'Key R',
          accent: '#f5dfaa',
          body: 'Turns your selected Sky-Bridge shape 90° or rotates the firing lane of directional turrets.',
        };
      case 'select':
        return {
          title: 'Select & Command',
          badge: 'Key 1',
          accent: '#f0b429',
          body: 'Inspect any unit or structure on the map, or click a stunned Priest to dispatch your High Priest for capture.',
        };
      case 'summon_golem': {
        const atCap = hud.golemCount >= hud.maxGolems;
        const lowAether = hud.stormPower < hud.golemCost;
        return {
          title: 'Summon Aether Golem',
          badge: `${hud.golemCost} AE · Key G`,
          accent: '#f0b429',
          body: `Spawns a harvester Golem at your High Temple (${hud.golemCount}/${hud.maxGolems} active) to collect Aether Crystals from connected Geysers.`,
          meta: atCap
            ? 'Golem limit reached — wait for a slot before summoning another.'
            : lowAether
              ? `Requires ${hud.golemCost - hud.stormPower} more AE.`
              : 'Ready to summon immediately.',
        };
      }
      case 'minimap':
        return {
          title: 'Tactical Sky Chart',
          badge: `${hud.gridSize}×${hud.gridSize}`,
          accent: '#67e8f9',
          body: 'Click or drag anywhere on the chart to pan the camera swiftly across the archipelago.',
        };
      default: {
        if (key.startsWith('range_fury:')) {
          const fury = key.slice('range_fury:'.length) as Fury;
          const meta = FURY_META[fury];
          const active = hud.rangeOverlay[fury];
          return {
            title: `${meta.name} Ranges`,
            badge: active ? 'Shown' : 'Hidden',
            accent: meta.color,
            body: meta.tagline,
            meta: `Click to ${active ? 'hide' : 'show'} ${meta.name} tower coverage indicators on the map.`,
          };
        }
        if (key.startsWith('bridge:')) {
          const idx = Number(key.slice('bridge:'.length));
          const pieceKey = hud.bridgeQueue[idx];
          if (!pieceKey) return null;
          const def = TETROMINOES[pieceKey];
          return {
            title: `${def.label} Sky-Bridge`,
            badge: `${def.cost} AE`,
            accent: furyMeta.color,
            body: 'Extends your powered Aether grid across open sky to connect islands and support forward turrets.',
            meta: 'Click any glowing sky edge adjacent to your powered territory. Press R to rotate.',
          };
        }
        if (key.startsWith('structure:')) {
          const kind = key.slice('structure:'.length) as BuildOptionKind;
          const def = STRUCTURE_CATALOG[kind];
          if (!def) return null;
          const locked = def.tier > hud.knowledgeTier;
          const parts: string[] = [`HP ${def.maxHp}`];
          if (def.range > 0) parts.push(`Range ${def.range} (${def.directional ? 'Lane' : '360°'})`);
          if (def.damage > 0) parts.push(`${def.damage} DMG @ ${def.fireRate}/s`);
          if (def.passiveIncome) parts.push(`+${def.passiveIncome} AE/s`);
          if (def.slowAuraRadius) parts.push(`Slow Aura ${def.slowAuraRadius}`);
          return {
            title: def.name,
            badge: locked ? 'Altar Tier 2' : `${def.cost} AE`,
            accent: locked ? '#c084fc' : def.alignment === 'SUN' ? '#f0b429' : furyMeta.color,
            body: def.description,
            meta: locked
              ? `Locked — sacrifice a Rogue/rival Priest or shatter a rival High Temple to unlock. (${parts.join(' · ')})`
              : parts.join(' · '),
          };
        }
        return null;
      }
    }
  };

  const uiTooltipContent = uiTooltip ? resolveUiTooltip(uiTooltip.key) : null;
  let uiTooltipStyle: React.CSSProperties | undefined;
  if (uiTooltip && uiTooltipContent) {
    const cardW = 276;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
    const cx = uiTooltip.rect.left + uiTooltip.rect.width / 2;
    const left = Math.max(12, Math.min(viewportWidth - cardW - 12, Math.round(cx - cardW / 2)));
    const placeBelow = uiTooltip.rect.top < vh * 0.5;
    uiTooltipStyle = placeBelow
      ? { left, top: Math.round(uiTooltip.rect.bottom + 8), width: cardW }
      : { left, bottom: Math.round(vh - uiTooltip.rect.top + 8), width: cardW };
  }

  return (
    <div
      ref={hudRootRef}
      className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-2.5 sm:p-3.5 overflow-hidden"
    >
      {/* STYLED HOVER TOOLTIP FOR HUD CONTROLS & STATUS INDICATORS */}
      {uiTooltipContent && uiTooltipStyle && (
        <div
          style={uiTooltipStyle}
          role="tooltip"
          className="pointer-events-none fixed z-30 stone-frame rounded-lg px-3 py-2.5 text-xs shadow-2xl"
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-display font-semibold text-[13px] text-[#f6ead0] truncate">
              {uiTooltipContent.title}
            </span>
            {uiTooltipContent.badge && (
              <span
                className="text-[10px] font-mono-tabular font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                style={{
                  backgroundColor: `${uiTooltipContent.accent ?? '#f0b429'}24`,
                  color: uiTooltipContent.accent ?? '#f0b429',
                }}
              >
                {uiTooltipContent.badge}
              </span>
            )}
          </div>
          <p className="text-[11px] leading-snug text-[#dbe7f3]">{uiTooltipContent.body}</p>
          {uiTooltipContent.rivals && uiTooltipContent.rivals.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-[#d6bc86]/15 flex flex-col gap-1">
              {uiTooltipContent.rivals.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex items-center gap-1.5 text-[#e2ebf5] truncate">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: r.eliminated ? '#475569' : r.color }}
                    />
                    <span className={r.eliminated ? 'line-through text-[#64748b]' : ''}>
                      {r.label} ({FURY_META[r.fury].name.replace(' Aspect', '')})
                    </span>
                  </span>
                  <span
                    className={`font-mono-tabular shrink-0 ${
                      r.eliminated
                        ? 'text-[#64748b]'
                        : r.state === 'STUNNED'
                          ? 'text-[#fde047] font-semibold'
                          : 'text-[#fca5a5]'
                    }`}
                  >
                    {r.eliminated ? 'Fallen' : r.state === 'STUNNED' ? 'STUNNED' : `${r.hp}/${r.maxHp}`}
                  </span>
                </div>
              ))}
            </div>
          )}
          {uiTooltipContent.sites && uiTooltipContent.sites.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-[#d6bc86]/15 flex flex-col gap-1">
              {uiTooltipContent.sites.map((site) => {
                const controllerRival =
                  site.controller && site.controller !== 'PLAYER'
                    ? hud.rivals.find((r) => r.id === site.controller)
                    : null;
                const dotCol =
                  site.controller === 'PLAYER'
                    ? furyMeta.color
                    : controllerRival
                      ? controllerRival.color
                      : site.contested
                        ? '#f59e0b'
                        : '#d6bc86';
                const statusLabel =
                  site.controller === 'PLAYER'
                    ? 'Allied'
                    : controllerRival
                      ? controllerRival.label
                      : site.guardedByNeutral
                        ? 'Guarded'
                        : site.contested
                          ? 'Contested'
                          : 'Unclaimed';
                return (
                  <div key={site.islandId} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex items-center gap-1.5 text-[#e2ebf5] truncate">
                      <span
                        className="w-2 h-2 rotate-45 shrink-0"
                        style={{ backgroundColor: dotCol }}
                      />
                      <span className="truncate">
                        {site.name}
                        {site.role === 'CITADEL' ? ' ★' : ''}
                      </span>
                    </span>
                    <span
                      className="font-mono-tabular shrink-0 text-[10.5px]"
                      style={{ color: dotCol }}
                    >
                      {statusLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {uiTooltipContent.meta && (
            <p className="mt-1.5 pt-1.5 border-t border-[#d6bc86]/15 text-[10.5px] leading-snug text-[#9cb2c9]">
              {uiTooltipContent.meta}
            </p>
          )}
        </div>
      )}

      {/* FLOATING MAP HOVER STATS TOOLTIP */}
      {hovered && hoverStyle && !uiTooltip && (
        <div
          style={hoverStyle}
          className="pointer-events-none fixed z-20 stone-frame rounded-lg px-3 py-2.5 text-xs shadow-2xl"
        >
          {/* Header: Name + Faction Tag */}
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="font-display font-semibold text-[13px] text-[#f6ead0] truncate">
              {hovered.title}
            </span>
            <span
              className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
              style={{
                backgroundColor: `${hovered.factionColor}26`,
                color: hovered.factionColor,
              }}
            >
              {hovered.factionLabel}
            </span>
          </div>

          {/* Health Bar (hidden for indestructible Geysers) */}
          {hovered.kind !== 'GEYSER' && (
            <div className="mb-2">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="flex items-center gap-1 text-[#9cb2c9]">
                  <Heart className="w-3 h-3 text-[#f87171]" />
                  Health
                </span>
                <span className="font-mono-tabular font-semibold text-[#eef2f6]">
                  {hovered.hp} / {hovered.maxHp}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[#0b121c] overflow-hidden border border-[#d6bc86]/20">
                <div
                  className="h-full rounded-full transition-[width] duration-100"
                  style={{
                    width: `${Math.max(0, Math.min(100, (hovered.hp / Math.max(1, hovered.maxHp)) * 100))}%`,
                    backgroundColor: isAiFaction(hovered.owner)
                      ? hovered.factionColor
                      : hovered.hp / Math.max(1, hovered.maxHp) < 0.35
                        ? '#f59e0b'
                        : hovered.factionColor,
                  }}
                />
              </div>
            </div>
          )}

          {/* Attack Range & Combat Specs */}
          <div className="flex items-start gap-1.5 text-[11px] mb-1.5">
            <Crosshair className="w-3.5 h-3.5 text-[#f0b429] shrink-0 mt-0.5" />
            <div className="min-w-0 leading-snug">
              <div className="text-[#e6eef7] font-medium">{hovered.rangeLabel}</div>
              {hovered.combatStats && (
                <div className="text-[10.5px] font-mono-tabular text-[#9cb2c9]">
                  {hovered.combatStats}
                </div>
              )}
            </div>
          </div>

          {/* Live Current Objective */}
          <div className="flex items-start gap-1.5 text-[11px] pt-1.5 border-t border-[#d6bc86]/15">
            <Target
              className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                hovered.powered === false ? 'text-[#f87171]' : 'text-[#67e8f9]'
              }`}
            />
            <div className="min-w-0 leading-snug">
              <span className="text-[#8ea5bc] mr-1">Objective:</span>
              <span
                className={
                  hovered.powered === false ? 'text-[#fca5a5] font-medium' : 'text-[#dbe7f3]'
                }
              >
                {hovered.objective}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TOP PERIMETER ROW — cohesive corner-anchored clusters that scale proportionally */}
      <div className="relative w-full h-0">
        {/* Top-Left: Unified Resource & Priest Bar + Compact Victory Paths Strip */}
        <div
          style={topScale < 1 ? { transform: `scale(${topScale})` } : undefined}
          className="pointer-events-auto absolute top-0 left-0 origin-top-left flex flex-col items-start gap-1.5"
        >
          <div className="stone-frame rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 flex items-center gap-2.5 sm:gap-3 text-xs whitespace-nowrap">
            <div
              {...tipProps('aether')}
              className="flex items-center gap-1.5 cursor-help"
            >
              <StormCrystalIcon className="w-4 h-4 shrink-0" />
              <span className="font-mono-tabular text-sm sm:text-base font-bold text-[#f0b429]">
                {hud.stormPower}
              </span>
              {!isUltraCompactTop && <span className="text-[#9cb2c9]">AE</span>}
            </div>

            <div className="h-4 w-px bg-[#d6bc86]/20" />

            <div
              {...tipProps('golems')}
              className="flex items-center gap-1 text-[#dce6f2] cursor-help"
            >
              <GolemGlyph className="w-4 h-4 shrink-0" />
              <span className="font-mono-tabular font-semibold">
                {hud.golemCount}/{hud.maxGolems}
              </span>
            </div>

            {!isUltraCompactTop && (
              <>
                <div className="h-4 w-px bg-[#d6bc86]/20" />
                <div {...tipProps('islands')} className="text-[#cbd8e6] cursor-help">
                  Islands{' '}
                  <span className="font-mono-tabular font-semibold text-white">
                    {hud.connectedIslands}/{hud.totalIslands}
                  </span>
                </div>
              </>
            )}

            {!isCompactTop && (
              <>
                <div className="h-4 w-px bg-[#d6bc86]/20" />

                <div {...tipProps('aspect')} className="cursor-help">
                  <span style={{ color: furyMeta.color }} className="font-semibold">
                    {furyMeta.name}
                  </span>
                  <span className="text-[#9cb2c9] mx-1.5">·</span>
                  <span className="font-mono-tabular text-[#f5dfaa]">
                    Tier {hud.knowledgeTier}
                  </span>
                </div>

                <div className="h-4 w-px bg-[#d6bc86]/20" />

                <div
                  {...tipProps('priests')}
                  className="flex items-center gap-2 text-[11px] font-mono-tabular cursor-help"
                >
                  <span className="text-[#a7f3d0]">
                    Priest {hud.playerPriestState === 'STUNNED' ? 'STUNNED' : `${hud.playerPriestHp}/${hud.playerPriestMaxHp}`}
                  </span>
                  <span className="text-[#9cb2c9]">/</span>
                  {hud.opponentCount === 1 ? (
                    <span className="text-[#fca5a5]">
                      Rival {hud.aiPriestState === 'STUNNED' ? 'STUNNED' : `${hud.aiPriestHp}/${hud.aiPriestMaxHp}`}
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#fca5a5]">
                        Rivals {hud.rivals.filter((r) => !r.eliminated).length}/{hud.opponentCount}
                      </span>
                      <div className="flex items-center gap-1">
                        {hud.rivals.map((r) => (
                          <span
                            key={r.id}
                            className={`w-2.5 h-2.5 rounded-full border ${
                              r.eliminated
                                ? 'opacity-25 border-[#64748b]'
                                : r.state === 'STUNNED'
                                  ? 'border-[#fde047] ring-1 ring-[#fde047]'
                                  : 'border-white/40'
                            }`}
                            style={{ backgroundColor: r.eliminated ? '#334155' : r.color }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Compact Alternative Victory Paths Strip (shown only when at least one alt victory is enabled) */}
          {(hud.victoryRules.aetherOverload || hud.victoryRules.altarDominance) && (
            <div className="stone-frame-subtle rounded-lg px-2.5 py-1 flex items-center gap-2.5 text-[11px] whitespace-nowrap">
              {hud.victoryRules.aetherOverload && (
                <div
                  {...tipProps('win_overload')}
                  className="flex items-center gap-1.5 cursor-help"
                >
                  <Zap className="w-3.5 h-3.5 text-[#f0b429] shrink-0" />
                  <span className="text-[#cbd8e6]">Overload</span>
                  {vp.aetherOverloadAchieved ? (
                    <span className="font-mono-tabular font-semibold text-[#fde047]">Done ✓</span>
                  ) : (
                    <>
                      <div className="w-11 h-1.5 rounded-full bg-[#0b121c] border border-[#d6bc86]/25 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-[width] duration-150"
                          style={{
                            width: `${overloadPct}%`,
                            backgroundColor: overloadPct >= 75 ? '#fde047' : '#f0b429',
                          }}
                        />
                      </div>
                      <span className="font-mono-tabular font-semibold text-[#f5dfaa]">
                        {overloadPct}%
                      </span>
                      {rivalOverloadWarning && (
                        <span
                          className="w-2 h-2 rounded-full animate-pulse shrink-0"
                          style={{ backgroundColor: vp.leadingOverloadColor }}
                        />
                      )}
                    </>
                  )}
                </div>
              )}

              {hud.victoryRules.aetherOverload && hud.victoryRules.altarDominance && (
                <div className="h-3.5 w-px bg-[#d6bc86]/20" />
              )}

              {hud.victoryRules.altarDominance && (
                <button
                  type="button"
                  onClick={onFocusSacredSite}
                  {...tipProps('win_dominance')}
                  className="flex items-center gap-1.5 text-left hover:text-white transition-colors cursor-pointer"
                >
                  <Crown
                    className="w-3.5 h-3.5 shrink-0"
                    style={{
                      color: vp.altarDominanceAchieved
                        ? '#fde047'
                        : domActive
                          ? domLeaderIsPlayer
                            ? '#fde047'
                            : (vp.dominanceLeaderColor ?? '#f87171')
                          : '#67e8f9',
                    }}
                  />
                  {vp.altarDominanceAchieved ? (
                    <span className="font-mono-tabular font-semibold text-[#fde047]">
                      Dominance ✓
                    </span>
                  ) : (
                    <>
                      <span className="text-[#cbd8e6]">
                        Sites{' '}
                        <span className="font-mono-tabular font-semibold text-white">
                          {vp.playerControlledSites}/{vp.requiredSites}
                        </span>
                      </span>
                      {domActive && (
                        <>
                          <div className="w-11 h-1.5 rounded-full bg-[#0b121c] border border-[#d6bc86]/25 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-[width] duration-150"
                              style={{
                                width: `${Math.round(domRatio * 100)}%`,
                                backgroundColor: domLeaderIsPlayer
                                  ? '#fde047'
                                  : (vp.dominanceLeaderColor ?? '#ef4444'),
                              }}
                            />
                          </div>
                          <span
                            className="font-mono-tabular font-semibold"
                            style={{
                              color: domLeaderIsPlayer
                                ? '#fde047'
                                : (vp.dominanceLeaderColor ?? '#fca5a5'),
                            }}
                          >
                            {formatClock(domRemainingSec)}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Top-Center: Stunned Priest Capture Callouts & Battle Alerts (floats independently without shifting corners) */}
        {(hud.stunnedTargets.length > 0 || hud.alertBanner) && (
          <div
            style={{
              top: centerInline ? 0 : Math.round(80 * topScale),
              maxWidth: centerMaxWidth,
              transform: topScale < 1 ? `translateX(-50%) scale(${topScale})` : 'translateX(-50%)',
            }}
            className="absolute left-1/2 origin-top flex flex-col items-center gap-1.5 w-max"
          >
            {hud.stunnedTargets.map((target) => (
              <button
                key={target.priestId}
                type="button"
                onClick={() => onCapturePriest(target.priestId)}
                className="pointer-events-auto stone-frame rounded-lg px-3.5 py-1.5 text-xs font-semibold text-[#fef08a] border-[#facc15]/60 hover:bg-[#273549] transition-colors cursor-pointer text-center leading-snug max-w-full"
              >
                {target.label} Stunned ({target.stunRemaining}s) — Send Your High Priest to Capture
              </button>
            ))}

            {hud.alertBanner && (
              <div
                className={`stone-frame rounded-lg px-3.5 py-1.5 text-xs font-medium text-center leading-snug max-w-full ${
                  hud.alertBanner.tone === 'WARNING'
                    ? 'text-[#fca5a5] border-[#ef4444]/45'
                    : hud.alertBanner.tone === 'SACRIFICE'
                      ? 'text-[#fef08a] border-[#f0b429]/55'
                      : 'text-[#dbe7f3]'
                }`}
              >
                {hud.alertBanner.text}
              </div>
            )}
          </div>
        )}

        {/* Top-Right: Unified Controls + Range Filter + Minimap Column */}
        <div
          style={topScale < 1 ? { transform: `scale(${topScale})` } : undefined}
          className="pointer-events-auto absolute top-0 right-0 origin-top-right flex flex-col items-end gap-2"
        >
          <div className="stone-frame rounded-lg px-1.5 sm:px-2 py-1 flex items-center gap-1 text-xs whitespace-nowrap">
            {!isUltraCompactTop && (
              <span
                {...tipProps('clock')}
                className="font-mono-tabular text-[#d3dfec] px-1.5 cursor-help"
              >
                {formatClock(hud.elapsedSeconds)}
              </span>
            )}
            <button
              type="button"
              onClick={onZoomOut}
              {...tipProps('zoom_out')}
              className="p-1.5 rounded text-[#cbd8e6] hover:text-white hover:bg-[#233245] transition-colors cursor-pointer"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onZoomIn}
              {...tipProps('zoom_in')}
              className="p-1.5 rounded text-[#cbd8e6] hover:text-white hover:bg-[#233245] transition-colors cursor-pointer"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onCenterHome}
              {...tipProps('center_home')}
              className="p-1.5 rounded text-[#cbd8e6] hover:text-white hover:bg-[#233245] transition-colors cursor-pointer"
              aria-label="Center camera on home island"
            >
              <Compass className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleRangeOverlay}
              {...tipProps('ranges')}
              aria-pressed={hud.rangeOverlay.enabled}
              aria-label="Toggle tower range overlay"
              className={`px-2 py-1 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                hud.rangeOverlay.enabled
                  ? 'bg-[#f0b429] text-[#131b26]'
                  : 'text-[#cbd8e6] hover:text-white hover:bg-[#233245]'
              }`}
            >
              <Radar className="w-3.5 h-3.5" />
              {!isCompactTop && <span>Ranges</span>}
            </button>
            <button
              type="button"
              onClick={onToggleSpeed}
              {...tipProps('speed')}
              aria-label={`Game speed ${hud.speedMultiplier}x, click for ${nextSpeed}x`}
              className={`px-2 py-1 rounded text-xs font-mono-tabular font-semibold transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                hud.speedMultiplier === 5
                  ? 'bg-[#fb923c] text-[#131b26]'
                  : hud.speedMultiplier > 1
                    ? 'bg-[#f0b429] text-[#131b26]'
                    : 'text-[#cbd8e6] hover:text-white hover:bg-[#233245]'
              }`}
            >
              <FastForward className="w-3.5 h-3.5" />
              {hud.speedMultiplier}x
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              {...tipProps('mute')}
              className="p-1.5 rounded text-[#cbd8e6] hover:text-white hover:bg-[#233245] transition-colors cursor-pointer"
              aria-label={hud.muted ? 'Unmute audio' : 'Mute audio'}
            >
              {hud.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              {...tipProps('settings')}
              className="p-1.5 rounded text-[#cbd8e6] hover:text-[#f5dfaa] hover:bg-[#233245] transition-colors cursor-pointer"
              aria-label="Open audio settings and credits"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onPause}
              {...tipProps('pause')}
              className="p-1.5 rounded text-[#cbd8e6] hover:text-white hover:bg-[#233245] transition-colors cursor-pointer"
              aria-label="Pause game"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Tactical Elemental Range Overlay Filter Bar */}
          {hud.rangeOverlay.enabled && (
            <div className="stone-frame rounded-lg px-2 py-1.5 flex flex-col gap-1 text-[11px]">
              <div className="flex items-center gap-1">
                {(['WIND', 'RAIN', 'THUNDER'] as Fury[]).map((fury) => {
                  const meta = FURY_META[fury];
                  const active = hud.rangeOverlay[fury];
                  return (
                    <button
                      key={fury}
                      type="button"
                      onClick={() => onToggleRangeFury(fury)}
                      {...tipProps(`range_fury:${fury}`)}
                      aria-pressed={active}
                      className={`px-2 py-0.5 rounded border text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                        active
                          ? 'bg-[#1c2a3a] text-[#eef2f6]'
                          : 'bg-[#101824] text-[#7c92a8] border-[#d6bc86]/15 opacity-60 hover:opacity-85'
                      }`}
                      style={active ? { borderColor: `${meta.color}99` } : undefined}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: active ? meta.color : '#475569' }}
                      />
                      {fury === 'WIND' ? 'Wind' : fury === 'RAIN' ? 'Rain' : 'Thunder'}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#9cb2c9] px-0.5">
                <span>Solid: Allied</span>
                <span>Dashed: Enemy</span>
              </div>
            </div>
          )}

          <div
            {...tipProps('minimap')}
            className="stone-frame rounded-lg p-1 sm:p-1.5 hidden sm:block"
          >
            <canvas
              ref={minimapRef}
              width={196}
              height={102}
              onMouseDown={(e) => {
                draggingMinimap.current = true;
                handleMinimapClientCoords(e.currentTarget, e.clientX, e.clientY);
              }}
              onMouseMove={(e) => {
                if (draggingMinimap.current) {
                  handleMinimapClientCoords(e.currentTarget, e.clientX, e.clientY);
                }
              }}
              onMouseUp={() => {
                draggingMinimap.current = false;
              }}
              onMouseLeave={() => {
                draggingMinimap.current = false;
              }}
              onTouchStart={(e) => {
                if (e.touches.length > 0) {
                  handleMinimapClientCoords(e.currentTarget, e.touches[0].clientX, e.touches[0].clientY);
                }
              }}
              onTouchMove={(e) => {
                if (e.touches.length > 0) {
                  handleMinimapClientCoords(e.currentTarget, e.touches[0].clientX, e.touches[0].clientY);
                }
              }}
              className="block rounded cursor-crosshair touch-none"
            />
          </div>
        </div>
      </div>

      {/* BOTTOM COMMAND DOCK */}
      <div
        style={dockScale < 1 ? { transform: `scale(${dockScale})` } : undefined}
        className="flex flex-col items-center gap-2 origin-bottom"
      >
        {/* Contextual Placement / Inspector Strip */}
        {contextLine && (
          <div
            className={`pointer-events-auto stone-frame-subtle rounded-lg px-3.5 py-1.5 flex items-center gap-3 text-xs ${
              viewportWidth < 640 ? 'max-w-[calc(100vw-20px)]' : 'max-w-2xl'
            }`}
          >
            <span className="font-semibold whitespace-nowrap shrink-0" style={{ color: contextLine.accent ?? '#f5dfaa' }}>
              {contextLine.title}
            </span>
            <span className="text-[#c1d0e0] truncate min-w-0">{contextLine.detail}</span>
            {contextLine.actionId !== undefined && (
              <button
                type="button"
                onClick={() => onCapturePriest(contextLine!.actionId!)}
                className="px-2.5 py-1 rounded bg-[#f0b429] text-[#131b26] font-semibold hover:bg-[#f7c54b] cursor-pointer whitespace-nowrap shrink-0"
              >
                Send High Priest
              </button>
            )}
          </div>
        )}

        {/* Main Compact Dock */}
        <div
          className={`pointer-events-auto stone-frame rounded-xl px-3 py-2 flex items-center gap-3 ${
            viewportWidth < 640 ? 'max-w-full overflow-x-auto' : ''
          }`}
        >
          {/* Tetromino Sky-Bridge Queue */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex flex-col mr-1">
              <span className="text-[11px] font-semibold text-[#f5dfaa] whitespace-nowrap">
                Bridges
              </span>
              <button
                type="button"
                onClick={onRotate}
                {...tipProps('rotate')}
                className="mt-1 flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-[#d4e2f0] bg-[#223042] hover:bg-[#2c3d54] transition-colors cursor-pointer whitespace-nowrap"
              >
                <RotateCw className="w-3 h-3" />
                Rotate
              </button>
            </div>

            {hud.bridgeQueue.map((pieceKey, idx) => {
              const def = TETROMINOES[pieceKey];
              const active = hud.placement.type === 'BRIDGE' && hud.placement.queueIndex === idx;
              const rot = active && hud.placement.type === 'BRIDGE' ? hud.placement.rotation : 0;
              const affordable = hud.stormPower >= def.cost;

              return (
                <button
                  key={`${pieceKey}-${idx}`}
                  type="button"
                  {...tipProps(`bridge:${idx}`)}
                  onClick={() =>
                    onSetPlacement({
                      type: 'BRIDGE',
                      queueIndex: idx,
                      rotation: active && hud.placement.type === 'BRIDGE' ? hud.placement.rotation : 0,
                    })
                  }
                  className={`flex flex-col items-center px-2 py-1 rounded-lg border transition-all duration-150 cursor-pointer shrink-0 ${
                    active
                      ? 'bg-[#25364a] border-[#f0b429]'
                      : 'bg-[#131c28] border-[#d6bc86]/20 hover:border-[#d6bc86]/50'
                  } ${!affordable ? 'opacity-55' : ''}`}
                >
                  <TetrominoPreview piece={pieceKey} rotation={rot} color={furyMeta.color} size={32} />
                  <span className="font-mono-tabular text-[11px] font-semibold text-[#f0b429]">
                    {def.cost}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="h-11 w-px bg-[#d6bc86]/20 shrink-0" />

          {/* Select + Structure Build Palette + Summon Golem */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onSetPlacement({ type: 'SELECT' })}
              {...tipProps('select')}
              className={`flex flex-col items-center justify-center w-[54px] h-[56px] rounded-lg border transition-colors cursor-pointer shrink-0 ${
                hud.placement.type === 'SELECT'
                  ? 'bg-[#25364a] border-[#f0b429] text-white'
                  : 'bg-[#131c28] border-[#d6bc86]/20 text-[#b4c5d8] hover:border-[#d6bc86]/50'
              }`}
            >
              <MousePointer2 className="w-4 h-4 mb-1" />
              <span className="text-[10px] font-medium whitespace-nowrap">Select</span>
              <span className="text-[9px] font-mono-tabular opacity-60">1</span>
            </button>

            {palette.map((kind: BuildOptionKind, index: number) => {
              const def = STRUCTURE_CATALOG[kind];
              const locked = def.tier > hud.knowledgeTier;
              const affordable = hud.stormPower >= def.cost;
              const active = hud.placement.type === 'STRUCTURE' && hud.placement.kind === kind;
              const col = def.alignment === 'SUN' ? '#f0b429' : furyMeta.color;

              return (
                <button
                  key={kind}
                  type="button"
                  {...tipProps(`structure:${kind}`)}
                  onClick={() => {
                    if (locked) return;
                    onSetPlacement({
                      type: 'STRUCTURE',
                      kind,
                      facing: active && hud.placement.type === 'STRUCTURE' ? hud.placement.facing : 0,
                    });
                  }}
                  className={`relative flex flex-col items-center justify-center w-[66px] h-[56px] px-1 rounded-lg border transition-colors shrink-0 ${
                    locked
                      ? 'bg-[#111822] border-[#d6bc86]/15 opacity-60 cursor-not-allowed'
                      : active
                        ? 'bg-[#25364a] border-[#f0b429] cursor-pointer'
                        : 'bg-[#131c28] border-[#d6bc86]/20 hover:border-[#d6bc86]/50 cursor-pointer'
                  } ${!locked && !affordable ? 'opacity-60' : ''}`}
                >
                  <span className="absolute top-0.5 left-1.5 text-[9px] font-mono-tabular text-[#8da3ba]">
                    {index + 2}
                  </span>
                  {locked ? (
                    <>
                      <Lock className="w-3.5 h-3.5 text-[#c084fc] mb-0.5" />
                      <span className="text-[10px] font-medium text-[#cbd5e1] truncate max-w-full">
                        {def.shortName}
                      </span>
                      <span className="text-[9px] text-[#c084fc] whitespace-nowrap">Altar T2</span>
                    </>
                  ) : (
                    <>
                      <StructureGlyph kind={kind} color={col} className="w-5 h-5" />
                      <span className="text-[10px] font-medium text-[#e2ebf5] truncate max-w-full leading-tight">
                        {def.shortName}
                      </span>
                      <span className="font-mono-tabular text-[10px] font-semibold text-[#f0b429]">
                        {def.cost}
                      </span>
                    </>
                  )}
                </button>
              );
            })}

            <div className="h-11 w-px bg-[#d6bc86]/20 mx-0.5 shrink-0" />

            {/* Summon Golem Instant Action */}
            <button
              type="button"
              onClick={() => {
                if (hud.golemCount >= hud.maxGolems || hud.stormPower < hud.golemCost) return;
                onSummonGolem();
              }}
              aria-disabled={hud.golemCount >= hud.maxGolems || hud.stormPower < hud.golemCost}
              {...tipProps('summon_golem')}
              className={`flex flex-col items-center justify-center w-[66px] h-[56px] px-1 rounded-lg border transition-colors shrink-0 ${
                hud.golemCount >= hud.maxGolems || hud.stormPower < hud.golemCost
                  ? 'bg-[#111822] border-[#d6bc86]/15 opacity-50 cursor-not-allowed'
                  : 'bg-[#1a2636] border-[#f0b429]/45 hover:bg-[#243447] cursor-pointer'
              }`}
            >
              <GolemGlyph className="w-5 h-5" />
              <span className="text-[10px] font-semibold text-[#eef2f6] whitespace-nowrap">
                + Golem
              </span>
              <span className="font-mono-tabular text-[10px] font-semibold text-[#f0b429]">
                {hud.golemCost}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
