import React from 'react';
import {
  ArrowRight,
  Home,
  Play,
  RotateCcw,
  ScrollText,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Trophy,
} from 'lucide-react';
import { FURY_META } from '../game/catalog';
import type { GamePhase, MatchStats } from '../game/types';
import { PWAInstallButton } from './PWAInstallButton';

interface ModalOverlaysProps {
  phase: GamePhase;
  stats: MatchStats;
  onResume: () => void;
  onContinuePlaying: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
  onOpenSettings: () => void;
  onOpenRules: () => void;
  onOpenCredits: () => void;
}

function formatDifficulty(diff: MatchStats['difficulty']): string {
  if (diff === 'STORMLORD') return 'Ascendant';
  if (diff === 'ARCHON') return 'Archon';
  return 'Acolyte';
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function ModalOverlays({
  phase,
  stats,
  onResume,
  onContinuePlaying,
  onRestart,
  onReturnTitle,
  onOpenSettings,
  onOpenRules,
  onOpenCredits,
}: ModalOverlaysProps) {
  if (phase !== 'PAUSED' && phase !== 'VICTORY' && phase !== 'DEFEAT') {
    return null;
  }

  if (phase === 'PAUSED') {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#09121e]/75 p-6">
        <div className="stone-frame rounded-xl w-full max-w-sm p-6 space-y-5 text-center">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold text-[#f5dfaa]">
              Skirmish Paused
            </h2>
            <p className="text-xs text-[#9fb5cc]">
              {stats.opponentCount > 1
                ? `${FURY_META[stats.playerFury].name} vs. ${stats.opponentCount} Rivals (${stats.opponentCount - stats.rivalsEliminated} remaining) · ${formatDifficulty(stats.difficulty)}`
                : `${FURY_META[stats.playerFury].name} vs. ${FURY_META[stats.aiFury].name} · ${formatDifficulty(stats.difficulty)}`}
            </p>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onResume}
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg font-semibold text-sm text-[#131b26] bg-[#f0b429] hover:bg-[#f7c54b] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Play className="w-4 h-4 fill-current" />
              Resume Skirmish
            </button>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex items-center justify-center gap-1.5 py-2.5 px-2.5 rounded-lg font-medium text-xs text-[#e2ebf5] bg-[#1e2c3e] border border-[#d6bc86]/25 hover:border-[#d6bc86]/55 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Settings className="w-3.5 h-3.5 text-[#f0b429]" />
                Audio
              </button>
              <button
                type="button"
                onClick={onOpenRules}
                className="flex items-center justify-center gap-1.5 py-2.5 px-2.5 rounded-lg font-medium text-xs text-[#e2ebf5] bg-[#1e2c3e] border border-[#d6bc86]/25 hover:border-[#d6bc86]/55 transition-colors cursor-pointer whitespace-nowrap"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#f0b429]" />
                Rules
              </button>
              <button
                type="button"
                onClick={onOpenCredits}
                className="flex items-center justify-center gap-1.5 py-2.5 px-2.5 rounded-lg font-medium text-xs text-[#e2ebf5] bg-[#1e2c3e] border border-[#d6bc86]/25 hover:border-[#d6bc86]/55 transition-colors cursor-pointer whitespace-nowrap"
              >
                <ScrollText className="w-3.5 h-3.5 text-[#f0b429]" />
                Credits
              </button>
            </div>
            <button
              type="button"
              onClick={onRestart}
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg font-medium text-sm text-[#e2ebf5] bg-[#1e2c3e] border border-[#d6bc86]/25 hover:border-[#d6bc86]/50 transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4" />
              Restart Skirmish
            </button>
            <button
              type="button"
              onClick={onReturnTitle}
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg font-medium text-sm text-[#b4c5d8] hover:text-white hover:bg-[#1e2c3e] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Home className="w-4 h-4" />
              Return to Title
            </button>
            <PWAInstallButton compact />
          </div>
        </div>
      </div>
    );
  }

  const isVictory = phase === 'VICTORY';
  const furyMeta = FURY_META[stats.playerFury];

  const headline = isVictory
    ? stats.outcomeReason === 'AETHER_OVERLOAD'
      ? 'Aether Overload'
      : stats.outcomeReason === 'ALTAR_DOMINANCE'
        ? 'Altar Dominance'
        : 'Skies Conquered'
    : 'Sanctum Fallen';

  const rivalName = stats.winnerLabel && stats.winnerLabel !== 'Allied' ? stats.winnerLabel : 'A rival archipelago';

  const subtitle = isVictory
    ? stats.outcomeReason === 'AETHER_OVERLOAD'
      ? `Your overflowing crystal reserves surged across the cloudsea in the name of the ${furyMeta.name}.`
      : stats.outcomeReason === 'ALTAR_DOMINANCE'
        ? `Your ${furyMeta.name} held the central sacred temple sites until the skies bowed.`
        : stats.opponentCount > 1
          ? `All ${stats.opponentCount} rival archipelagos have fallen in the name of the ${furyMeta.name}.`
          : stats.outcomeReason === 'TEMPLE_DESTRUCTION'
            ? `The rival High Temple was shattered to rubble in the name of the ${furyMeta.name}.`
            : `The rival High Priest was bound upon your Altar in the name of the ${furyMeta.name}.`
    : stats.outcomeReason === 'AETHER_OVERLOAD'
      ? `${rivalName} hoarded enough crystal energy to trigger Aether Overload.`
      : stats.outcomeReason === 'ALTAR_DOMINANCE'
        ? `${rivalName} held the central sacred temple sites and claimed Altar Dominance.`
        : stats.outcomeReason === 'TEMPLE_DESTRUCTION'
          ? 'Your High Temple was shattered by rival siege fire.'
          : 'Your High Priest was captured and sacrificed by a rival archipelago.';

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#08101c]/82 p-6">
      <div className="stone-frame rounded-xl w-full max-w-md p-7 space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center bg-[#1e2b3c] border border-[#d6bc86]/40">
            {isVictory ? (
              <Trophy className="w-6 h-6 text-[#f0b429]" />
            ) : (
              <ShieldAlert className="w-6 h-6 text-[#f87171]" />
            )}
          </div>
          <h2
            className="font-display text-3xl font-bold"
            style={{ color: isVictory ? '#f5dfaa' : '#fca5a5' }}
          >
            {headline}
          </h2>
          <p className="text-sm text-[#c1d1e2]">{subtitle}</p>
        </div>

        {/* Tabular Match Summary Breakdown */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-[#d6bc86]/20 py-4 text-sm">
          <div className="flex justify-between items-baseline">
            <span className="text-[#9bb1c7]">Duration</span>
            <span className="font-mono-tabular font-semibold text-white">
              {formatDuration(stats.elapsedSeconds)}
            </span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-[#9bb1c7]">Islands Linked</span>
            <span className="font-mono-tabular font-semibold text-white">
              {stats.islandsConnected}
            </span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-[#9bb1c7]">Crystals Harvested</span>
            <span className="font-mono-tabular font-semibold text-[#f0b429]">
              {stats.crystalsHarvested}
            </span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-[#9bb1c7]">Bridges Spanned</span>
            <span className="font-mono-tabular font-semibold text-white">
              {stats.bridgesPlaced}
            </span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-[#9bb1c7]">Towers Destroyed</span>
            <span className="font-mono-tabular font-semibold text-white">
              {stats.towersDestroyed}
            </span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-[#9bb1c7]">Altar Sacrifices</span>
            <span className="font-mono-tabular font-semibold text-[#c084fc]">
              {stats.sacrificesCompleted}
            </span>
          </div>
          {stats.opponentCount > 1 && (
            <div className="col-span-2 flex justify-between items-baseline pt-1 border-t border-[#d6bc86]/15">
              <span className="text-[#9bb1c7]">Rivals Defeated</span>
              <span className="font-mono-tabular font-semibold text-[#f0b429]">
                {stats.rivalsEliminated} / {stats.opponentCount}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          {isVictory && stats.canContinuePlaying && (
            <button
              type="button"
              onClick={onContinuePlaying}
              className="w-full flex flex-col items-center justify-center gap-0.5 py-3 px-4 rounded-lg font-display font-bold text-sm text-[#131b26] bg-[#f0b429] hover:bg-[#f7c54b] transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                Continue Playing
                <ArrowRight className="w-4 h-4" />
              </span>
              <span className="font-sans text-[11px] font-medium text-[#1e293b]">
                Keep playing to pursue High Priest Sacrifice &amp; remaining victories
              </span>
            </button>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onRestart}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-display font-bold text-sm transition-colors cursor-pointer whitespace-nowrap ${
                isVictory && stats.canContinuePlaying
                  ? 'text-[#e2ebf5] bg-[#1e2c3e] border border-[#d6bc86]/30 hover:border-[#d6bc86]/60'
                  : 'text-[#131b26] bg-[#f0b429] hover:bg-[#f7c54b]'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              Play Again
            </button>
            <button
              type="button"
              onClick={onReturnTitle}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-sm text-[#dbe7f3] bg-[#1e2c3e] border border-[#d6bc86]/25 hover:border-[#d6bc86]/50 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Home className="w-4 h-4" />
              Change Setup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
