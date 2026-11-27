import React, { useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Compass,
  Crown,
  Disc3,
  Flame,
  Layers,
  Lock,
  Music,
  ScrollText,
  Settings,
  Shield,
  SkipForward,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import { MUSIC_TRACKS } from '../game/audio';
import { AETHER_OVERLOAD_OPTIONS, ALTAR_DOMINANCE_DURATION } from '../game/catalog';
import type { GamePhase, VictoryRules } from '../game/types';

export type SettingsModalView = 'AUDIO' | 'RULES' | 'CREDITS';

interface SettingsCreditsModalProps {
  open: boolean;
  view: SettingsModalView;
  phase: GamePhase;
  muted: boolean;
  musicVolume: number;
  sfxVolume: number;
  currentTrackTitle: string;
  victoryRules: VictoryRules;
  onClose: () => void;
  onViewChange: (view: SettingsModalView) => void;
  onToggleMute: () => void;
  onChangeMusicVolume: (volume: number) => void;
  onChangeSfxVolume: (volume: number) => void;
  onPreviewSfx: () => void;
  onNextTrack: () => void;
  onUpdateVictoryRules: (patch: Partial<Omit<VictoryRules, 'priestSacrifice'>>) => void;
}

export function SettingsCreditsModal({
  open,
  view,
  phase,
  muted,
  musicVolume,
  sfxVolume,
  currentTrackTitle,
  victoryRules,
  onClose,
  onViewChange,
  onToggleMute,
  onChangeMusicVolume,
  onChangeSfxVolume,
  onPreviewSfx,
  onNextTrack,
  onUpdateVictoryRules,
}: SettingsCreditsModalProps) {
  const prevMusicVolRef = useRef(0.65);
  const prevSfxVolRef = useRef(0.85);

  useEffect(() => {
    if (musicVolume > 0.01) prevMusicVolRef.current = musicVolume;
  }, [musicVolume]);

  useEffect(() => {
    if (sfxVolume > 0.01) prevSfxVolRef.current = sfxVolume;
  }, [sfxVolume]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const musicPct = Math.round(musicVolume * 100);
  const sfxPct = Math.round(sfxVolume * 100);
  const isGameplayMusic = view !== 'CREDITS' && phase !== 'TITLE_MENU';

  const handleToggleMusicChannel = () => {
    if (musicVolume > 0.01) {
      prevMusicVolRef.current = musicVolume;
      onChangeMusicVolume(0);
    } else {
      onChangeMusicVolume(prevMusicVolRef.current || 0.65);
    }
  };

  const handleToggleSfxChannel = () => {
    if (sfxVolume > 0.01) {
      prevSfxVolRef.current = sfxVolume;
      onChangeSfxVolume(0);
    } else {
      onChangeSfxVolume(prevSfxVolRef.current || 0.85);
      onPreviewSfx();
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#07101c]/82 backdrop-blur-[2px] p-4 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={
          view === 'AUDIO' ? 'Audio Settings' : view === 'RULES' ? 'Victory Rules' : 'Game Credits'
        }
        className="stone-frame rounded-xl w-full max-w-xl max-h-[88vh] flex flex-col overflow-hidden text-[#eef2f6] shadow-2xl"
      >
        {/* Top Modal Header with Segmented Audio / Game Rules / Credits Tabs */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3.5 border-b border-[#d6bc86]/20 bg-[#101925]/70 shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0c141f] border border-[#d6bc86]/20">
            <button
              type="button"
              onClick={() => onViewChange('AUDIO')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                view === 'AUDIO'
                  ? 'bg-[#243447] text-[#fef3c7] border border-[#d6bc86]/45'
                  : 'text-[#9ab0c7] hover:text-white border border-transparent'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              Audio
            </button>
            <button
              type="button"
              onClick={() => onViewChange('RULES')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                view === 'RULES'
                  ? 'bg-[#243447] text-[#fef3c7] border border-[#d6bc86]/45'
                  : 'text-[#9ab0c7] hover:text-white border border-transparent'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              Game Rules
            </button>
            <button
              type="button"
              onClick={() => onViewChange('CREDITS')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                view === 'CREDITS'
                  ? 'bg-[#243447] text-[#fef3c7] border border-[#d6bc86]/45'
                  : 'text-[#9ab0c7] hover:text-white border border-transparent'
              }`}
            >
              <ScrollText className="w-3.5 h-3.5" />
              Credits
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleMute}
              title={muted ? 'Unmute all audio' : 'Mute all audio'}
              aria-label={muted ? 'Unmute all audio' : 'Mute all audio'}
              className={`p-1.5 rounded-md border transition-colors cursor-pointer ${
                muted
                  ? 'bg-[#2a1d24] text-[#fca5a5] border-[#ef4444]/40'
                  : 'text-[#b7c8da] hover:text-white border-transparent hover:bg-[#1e2c3e]'
              }`}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="p-1.5 rounded-md text-[#a9bdd2] hover:text-white hover:bg-[#233245] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        {view === 'AUDIO' ? (
          <div className="p-5 sm:p-6 space-y-5 overflow-y-auto">
            <div className="space-y-1">
              <h2 className="font-display text-xl font-bold text-[#f5dfaa]">
                Audio & Sanctuary Settings
              </h2>
              <p className="text-xs text-[#9cb2c9]">
                Balance the orchestral sky-island score and elemental battle sound effects independently.
              </p>
            </div>

            {/* Now Playing Strip */}
            <div className="rounded-lg bg-[#101925]/90 border border-[#d6bc86]/25 px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-[#1c2a3c] border border-[#d6bc86]/35 flex items-center justify-center shrink-0">
                  <Disc3
                    className={`w-4 h-4 text-[#f0b429] ${
                      !muted && musicVolume > 0.01 ? 'animate-spin' : 'opacity-50'
                    }`}
                    style={!muted && musicVolume > 0.01 ? { animationDuration: '9s' } : undefined}
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-[10.5px] uppercase tracking-wider text-[#9bb1c7] font-semibold">
                    {muted ? 'Audio Muted' : musicVolume <= 0.01 ? 'Music Silenced' : 'Now Playing'}
                  </div>
                  <div className="text-sm font-display font-semibold text-[#f6ead0] truncate">
                    {currentTrackTitle}
                  </div>
                </div>
              </div>

              {isGameplayMusic && (
                <button
                  type="button"
                  onClick={onNextTrack}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[#e2ebf5] bg-[#1c2b3d] border border-[#d6bc86]/30 hover:border-[#d6bc86]/60 hover:bg-[#24374d] transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <SkipForward className="w-3.5 h-3.5 text-[#f0b429]" />
                  Next Track
                </button>
              )}
            </div>

            {/* Independent Volume Sliders */}
            <div className="space-y-4">
              {/* Music Volume */}
              <div className="rounded-lg bg-[#111b28]/80 border border-[#d6bc86]/18 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleToggleMusicChannel}
                    className="flex items-center gap-2 text-sm font-semibold text-[#eef2f6] hover:text-[#f5dfaa] transition-colors cursor-pointer"
                  >
                    {musicVolume <= 0.01 || muted ? (
                      <VolumeX className="w-4 h-4 text-[#8ea5bc]" />
                    ) : (
                      <Music className="w-4 h-4 text-[#f0b429]" />
                    )}
                    Music Volume
                  </button>
                  <span className="font-mono-tabular text-xs font-bold text-[#f5dfaa]">
                    {muted ? 'MUTED' : `${musicPct}%`}
                  </span>
                </div>

                <div className="relative flex items-center">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={musicPct}
                    aria-label="Music Volume"
                    onChange={(e) => onChangeMusicVolume(Number(e.target.value) / 100)}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#f0b429] bg-[#0a121c] border border-[#d6bc86]/25"
                  />
                </div>
                <div className="flex justify-between text-[10.5px] text-[#8ea5bc]">
                  <span>Title, skirmish playlist & credits score</span>
                  <span>
                    {musicPct === 0 ? 'Off' : musicPct < 45 ? 'Subtle' : musicPct < 80 ? 'Balanced' : 'Full'}
                  </span>
                </div>
              </div>

              {/* Sound FX Volume */}
              <div className="rounded-lg bg-[#111b28]/80 border border-[#d6bc86]/18 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleToggleSfxChannel}
                    className="flex items-center gap-2 text-sm font-semibold text-[#eef2f6] hover:text-[#f5dfaa] transition-colors cursor-pointer"
                  >
                    {sfxVolume <= 0.01 || muted ? (
                      <VolumeX className="w-4 h-4 text-[#8ea5bc]" />
                    ) : (
                      <Waves className="w-4 h-4 text-[#67e8f9]" />
                    )}
                    Sound FX Volume
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onPreviewSfx}
                      disabled={muted || sfxPct === 0}
                      className="px-2 py-0.5 rounded text-[11px] font-medium text-[#d5e3f2] bg-[#1b293b] border border-[#d6bc86]/25 hover:border-[#d6bc86]/55 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      Test
                    </button>
                    <span className="font-mono-tabular text-xs font-bold text-[#67e8f9] min-w-[36px] text-right">
                      {muted ? 'MUTED' : `${sfxPct}%`}
                    </span>
                  </div>
                </div>

                <div className="relative flex items-center">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={sfxPct}
                    aria-label="Sound FX Volume"
                    onChange={(e) => onChangeSfxVolume(Number(e.target.value) / 100)}
                    onMouseUp={onPreviewSfx}
                    onTouchEnd={onPreviewSfx}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#67e8f9] bg-[#0a121c] border border-[#d6bc86]/25"
                  />
                </div>
                <div className="flex justify-between text-[10.5px] text-[#8ea5bc]">
                  <span>Sky-bridges, crystals, towers, sacrifices & wind ambience</span>
                  <span>
                    {sfxPct === 0 ? 'Off' : sfxPct < 45 ? 'Quiet' : sfxPct < 80 ? 'Crisp' : 'Bold'}
                  </span>
                </div>
              </div>

              {/* Master Mute Row */}
              <div className="flex items-center justify-between rounded-lg bg-[#101925]/70 border border-[#d6bc86]/15 px-4 py-2.5">
                <div className="text-xs text-[#c7d6e6]">Master Audio Switch</div>
                <button
                  type="button"
                  onClick={onToggleMute}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer border ${
                    muted
                      ? 'bg-[#2e1c22] text-[#fca5a5] border-[#ef4444]/45 hover:bg-[#3a222a]'
                      : 'bg-[#1c2b3d] text-[#a7f3d0] border-[#34d399]/35 hover:bg-[#23364c]'
                  }`}
                >
                  {muted ? 'Muted — Click to Unmute' : 'Audio Active'}
                </button>
              </div>
            </div>

            {/* Quick Links to Game Rules & Credits */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onViewChange('RULES')}
                className="group text-left rounded-lg p-3.5 bg-[#152233] border border-[#d6bc86]/30 hover:border-[#f0b429]/70 transition-all cursor-pointer flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-lg bg-[#203044] border border-[#f0b429]/35 flex items-center justify-center shrink-0">
                  <Trophy className="w-4 h-4 text-[#f0b429]" />
                </div>
                <div className="min-w-0">
                  <div className="font-display text-xs font-bold text-[#f5dfaa] group-hover:text-[#fde68a]">
                    Victory Conditions
                  </div>
                  <div className="text-[11px] text-[#9cb2c9] truncate">
                    Configure ways to win
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onViewChange('CREDITS')}
                className="group text-left rounded-lg p-3.5 bg-[#152233] border border-[#d6bc86]/30 hover:border-[#f0b429]/70 transition-all cursor-pointer flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-lg bg-[#203044] border border-[#f0b429]/35 flex items-center justify-center shrink-0">
                  <ScrollText className="w-4 h-4 text-[#f0b429]" />
                </div>
                <div className="min-w-0">
                  <div className="font-display text-xs font-bold text-[#f5dfaa] group-hover:text-[#fde68a]">
                    Game Credits
                  </div>
                  <div className="text-[11px] text-[#9cb2c9] truncate">
                    Story & Credits theme
                  </div>
                </div>
              </button>
            </div>
          </div>
        ) : view === 'RULES' ? (
          /* GAME RULES / VICTORY CONDITIONS VIEW */
          <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
            <div className="space-y-1">
              <h2 className="font-display text-xl font-bold text-[#f5dfaa]">
                Victory Conditions
              </h2>
              <p className="text-xs text-[#9cb2c9]">
                Choose which alternative win conditions are active. High Priest Sacrifice always
                remains the core path to victory, and achieving an alternative win lets you continue
                playing for the remaining objectives.
              </p>
            </div>

            <div className="space-y-3">
              {/* 1. High Priest Sacrifice — ALWAYS ON */}
              <div className="rounded-lg bg-[#162334]/95 border border-[#f0b429]/45 p-4 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-[#243448] border border-[#f0b429]/50 flex items-center justify-center shrink-0 mt-0.5">
                    <Flame className="w-4 h-4 text-[#f0b429]" />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-sm font-bold text-[#fef3c7]">
                        High Priest Sacrifice
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-[#f0b429]/20 text-[#f5dfaa] border border-[#f0b429]/35">
                        <Lock className="w-2.5 h-2.5" />
                        Primary · Always On
                      </span>
                    </div>
                    <p className="text-xs text-[#c1d2e3] leading-relaxed">
                      Stun rival High Priests, march your High Priest to bind them, and complete the
                      Grand Sacrifice upon your Altar.
                    </p>
                  </div>
                </div>
              </div>

              {/* 2. Temple Siege — Toggleable */}
              <div
                className={`rounded-lg p-4 border transition-colors ${
                  victoryRules.templeDestruction
                    ? 'bg-[#121d2b]/90 border-[#d6bc86]/30'
                    : 'bg-[#0e1622]/75 border-[#d6bc86]/15 opacity-80'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-[#1b293b] border border-[#d6bc86]/30 flex items-center justify-center shrink-0 mt-0.5">
                      <Shield className="w-4 h-4 text-[#fb923c]" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="font-display text-sm font-bold text-[#eef2f6]">
                        Temple Siege
                      </div>
                      <p className="text-xs text-[#b4c6d9] leading-relaxed">
                        Shatter rival High Temples (1,200 HP) to eliminate factions and unlock
                        Tier-2 mastery. When disabled, High Temples are protected by an ancient ward.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={victoryRules.templeDestruction}
                    aria-label="Toggle Temple Siege victory condition"
                    onClick={() =>
                      onUpdateVictoryRules({ templeDestruction: !victoryRules.templeDestruction })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer mt-0.5 ${
                      victoryRules.templeDestruction
                        ? 'bg-[#f0b429] border-[#fde047]'
                        : 'bg-[#1b2636] border-[#64748b]/50'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full transition-transform ${
                        victoryRules.templeDestruction
                          ? 'translate-x-5.5 bg-[#131b26]'
                          : 'translate-x-1 bg-[#94a3b8]'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* 3. Altar Dominance — Toggleable */}
              <div
                className={`rounded-lg p-4 border transition-colors ${
                  victoryRules.altarDominance
                    ? 'bg-[#121d2b]/90 border-[#d6bc86]/30'
                    : 'bg-[#0e1622]/75 border-[#d6bc86]/15 opacity-80'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-[#1b293b] border border-[#d6bc86]/30 flex items-center justify-center shrink-0 mt-0.5">
                      <Crown className="w-4 h-4 text-[#67e8f9]" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="font-display text-sm font-bold text-[#eef2f6]">
                        Altar Dominance
                      </div>
                      <p className="text-xs text-[#b4c6d9] leading-relaxed">
                        Hold exclusive powered control over the majority of central Sacred Sites
                        (Citadel & Shrines) for {ALTAR_DOMINANCE_DURATION} seconds.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={victoryRules.altarDominance}
                    aria-label="Toggle Altar Dominance victory condition"
                    onClick={() =>
                      onUpdateVictoryRules({ altarDominance: !victoryRules.altarDominance })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer mt-0.5 ${
                      victoryRules.altarDominance
                        ? 'bg-[#67e8f9] border-[#a5f3fc]'
                        : 'bg-[#1b2636] border-[#64748b]/50'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full transition-transform ${
                        victoryRules.altarDominance
                          ? 'translate-x-5.5 bg-[#131b26]'
                          : 'translate-x-1 bg-[#94a3b8]'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* 4. Aether Overload — Toggleable + Target Reserve Preset */}
              <div
                className={`rounded-lg p-4 border transition-colors space-y-3 ${
                  victoryRules.aetherOverload
                    ? 'bg-[#121d2b]/90 border-[#d6bc86]/30'
                    : 'bg-[#0e1622]/75 border-[#d6bc86]/15 opacity-80'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-[#1b293b] border border-[#d6bc86]/30 flex items-center justify-center shrink-0 mt-0.5">
                      <Zap className="w-4 h-4 text-[#fde047]" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="font-display text-sm font-bold text-[#eef2f6]">
                        Aether Overload
                      </div>
                      <p className="text-xs text-[#b4c6d9] leading-relaxed">
                        Hoard enough unspent crystal energy to overload the sky-grid. Reaching the
                        target lets you claim victory or choose <strong className="text-[#f5dfaa]">Continue Playing</strong> toward other victories.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={victoryRules.aetherOverload}
                    aria-label="Toggle Aether Overload victory condition"
                    onClick={() =>
                      onUpdateVictoryRules({ aetherOverload: !victoryRules.aetherOverload })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer mt-0.5 ${
                      victoryRules.aetherOverload
                        ? 'bg-[#f0b429] border-[#fde047]'
                        : 'bg-[#1b2636] border-[#64748b]/50'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full transition-transform ${
                        victoryRules.aetherOverload
                          ? 'translate-x-5.5 bg-[#131b26]'
                          : 'translate-x-1 bg-[#94a3b8]'
                      }`}
                    />
                  </button>
                </div>

                {victoryRules.aetherOverload && (
                  <div className="pl-12 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#d6bc86]/15">
                    <span className="text-[11px] text-[#9cb2c9]">Overload Target</span>
                    <div className="flex items-center gap-1.5">
                      {AETHER_OVERLOAD_OPTIONS.map((amount) => {
                        const active = victoryRules.aetherOverloadTarget === amount;
                        return (
                          <button
                            key={amount}
                            type="button"
                            onClick={() =>
                              onUpdateVictoryRules({ aetherOverloadTarget: amount })
                            }
                            className={`px-2.5 py-1 rounded text-xs font-mono-tabular font-semibold transition-colors cursor-pointer border ${
                              active
                                ? 'bg-[#253549] text-[#fde68a] border-[#f0b429]/65'
                                : 'bg-[#0e1724] text-[#9eb3c9] border-[#d6bc86]/20 hover:text-white hover:border-[#d6bc86]/45'
                            }`}
                          >
                            {amount.toLocaleString()} AE
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* CREDITS VIEW — plays Threshold of Dread */
          <div className="p-5 sm:p-6 space-y-6 overflow-y-auto">
            {/* Hero Title & Live Credits Soundtrack Strip */}
            <div className="text-center space-y-2.5 border-b border-[#d6bc86]/20 pb-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#121e2e] border border-[#d6bc86]/30 text-[11px] font-medium text-[#f5dfaa]">
                <Music className="w-3.5 h-3.5 text-[#f0b429]" />
                <span>
                  {muted || musicVolume <= 0.01
                    ? 'Credits Theme: Threshold of Dread (Muted)'
                    : 'Now Playing · Threshold of Dread'}
                </span>
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-wide text-[#f6e3b5]">
                Aether Isles: Skybridge Siege
              </h2>
              <p className="text-xs sm:text-sm text-[#c6d6e6] max-w-md mx-auto leading-relaxed">
                A floating-archipelago real-time tactics game of stone sky-bridges, erupting Aether
                geysers, elemental siegecraft, and ancient Altar rituals above the cloudsea.
              </p>
            </div>

            {/* About the World & Gameplay */}
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#f0b429]">
                <Compass className="w-3.5 h-3.5" />
                About the Game
              </div>
              <p className="text-xs sm:text-[13px] text-[#d3dfec] leading-relaxed">
                Inspired by classic floating-island strategy battles,{' '}
                <strong className="text-[#f5dfaa]">Aether Isles</strong> challenges commanders to
                link shattered sky-isles with polyomino bridges where every spanning tile carries
                life-giving Aether power. Sever a rival&apos;s bridge and their forward bastions
                fall dark; fortify your own crossings and press toward victory through High Priest
                Sacrifices, Temple Siege, Altar Dominance, or Aether Overload.
              </p>
            </section>

            {/* Original Soundtrack Section */}
            <section className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#f0b429]">
                <Music className="w-3.5 h-3.5" />
                Original Soundtrack
              </div>
              <div className="rounded-lg bg-[#0f1824]/90 border border-[#d6bc86]/20 divide-y divide-[#d6bc86]/12">
                {MUSIC_TRACKS.map((track, idx) => {
                  const isCreditsTrack = track.mode === 'CREDITS';
                  return (
                    <div
                      key={track.id}
                      className={`px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs ${
                        isCreditsTrack ? 'bg-[#1c2839]/70' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono-tabular text-[11px] text-[#8ea5bc] w-4 shrink-0">
                          0{idx + 1}
                        </span>
                        <span
                          className={`font-medium truncate ${
                            isCreditsTrack ? 'text-[#fde68a]' : 'text-[#e5eef7]'
                          }`}
                        >
                          {track.title}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#9bb2c8] shrink-0">{track.role}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* How It Was Created */}
            <section className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#f0b429]">
                <Layers className="w-3.5 h-3.5" />
                How It Was Created
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-[#111b28]/85 border border-[#d6bc86]/18 p-3.5 space-y-1">
                  <div className="font-display font-semibold text-[#f5dfaa]">
                    Painterly Isometric Engine
                  </div>
                  <p className="text-[#bccde0] leading-relaxed">
                    Built on a custom 60fps HTML5 Canvas 2D renderer blending a dual-lit sunlit sky
                    and storm-front cloudsea, moss-draped cliffs, animated waterfalls, and bespoke
                    fortress silhouettes.
                  </p>
                </div>
                <div className="rounded-lg bg-[#111b28]/85 border border-[#d6bc86]/18 p-3.5 space-y-1">
                  <div className="font-display font-semibold text-[#f5dfaa]">
                    Living Archipelago Topology
                  </div>
                  <p className="text-[#bccde0] leading-relaxed">
                    Procedural island generation scales dynamically for 1 to 6 rival commanders,
                    driven by real-time breadth-first power propagation and A* island-hopping
                    pathfinding.
                  </p>
                </div>
                <div className="rounded-lg bg-[#111b28]/85 border border-[#d6bc86]/18 p-3.5 space-y-1">
                  <div className="font-display font-semibold text-[#f5dfaa]">
                    Synthesized Spatial Soundscape
                  </div>
                  <p className="text-[#bccde0] leading-relaxed">
                    Combat volleys, stone sky-bridges, crystal harvests, and elemental wind beds are
                    synthesized live via the Web Audio API with stereo panning and mixed beneath the
                    original soundtrack.
                  </p>
                </div>
                <div className="rounded-lg bg-[#111b28]/85 border border-[#d6bc86]/18 p-3.5 space-y-1">
                  <div className="font-display font-semibold text-[#f5dfaa]">
                    Crafted for Desktop & Mobile
                  </div>
                  <p className="text-[#bccde0] leading-relaxed">
                    Engineered with TypeScript, React, Vite, and Tailwind CSS with pinch-zoom touch
                    controls, scalable perimeter HUD, and offline-ready Progressive Web App support.
                  </p>
                </div>
              </div>
            </section>

            {/* Closing Note */}
            <div className="rounded-lg bg-[#111b28]/60 border border-[#d6bc86]/18 px-4 py-3 text-center space-y-1">
              <div className="flex items-center justify-center gap-1.5 text-xs font-display font-semibold text-[#f5dfaa]">
                <Sparkles className="w-3.5 h-3.5 text-[#f0b429]" />
                Thank You for Commanding the Skies of Aetheria
              </div>
              <p className="text-[11px] text-[#9cb2c9]">
                May your bridges hold firm and your High Priest stand unbroken.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[#d6bc86]/20 bg-[#101925]/70 shrink-0">
          {view === 'CREDITS' ? (
            <button
              type="button"
              onClick={() => onViewChange('AUDIO')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-[#d4e1ee] bg-[#1a2738] border border-[#d6bc86]/25 hover:border-[#d6bc86]/55 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Settings
            </button>
          ) : (
            <span className="text-[11px] text-[#8ea5bc]">
              {view === 'RULES'
                ? 'Victory rules apply immediately & save automatically'
                : 'Volume preferences save automatically'}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-xs font-semibold text-[#131b26] bg-[#f0b429] hover:bg-[#f7c54b] transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
