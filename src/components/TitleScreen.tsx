import React, { useEffect, useState } from 'react';
import { BookOpen, CloudFog, Play, Settings, SlidersHorizontal, Volume2, VolumeX, X } from 'lucide-react';
import { FURY_META, MAX_OPPONENTS, getMapScaleLabel } from '../game/catalog';
import {
  DIFFICULTY_ORDER,
  DIFFICULTY_PROFILES,
  getAverageActionCadence,
} from '../game/difficulty';
import type { Difficulty, Fury, VictoryRules } from '../game/types';
import titleKeyArtImgUrl from '../assets/images/title_key_art_1795699734519.jpg';
import { AetherIslesTitleLockup } from './Icons';
import { PWAInstallButton } from './PWAInstallButton';

const KEY_ART_SRC = titleKeyArtImgUrl;

interface TitleScreenProps {
  selectedFury: Fury;
  selectedDifficulty: Difficulty;
  selectedOpponents: number;
  victoryRules: VictoryRules;
  musicMuted: boolean;
  disableShortcuts?: boolean;
  onSelectFury: (fury: Fury) => void;
  onSelectDifficulty: (difficulty: Difficulty) => void;
  onSelectOpponents: (count: number) => void;
  onStart: () => void;
  onOpenSettings: () => void;
  onOpenRules: () => void;
  onToggleFogOfWar: () => void;
  onToggleMusicMute: () => void;
}

const OPPONENT_COUNTS = Array.from({ length: MAX_OPPONENTS }, (_, i) => i + 1);

interface DifficultyOption {
  key: Difficulty;
  label: string;
  detail: string;
  accent: string;
  summary: string;
  stats: Array<{ label: string; value: string }>;
}

const DIFFICULTIES: DifficultyOption[] = DIFFICULTY_ORDER.map((key) => {
  const p = DIFFICULTY_PROFILES[key];
  const avgCadence = getAverageActionCadence(p).toFixed(1);
  const millWord = p.maxWindmills === 1 ? 'Mill' : 'Mills';
  return {
    key: p.key,
    label: p.label,
    detail: p.detail,
    accent: p.accent,
    summary: p.summary,
    stats: [
      {
        label: 'Passive Aether',
        value: `${Math.round(p.passiveAetherMultiplier * 100)}% (+${p.startingAetherBonus} start)`,
      },
      {
        label: 'Action Cadence',
        value: `~${avgCadence}s / move (${p.openingGraceSeconds.toFixed(1)}s start)`,
      },
      {
        label: 'Economy Caps',
        value: `${p.desiredGolems} Golems · ${p.maxWindmills} ${millWord}`,
      },
      {
        label: 'Overload Hoard',
        value: p.overloadHoardEnabled ? 'Active' : 'Off',
      },
    ],
  };
});

