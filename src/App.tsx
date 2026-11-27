import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameHud } from './components/GameHud';
import { ModalOverlays } from './components/ModalOverlays';
import { OfflineNotice } from './components/PWAInstallButton';
import { SettingsCreditsModal, type SettingsModalView } from './components/SettingsCreditsModal';
import { TitleScreen } from './components/TitleScreen';
import { DEFAULT_VICTORY_RULES } from './game/catalog';
import { SkybridgeEngine } from './game/simulation';
import type {
  AerialUnitKind,
  Difficulty,
  Fury,
  HudSnapshot,
  PlacementMode,
  PriestAbilityId,
  TechUnlockKey,
  VictoryRules,
} from './game/types';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SkybridgeEngine | null>(null);
  const autoPausedForSettingsRef = useRef(false);
  const prevMusicVolRef = useRef(0.65);

  const [selectedFury, setSelectedFury] = useState<Fury>('WIND');
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>('ARCHON');
  const [selectedOpponents, setSelectedOpponents] = useState<number>(1);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsModalView>('AUDIO');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new SkybridgeEngine(canvas, (snapshot) => {
      setHud(snapshot);
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Automatically switch to the Credits soundtrack while the Credits screen is open
  useEffect(() => {
    engineRef.current?.setCreditsMusicActive(settingsOpen && settingsView === 'CREDITS');
  }, [settingsOpen, settingsView]);

  useEffect(() => {
    if (hud && hud.musicVolume > 0.01) {
      prevMusicVolRef.current = hud.musicVolume;
    }
  }, [hud?.musicVolume]);

  const handleStartSkirmish = useCallback(() => {
    setSettingsOpen(false);
    autoPausedForSettingsRef.current = false;
    engineRef.current?.startSkirmish(selectedFury, selectedDifficulty, selectedOpponents);
  }, [selectedFury, selectedDifficulty, selectedOpponents]);

  const handleBindMinimap = useCallback((minimapCanvas: HTMLCanvasElement | null) => {
    engineRef.current?.setMinimapCanvas(minimapCanvas);
  }, []);

  const handleMinimapClick = useCallback((nx: number, ny: number) => {
    engineRef.current?.panFromMinimapNorm(nx, ny);
  }, []);

  const handleSetPlacement = useCallback((mode: PlacementMode) => {
    engineRef.current?.setPlacement(mode);
  }, []);

  const handleRotate = useCallback(() => {
    engineRef.current?.rotatePlacement();
  }, []);

  const handleSummonGolem = useCallback(() => {
    engineRef.current?.summonPlayerGolem();
  }, []);

  const handleToggleSpeed = useCallback(() => {
    engineRef.current?.toggleSpeed();
  }, []);

  const handleToggleMute = useCallback(() => {
    engineRef.current?.toggleMute();
  }, []);

  const handleChangeMusicVolume = useCallback((volume: number) => {
    if (volume > 0.01) {
      prevMusicVolRef.current = volume;
    }
    engineRef.current?.setMusicVolume(volume);
  }, []);

  const handleToggleTitleMusicMute = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const isMuted = hud?.muted ?? false;
    const currentMusicVol = hud?.musicVolume ?? 0.65;
    if (!isMuted && currentMusicVol > 0.01) {
      prevMusicVolRef.current = currentMusicVol;
      engine.setMusicVolume(0);
    } else {
      if (isMuted) {
        engine.toggleMute();
      }
      if (currentMusicVol <= 0.01) {
        engine.setMusicVolume(prevMusicVolRef.current || 0.65);
      } else {
        engine.unlockAudio();
      }
    }
  }, [hud?.muted, hud?.musicVolume]);

  const handleChangeSfxVolume = useCallback((volume: number) => {
    engineRef.current?.setSfxVolume(volume);
  }, []);

  const handlePreviewSfx = useCallback(() => {
    engineRef.current?.previewSfxVolume();
  }, []);

  const handleNextTrack = useCallback(() => {
    engineRef.current?.nextMusicTrack();
  }, []);

  const handleUpdateVictoryRules = useCallback(
    (patch: Partial<Omit<VictoryRules, 'priestSacrifice'>>) => {
      engineRef.current?.setVictoryRules(patch);
    },
    []
  );

  const handleContinuePlaying = useCallback(() => {
    engineRef.current?.continueAfterVictory();
  }, []);

  const handleToggleRangeOverlay = useCallback(() => {
    engineRef.current?.toggleRangeOverlay();
  }, []);

  const handleToggleRangeFury = useCallback((fury: Fury) => {
    engineRef.current?.toggleRangeFury(fury);
  }, []);

  const handlePause = useCallback(() => {
    engineRef.current?.setPaused(true);
  }, []);

  const handleResume = useCallback(() => {
    autoPausedForSettingsRef.current = false;
    engineRef.current?.setPaused(false);
  }, []);

  const handleOpenSettings = useCallback(
    (initialView: SettingsModalView = 'AUDIO') => {
      engineRef.current?.unlockAudio();
      if (hud?.phase === 'PLAYING') {
        autoPausedForSettingsRef.current = true;
        engineRef.current?.setPaused(true);
      } else {
        autoPausedForSettingsRef.current = false;
      }
      setSettingsView(initialView);
      setSettingsOpen(true);
    },
    [hud?.phase]
  );

  const handleOpenAudioSettings = useCallback(() => {
    handleOpenSettings('AUDIO');
  }, [handleOpenSettings]);

  const handleOpenRulesSettings = useCallback(() => {
    handleOpenSettings('RULES');
  }, [handleOpenSettings]);

  const handleOpenCreditsSettings = useCallback(() => {
    handleOpenSettings('CREDITS');
  }, [handleOpenSettings]);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
    if (autoPausedForSettingsRef.current) {
      autoPausedForSettingsRef.current = false;
      engineRef.current?.setPaused(false);
    }
  }, []);

  const handleCenterHome = useCallback(() => {
    engineRef.current?.centerOnHome();
  }, []);

  const handleFocusPriest = useCallback(() => {
    engineRef.current?.focusPlayerPriest();
  }, []);

  const handleZoomIn = useCallback(() => {
    engineRef.current?.zoomBy(1.18);
  }, []);

  const handleZoomOut = useCallback(() => {
    engineRef.current?.zoomBy(0.84);
  }, []);

  const handleCapturePriest = useCallback((priestId: number) => {
    engineRef.current?.commandCaptureStunnedPriest(priestId);
  }, []);

  const handleFocusSacredSite = useCallback(() => {
    engineRef.current?.focusNextSacredSite();
  }, []);

  const handleReclaimSelected = useCallback(() => {
    engineRef.current?.reclaimSelectedStructure();
  }, []);

  const handleSummonAerial = useCallback((kind: AerialUnitKind) => {
    engineRef.current?.summonPlayerAerialUnit(kind);
  }, []);

  const handleCastPriestAbility = useCallback((abilityId: PriestAbilityId) => {
    engineRef.current?.castPriestAbility(abilityId);
  }, []);

  const handleChooseTechUnlock = useCallback((key: TechUnlockKey) => {
    engineRef.current?.chooseTechUnlock(key);
  }, []);

  const handleToggleFogOfWar = useCallback(() => {
    const current = hud?.victoryRules.fogOfWar ?? DEFAULT_VICTORY_RULES.fogOfWar;
    engineRef.current?.setVictoryRules({ fogOfWar: !current });
  }, [hud?.victoryRules.fogOfWar]);

  const handleReturnTitle = useCallback(() => {
    setSettingsOpen(false);
    autoPausedForSettingsRef.current = false;
    engineRef.current?.returnToTitle();
  }, []);

  const phase = hud?.phase ?? 'TITLE_MENU';
  const victoryRules = hud?.victoryRules ?? DEFAULT_VICTORY_RULES;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0e1c2e]">
      {/* Isolated 60fps Canvas Container — never remounted by React HUD updates */}
      <div className="absolute inset-0 w-full h-full">
        <canvas
          ref={canvasRef}
          className={`block w-full h-full touch-none ${
            phase === 'PLAYING'
              ? hud?.placement.type === 'SELECT'
                ? 'cursor-grab active:cursor-grabbing'
                : 'cursor-crosshair'
              : 'cursor-default'
          }`}
        />
      </div>

      {/* Title Screen */}
      {phase === 'TITLE_MENU' && (
        <div className="relative z-20 w-full h-full">
          <TitleScreen
            selectedFury={selectedFury}
            selectedDifficulty={selectedDifficulty}
            selectedOpponents={selectedOpponents}
            victoryRules={victoryRules}
            musicMuted={(hud?.muted ?? false) || (hud?.musicVolume ?? 0.65) <= 0.01}
            disableShortcuts={settingsOpen}
            onSelectFury={setSelectedFury}
            onSelectDifficulty={setSelectedDifficulty}
            onSelectOpponents={setSelectedOpponents}
            onStart={handleStartSkirmish}
            onOpenSettings={handleOpenAudioSettings}
            onOpenRules={handleOpenRulesSettings}
            onToggleFogOfWar={handleToggleFogOfWar}
            onToggleMusicMute={handleToggleTitleMusicMute}
          />
        </div>
      )}

      {/* Perimeter Tactical HUD */}
      {hud && phase !== 'TITLE_MENU' && (
        <GameHud
          hud={hud}
          onBindMinimap={handleBindMinimap}
          onMinimapClick={handleMinimapClick}
          onSetPlacement={handleSetPlacement}
          onRotate={handleRotate}
          onSummonGolem={handleSummonGolem}
          onSummonAerial={handleSummonAerial}
          onReclaimSelected={handleReclaimSelected}
          onCastPriestAbility={handleCastPriestAbility}
          onChooseTechUnlock={handleChooseTechUnlock}
          onToggleSpeed={handleToggleSpeed}
          onToggleMute={handleToggleMute}
          onToggleRangeOverlay={handleToggleRangeOverlay}
          onToggleRangeFury={handleToggleRangeFury}
          onOpenSettings={handleOpenAudioSettings}
          onPause={handlePause}
          onCenterHome={handleCenterHome}
          onFocusPriest={handleFocusPriest}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onCapturePriest={handleCapturePriest}
          onFocusSacredSite={handleFocusSacredSite}
        />
      )}

      {/* Pause, Victory & Defeat Modals */}
      {hud && !settingsOpen && (
        <ModalOverlays
          phase={phase}
          stats={hud.matchStats}
          onResume={handleResume}
          onContinuePlaying={handleContinuePlaying}
          onRestart={handleStartSkirmish}
          onReturnTitle={handleReturnTitle}
          onOpenSettings={handleOpenAudioSettings}
          onOpenRules={handleOpenRulesSettings}
          onOpenCredits={handleOpenCreditsSettings}
        />
      )}

      {/* Audio Settings, Victory Rules & Game Credits Modal */}
      <SettingsCreditsModal
        open={settingsOpen}
        view={settingsView}
        phase={phase}
        muted={hud?.muted ?? false}
        musicVolume={hud?.musicVolume ?? 0.65}
        sfxVolume={hud?.sfxVolume ?? 0.85}
        currentTrackTitle={hud?.currentTrackTitle ?? 'Above the Skybridge'}
        victoryRules={victoryRules}
        onClose={handleCloseSettings}
        onViewChange={setSettingsView}
        onToggleMute={handleToggleMute}
        onChangeMusicVolume={handleChangeMusicVolume}
        onChangeSfxVolume={handleChangeSfxVolume}
        onPreviewSfx={handlePreviewSfx}
        onNextTrack={handleNextTrack}
        onUpdateVictoryRules={handleUpdateVictoryRules}
      />

      <OfflineNotice />
    </main>
  );
}