export function TitleScreen({
  selectedFury,
  selectedDifficulty,
  selectedOpponents,
  victoryRules,
  musicMuted,
  disableShortcuts = false,
  onSelectFury,
  onSelectDifficulty,
  onSelectOpponents,
  onStart,
  onOpenSettings,
  onOpenRules,
  onToggleFogOfWar,
  onToggleMusicMute,
}: TitleScreenProps) {
  const [showGuide, setShowGuide] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [emblemErrors, setEmblemErrors] = useState<Record<string, boolean>>({});
  const [hoveredDifficulty, setHoveredDifficulty] = useState<{
    option: DifficultyOption;
    rect: { left: number; top: number; bottom: number; width: number };
  } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (disableShortcuts) return;
      if (showGuide) {
        if (e.code === 'Escape') setShowGuide(false);
        return;
      }
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onStart, showGuide, disableShortcuts]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0e1e33] text-[#eef2f6]">
      {/* Full-Viewport Painted Sky-Island Key Art Backdrop */}
      {!imgError ? (
        <img
          src={KEY_ART_SRC}
          alt="Floating sky islands linked by stone bridges above sunlit clouds"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 75% 25%, #3c75a1 0%, #173454 52%, #0b1829 100%)',
          }}
        />
      )}

      {/* Measured Atmospheric Left Scrim for High Legibility over Negative Sky Space */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(95deg, rgba(10, 21, 35, 0.94) 0%, rgba(12, 26, 44, 0.84) 40%, rgba(12, 26, 44, 0.34) 72%, rgba(10, 21, 35, 0.22) 100%)',
        }}
      />

      {/* Simple Top-Right Theme Music Mute Button */}
      <button
        type="button"
        onClick={onToggleMusicMute}
        aria-pressed={musicMuted}
        aria-label={musicMuted ? 'Unmute theme music' : 'Mute theme music'}
        title={musicMuted ? 'Unmute theme music' : 'Mute theme music'}
        className={`fixed top-5 right-5 md:top-8 md:right-10 z-20 inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium backdrop-blur-sm border transition-all duration-150 shadow-md cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#f0b429] ${
          musicMuted
            ? 'text-[#f6b8b8] bg-[#2a161c]/85 border-[#e87a7a]/45 hover:bg-[#381d25]/95 hover:border-[#f09595]/70'
            : 'text-[#e5eef7] bg-[#121c29]/80 border-[#d6bc86]/30 hover:border-[#d6bc86]/65 hover:text-[#fef3c7] hover:bg-[#1a2839]/95'
        }`}
      >
        {musicMuted ? (
          <VolumeX className="w-4 h-4 text-[#f08b8b] shrink-0" />
        ) : (
          <Volume2 className="w-4 h-4 text-[#f0b429] shrink-0" />
        )}
        <span>{musicMuted ? 'Music Muted' : 'Mute Music'}</span>
      </button>

      {/* Main Content Stage */}
      <div className="relative z-10 h-full overflow-y-auto flex flex-col justify-between px-6 py-6 md:px-14 md:py-10 max-w-[680px]">
        {/* Top Wordmark & Premise */}
        <div className="space-y-4">
          <AetherIslesTitleLockup className="w-full max-w-[440px] h-auto -ml-2" />
          <p className="text-[15px] leading-relaxed text-[#cfdbe8] max-w-[490px]">
            Span the cloudsea of Aetheria with stone sky-bridges, harvest erupting Aether Crystals, erect
            elemental defenses, and carry rival Priests to your Altar.
          </p>
        </div>

        {/* Skirmish Configuration */}
        <div className="space-y-4 my-auto py-3">
          {/* Elemental Aspect Selector */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-[#f5dfaa] tracking-wide">
                Choose Your Element
              </h2>
              <span className="text-xs text-[#a5b9cf]">
                Procedural Archipelago · Altar Rituals
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {(['WIND', 'RAIN', 'THUNDER'] as Fury[]).map((fury) => {
                const meta = FURY_META[fury];
                const active = selectedFury === fury;
                return (
                  <button
                    key={fury}
                    type="button"
                    onClick={() => onSelectFury(fury)}
                    className={`group text-left p-2.5 rounded-lg transition-all duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#f0b429] ${
                      active
                        ? 'bg-[#1d2b3d] border border-[#e6c478] shadow-lg'
                        : 'bg-[#131d2a]/90 border border-[#d6bc86]/20 hover:border-[#d6bc86]/50 hover:bg-[#1a2636]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 border border-[#d6bc86]/40 bg-[#0f1926] flex items-center justify-center">
                        {!emblemErrors[fury] ? (
                          <img
                            src={meta.emblemSrc}
                            alt={meta.name}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setEmblemErrors((prev) => ({ ...prev, [fury]: true }))
                            }
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span
                            className="text-xs font-bold"
                            style={{ color: meta.color }}
                          >
                            {fury[0]}
                          </span>
                        )}
                      </div>
                      <span
                        className="font-display text-sm font-bold whitespace-nowrap"
                        style={{ color: active ? meta.color : '#eef2f6' }}
                      >
                        {fury === 'WIND' ? 'Wind' : fury === 'RAIN' ? 'Rain' : 'Thunder'}
                      </span>
                    </div>
                    <p className="text-xs leading-snug text-[#b4c5d8]">
                      {meta.tagline}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Opponent Count & Dynamic Map Size Selector */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#f5dfaa] tracking-wide">
                Rival Opponents
              </h2>
              <span className="text-xs font-mono-tabular text-[#d9c38d]">
                {getMapScaleLabel(selectedOpponents)}
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1.5 p-1 rounded-lg bg-[#111a26]/90 border border-[#d6bc86]/20">
              {OPPONENT_COUNTS.map((count) => {
                const active = selectedOpponents === count;
                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() => onSelectOpponents(count)}
                    aria-pressed={active}
                    className={`py-2 px-1 rounded-md text-center transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-[#243447] text-[#fef3c7] border border-[#d6bc86]/50'
                        : 'text-[#9eb3c9] hover:text-white hover:bg-[#182433] border border-transparent'
                    }`}
                  >
                    <div className="font-mono-tabular text-sm font-bold leading-tight">{count}</div>
                    <div className="text-[10px] opacity-75">
                      {count === 1 ? 'Rival' : 'Rivals'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI Difficulty Selector */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#f5dfaa] tracking-wide">
                Rival High Priest Difficulty
              </h2>
              <span className="text-[11px] text-[#8fa7bf]">
                Hover mode for scaling details
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 p-1 rounded-lg bg-[#111a26]/90 border border-[#d6bc86]/20">
              {DIFFICULTIES.map((d) => {
                const active = selectedDifficulty === d.key;
                const showTip = (el: HTMLElement) => {
                  const r = el.getBoundingClientRect();
                  setHoveredDifficulty({
                    option: d,
                    rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width },
                  });
                };
                const hideTip = () => {
                  setHoveredDifficulty((prev) => (prev?.option.key === d.key ? null : prev));
                };
                return (
                  <button
                    key={d.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectDifficulty(d.key)}
                    onMouseEnter={(e) => showTip(e.currentTarget)}
                    onMouseLeave={hideTip}
                    onFocus={(e) => showTip(e.currentTarget)}
                    onBlur={hideTip}
                    className={`py-2 px-3 rounded-md text-center transition-colors duration-150 cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#f0b429] ${
                      active
                        ? 'bg-[#243447] text-[#fef3c7] border border-[#d6bc86]/45'
                        : 'text-[#9eb3c9] hover:text-white border border-transparent'
                    }`}
                  >
                    <div className="text-xs font-semibold">{d.label}</div>
                    <div className="text-[11px] opacity-75">{d.detail}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Victory Rules & Optional Fog of War Strip */}
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg bg-[#111a26]/90 border border-[#d6bc86]/20">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-[#f5dfaa] tracking-wide mb-0.5">
                Match Rules &amp; Victory Conditions
              </div>
              <div className="text-xs text-[#bfd0e2] truncate">
                {[
                  'Priest Sacrifice',
                  victoryRules.templeDestruction ? 'Temple Siege' : null,
                  victoryRules.altarDominance ? 'Altar Dominance' : null,
                  victoryRules.aetherOverload
                    ? `Overload (${victoryRules.aetherOverloadTarget.toLocaleString()} AE)`
                    : null,
                  victoryRules.fogOfWar ? 'Fog of War' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                role="switch"
                aria-checked={victoryRules.fogOfWar}
                onClick={onToggleFogOfWar}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                  victoryRules.fogOfWar
                    ? 'bg-[#163142] text-[#a5f3fc] border-[#67e8f9]/60 hover:bg-[#1b3d52]'
                    : 'bg-[#172332] text-[#a5b9cf] border-[#d6bc86]/25 hover:text-white hover:border-[#d6bc86]/50'
                }`}
              >
                <CloudFog className={`w-3.5 h-3.5 ${victoryRules.fogOfWar ? 'text-[#67e8f9]' : 'text-[#8ea5bc]'}`} />
                Fog: {victoryRules.fogOfWar ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                onClick={onOpenRules}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-[#f5dfaa] bg-[#1b293b] border border-[#d6bc86]/30 hover:border-[#f0b429]/65 hover:bg-[#23344a] transition-colors cursor-pointer shrink-0 whitespace-nowrap"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#f0b429]" />
                Configure
              </button>
            </div>
          </div>

          {/* Primary Start CTA + Field Guide + Android PWA Install */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onStart}
              className="flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-lg font-display font-bold text-sm tracking-wider text-[#131b26] bg-[#f0b429] hover:bg-[#f7c54b] active:scale-[0.98] transition-all duration-150 shadow-lg cursor-pointer whitespace-nowrap"
            >
              <Play className="w-4 h-4 fill-current" />
              Start Skirmish
            </button>
            <button
              type="button"
              onClick={() => setShowGuide(true)}
              className="flex items-center gap-2 px-4 py-3.5 rounded-lg text-sm font-medium text-[#dbe7f3] bg-[#162232]/90 border border-[#d6bc86]/30 hover:border-[#d6bc86]/60 hover:bg-[#1e2e42] transition-colors duration-150 cursor-pointer whitespace-nowrap"
            >
              <BookOpen className="w-4 h-4" />
              How to Play
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-2 px-4 py-3.5 rounded-lg text-sm font-medium text-[#dbe7f3] bg-[#162232]/90 border border-[#d6bc86]/30 hover:border-[#d6bc86]/60 hover:bg-[#1e2e42] transition-colors duration-150 cursor-pointer whitespace-nowrap"
            >
              <Settings className="w-4 h-4 text-[#f0b429]" />
              Settings
            </button>
            <PWAInstallButton />
          </div>
        </div>

        {/* Single Flat Control-Hint Footer Line */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <div className="text-xs text-[#9cb3ca] font-mono-tabular">
            Drag / WASD / Touch Pan · Scroll / Pinch Zoom · R / Right-Click Rotate · 1–7 Build · Space Home · Esc Pause
          </div>
          <a
            href="https://ko-fi.com/M4R320UNC5"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Support me on Ko-fi"
            className="md:hidden inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-[#cfdbe8] bg-[#131d2a]/85 border border-[#d6bc86]/25 hover:border-[#d6bc86]/55 hover:text-[#fef3c7] hover:bg-[#1a2839] transition-colors duration-150 whitespace-nowrap"
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
              <path
                d="M4 7.5h11.5v5.25a4.75 4.75 0 0 1-4.75 4.75h-2A4.75 4.75 0 0 1 4 12.75V7.5Z"
                stroke="#d6bc86"
                strokeWidth="1.6"
                fill="#1b293b"
              />
              <path
                d="M15.5 8.75h1.6a2.4 2.4 0 0 1 0 4.8h-1.6"
                stroke="#d6bc86"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M9.75 14.3c-.15-.12-2.2-1.45-2.2-2.8 0-.82.64-1.45 1.4-1.45.45 0 .85.22 1.1.56.25-.34.65-.56 1.1-.56.76 0 1.4.63 1.4 1.45 0 1.35-2.05 2.68-2.2 2.8a.48.48 0 0 1-.6 0Z"
                fill="#f0b429"
              />
            </svg>
            Support me on Ko-fi
          </a>
        </div>
      </div>

      {/* Polite Corner Ko-fi Support Link (Desktop) */}
      <a
        href="https://ko-fi.com/M4R320UNC5"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Support me on Ko-fi"
        className="hidden md:inline-flex items-center gap-2 fixed bottom-8 right-10 z-20 px-3.5 py-2 rounded-lg text-xs font-medium text-[#cfdbe8]/90 bg-[#121c29]/80 backdrop-blur-sm border border-[#d6bc86]/25 hover:border-[#d6bc86]/60 hover:text-[#fef3c7] hover:bg-[#1a2839]/95 transition-all duration-150 shadow-md whitespace-nowrap"
      >
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 shrink-0" aria-hidden="true">
          <path
            d="M4 7.5h11.5v5.25a4.75 4.75 0 0 1-4.75 4.75h-2A4.75 4.75 0 0 1 4 12.75V7.5Z"
            stroke="#d6bc86"
            strokeWidth="1.6"
            fill="#1b293b"
          />
          <path
            d="M15.5 8.75h1.6a2.4 2.4 0 0 1 0 4.8h-1.6"
            stroke="#d6bc86"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M9.75 14.3c-.15-.12-2.2-1.45-2.2-2.8 0-.82.64-1.45 1.4-1.45.45 0 .85.22 1.1.56.25-.34.65-.56 1.1-.56.76 0 1.4.63 1.4 1.45 0 1.35-2.05 2.68-2.2 2.8a.48.48 0 0 1-.6 0Z"
            fill="#f0b429"
          />
        </svg>
        Support me on Ko-fi
      </a>

      {/* Compact How to Play Modal */}
      {showGuide && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#08111e]/80 p-6">
          <div className="stone-frame rounded-xl max-w-xl w-full p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-[#d6bc86]/20 pb-3">
              <h3 className="font-display text-lg font-bold text-[#f5dfaa]">
                Commanding the Floating Islands
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1.5 rounded-md text-[#a9bdd2] hover:text-white hover:bg-[#233245] cursor-pointer"
                aria-label="Close guide"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-sm text-[#d3dfec] leading-relaxed">
              <p>
                <strong className="text-[#f0b429]">1. Polyomino Sky-Bridges:</strong> Pick a bridge
                shape from the bottom-left queue, press <span className="font-mono-tabular text-white">R</span> or
                right-click to rotate, and snap it onto any edge connected to your Temple. Aether energy
                flows only through connected land and bridges—cut an enemy bridge to disable their forward towers.
              </p>
              <p>
                <strong className="text-[#f0b429]">2. Aether Vents & Golems:</strong> Vents erupt
                with Aether Crystals. Your Golems automatically traverse connected bridges to harvest
                crystals and return them to your Temple for Aether.
              </p>
              <p>
                <strong className="text-[#f0b429]">3. Tactical Tower Combat:</strong> Placed towers
                fire automatically. Directional cannons (Gale Ballista, Zephyr Lance, Volt Siege Cannon) lock onto a
                cardinal lane—rotate before placing and counter enemy lanes with Stone or Glacial Bulwarks.
              </p>
              <p>
                <strong className="text-[#f0b429]">4. Four Paths to Victory:</strong> Unlock Tier-2
                weapons by sacrificing a Rogue/rival Priest or shattering a rival High Temple. Win the
                skirmish by sacrificing all rival High Priests, destroying all rival High Temples,
                holding majority control of the central Sacred Sites for 90s (<strong className="text-[#67e8f9]">Altar Dominance</strong>),
                or hoarding 2,500 AE (<strong className="text-[#fde047]">Aether Overload</strong>).
              </p>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-[#131b26] bg-[#f0b429] hover:bg-[#f7c54b] transition-colors cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Difficulty Scaling Hover Tooltip */}
      {hoveredDifficulty && !showGuide && !disableShortcuts && (
        (() => {
          const { option, rect } = hoveredDifficulty;
          const tooltipWidth = 264;
          const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
          const left = Math.max(
            12,
            Math.min(vw - tooltipWidth - 12, rect.left + rect.width / 2 - tooltipWidth / 2)
          );
          const placeAbove = rect.top > 185;
          return (
            <div
              role="tooltip"
              style={{
                left,
                width: tooltipWidth,
                ...(placeAbove
                  ? { bottom: (typeof window !== 'undefined' ? window.innerHeight : 800) - rect.top + 10 }
                  : { top: rect.bottom + 10 }),
              }}
              className="pointer-events-none fixed z-30 stone-frame rounded-lg px-3.5 py-2.5 text-xs shadow-2xl"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span
                  className="font-display font-bold text-[13px]"
                  style={{ color: option.accent }}
                >
                  {option.label}
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-[#b7c8da]">
                  {option.detail}
                </span>
              </div>
              <p className="text-[11px] leading-snug text-[#cbd8e6] mb-2">
                {option.summary}
              </p>
              <div className="space-y-1 pt-1.5 border-t border-[#d6bc86]/20">
                {option.stats.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-[#9cb2c9]">{row.label}</span>
                    <span className="font-mono-tabular font-semibold text-[#eef2f6]">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}
