import { AiCommander } from './ai';
import {
  WebAudioManager,
  type AudioHookEvent,
  type AudioHookListener,
  type AudioSpatialContext,
} from './audio';
import {
  AETHER_OVERLOAD_OPTIONS,
  AETHER_OVERLOAD_TARGET,
  ALTAR_DOMINANCE_DURATION,
  BRIDGE_TILE_HP,
  FURY_META,
  GOLEM_COST,
  MAX_GOLEMS,
  STRUCTURE_CATALOG,
  TETROMINOES,
  clampOpponentCount,
  directionLabel,
  directionVector,
  getNextSpeedMultiplier,
  getRequiredSacredSites,
  getWorldIsoBounds,
  isAiFaction,
  isFactionId,
  loadVictoryRules,
  randomTetrominoKey,
  saveVictoryRules,
} from './catalog';
import {
  canPlaceBridge,
  canPlaceStructure,
  countConnectedIslands,
  findNearestWalkableFreeTile,
  findTilePath,
  getStructureAt,
  hasGeyserAt,
  hasStructureAt,
  inBounds,
  isTilePoweredBy,
  isWalkable,
  recomputePowerGrids,
} from './pathfinding';
import { renderMinimap, renderWorld, screenToWorldIso, worldToScreen, type CameraState } from './renderer';
import type {
  AiFactionId,
  BuildOptionKind,
  Difficulty,
  Direction,
  FactionId,
  ImpactEffectKind,
  Fury,
  GamePhase,
  Golem,
  HoverInspect,
  HudSnapshot,
  OutcomeReason,
  Owner,
  PlacementMode,
  Priest,
  RangeOverlayState,
  RivalHudSummary,
  SelectedInspect,
  SpeedMultiplier,
  Structure,
  VictoryProgressSnapshot,
  VictoryRules,
} from './types';
import { createInitialWorld, isoToTile, tileToIso, type WorldState } from './worldGen';

export class SkybridgeEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private minimapFrameCounter = 0;
  private audio = new WebAudioManager();
  private audioListeners = new Set<AudioHookListener>();
  private unsubscribeTrackChange: (() => void) | null = null;
  private creditsMusicActive = false;
  private ai = new AiCommander();
  private stormGustTimer = 9;

  private victoryRules: VictoryRules = loadVictoryRules();
  private achievedAltVictories = new Set<'AETHER_OVERLOAD' | 'ALTAR_DOMINANCE'>();
  private state: WorldState;
  private phase: GamePhase = 'TITLE_MENU';
  private outcomeReason: OutcomeReason | undefined = undefined;
  private winnerLabel: string | undefined = undefined;
  private templeWarningCooldown = 0;
  private sacredFocusIndex = 0;
  private overloadWarned70 = new Set<FactionId>();
  private overloadWarned90 = new Set<FactionId>();
  private dominanceWarned50 = new Set<FactionId>();
  private dominanceWarned80 = new Set<FactionId>();
  private speedMultiplier: SpeedMultiplier = 1;
  private rafId: number | null = null;
  private lastTimestamp = 0;
  private animTime = 0;
  private hitstopTimer = 0;

  private camera: CameraState = { x: -820, y: 760, zoom: 0.96, shakeX: 0, shakeY: 0 };
  private shakeMag = 0;
  private viewW = 1280;
  private viewH = 720;
  private canvasLeft = 0;
  private canvasTop = 0;

  private heldKeys = new Set<string>();
  private isDragging = false;
  private dragButton = -1;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragCamStartX = 0;
  private dragCamStartY = 0;
  private dragMoved = false;

  // Multi-touch gesture tracking (Android / mobile)
  private activeTouchMode: 'NONE' | 'PAN' | 'PINCH' = 'NONE';
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private pinchStartMidX = 0;
  private pinchStartMidY = 0;
  private lastTouchClientX = 0;
  private lastTouchClientY = 0;

  private hoverTile: { tx: number; ty: number } | null = null;
  private hoveredId: number | null = null;
  private hoveredKind: 'STRUCTURE' | 'PRIEST' | 'GOLEM' | 'GEYSER' | null = null;
  private rangeOverlay: RangeOverlayState = {
    enabled: false,
    WIND: true,
    RAIN: true,
    THUNDER: true,
  };
  private placement: PlacementMode = { type: 'SELECT' };
  private selectedId: number | null = null;
  private selectedKind: 'STRUCTURE' | 'PRIEST' | 'GOLEM' | 'GEYSER' | null = null;

  private alertBanner: { text: string; tone: 'INFO' | 'WARNING' | 'SACRIFICE'; timer: number } | null = null;
  private hudEmitTimer = 0;
  private onHudUpdate: (snap: HudSnapshot) => void;

  // Bound DOM listeners for clean teardown
  private handleResizeBound: () => void;
  private handleKeyDownBound: (e: KeyboardEvent) => void;
  private handleKeyUpBound: (e: KeyboardEvent) => void;
  private handleBlurBound: () => void;
  private handleMouseDownBound: (e: MouseEvent) => void;
  private handleMouseMoveBound: (e: MouseEvent) => void;
  private handleMouseUpBound: (e: MouseEvent) => void;
  private handleMouseLeaveBound: () => void;
  private handleWheelBound: (e: WheelEvent) => void;
  private handleContextMenuBound: (e: MouseEvent) => void;
  private handleTouchStartBound: (e: TouchEvent) => void;
  private handleTouchMoveBound: (e: TouchEvent) => void;
  private handleTouchEndBound: (e: TouchEvent) => void;
  private handleFirstGestureBound: () => void;

  constructor(canvas: HTMLCanvasElement, onHudUpdate: (snap: HudSnapshot) => void) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not acquire 2D canvas context');
    }
    this.ctx = context;
    this.onHudUpdate = onHudUpdate;

    this.state = createInitialWorld('WIND', 'ARCHON', 1, this.victoryRules);
    this.centerOnHome();

    this.handleResizeBound = this.handleResize.bind(this);
    this.handleKeyDownBound = this.handleKeyDown.bind(this);
    this.handleKeyUpBound = this.handleKeyUp.bind(this);
    this.handleBlurBound = this.handleBlur.bind(this);
    this.handleMouseDownBound = this.handleMouseDown.bind(this);
    this.handleMouseMoveBound = this.handleMouseMove.bind(this);
    this.handleMouseUpBound = this.handleMouseUp.bind(this);
    this.handleMouseLeaveBound = this.handleMouseLeave.bind(this);
    this.handleWheelBound = this.handleWheel.bind(this);
    this.handleContextMenuBound = this.handleContextMenu.bind(this);
    this.handleTouchStartBound = this.handleTouchStart.bind(this);
    this.handleTouchMoveBound = this.handleTouchMove.bind(this);
    this.handleTouchEndBound = this.handleTouchEnd.bind(this);
    this.handleFirstGestureBound = this.handleFirstGesture.bind(this);

    this.onAudioEvent(this.audio.handleEvent);
    this.unsubscribeTrackChange = this.audio.onTrackChange(() => this.emitHud());
    this.syncMusicState();
    this.attachEvents();
    this.handleResize();
    this.startLoop();
    this.emitHud();
  }

  /**
   * Subscribe to typed engine audio hooks (bridge placement, crystal harvesting,
   * tower firing, elemental storms, and ritual/UI cues). Returns an unsubscribe function.
   */
  public onAudioEvent(listener: AudioHookListener): () => void {
    this.audioListeners.add(listener);
    return () => {
      this.audioListeners.delete(listener);
    };
  }

  private computeSpatialContext(tx?: number, ty?: number): AudioSpatialContext {
    if (tx === undefined || ty === undefined) {
      return { pan: 0, gain: 1 };
    }
    const { sx, sy } = worldToScreen(tx, ty, this.camera, this.viewW, this.viewH);
    const halfW = Math.max(1, this.viewW * 0.5);
    const halfH = Math.max(1, this.viewH * 0.5);
    const nx = (sx - halfW) / halfW;
    const ny = (sy - halfH) / halfH;
    const pan = Math.max(-0.85, Math.min(0.85, nx * 0.72));
    const dist = Math.hypot(nx, ny);
    const gain = dist <= 0.95 ? 1 : Math.max(0, 1 - (dist - 0.95) / 1.35);
    return { pan, gain };
  }

  private emitAudio(event: AudioHookEvent): void {
    if (this.audioListeners.size === 0) return;
    const coords =
      'tx' in event && 'ty' in event ? { tx: event.tx, ty: event.ty } : undefined;
    const spatial = this.computeSpatialContext(coords?.tx, coords?.ty);
    for (const listener of this.audioListeners) {
      listener(event, spatial);
    }
  }

  public setMinimapCanvas(canvas: HTMLCanvasElement | null): void {
    this.minimapCanvas = canvas;
    this.minimapCtx = canvas ? canvas.getContext('2d') : null;
    this.minimapFrameCounter = 0;
  }

  public startSkirmish(fury: Fury, difficulty: Difficulty, opponentCount = 1): void {
    this.audio.unlock();
    this.audio.setAmbience(true, fury, 0.52);
    this.stormGustTimer = 8 + Math.random() * 6;
    const clampedOpp = clampOpponentCount(opponentCount);
    this.state = createInitialWorld(fury, difficulty, clampedOpp, this.victoryRules);
    this.ai.reset();
    this.phase = 'PLAYING';
    this.syncMusicState();
    this.outcomeReason = undefined;
    this.winnerLabel = undefined;
    this.achievedAltVictories.clear();
    this.templeWarningCooldown = 0;
    this.sacredFocusIndex = 0;
    this.overloadWarned70.clear();
    this.overloadWarned90.clear();
    this.dominanceWarned50.clear();
    this.dominanceWarned80.clear();
    this.speedMultiplier = 1;
    this.placement = { type: 'BRIDGE', queueIndex: 0, rotation: 0 };
    this.selectedId = null;
    this.selectedKind = null;
    this.hoveredId = null;
    this.hoveredKind = null;
    this.hitstopTimer = 0;
    this.shakeMag = 0;
    this.centerOnHome();

    const activePaths: string[] = ['High Priest Sacrifice'];
    if (this.victoryRules.templeDestruction) activePaths.push('Temple Siege');
    if (this.victoryRules.altarDominance) activePaths.push(`Altar Dominance (${ALTAR_DOMINANCE_DURATION}s)`);
    if (this.victoryRules.aetherOverload) {
      activePaths.push(`Aether Overload (${this.victoryRules.aetherOverloadTarget.toLocaleString()} AE)`);
    }
    this.pushAlert(
      clampedOpp > 1
        ? `${clampedOpp} rivals across this ${this.state.gridSize}×${this.state.gridSize} sky-sea. Active victories: ${activePaths.join(' · ')}.`
        : `Active victories: ${activePaths.join(' · ')}.`,
      'INFO',
      7
    );
    this.emitHud();
  }

  public setVictoryRules(patch: Partial<Omit<VictoryRules, 'priestSacrifice'>>): void {
    const validTarget =
      patch.aetherOverloadTarget !== undefined &&
      AETHER_OVERLOAD_OPTIONS.includes(
        patch.aetherOverloadTarget as (typeof AETHER_OVERLOAD_OPTIONS)[number]
      )
        ? patch.aetherOverloadTarget
        : this.victoryRules.aetherOverloadTarget;

    this.victoryRules = {
      priestSacrifice: true,
      templeDestruction:
        typeof patch.templeDestruction === 'boolean'
          ? patch.templeDestruction
          : this.victoryRules.templeDestruction,
      altarDominance:
        typeof patch.altarDominance === 'boolean'
          ? patch.altarDominance
          : this.victoryRules.altarDominance,
      aetherOverload:
        typeof patch.aetherOverload === 'boolean'
          ? patch.aetherOverload
          : this.victoryRules.aetherOverload,
      aetherOverloadTarget: validTarget,
    };
    saveVictoryRules(this.victoryRules);
    this.state.victoryRules = { ...this.victoryRules };

    if (!this.victoryRules.altarDominance) {
      for (const id of this.state.activeFactionIds) {
        if (this.state.factions[id]) this.state.factions[id].dominanceSeconds = 0;
      }
      for (const site of this.state.sacredSites) {
        site.controller = null;
        site.contested = false;
      }
      this.dominanceWarned50.clear();
      this.dominanceWarned80.clear();
    }
    if (!this.victoryRules.aetherOverload) {
      this.overloadWarned70.clear();
      this.overloadWarned90.clear();
    }
    this.emitHud();
  }

  public continueAfterVictory(): void {
    if (this.phase !== 'VICTORY') return;
    const remainingRivals = this.state.aiFactionIds.filter(
      (id) => !this.state.factions[id]?.eliminated
    ).length;
    if (remainingRivals <= 0) return;

    const achievedLabel =
      this.outcomeReason === 'AETHER_OVERLOAD'
        ? 'Aether Overload'
        : this.outcomeReason === 'ALTAR_DOMINANCE'
          ? 'Altar Dominance'
          : 'Victory';

    this.phase = 'PLAYING';
    this.outcomeReason = undefined;
    this.winnerLabel = undefined;
    this.lastTimestamp = performance.now();
    this.audio.unlock();
    this.audio.setAmbience(true, this.state.factions.PLAYER.fury, 0.52);
    this.syncMusicState();
    this.pushAlert(
      `${achievedLabel} achieved! Continuing skirmish — ${remainingRivals} rival${remainingRivals === 1 ? '' : 's'} remain for High Priest Sacrifice or other active paths.`,
      'SACRIFICE',
      6.5
    );
    this.emitHud();
  }

  public setPaused(paused: boolean): void {
    if (this.phase === 'PLAYING' && paused) {
      this.phase = 'PAUSED';
      this.heldKeys.clear();
      this.hoveredId = null;
      this.hoveredKind = null;
      this.audio.setAmbience(false, this.state.factions.PLAYER.fury);
      this.syncMusicState();
      this.emitHud();
    } else if (this.phase === 'PAUSED' && !paused) {
      this.phase = 'PLAYING';
      this.lastTimestamp = performance.now();
      this.audio.unlock();
      this.audio.setAmbience(true, this.state.factions.PLAYER.fury, 0.52);
      this.syncMusicState();
      this.emitHud();
    }
  }

  public returnToTitle(): void {
    this.phase = 'TITLE_MENU';
    this.heldKeys.clear();
    this.placement = { type: 'SELECT' };
    this.selectedId = null;
    this.selectedKind = null;
    this.hoveredId = null;
    this.hoveredKind = null;
    this.audio.setAmbience(false, this.state.factions.PLAYER.fury);
    this.syncMusicState();
    this.emitHud();
  }

  public toggleSpeed(): void {
    this.speedMultiplier = getNextSpeedMultiplier(this.speedMultiplier);
    this.emitHud();
  }

  public toggleMute(): void {
    this.audio.unlock();
    this.audio.toggleMute();
    this.emitHud();
  }

  public setMusicVolume(volume: number): void {
    this.audio.unlock();
    this.audio.setMusicVolume(volume);
    this.emitHud();
  }

  public setSfxVolume(volume: number): void {
    this.audio.unlock();
    this.audio.setSfxVolume(volume);
    this.emitHud();
  }

  public previewSfxVolume(): void {
    this.audio.playVolumeTest();
  }

  public setCreditsMusicActive(active: boolean): void {
    if (this.creditsMusicActive === active) return;
    this.creditsMusicActive = active;
    this.audio.unlock();
    this.syncMusicState();
    this.emitHud();
  }

  public nextMusicTrack(): void {
    this.audio.unlock();
    this.audio.nextGameplayTrack();
    this.emitHud();
  }

  public unlockAudio(): void {
    this.audio.unlock();
  }

  private syncMusicState(): void {
    if (this.creditsMusicActive) {
      this.audio.setMusicMode('CREDITS');
      this.audio.setMusicDucked(false);
    } else if (this.phase === 'TITLE_MENU') {
      this.audio.setMusicMode('TITLE');
      this.audio.setMusicDucked(false);
    } else {
      this.audio.setMusicMode('GAMEPLAY');
      this.audio.setMusicDucked(this.phase !== 'PLAYING');
    }
  }

  private handleFirstGesture(): void {
    this.audio.unlock();
    window.removeEventListener('pointerdown', this.handleFirstGestureBound);
    window.removeEventListener('keydown', this.handleFirstGestureBound);
  }

  public toggleRangeOverlay(): void {
    const nextEnabled = !this.rangeOverlay.enabled;
    if (nextEnabled && !this.rangeOverlay.WIND && !this.rangeOverlay.RAIN && !this.rangeOverlay.THUNDER) {
      this.rangeOverlay = { enabled: true, WIND: true, RAIN: true, THUNDER: true };
    } else {
      this.rangeOverlay = { ...this.rangeOverlay, enabled: nextEnabled };
    }
    this.emitHud();
  }

  public toggleRangeFury(fury: Fury): void {
    const nextVal = !this.rangeOverlay[fury];
    const next: RangeOverlayState = {
      ...this.rangeOverlay,
      enabled: true,
      [fury]: nextVal,
    };
    if (!next.WIND && !next.RAIN && !next.THUNDER) {
      next.enabled = false;
    }
    this.rangeOverlay = next;
    this.emitHud();
  }

  public setPlacement(mode: PlacementMode): void {
    this.audio.unlock();
    this.placement = mode;
    if (mode.type !== 'SELECT') {
      this.selectedId = null;
      this.selectedKind = null;
    }
    this.emitHud();
  }

  public rotatePlacement(): void {
    this.audio.unlock();
    if (this.placement.type === 'BRIDGE') {
      this.placement = {
        ...this.placement,
        rotation: ((this.placement.rotation + 1) % 4) as Direction,
      };
      this.emitAudio({ type: 'UI_ROTATE' });
      this.emitHud();
    } else if (this.placement.type === 'STRUCTURE') {
      this.placement = {
        ...this.placement,
        facing: ((this.placement.facing + 1) % 4) as Direction,
      };
      this.emitAudio({ type: 'UI_ROTATE' });
      this.emitHud();
    }
  }

  public summonPlayerGolem(): void {
    this.audio.unlock();
    const ok = this.summonGolem('PLAYER');
    if (!ok) {
      this.emitAudio({ type: 'UI_INVALID' });
    }
    this.emitHud();
  }

  public centerOnHome(): void {
    const homeIsle = this.state.islands.find((isl) => isl.role === 'PLAYER_HOME') ?? this.state.islands[0];
    const home = homeIsle ? tileToIso(homeIsle.centerX, homeIsle.centerY) : tileToIso(10, 38);
    this.camera.x = this.clampCamX(home.x);
    this.camera.y = this.clampCamY(home.y);
    this.camera.zoom = this.viewW < 640 ? 0.72 : 0.95;
  }

  private getMinZoom(): number {
    // Allow zooming further out on larger multi-opponent archipelagos
    return Math.max(0.28, 0.45 - (this.state.opponentCount - 1) * 0.032);
  }

  public zoomBy(factor: number): void {
    this.camera.zoom = Math.max(this.getMinZoom(), Math.min(1.65, this.camera.zoom * factor));
  }

  public focusOnTile(tx: number, ty: number): void {
    const iso = tileToIso(tx, ty);
    this.camera.x = this.clampCamX(iso.x);
    this.camera.y = this.clampCamY(iso.y);
  }

  public focusNextSacredSite(): void {
    const sites = this.state.sacredSites;
    if (sites.length === 0) return;
    const site = sites[this.sacredFocusIndex % sites.length];
    this.sacredFocusIndex = (this.sacredFocusIndex + 1) % sites.length;
    this.focusOnTile(site.tx, site.ty);
  }

  public panFromMinimapNorm(nx: number, ny: number): void {
    const bounds = getWorldIsoBounds(this.state.gridSize);
    this.camera.x = this.clampCamX(bounds.minX + nx * bounds.spanX);
    this.camera.y = this.clampCamY(bounds.minY + ny * bounds.spanY);
  }

  public commandCaptureStunnedPriest(priestId: number): void {
    const targetPriest = this.state.priests.find((p) => p.id === priestId);
    if (!targetPriest || targetPriest.state !== 'STUNNED') return;
    this.focusOnTile(targetPriest.x, targetPriest.y);

    const playerPriest = this.state.priests.find((p) => p.owner === 'PLAYER' && !p.isRogue);
    if (!playerPriest || playerPriest.state !== 'ACTIVE') {
      this.pushAlert('Your High Priest is unable to march right now!', 'WARNING', 4);
      this.emitAudio({ type: 'UI_INVALID' });
      this.emitHud();
      return;
    }
    if (playerPriest.carryingPriestId !== null) {
      this.pushAlert('Your High Priest is already carrying a Priest to the Altar!', 'INFO', 4);
      this.emitAudio({ type: 'UI_INVALID' });
      this.emitHud();
      return;
    }

    const assigned = this.dispatchHighPriestToCapture('PLAYER', targetPriest);
    if (assigned) {
      this.selectedKind = 'PRIEST';
      this.selectedId = playerPriest.id;
      this.pushAlert('Your High Priest is marching to capture the stunned Priest!', 'SACRIFICE', 4.5);
      this.emitAudio({ type: 'UI_ROTATE' });
    } else {
      this.pushAlert('Bridge to that island first so your High Priest can walk over and capture them.', 'WARNING', 5);
      this.emitAudio({ type: 'UI_INVALID' });
    }
    this.emitHud();
  }

  public destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.unsubscribeTrackChange?.();
    this.unsubscribeTrackChange = null;
    this.audioListeners.clear();
    this.audio.dispose();
    window.removeEventListener('pointerdown', this.handleFirstGestureBound);
    window.removeEventListener('keydown', this.handleFirstGestureBound);
    window.removeEventListener('resize', this.handleResizeBound);
    window.removeEventListener('keydown', this.handleKeyDownBound);
    window.removeEventListener('keyup', this.handleKeyUpBound);
    window.removeEventListener('blur', this.handleBlurBound);
    this.canvas.removeEventListener('mousedown', this.handleMouseDownBound);
    window.removeEventListener('mousemove', this.handleMouseMoveBound);
    window.removeEventListener('mouseup', this.handleMouseUpBound);
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeaveBound);
    this.canvas.removeEventListener('wheel', this.handleWheelBound);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenuBound);
    this.canvas.removeEventListener('touchstart', this.handleTouchStartBound);
    this.canvas.removeEventListener('touchmove', this.handleTouchMoveBound);
    this.canvas.removeEventListener('touchend', this.handleTouchEndBound);
    this.canvas.removeEventListener('touchcancel', this.handleTouchEndBound);
  }

  private attachEvents(): void {
    window.addEventListener('pointerdown', this.handleFirstGestureBound, { passive: true });
    window.addEventListener('keydown', this.handleFirstGestureBound, { passive: true });
    window.addEventListener('resize', this.handleResizeBound);
    window.addEventListener('keydown', this.handleKeyDownBound);
    window.addEventListener('keyup', this.handleKeyUpBound);
    window.addEventListener('blur', this.handleBlurBound);
    this.canvas.addEventListener('mousedown', this.handleMouseDownBound);
    window.addEventListener('mousemove', this.handleMouseMoveBound);
    window.addEventListener('mouseup', this.handleMouseUpBound);
    this.canvas.addEventListener('mouseleave', this.handleMouseLeaveBound);
    this.canvas.addEventListener('wheel', this.handleWheelBound, { passive: false });
    this.canvas.addEventListener('contextmenu', this.handleContextMenuBound);
    this.canvas.addEventListener('touchstart', this.handleTouchStartBound, { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMoveBound, { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEndBound, { passive: false });
    this.canvas.addEventListener('touchcancel', this.handleTouchEndBound, { passive: false });
  }

  private handleResize(): void {
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.viewW = w;
    this.viewH = h;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rect = this.canvas.getBoundingClientRect();
    this.canvasLeft = rect.left;
    this.canvasTop = rect.top;
  }

  private handleBlur(): void {
    this.heldKeys.clear();
    this.isDragging = false;
    this.activeTouchMode = 'NONE';
    this.clearHoveredEntity();
  }

  private handleMouseLeave(): void {
    if (!this.isDragging) {
      this.hoverTile = null;
      this.clearHoveredEntity();
    }
  }

  private clearHoveredEntity(): void {
    if (this.hoveredId !== null || this.hoveredKind !== null) {
      this.hoveredId = null;
      this.hoveredKind = null;
      this.emitHud();
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.phase === 'TITLE_MENU') return;
    const code = e.code;

    if (code === 'Escape') {
      if (this.placement.type !== 'SELECT' && this.phase === 'PLAYING') {
        this.placement = { type: 'SELECT' };
        this.emitHud();
      } else if (this.phase === 'PLAYING' || this.phase === 'PAUSED') {
        this.setPaused(this.phase === 'PLAYING');
      }
      return;
    }

    if (this.phase !== 'PLAYING') return;

    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    this.heldKeys.add(code);

    if (code === 'KeyR') {
      this.rotatePlacement();
    } else if (code === 'Equal' || code === 'NumpadAdd') {
      this.zoomBy(1.15);
    } else if (code === 'Minus' || code === 'NumpadSubtract') {
      this.zoomBy(0.87);
    } else if (code === 'Space') {
      e.preventDefault();
      this.centerOnHome();
    } else if (code === 'KeyB') {
      this.setPlacement({ type: 'BRIDGE', queueIndex: 0, rotation: 0 });
    } else if (code === 'KeyG') {
      this.summonPlayerGolem();
    } else if (code === 'KeyV') {
      this.toggleRangeOverlay();
    } else if (code === 'KeyF') {
      this.toggleSpeed();
    } else if (code === 'Digit1') {
      this.setPlacement({ type: 'SELECT' });
    } else if (code >= 'Digit2' && code <= 'Digit7') {
      const idx = Number(code.replace('Digit', '')) - 2;
      const palette: BuildOptionKind[] = [
        'SUN_DISC',
        'STONE_BLOCKER',
        'WINDMILL',
        ...FURY_META[this.state.factions.PLAYER.fury].units,
      ];
      const kind = palette[idx];
      if (kind) {
        const def = STRUCTURE_CATALOG[kind];
        if (def.tier <= this.state.factions.PLAYER.knowledgeTier) {
          this.setPlacement({ type: 'STRUCTURE', kind, facing: 0 });
        } else {
          this.pushAlert('Unlock Tier-2 elemental units by sacrificing a Rogue or rival Priest at your Altar.', 'INFO', 4);
          this.emitAudio({ type: 'UI_INVALID' });
          this.emitHud();
        }
      }
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.heldKeys.delete(e.code);
  }

  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  private handleMouseDown(e: MouseEvent): void {
    this.audio.unlock();
    if (this.phase !== 'PLAYING') return;

    const rect = this.canvas.getBoundingClientRect();
    this.canvasLeft = rect.left;
    this.canvasTop = rect.top;

    // Universal drag-to-pan on Left, Middle, or Right button in EVERY mode.
    // A short click (<= 7px movement) performs placement/select (left) or rotate (right).
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      this.isDragging = true;
      this.dragButton = e.button;
      this.dragMoved = false;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragCamStartX = this.camera.x;
      this.dragCamStartY = this.camera.y;
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (this.isDragging) {
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      if (!this.dragMoved && Math.hypot(dx, dy) > 7) {
        this.dragMoved = true;
        this.clearHoveredEntity();
      }
      if (this.dragMoved) {
        this.camera.x = this.clampCamX(this.dragCamStartX - dx / this.camera.zoom);
        this.camera.y = this.clampCamY(this.dragCamStartY - dy / this.camera.zoom);
        return;
      }
    }

    if (e.target !== this.canvas && !this.isDragging) {
      this.clearHoveredEntity();
      return;
    }

    const sx = e.clientX - this.canvasLeft;
    const sy = e.clientY - this.canvasTop;
    this.updateHoverTileFromScreen(sx, sy);
  }

  private handleMouseUp(e: MouseEvent): void {
    if (!this.isDragging) return;
    const wasMoved = this.dragMoved;
    const btn = this.dragButton;
    this.isDragging = false;
    this.dragButton = -1;

    if (this.phase !== 'PLAYING' || wasMoved) return;

    if (btn === 2) {
      if (this.placement.type !== 'SELECT') {
        this.rotatePlacement();
      }
      return;
    }

    if (btn === 0) {
      if (this.placement.type === 'SELECT') {
        this.handleSelectOrCommandClick();
      } else {
        this.handlePrimaryPlacementAtClient(e.clientX, e.clientY);
      }
    }
  }

  private handleTouchStart(e: TouchEvent): void {
    this.audio.unlock();
    if (this.phase !== 'PLAYING') return;
    e.preventDefault();

    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.activeTouchMode = 'PAN';
      this.dragMoved = false;
      this.dragStartX = t.clientX;
      this.dragStartY = t.clientY;
      this.lastTouchClientX = t.clientX;
      this.lastTouchClientY = t.clientY;
      this.dragCamStartX = this.camera.x;
      this.dragCamStartY = this.camera.y;

      const rect = this.canvas.getBoundingClientRect();
      this.canvasLeft = rect.left;
      this.canvasTop = rect.top;
      this.updateHoverTileFromScreen(t.clientX - this.canvasLeft, t.clientY - this.canvasTop);
    } else if (e.touches.length >= 2) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      this.activeTouchMode = 'PINCH';
      this.dragMoved = true;
      this.pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
      this.pinchStartZoom = this.camera.zoom;
      this.pinchStartMidX = (t0.clientX + t1.clientX) * 0.5;
      this.pinchStartMidY = (t0.clientY + t1.clientY) * 0.5;
      this.dragCamStartX = this.camera.x;
      this.dragCamStartY = this.camera.y;
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    if (this.phase !== 'PLAYING') return;
    e.preventDefault();

    if (this.activeTouchMode === 'PAN' && e.touches.length === 1) {
      const t = e.touches[0];
      this.lastTouchClientX = t.clientX;
      this.lastTouchClientY = t.clientY;
      const dx = t.clientX - this.dragStartX;
      const dy = t.clientY - this.dragStartY;
      if (!this.dragMoved && Math.hypot(dx, dy) > 9) this.dragMoved = true;
      if (this.dragMoved) {
        this.camera.x = this.clampCamX(this.dragCamStartX - dx / this.camera.zoom);
        this.camera.y = this.clampCamY(this.dragCamStartY - dy / this.camera.zoom);
        return;
      }
      this.updateHoverTileFromScreen(t.clientX - this.canvasLeft, t.clientY - this.canvasTop);
    } else if (e.touches.length >= 2) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
      const midX = (t0.clientX + t1.clientX) * 0.5;
      const midY = (t0.clientY + t1.clientY) * 0.5;

      if (this.activeTouchMode !== 'PINCH') {
        this.activeTouchMode = 'PINCH';
        this.pinchStartDist = dist;
        this.pinchStartZoom = this.camera.zoom;
        this.pinchStartMidX = midX;
        this.pinchStartMidY = midY;
        this.dragCamStartX = this.camera.x;
        this.dragCamStartY = this.camera.y;
      }

      const nextZoom = Math.max(
        this.getMinZoom(),
        Math.min(1.65, this.pinchStartZoom * (dist / this.pinchStartDist))
      );
      this.camera.zoom = nextZoom;
      const dx = midX - this.pinchStartMidX;
      const dy = midY - this.pinchStartMidY;
      this.camera.x = this.clampCamX(this.dragCamStartX - dx / nextZoom);
      this.camera.y = this.clampCamY(this.dragCamStartY - dy / nextZoom);
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (this.phase !== 'PLAYING') {
      this.activeTouchMode = 'NONE';
      return;
    }
    e.preventDefault();

    if (e.touches.length === 0) {
      const wasTap = this.activeTouchMode === 'PAN' && !this.dragMoved;
      this.activeTouchMode = 'NONE';
      if (wasTap) {
        if (this.placement.type === 'SELECT') {
          this.handleSelectOrCommandClick();
        } else {
          this.handlePrimaryPlacementAtClient(this.lastTouchClientX, this.lastTouchClientY);
        }
      }
    } else if (e.touches.length === 1) {
      // Transition smoothly from pinch back to single-finger pan
      const t = e.touches[0];
      this.activeTouchMode = 'PAN';
      this.dragMoved = true;
      this.dragStartX = t.clientX;
      this.dragStartY = t.clientY;
      this.dragCamStartX = this.camera.x;
      this.dragCamStartY = this.camera.y;
    }
  }

  private updateHoverTileFromScreen(sx: number, sy: number): void {
    const iso = screenToWorldIso(sx, sy, this.camera, this.viewW, this.viewH);
    const tile = isoToTile(iso.isoX, iso.isoY);
    const tx = Math.round(tile.tx);
    const ty = Math.round(tile.ty);
    if (inBounds(tx, ty, this.state.gridSize)) {
      this.hoverTile = { tx, ty };
    } else {
      this.hoverTile = null;
    }

    if (this.phase !== 'PLAYING' || (this.isDragging && this.dragMoved)) {
      this.clearHoveredEntity();
      return;
    }

    this.resolveHoveredEntity(tile.tx, tile.ty, tx, ty);
  }

  private resolveHoveredEntity(txFrac: number, tyFrac: number, tx: number, ty: number): void {
    let nextKind: 'STRUCTURE' | 'PRIEST' | 'GOLEM' | 'GEYSER' | null = null;
    let nextId: number | null = null;

    // 1. Priests (priority hit-test so moving/stunned priests are effortless to inspect)
    let bestPriestDist = 0.88;
    for (const p of this.state.priests) {
      if (p.state === 'SACRIFICED' || p.state === 'CARRIED') continue;
      const d = Math.hypot(p.x - txFrac, p.y - tyFrac);
      if (d < bestPriestDist) {
        bestPriestDist = d;
        nextKind = 'PRIEST';
        nextId = p.id;
      }
    }

    // 2. Aether Golems
    if (nextId === null) {
      let bestGolemDist = 0.85;
      for (const g of this.state.golems) {
        const d = Math.hypot(g.x - txFrac, g.y - tyFrac);
        if (d < bestGolemDist) {
          bestGolemDist = d;
          nextKind = 'GOLEM';
          nextId = g.id;
        }
      }
    }

    // 3. Structures on tile
    if (nextId === null && inBounds(tx, ty, this.state.gridSize)) {
      const s = getStructureAt(this.state, tx, ty);
      if (s) {
        nextKind = 'STRUCTURE';
        nextId = s.id;
      }
    }

    // 4. Geysers on tile
    if (nextId === null && inBounds(tx, ty, this.state.gridSize)) {
      const geyser = this.state.geysers.find((g) => g.tx === tx && g.ty === ty);
      if (geyser) {
        nextKind = 'GEYSER';
        nextId = geyser.id;
      }
    }

    if (nextKind !== this.hoveredKind || nextId !== this.hoveredId) {
      this.hoveredKind = nextKind;
      this.hoveredId = nextId;
      this.emitHud();
    }
  }

  private handleWheel(e: WheelEvent): void {
    if (this.phase !== 'PLAYING') return;
    e.preventDefault();

    const sx = e.clientX - this.canvasLeft;
    const sy = e.clientY - this.canvasTop;

    // Trackpad two-finger pan (horizontal delta present) or Shift+Wheel pans the map smoothly
    if (!e.ctrlKey && (Math.abs(e.deltaX) > 2 || e.shiftKey)) {
      this.camera.x = this.clampCamX(this.camera.x + e.deltaX / this.camera.zoom);
      this.camera.y = this.clampCamY(this.camera.y + e.deltaY / this.camera.zoom);
      return;
    }

    // Zoom smoothly toward cursor position
    const before = screenToWorldIso(sx, sy, this.camera, this.viewW, this.viewH);
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    this.camera.zoom = Math.max(this.getMinZoom(), Math.min(1.65, this.camera.zoom * factor));
    const after = screenToWorldIso(sx, sy, this.camera, this.viewW, this.viewH);
    this.camera.x = this.clampCamX(this.camera.x + (before.isoX - after.isoX));
    this.camera.y = this.clampCamY(this.camera.y + (before.isoY - after.isoY));
    const iso = screenToWorldIso(sx, sy, this.camera, this.viewW, this.viewH);
    const tile = isoToTile(iso.isoX, iso.isoY);
    const tx = Math.round(tile.tx);
    const ty = Math.round(tile.ty);
    this.hoverTile = inBounds(tx, ty, this.state.gridSize) ? { tx, ty } : null;
  }

  private handlePrimaryPlacementAtClient(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const iso = screenToWorldIso(clientX - rect.left, clientY - rect.top, this.camera, this.viewW, this.viewH);
    const tile = isoToTile(iso.isoX, iso.isoY);
    const tx = Math.round(tile.tx);
    const ty = Math.round(tile.ty);
    if (!inBounds(tx, ty, this.state.gridSize)) return;

    if (this.placement.type === 'BRIDGE') {
      const ok = this.placeBridge('PLAYER', this.placement.queueIndex, this.placement.rotation, tx, ty);
      if (!ok) {
        this.emitAudio({ type: 'UI_INVALID' });
      }
      this.emitHud();
    } else if (this.placement.type === 'STRUCTURE') {
      const ok = this.placeStructure('PLAYER', this.placement.kind, tx, ty, this.placement.facing);
      if (!ok) {
        this.emitAudio({ type: 'UI_INVALID' });
      }
      this.emitHud();
    }
  }

  private handleSelectOrCommandClick(): void {
    if (!this.hoverTile) return;
    const { tx, ty } = this.hoverTile;

    // 1. Did player click on a stunned Rogue or AI Priest? Command Your High Priest to walk over & capture!
    const clickedStunned = this.state.priests.find(
      (p) => p.state === 'STUNNED' && p.owner !== 'PLAYER' && Math.hypot(p.x - tx, p.y - ty) <= 1.25
    );
    if (clickedStunned) {
      this.commandCaptureStunnedPriest(clickedStunned.id);
      return;
    }

    // 2. Did player click on any Priest?
    const clickedPriest = this.state.priests.find(
      (p) => p.state !== 'CARRIED' && p.state !== 'SACRIFICED' && Math.hypot(p.x - tx, p.y - ty) <= 1.1
    );
    if (clickedPriest) {
      this.selectedKind = 'PRIEST';
      this.selectedId = clickedPriest.id;
      this.emitHud();
      return;
    }

    // 3. Did player click on a Golem?
    const clickedGolem = this.state.golems.find((g) => Math.hypot(g.x - tx, g.y - ty) <= 1.0);
    if (clickedGolem) {
      this.selectedKind = 'GOLEM';
      this.selectedId = clickedGolem.id;
      this.emitHud();
      return;
    }

    // 4. Did player click on their own Altar while their High Priest is selected and carrying a Priest? Send straight to Altar!
    const clickedStruct = getStructureAt(this.state, tx, ty);
    if (
      clickedStruct &&
      clickedStruct.owner === 'PLAYER' &&
      clickedStruct.kind === 'ALTAR' &&
      this.selectedKind === 'PRIEST' &&
      this.selectedId !== null
    ) {
      const playerPriest = this.state.priests.find(
        (p) => p.id === this.selectedId && p.owner === 'PLAYER' && p.state === 'ACTIVE' && p.carryingPriestId !== null
      );
      if (playerPriest) {
        const path = findTilePath(this.state, playerPriest.x, playerPriest.y, clickedStruct.tx, clickedStruct.ty);
        if (path && path.length > 0) {
          playerPriest.targetPath = path;
          playerPriest.returningToAltar = true;
          this.spawnBurst(clickedStruct.tx, clickedStruct.ty, '#fde047', 8, 40);
          this.emitAudio({ type: 'UI_ROTATE' });
          return;
        }
      }
    }

    if (clickedStruct) {
      this.selectedKind = 'STRUCTURE';
      this.selectedId = clickedStruct.id;
      this.emitHud();
      return;
    }

    // 5. Did player click on a Geyser?
    const clickedGeyser = this.state.geysers.find((g) => g.tx === tx && g.ty === ty);
    if (clickedGeyser) {
      this.selectedKind = 'GEYSER';
      this.selectedId = clickedGeyser.id;
      this.emitHud();
      return;
    }

    // 6. If Player High Priest is currently selected and tile is walkable ground, walk High Priest there!
    if (this.selectedKind === 'PRIEST' && this.selectedId !== null) {
      const playerPriest = this.state.priests.find(
        (p) => p.id === this.selectedId && p.owner === 'PLAYER' && p.state === 'ACTIVE'
      );
      if (playerPriest && isWalkable(this.state, tx, ty)) {
        const path = findTilePath(this.state, playerPriest.x, playerPriest.y, tx, ty);
        if (path && path.length > 0) {
          playerPriest.targetPath = path;
          playerPriest.captureTargetPriestId = null;
          if (playerPriest.carryingPriestId !== null) {
            // Allow manual evasive routing while carrying, resuming Altar return once they reach the waypoint or Altar
            playerPriest.returningToAltar = false;
          }
          this.spawnBurst(tx, ty, '#f0b429', 6, 35);
          this.emitAudio({ type: 'UI_ROTATE' });
          return;
        }
      }
    }

    // Otherwise clear selection
    this.selectedKind = null;
    this.selectedId = null;
    this.emitHud();
  }

  private startLoop(): void {
    this.lastTimestamp = performance.now();
    const tick = (now: number) => {
      const rawDt = (now - this.lastTimestamp) / 1000;
      this.lastTimestamp = now;
      const clampedDt = Math.min(Math.max(rawDt, 0), 0.05);

      this.animTime += clampedDt;
      this.updateCamera(clampedDt);

      if (this.phase === 'PLAYING') {
        this.stormGustTimer -= clampedDt;
        if (this.stormGustTimer <= 0) {
          this.stormGustTimer = 11 + Math.random() * 9;
          this.emitAudio({
            type: 'ELEMENTAL_STORM',
            storm: 'AMBIENT_GUST',
            fury: this.state.factions.PLAYER.fury,
            intensity: 0.75,
          });
        }
        if (this.hitstopTimer > 0) {
          this.hitstopTimer = Math.max(0, this.hitstopTimer - clampedDt);
        } else {
          let remaining = clampedDt * this.speedMultiplier;
          const maxStep = 0.04;
          while (remaining > 0.0001 && this.phase === 'PLAYING') {
            const stepDt = Math.min(remaining, maxStep);
            this.updateSimulation(stepDt);
            remaining -= stepDt;
          }
        }
      }

      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private updateCamera(dt: number): void {
    if (this.phase === 'PLAYING') {
      const panSpeed = 620 / this.camera.zoom;
      if (this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp')) this.camera.y -= panSpeed * dt;
      if (this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown')) this.camera.y += panSpeed * dt;
      if (this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft')) this.camera.x -= panSpeed * dt;
      if (this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight')) this.camera.x += panSpeed * dt;
      this.camera.x = this.clampCamX(this.camera.x);
      this.camera.y = this.clampCamY(this.camera.y);
    }

    if (this.shakeMag > 0.08) {
      this.camera.shakeX = (Math.random() - 0.5) * 2 * this.shakeMag;
      this.camera.shakeY = (Math.random() - 0.5) * 2 * this.shakeMag;
      this.shakeMag *= Math.pow(0.0003, dt);
    } else {
      this.shakeMag = 0;
      this.camera.shakeX = 0;
      this.camera.shakeY = 0;
    }
  }

  private clampCamX(x: number): number {
    const bounds = getWorldIsoBounds(this.state.gridSize);
    return Math.max(bounds.minX - 30, Math.min(bounds.maxX + 30, x));
  }

  private clampCamY(y: number): number {
    const bounds = getWorldIsoBounds(this.state.gridSize);
    return Math.max(bounds.minY, Math.min(bounds.maxY, y));
  }

  private triggerShake(amount: number, tx?: number, ty?: number): void {
    let scaled = amount;
    if (tx !== undefined && ty !== undefined) {
      const iso = tileToIso(tx, ty);
      const { sx, sy } = worldToScreen(iso.x, iso.y, this.camera, this.viewW, this.viewH);
      const halfW = Math.max(1, this.viewW * 0.5);
      const halfH = Math.max(1, this.viewH * 0.5);
      const dist = Math.hypot((sx - halfW) / halfW, (sy - halfH) / halfH);
      if (dist >= 1.15) return; // Ignore off-screen combat so distant fights never jostle the camera
      scaled *= Math.max(0, 1 - dist * 0.65);
    }
    this.shakeMag = Math.min(6, Math.max(this.shakeMag, scaled));
  }

  private updateSimulation(dt: number): void {
    const state = this.state;
    state.elapsedSeconds += dt;

    // Alert timer & temple siege warning throttle
    if (this.alertBanner) {
      this.alertBanner.timer -= dt;
      if (this.alertBanner.timer <= 0) this.alertBanner = null;
    }
    if (this.templeWarningCooldown > 0) {
      this.templeWarningCooldown = Math.max(0, this.templeWarningCooldown - dt);
    }

    // Passive baseline Aether trickle for all active, non-eliminated factions
    const baseIncome = 2.6;
    const aiDiffMult = state.difficulty === 'STORMLORD' ? 1.18 : state.difficulty === 'ARCHON' ? 1.0 : 0.82;
    for (const id of state.activeFactionIds) {
      const f = state.factions[id];
      if (!f || f.eliminated) continue;
      f.stormPower += baseIncome * (id === 'PLAYER' ? 1 : aiDiffMult) * dt;
    }

    // Tile hit flashes
    const gs = state.gridSize;
    for (let y = 0; y < gs; y++) {
      const row = state.tiles[y];
      for (let x = 0; x < gs; x++) {
        if (row[x].hitFlash > 0) {
          row[x].hitFlash = Math.max(0, row[x].hitFlash - dt * 5);
        }
      }
    }

    // 1. Geysers & Crystals
    this.updateGeysersAndCrystals(dt);

    // 2. Structures (income, regen, slow aura, combat firing)
    this.updateStructures(dt);

    // 3. Priests (movement, repair aura, stun timer, sacrifice ritual)
    this.updatePriests(dt);

    // 4. Golems (harvesting, crystal delivery, capturing & dragging stunned priests)
    this.updateGolems(dt);

    // 5. Projectiles & Visual FX
    this.updateProjectiles(dt);
    this.updateEffects(dt);

    // 6. AI High Priest Commander (damp AI decision speedup at 2x/3x/5x so computer doesn't outpace human clicks)
    const aiThinkDt = this.speedMultiplier > 1 ? dt / Math.pow(this.speedMultiplier, 0.45) : dt;
    this.ai.update(state, aiThinkDt, {
      placeBridge: this.placeBridge.bind(this),
      placeStructure: this.placeStructure.bind(this),
      summonGolem: this.summonGolem.bind(this),
    });

    // 7. Alternative Victory Conditions (Altar Dominance & Aether Overload)
    if (this.phase === 'PLAYING') {
      this.updateVictoryConditions(dt);
    }

    // 8. Throttled HUD snapshot
    this.hudEmitTimer += dt;
    if (this.hudEmitTimer >= 0.12) {
      this.hudEmitTimer = 0;
      this.emitHud();
    }
  }

  public placeBridge(
    owner: FactionId,
    queueIndex: number,
    rotation: Direction,
    anchorTx: number,
    anchorTy: number
  ): boolean {
    const faction = this.state.factions[owner];
    if (!faction || faction.eliminated) return false;
    const pieceKey = faction.bridgeQueue[queueIndex];
    if (!pieceKey) return false;
    const def = TETROMINOES[pieceKey];
    if (faction.stormPower < def.cost) return false;

    const check = canPlaceBridge(this.state, owner, pieceKey, rotation, anchorTx, anchorTy);
    if (!check.valid) return false;

    const prevIslands = countConnectedIslands(this.state, owner);
    faction.stormPower -= def.cost;
    faction.bridgesPlaced += 1;

    for (const cell of check.cells) {
      const tile = this.state.tiles[cell.y][cell.x];
      tile.kind = 'BRIDGE';
      tile.owner = owner;
      tile.hp = BRIDGE_TILE_HP;
      tile.maxHp = BRIDGE_TILE_HP;
      tile.hitFlash = 0.25;
      this.spawnBurst(cell.x, cell.y, faction.color, 5, 38);
    }

    // Cycle piece in queue
    faction.bridgeQueue[queueIndex] = randomTetrominoKey();
    recomputePowerGrids(this.state);

    const newIslands = countConnectedIslands(this.state, owner);
    const linkedNewIsland = newIslands > prevIslands;
    this.spawnImpact(anchorTx, anchorTy, 'BUILD_SNAP', faction.color, linkedNewIsland ? 0.85 : 0.55, linkedNewIsland ? 1.35 : 0.95);
    this.emitAudio({
      type: 'BRIDGE_PLACED',
      owner,
      cells: check.cells.length,
      linkedNewIsland,
      tx: anchorTx,
      ty: anchorTy,
    });
    if (owner === 'PLAYER' && linkedNewIsland) {
      this.pushAlert('New floating island linked to your Aether power grid!', 'INFO', 4.5);
      this.triggerShake(1.4, anchorTx, anchorTy);
    }
    return true;
  }

  public placeStructure(
    owner: FactionId,
    kind: BuildOptionKind,
    tx: number,
    ty: number,
    facing: Direction
  ): boolean {
    const faction = this.state.factions[owner];
    if (!faction || faction.eliminated) return false;
    const def = STRUCTURE_CATALOG[kind];
    if (def.tier > faction.knowledgeTier) return false;
    if (faction.stormPower < def.cost) return false;

    const check = canPlaceStructure(this.state, owner, tx, ty, def.canBuildOnBridge);
    if (!check.valid) return false;

    faction.stormPower -= def.cost;
    const struct: Structure = {
      id: this.state.nextEntityId++,
      kind,
      owner,
      tx,
      ty,
      facing,
      hp: def.maxHp,
      maxHp: def.maxHp,
      cooldown: 0.35,
      powered: true,
      hitFlash: 0,
      recoil: 0,
      animPhase: Math.random() * Math.PI * 2,
      buildProgress: 0.05,
    };
    this.state.structures.push(struct);
    this.spawnBurst(tx, ty, faction.color, 10, 48);
    this.spawnImpact(tx, ty, 'BUILD_SNAP', faction.color, 0.62, 1.05);

    this.emitAudio({ type: 'STRUCTURE_BUILT', owner, kind, tx, ty });
    return true;
  }

  public summonGolem(owner: FactionId): boolean {
    const faction = this.state.factions[owner];
    if (!faction || faction.eliminated) return false;
    const current = this.state.golems.filter((g) => g.owner === owner).length;
    if (current >= MAX_GOLEMS || faction.stormPower < GOLEM_COST) return false;

    const temple = this.state.structures.find((s) => s.owner === owner && s.kind === 'TEMPLE');
    if (!temple) return false;

    const spawn = findNearestWalkableFreeTile(this.state, temple.tx, temple.ty, owner);
    faction.stormPower -= GOLEM_COST;

    this.state.golems.push({
      id: this.state.nextEntityId++,
      owner,
      x: spawn.x,
      y: spawn.y,
      hp: 155,
      maxHp: 155,
      speed: 2.35,
      task: 'IDLE',
      targetCrystalId: null,
      carryingCrystalValue: 0,
      path: [],
      repathCooldown: 0,
      hitFlash: 0,
      slowTimer: 0,
      walkPhase: 0,
    });
    this.spawnBurst(spawn.x, spawn.y, '#f0b429', 10, 42);
    this.emitAudio({ type: 'GOLEM_SUMMONED', owner, tx: spawn.x, ty: spawn.y });
    if (owner === 'PLAYER') {
      this.addFloatingText(spawn.x, spawn.y, 'GOLEM SUMMONED', '#f0b429');
    }
    return true;
  }

  private updateGeysersAndCrystals(dt: number): void {
    for (const c of this.state.crystals) {
      if (c.spawnAnim < 1) {
        c.spawnAnim = Math.min(1, c.spawnAnim + dt * 2.1);
      }
    }

    for (const g of this.state.geysers) {
      g.eruptTimer -= dt;
      if (g.eruptTimer > 0) continue;
      g.eruptTimer = g.eruptInterval;

      const nearbyCount = this.state.crystals.filter((c) => Math.hypot(c.tx - g.tx, c.ty - g.ty) <= 3.5).length;
      const cap = g.isSuper ? 6 : 4;
      if (nearbyCount >= cap) continue;

      const drops = g.isSuper ? 2 : 1;
      let erupted = false;
      for (let d = 0; d < drops; d++) {
        const candidates: Array<{ x: number; y: number }> = [];
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const tx = g.tx + dx;
            const ty = g.ty + dy;
            if (!inBounds(tx, ty, this.state.gridSize)) continue;
            if (this.state.tiles[ty][tx].kind !== 'LAND') continue;
            if (hasStructureAt(this.state, tx, ty) || hasGeyserAt(this.state, tx, ty)) continue;
            if (this.state.crystals.some((c) => c.tx === tx && c.ty === ty)) continue;
            candidates.push({ x: tx, y: ty });
          }
        }
        if (candidates.length === 0) break;
        const spot = candidates[Math.floor(Math.random() * candidates.length)];
        this.state.crystals.push({
          id: this.state.nextEntityId++,
          tx: spot.x,
          ty: spot.y,
          x: spot.x,
          y: spot.y,
          value: g.isSuper ? 65 : 50,
          claimedByGolemId: null,
          spawnAnim: 0,
          fromX: g.tx,
          fromY: g.ty,
          bobPhase: Math.random() * Math.PI * 2,
        });
        this.spawnBurst(g.tx, g.ty, '#fde047', 6, 48);
        erupted = true;
      }
      if (erupted) {
        this.emitAudio({
          type: 'ELEMENTAL_STORM',
          storm: 'GEYSER_ERUPT',
          intensity: g.isSuper ? 0.95 : 0.65,
          tx: g.tx,
          ty: g.ty,
        });
      }
    }
  }

  private updateStructures(dt: number): void {
    const state = this.state;

    for (const s of state.structures) {
      const def = STRUCTURE_CATALOG[s.kind];
      if (s.buildProgress < 1) s.buildProgress = Math.min(1, s.buildProgress + dt * 4.5);
      if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt * 5);
      if (s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * 5);
      if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - dt);

      if (!s.powered) continue;

      // Passive income (Aether Mills)
      if (def.passiveIncome && isFactionId(s.owner)) {
        state.factions[s.owner].stormPower += def.passiveIncome * dt;
      }

      // Passive self-regeneration (Glacial Bulwark, Tidal Leviathan)
      if (def.regenPerSec && s.hp < s.maxHp) {
        s.hp = Math.min(s.maxHp, s.hp + def.regenPerSec * dt);
      }

      // Frost slow aura against hostile Golems
      if (def.slowAuraRadius) {
        for (const g of state.golems) {
          if (g.owner !== s.owner && Math.hypot(g.x - s.tx, g.y - s.ty) <= def.slowAuraRadius) {
            g.slowTimer = Math.max(g.slowTimer, 0.5);
          }
        }
      }

      // Static Combat Targeting
      if (def.fireRate > 0 && s.cooldown <= 0) {
        const fired = this.tryFireStructure(s);
        if (fired) {
          s.cooldown = 1 / def.fireRate;
          s.recoil = 1;
        }
      }
    }
  }

  private tryFireStructure(s: Structure): boolean {
    const def = STRUCTURE_CATALOG[s.kind];
    const target = this.acquireTargetForStructure(s);
    if (!target) return false;

    this.emitAudio({
      type: 'TOWER_FIRED',
      owner: s.owner,
      kind: s.kind,
      alignment: def.alignment,
      tx: s.tx,
      ty: s.ty,
    });

    // Instant pulse / chain-lightning towers
    if (s.kind === 'WHIRLWIND_SPIRE') {
      this.fireWhirlwindPulse(s);
      return true;
    }

    if (s.kind === 'SPARK_PYLON' || s.kind === 'ARC_SPIRE') {
      this.fireChainLightning(s, target, def.chainCount ?? 2);
      return true;
    }

    // Projectile weapons
    const speed = def.projectileSpeed ?? 10;
    let vx = 0;
    let vy = 0;
    let maxLife = 1.2;

    if (def.directional) {
      const dir = directionVector(s.facing);
      vx = dir.dx * speed;
      vy = dir.dy * speed;
      maxLife = (def.range + 0.6) / speed;
    } else {
      const dx = target.x - s.tx;
      const dy = target.y - s.ty;
      const dist = Math.hypot(dx, dy) || 1;
      vx = (dx / dist) * speed;
      vy = (dy / dist) * speed;
      maxLife = dist / speed + 0.08;
    }

    const kind =
      s.kind === 'WIND_CROSSBOW'
        ? 'WIND_BOLT'
        : s.kind === 'ZEPHYR_CANNON'
          ? 'ZEPHYR_BLADE'
          : s.kind === 'RAIN_CANNON'
            ? 'RAIN_ORB'
            : s.kind === 'THUNDER_CANNON'
              ? 'THUNDER_SHELL'
              : s.kind === 'MAN_O_WAR'
                ? 'MANOWAR_BOLT'
                : s.kind === 'STORM_OBELISK'
                  ? 'OBELISK_BOLT'
                  : 'DISC';

    this.state.projectiles.push({
      id: this.state.nextEntityId++,
      owner: s.owner,
      alignment: def.alignment,
      kind,
      x: s.tx,
      y: s.ty,
      vx,
      vy,
      targetX: target.x,
      targetY: target.y,
      damage: def.damage,
      splashRadius: def.splashRadius ?? 0,
      pierceLeft: def.pierceCount ?? 1,
      hitEntityIds: [],
      directional: def.directional,
      life: maxLife,
      maxLife,
      arcHeight: s.kind === 'RAIN_CANNON' ? 38 : 0,
      age: 0,
      bridgeBonus: s.kind === 'THUNDER_CANNON' ? 1.55 : 1,
    });

    // Tidal Leviathan fires a secondary tendril arc at a second nearby target
    if (s.kind === 'MAN_O_WAR') {
      this.state.lightningArcs.push({
        points: [
          { x: s.tx, y: s.ty },
          { x: (s.tx + target.x) * 0.5, y: (s.ty + target.y) * 0.5 },
          { x: target.x, y: target.y },
        ],
        color: '#38bdf8',
        life: 0.18,
        maxLife: 0.18,
        width: 2.2,
      });
    }

    return true;
  }

  private acquireTargetForStructure(
    s: Structure
  ): { x: number; y: number; entityType: 'PRIEST' | 'GOLEM' | 'STRUCTURE' | 'BRIDGE'; id?: number } | null {
    const def = STRUCTURE_CATALOG[s.kind];
    const isEnemy = (owner: Owner | null) => owner !== null && owner !== s.owner;

    const isInArc = (tx: number, ty: number): { ok: boolean; dist: number } => {
      const dx = tx - s.tx;
      const dy = ty - s.ty;
      const dist = Math.hypot(dx, dy);
      if (dist > def.range || dist < 0.2) return { ok: false, dist };
      if (!def.directional) return { ok: true, dist };
      const dir = directionVector(s.facing);
      const along = dx * dir.dx + dy * dir.dy;
      const perp = Math.abs(dx * dir.dy - dy * dir.dx);
      return { ok: along > 0.3 && along <= def.range && perp <= 0.85, dist };
    };

    let best: {
      x: number;
      y: number;
      entityType: 'PRIEST' | 'GOLEM' | 'STRUCTURE' | 'BRIDGE';
      id?: number;
      score: number;
    } | null = null;

    // 1. Prioritize active enemy/rogue Priests (highest priority if carrying a captured Priest!)
    for (const p of this.state.priests) {
      if (p.state !== 'ACTIVE' || !isEnemy(p.owner)) continue;
      if (s.owner === 'NEUTRAL' && p.isRogue) continue;
      const check = isInArc(p.x, p.y);
      if (check.ok) {
        const score = (p.carryingPriestId !== null ? 160 : 120) - check.dist * 4;
        if (!best || score > best.score) best = { x: p.x, y: p.y, entityType: 'PRIEST', id: p.id, score };
      }
    }

    // 2. Hostile Golems
    for (const g of this.state.golems) {
      if (!isEnemy(g.owner)) continue;
      const check = isInArc(g.x, g.y);
      if (check.ok) {
        const score = 95 - check.dist * 5;
        if (!best || score > best.score) best = { x: g.x, y: g.y, entityType: 'GOLEM', id: g.id, score };
      }
    }

    // 3. Hostile Structures (High Temples are targetable when Temple Siege is enabled; Altars remain untargetable)
    for (const st of this.state.structures) {
      if (!isEnemy(st.owner)) continue;
      if (st.kind === 'ALTAR') continue;
      if (st.kind === 'TEMPLE' && !this.victoryRules.templeDestruction) continue;
      const check = isInArc(st.tx, st.ty);
      if (check.ok) {
        const baseScore =
          STRUCTURE_CATALOG[st.kind].fireRate > 0 ? 90 : st.kind === 'TEMPLE' ? 84 : 72;
        const score = baseScore - check.dist * 5;
        if (!best || score > best.score) best = { x: st.tx, y: st.ty, entityType: 'STRUCTURE', id: st.id, score };
      }
    }

    // 4. Hostile Bridges (enables iconic bridge-cutting!)
    if (!best && s.owner !== 'NEUTRAL') {
      const r = Math.ceil(def.range);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const tx = s.tx + dx;
          const ty = s.ty + dy;
          if (!inBounds(tx, ty, this.state.gridSize)) continue;
          const tile = this.state.tiles[ty][tx];
          if (tile.kind !== 'BRIDGE' || !isEnemy(tile.owner)) continue;
          const check = isInArc(tx, ty);
          if (check.ok) {
            const score = 55 - check.dist * 5;
            if (!best || score > best.score) best = { x: tx, y: ty, entityType: 'BRIDGE', score };
          }
        }
      }
    }

    return best;
  }

  private fireWhirlwindPulse(s: Structure): void {
    const def = STRUCTURE_CATALOG[s.kind];
    this.spawnBurst(s.tx, s.ty, '#2dd4bf', 14, 72);
    this.applyAreaDamage(s.owner, s.tx, s.ty, def.range, def.damage, 1.35);
    this.emitAudio({
      type: 'ELEMENTAL_STORM',
      storm: 'WIND_CYCLONE',
      fury: 'WIND',
      intensity: 0.9,
      tx: s.tx,
      ty: s.ty,
    });
  }

  private fireChainLightning(s: Structure, firstTarget: { x: number; y: number }, chainCount: number): void {
    const def = STRUCTURE_CATALOG[s.kind];
    const points: Array<{ x: number; y: number }> = [{ x: s.tx, y: s.ty }];
    const hitCoords: Array<{ x: number; y: number }> = [];
    let curX = firstTarget.x;
    let curY = firstTarget.y;

    for (let hop = 0; hop < chainCount; hop++) {
      points.push({ x: curX, y: curY });
      hitCoords.push({ x: curX, y: curY });
      this.applyAreaDamage(s.owner, curX, curY, 0.95, def.damage * Math.pow(0.75, hop), s.kind === 'ARC_SPIRE' ? 1.4 : 1);
      this.spawnBurst(curX, curY, s.kind === 'ARC_SPIRE' ? '#facc15' : '#c084fc', 8, 52);

      // Find next hostile within 2.6 tiles not already struck, capped near the tower's nominal range
      let next: { x: number; y: number; dist: number } | null = null;
      const maxChainReach = def.range + 1.5;
      const isFresh = (x: number, y: number) =>
        Math.hypot(x - s.tx, y - s.ty) <= maxChainReach &&
        hitCoords.every((h) => Math.hypot(h.x - x, h.y - y) > 0.8);

      for (const st of this.state.structures) {
        if (st.owner === s.owner || st.kind === 'ALTAR') continue;
        if (st.kind === 'TEMPLE' && !this.victoryRules.templeDestruction) continue;
        if (!isFresh(st.tx, st.ty)) continue;
        const d = Math.hypot(st.tx - curX, st.ty - curY);
        if (d <= 2.6 && (!next || d < next.dist)) next = { x: st.tx, y: st.ty, dist: d };
      }
      for (const g of this.state.golems) {
        if (g.owner === s.owner || !isFresh(g.x, g.y)) continue;
        const d = Math.hypot(g.x - curX, g.y - curY);
        if (d <= 2.6 && (!next || d < next.dist)) next = { x: g.x, y: g.y, dist: d };
      }
      if (!next) break;
      curX = next.x;
      curY = next.y;
    }

    this.state.lightningArcs.push({
      points,
      color: s.kind === 'ARC_SPIRE' ? '#facc15' : '#c084fc',
      life: 0.24,
      maxLife: 0.24,
      width: s.kind === 'ARC_SPIRE' ? 3.8 : 2.6,
    });

    this.emitAudio({
      type: 'ELEMENTAL_STORM',
      storm: 'THUNDER_ARC',
      fury: 'THUNDER',
      intensity: s.kind === 'ARC_SPIRE' ? 1 : 0.62,
      tx: curX,
      ty: curY,
    });

    if (s.kind === 'ARC_SPIRE') {
      this.triggerShake(1.1, curX, curY);
    }
  }

  private updateProjectiles(dt: number): void {
    const nextProjs = [];
    for (const proj of this.state.projectiles) {
      proj.age += dt;
      proj.life -= dt;
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;

      let expired = proj.life <= 0;

      // Directional projectiles are intercepted by Stone/Glacial Bulwarks in their lane!
      if (proj.directional && !expired) {
        const rtx = Math.round(proj.x);
        const rty = Math.round(proj.y);
        const blocker = this.state.structures.find(
          (st) =>
            st.owner !== proj.owner &&
            st.tx === rtx &&
            st.ty === rty &&
            STRUCTURE_CATALOG[st.kind].blocksDirectional &&
            !proj.hitEntityIds.includes(st.id)
        );
        if (blocker) {
          this.damageStructure(blocker, proj.damage * (proj.kind === 'THUNDER_SHELL' ? 1.45 : 1), proj.owner);
          this.spawnBurst(blocker.tx, blocker.ty, '#e2e8f0', 8, 45);
          if (proj.kind === 'THUNDER_SHELL') {
            this.triggerShake(1.0, blocker.tx, blocker.ty);
          }
          expired = true;
        }
      }

      // Check direct hit against enemy structures, golems, priests, or target tile
      if (!expired) {
        if (proj.splashRadius > 0 && !proj.directional) {
          // Lobbing Rain Mortar explodes on reaching target
          if (Math.hypot(proj.x - proj.targetX, proj.y - proj.targetY) <= 0.45 || proj.life <= 0.01) {
            this.applyAreaDamage(proj.owner, proj.targetX, proj.targetY, proj.splashRadius, proj.damage, 1.15);
            this.spawnBurst(proj.targetX, proj.targetY, '#38bdf8', 14, 58);
            this.spawnImpact(proj.targetX, proj.targetY, 'RAIN_SPLASH', '#38bdf8', 0.95, 1.12);
            this.triggerShake(0.9, proj.targetX, proj.targetY);
            this.emitAudio({
              type: 'ELEMENTAL_STORM',
              storm: 'RAIN_DELUGE',
              fury: 'RAIN',
              intensity: 0.92,
              tx: proj.targetX,
              ty: proj.targetY,
            });
            expired = true;
          }
        } else {
          // Direct impact check
          let hit = false;
          for (const p of this.state.priests) {
            if (p.state !== 'ACTIVE' || p.owner === proj.owner) continue;
            if (proj.owner === 'NEUTRAL' && p.isRogue) continue;
            if (proj.hitEntityIds.includes(p.id)) continue;
            if (Math.hypot(p.x - proj.x, p.y - proj.y) <= 0.65) {
              proj.hitEntityIds.push(p.id);
              this.damagePriest(p, proj.damage, proj.owner);
              hit = true;
              break;
            }
          }

          if (!hit) {
            for (const g of this.state.golems) {
              if (g.owner === proj.owner || proj.hitEntityIds.includes(g.id)) continue;
              if (Math.hypot(g.x - proj.x, g.y - proj.y) <= 0.65) {
                proj.hitEntityIds.push(g.id);
                this.damageGolem(g, proj.damage);
                hit = true;
                break;
              }
            }
          }

          if (!hit) {
            for (const st of this.state.structures) {
              if (st.owner === proj.owner || st.kind === 'ALTAR') continue;
              if (st.kind === 'TEMPLE' && !this.victoryRules.templeDestruction) continue;
              if (proj.hitEntityIds.includes(st.id)) continue;
              if (Math.hypot(st.tx - proj.x, st.ty - proj.y) <= 0.65) {
                proj.hitEntityIds.push(st.id);
                this.damageStructure(st, proj.damage, proj.owner);
                hit = true;
                break;
              }
            }
          }

          if (!hit && proj.owner !== 'NEUTRAL') {
            const btx = Math.round(proj.x);
            const bty = Math.round(proj.y);
            if (inBounds(btx, bty, this.state.gridSize)) {
              const tile = this.state.tiles[bty][btx];
              if (tile.kind === 'BRIDGE' && tile.owner !== proj.owner && Math.hypot(btx - proj.x, bty - proj.y) <= 0.45) {
                this.damageBridgeTile(btx, bty, proj.damage * proj.bridgeBonus);
                hit = true;
              }
            }
          }

          if (hit) {
            if (proj.splashRadius > 0) {
              this.applyAreaDamage(proj.owner, proj.x, proj.y, proj.splashRadius, proj.damage * 0.55, proj.bridgeBonus);
            }
            this.spawnBurst(proj.x, proj.y, proj.kind === 'THUNDER_SHELL' ? '#facc15' : '#fef08a', 7, 45);
            if (proj.kind === 'THUNDER_SHELL') {
              this.spawnImpact(proj.x, proj.y, 'SCORCH_RING', '#f59e0b', 1.25, 1.15);
            } else if (proj.kind === 'ZEPHYR_BLADE' || proj.kind === 'WIND_BOLT') {
              this.spawnImpact(
                proj.x,
                proj.y,
                'WIND_BURST',
                '#2dd4bf',
                0.52,
                proj.kind === 'ZEPHYR_BLADE' ? 1.05 : 0.72
              );
            } else if (proj.kind === 'MANOWAR_BOLT') {
              this.spawnImpact(proj.x, proj.y, 'RAIN_SPLASH', '#38bdf8', 0.65, 0.72);
            }
            if (proj.kind === 'THUNDER_SHELL' || proj.kind === 'ZEPHYR_BLADE') {
              this.triggerShake(0.85, proj.x, proj.y);
              this.emitAudio({
                type: 'PROJECTILE_IMPACT',
                alignment: proj.alignment,
                heavy: true,
                tx: proj.x,
                ty: proj.y,
              });
            }
            proj.pierceLeft -= 1;
            if (proj.pierceLeft <= 0) expired = true;
          }
        }
      }

      if (!expired) nextProjs.push(proj);
    }
    this.state.projectiles = nextProjs;
  }

  private applyAreaDamage(
    attacker: Owner,
    cx: number,
    cy: number,
    radius: number,
    damage: number,
    bridgeMult: number
  ): void {
    for (const p of this.state.priests) {
      if (p.state === 'ACTIVE' && p.owner !== attacker && Math.hypot(p.x - cx, p.y - cy) <= radius) {
        if (attacker === 'NEUTRAL' && p.isRogue) continue;
        this.damagePriest(p, damage, attacker);
      }
    }
    for (const g of [...this.state.golems]) {
      if (g.owner !== attacker && Math.hypot(g.x - cx, g.y - cy) <= radius) {
        this.damageGolem(g, damage);
      }
    }
    for (const st of [...this.state.structures]) {
      if (
        st.owner !== attacker &&
        st.kind !== 'ALTAR' &&
        (st.kind !== 'TEMPLE' || this.victoryRules.templeDestruction) &&
        Math.hypot(st.tx - cx, st.ty - cy) <= radius
      ) {
        this.damageStructure(st, damage, attacker);
      }
    }
    if (attacker !== 'NEUTRAL') {
      const r = Math.ceil(radius);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const tx = Math.round(cx + dx);
          const ty = Math.round(cy + dy);
          if (!inBounds(tx, ty, this.state.gridSize)) continue;
          const tile = this.state.tiles[ty][tx];
          if (tile.kind === 'BRIDGE' && tile.owner !== attacker && Math.hypot(tx - cx, ty - cy) <= radius) {
            this.damageBridgeTile(tx, ty, damage * 0.7 * bridgeMult);
          }
        }
      }
    }
  }

  private damageStructure(st: Structure, amount: number, attacker: Owner): void {
    if (st.kind === 'TEMPLE' && !this.victoryRules.templeDestruction) return;
    st.hp -= amount;
    st.hitFlash = 1;

    // Warn player when their own High Temple comes under siege
    if (st.kind === 'TEMPLE' && st.owner === 'PLAYER' && st.hp > 0 && this.templeWarningCooldown <= 0) {
      this.templeWarningCooldown = 10;
      this.pushAlert('Your High Temple is under attack! Defend your home island!', 'WARNING', 5);
    }

    if (st.hp <= 0) {
      this.state.structures = this.state.structures.filter((item) => item.id !== st.id);
      this.spawnBurst(st.tx, st.ty, st.kind === 'TEMPLE' ? '#fde047' : '#f59e0b', st.kind === 'TEMPLE' ? 32 : 16, st.kind === 'TEMPLE' ? 95 : 68);
      this.spawnImpact(
        st.tx,
        st.ty,
        'CRUMBLE',
        st.kind === 'TEMPLE' ? '#fde047' : '#d6c7ac',
        st.kind === 'TEMPLE' ? 1.35 : 0.95,
        st.kind === 'TEMPLE' ? 1.65 : 1.0
      );
      if (st.kind === 'TEMPLE') {
        this.spawnImpact(st.tx, st.ty, 'SCORCH_RING', '#f59e0b', 2.2, 1.7);
      }
      this.triggerShake(st.kind === 'TEMPLE' ? 4.5 : 1.6, st.tx, st.ty);
      this.emitAudio({
        type: 'PROJECTILE_IMPACT',
        alignment: STRUCTURE_CATALOG[st.kind].alignment,
        heavy: true,
        tx: st.tx,
        ty: st.ty,
      });
      if (isFactionId(attacker)) {
        this.state.factions[attacker].towersDestroyed += 1;
      }
      if (this.selectedKind === 'STRUCTURE' && this.selectedId === st.id) {
        this.selectedId = null;
        this.selectedKind = null;
      }

      // Shattering a High Temple eliminates its faction (alternate win/loss & Tier-2 mastery path!)
      if (st.kind === 'TEMPLE') {
        if (st.owner === 'PLAYER') {
          this.outcomeReason = 'TEMPLE_DESTRUCTION';
          this.phase = 'DEFEAT';
          this.audio.setAmbience(false, this.state.factions.PLAYER.fury);
          this.syncMusicState();
          this.emitAudio({ type: 'DEFEAT' });
          this.heldKeys.clear();
          recomputePowerGrids(this.state);
          this.emitHud();
        } else if (isAiFaction(st.owner)) {
          this.eliminateAiFaction(st.owner, attacker, 'TEMPLE', st.tx, st.ty);
        }
      }
    }
  }

  private damageBridgeTile(tx: number, ty: number, amount: number): void {
    const tile = this.state.tiles[ty][tx];
    if (tile.kind !== 'BRIDGE') return;
    tile.hp -= amount;
    tile.hitFlash = 1;
    if (tile.hp <= 0) {
      const lostOwner = tile.owner;
      tile.kind = 'VOID';
      tile.owner = null;
      tile.hp = 0;
      tile.maxHp = 0;
      this.spawnBurst(tx, ty, '#94a3b8', 18, 75);
      this.spawnImpact(tx, ty, 'CRUMBLE', '#cbd5e1', 0.9, 0.95);
      this.triggerShake(2.1, tx, ty);
      this.emitAudio({ type: 'BRIDGE_BROKEN', tx, ty });

      // Any structure built on this shattered bridge tile collapses into the clouds!
      const doomedStructs = this.state.structures.filter((s) => s.tx === tx && s.ty === ty);
      if (doomedStructs.length > 0) {
        this.state.structures = this.state.structures.filter((s) => !(s.tx === tx && s.ty === ty));
      }

      // Any Golem standing on the collapsed bridge falls into the abyss
      this.state.golems = this.state.golems.filter((g) => !(Math.round(g.x) === tx && Math.round(g.y) === ty));

      // Rescue any Priest standing on a broken bridge back to their home tile (releasing any captive Priest!)
      for (const p of this.state.priests) {
        if (p.state !== 'CARRIED' && Math.round(p.x) === tx && Math.round(p.y) === ty) {
          this.releaseCarriedPriest(p);
          p.x = p.homeTx;
          p.y = p.homeTy;
          p.targetPath = [];
          p.captureTargetPriestId = null;
          p.returningToAltar = false;
        }
      }

      recomputePowerGrids(this.state);
      if (lostOwner === 'PLAYER') {
        this.pushAlert('A bridge section collapsed! Check your Aether power grid.', 'WARNING', 4.5);
      }
    }
  }

  private damageGolem(g: Golem, amount: number): void {
    g.hp -= amount;
    g.hitFlash = 1;
    if (g.hp <= 0) {
      this.state.golems = this.state.golems.filter((item) => item.id !== g.id);
      this.spawnBurst(g.x, g.y, '#94a3b8', 12, 54);
      this.spawnImpact(g.x, g.y, 'CRUMBLE', '#d6c7ac', 0.78, 0.72);
      this.emitAudio({
        type: 'PROJECTILE_IMPACT',
        alignment: 'SUN',
        heavy: false,
        tx: g.x,
        ty: g.y,
      });
    }
  }

  private releaseCarriedPriest(carrier: Priest): void {
    if (carrier.carryingPriestId === null) return;
    const captive = this.state.priests.find((p) => p.id === carrier.carryingPriestId);
    if (captive) {
      // Rescue captive Priest cleanly back to their home island if the carrying High Priest is stunned or falls
      captive.state = 'ACTIVE';
      captive.carriedByPriestId = null;
      captive.hp = Math.round(captive.maxHp * 0.7);
      captive.x = captive.homeTx;
      captive.y = captive.homeTy;
      captive.targetPath = [];
      this.addFloatingText(captive.x, captive.y, 'PRIEST RESCUED!', '#38bdf8');
    }
    carrier.carryingPriestId = null;
    carrier.returningToAltar = false;
  }

  private damagePriest(p: Priest, amount: number, attacker: Owner): void {
    p.hp -= amount;
    p.hitFlash = 1;
    if (p.hp <= 0 && p.state === 'ACTIVE') {
      this.releaseCarriedPriest(p);
      p.hp = 0;
      p.state = 'STUNNED';
      p.stunTimer = 32;
      p.targetPath = [];
      p.captureTargetPriestId = null;
      p.returningToAltar = false;
      this.emitAudio({
        type: 'PRIEST_STUNNED',
        isPlayer: p.owner === 'PLAYER',
        tx: p.x,
        ty: p.y,
      });
      this.triggerShake(2.2, p.x, p.y);
      this.spawnBurst(p.x, p.y, '#fde047', 18, 65);
      this.addFloatingText(p.x, p.y, 'STUNNED!', '#fde047');

      if (p.isRogue) {
        this.pushAlert('Rogue Priest stunned! Send your High Priest to capture & bring them to your Altar!', 'SACRIFICE', 6.5);
      } else if (isAiFaction(p.owner)) {
        const label = this.state.factions[p.owner].label;
        this.pushAlert(
          `${label} High Priest stunned! Walk your High Priest over to capture & return to your Altar!`,
          'SACRIFICE',
          7.5
        );
      } else if (p.owner === 'PLAYER') {
        this.pushAlert('Your High Priest is stunned! Defend them from rival High Priests!', 'WARNING', 6.5);
      }

      // Attacking AI High Priest immediately evaluates marching out to capture if connected
      if (isAiFaction(attacker) && p.owner !== attacker) {
        this.dispatchHighPriestToCapture(attacker, p);
      }
      this.emitHud();
    }
  }

  private pickupStunnedPriest(carrier: Priest, captive: Priest): void {
    captive.state = 'CARRIED';
    captive.carriedByPriestId = carrier.id;
    carrier.carryingPriestId = captive.id;
    carrier.captureTargetPriestId = null;
    carrier.returningToAltar = true;

    const altar = this.state.structures.find((s) => s.owner === carrier.owner && s.kind === 'ALTAR');
    if (altar) {
      const path = findTilePath(this.state, carrier.x, carrier.y, altar.tx, altar.ty);
      if (path) carrier.targetPath = path;
    }

    const blastX = (carrier.x + captive.x) * 0.5;
    const blastY = (carrier.y + captive.y) * 0.5;
    const carrierColor = isFactionId(carrier.owner)
      ? this.state.factions[carrier.owner].color
      : '#f0b429';
    const captiveColor = captive.isRogue
      ? '#a855f7'
      : isFactionId(captive.owner)
        ? this.state.factions[captive.owner].color
        : '#f59e0b';
    const isHighPriest = !captive.isRogue;

    this.state.captureExplosions.push({
      x: blastX,
      y: blastY,
      primaryColor: carrierColor,
      secondaryColor: captiveColor,
      progress: 0,
      duration: isHighPriest ? 1.15 : 0.88,
      isHighPriest,
      seed: Math.random() * Math.PI * 2,
    });

    // Multi-layered golden-and-faction ember burst outward from capture detonation
    this.spawnBurst(blastX, blastY, '#fef08a', isHighPriest ? 26 : 16, isHighPriest ? 145 : 110);
    this.spawnBurst(blastX, blastY, carrierColor, isHighPriest ? 18 : 11, isHighPriest ? 115 : 90);
    this.spawnBurst(blastX, blastY, captiveColor, isHighPriest ? 14 : 9, isHighPriest ? 95 : 75);
    this.triggerShake(isHighPriest ? 5.2 : 3.2, blastX, blastY);

    this.addFloatingText(carrier.x, carrier.y, 'PRIEST CAPTURED!', '#fde047');
    this.emitAudio({
      type: 'PRIEST_CAPTURED',
      byPlayer: carrier.owner === 'PLAYER',
      tx: carrier.x,
      ty: carrier.y,
    });
    if (carrier.owner === 'PLAYER') {
      this.pushAlert('Your High Priest captured the bound Priest and is returning to your Altar!', 'SACRIFICE', 5.5);
    } else if (isAiFaction(carrier.owner)) {
      const carrierName = this.state.factions[carrier.owner].label;
      this.pushAlert(
        `Warning: ${carrierName} High Priest captured a Priest! Stun them or cut their bridge!`,
        'WARNING',
        6
      );
    }
    this.emitHud();
  }

  private updatePriests(dt: number): void {
    for (const p of this.state.priests) {
      if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt * 5);
      if (p.repathCooldown > 0) p.repathCooldown = Math.max(0, p.repathCooldown - dt);

      if (p.state === 'STUNNED') {
        p.stunTimer -= dt;
        if (p.stunTimer <= 0) {
          p.state = 'ACTIVE';
          p.hp = Math.round(p.maxHp * 0.65);
          this.addFloatingText(p.x, p.y, 'RECOVERED', '#cbd5e1');
        }
        continue;
      }

      if (p.state === 'SACRIFICING') {
        p.sacrificeTimer -= dt;
        if (p.sacrificeTimer <= 0) {
          this.completeSacrifice(p);
        }
        continue;
      }

      if (p.state !== 'ACTIVE') continue;

      // Passive self-heal when out of immediate combat
      if (p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + 3.2 * dt);
      }

      // High Priest Repair Aura for friendly structures within 2.5 tiles
      if (!p.isRogue) {
        for (const s of this.state.structures) {
          if (s.owner === p.owner && s.hp < s.maxHp && Math.hypot(s.tx - p.x, s.ty - p.y) <= 2.5) {
            s.hp = Math.min(s.maxHp, s.hp + 9 * dt);
          }
        }
      }

      // Move along current path (checks bridge integrity dynamically)
      if (p.targetPath.length > 0) {
        const next = p.targetPath[0];
        if (!isWalkable(this.state, next.x, next.y)) {
          p.targetPath = [];
        } else {
          const dx = next.x - p.x;
          const dy = next.y - p.y;
          const dist = Math.hypot(dx, dy);
          const speed = p.carryingPriestId !== null ? 2.4 : 2.85;
          if (dist <= speed * dt) {
            p.x = next.x;
            p.y = next.y;
            p.targetPath.shift();
          } else {
            p.x += (dx / dist) * speed * dt;
            p.y += (dy / dist) * speed * dt;
          }
        }
      }

      // High Priest Capture & Altar Delivery Logic (both Player and AI High Priests!)
      if (!p.isRogue && isFactionId(p.owner)) {
        const ownerId = p.owner;
        // A. Carrying a captured Priest -> deliver when arriving at own Altar!
        if (p.carryingPriestId !== null) {
          const altar = this.state.structures.find((s) => s.owner === ownerId && s.kind === 'ALTAR');
          const captive = this.state.priests.find((pr) => pr.id === p.carryingPriestId);
          if (!altar || !captive) {
            p.carryingPriestId = null;
            p.returningToAltar = false;
          } else if (Math.hypot(p.x - altar.tx, p.y - altar.ty) <= 1.35) {
            p.carryingPriestId = null;
            p.returningToAltar = false;
            p.targetPath = [];
            this.beginSacrifice(ownerId, captive, altar);
          } else if (p.targetPath.length === 0 && p.repathCooldown <= 0) {
            const path = findTilePath(this.state, p.x, p.y, altar.tx, altar.ty);
            if (path && path.length > 0) {
              p.targetPath = path;
              p.returningToAltar = true;
            }
            p.repathCooldown = 1.0;
          }
          continue;
        }

        // B. Proximity automatic pickup if High Priest walks right next to any stunned hostile/rogue Priest
        const nearbyStunned = this.state.priests.find(
          (other) =>
            other.id !== p.id &&
            other.state === 'STUNNED' &&
            other.owner !== ownerId &&
            Math.hypot(other.x - p.x, other.y - p.y) <= 1.2
        );
        if (nearbyStunned) {
          this.pickupStunnedPriest(p, nearbyStunned);
          continue;
        }

        // C. Active capture march toward a stunned target Priest
        if (p.captureTargetPriestId !== null) {
          const target = this.state.priests.find((pr) => pr.id === p.captureTargetPriestId);
          if (!target || target.state !== 'STUNNED') {
            p.captureTargetPriestId = null;
            p.targetPath = [];
          } else if (p.targetPath.length === 0 && p.repathCooldown <= 0) {
            const path = findTilePath(this.state, p.x, p.y, target.x, target.y);
            if (path && path.length > 0) {
              p.targetPath = path;
            } else {
              p.captureTargetPriestId = null;
            }
            p.repathCooldown = 1.1;
          }
          continue;
        }

        // D. AI High Priests autonomously check for reachable stunned Priests to capture (or return home if idle)
        if (isAiFaction(ownerId) && p.repathCooldown <= 0 && p.targetPath.length === 0) {
          const stunnedTarget = this.state.priests
            .filter((other) => other.state === 'STUNNED' && other.owner !== ownerId)
            .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
          if (stunnedTarget) {
            const path = findTilePath(this.state, p.x, p.y, stunnedTarget.x, stunnedTarget.y);
            if (path && path.length > 0) {
              p.captureTargetPriestId = stunnedTarget.id;
              p.targetPath = path;
              continue;
            }
          }
          if (Math.hypot(p.x - p.homeTx, p.y - p.homeTy) > 2.2) {
            const homePath = findTilePath(this.state, p.x, p.y, p.homeTx, p.homeTy);
            if (homePath && homePath.length > 0) p.targetPath = homePath;
          }
          p.repathCooldown = 1.5;
        }
      }
    }
  }

  private updateGolems(dt: number): void {
    for (const g of this.state.golems) {
      if (g.hitFlash > 0) g.hitFlash = Math.max(0, g.hitFlash - dt * 5);
      if (g.slowTimer > 0) g.slowTimer = Math.max(0, g.slowTimer - dt);
      if (g.repathCooldown > 0) g.repathCooldown = Math.max(0, g.repathCooldown - dt);

      const moveSpeed = g.speed * (g.slowTimer > 0 ? 0.5 : 1);

      // Step along current path
      if (g.path.length > 0) {
        const next = g.path[0];
        if (!isWalkable(this.state, next.x, next.y)) {
          g.path = [];
        } else {
          const dx = next.x - g.x;
          const dy = next.y - g.y;
          const dist = Math.hypot(dx, dy);
          g.walkPhase += dt * moveSpeed * 4.2;
          if (dist <= moveSpeed * dt) {
            g.x = next.x;
            g.y = next.y;
            g.path.shift();
          } else {
            g.x += (dx / dist) * moveSpeed * dt;
            g.y += (dy / dist) * moveSpeed * dt;
          }
          continue;
        }
      }

      if (g.task === 'RETURNING_CRYSTAL' && g.carryingCrystalValue > 0) {
        const temple = this.state.structures.find((s) => s.owner === g.owner && s.kind === 'TEMPLE');
        if (!temple) {
          g.task = 'IDLE';
          continue;
        }
        if (Math.hypot(g.x - temple.tx, g.y - temple.ty) <= 1.35) {
          if (isFactionId(g.owner)) {
            this.state.factions[g.owner].stormPower += g.carryingCrystalValue;
            this.state.factions[g.owner].crystalsHarvested += 1;
            this.emitAudio({
              type: 'CRYSTAL_HARVESTED',
              owner: g.owner,
              value: g.carryingCrystalValue,
              tx: temple.tx,
              ty: temple.ty,
            });
            if (g.owner === 'PLAYER') {
              this.addFloatingText(temple.tx, temple.ty, `+${g.carryingCrystalValue} AE`, '#facc15');
            }
          }
          g.carryingCrystalValue = 0;
          g.task = 'IDLE';
        } else if (g.repathCooldown <= 0) {
          const path = findTilePath(this.state, g.x, g.y, temple.tx, temple.ty);
          if (path) g.path = path;
          g.repathCooldown = 1.1;
        }
        continue;
      }

      if (g.task === 'HARVESTING' && g.targetCrystalId !== null) {
        const crystal = this.state.crystals.find((c) => c.id === g.targetCrystalId);
        if (!crystal) {
          g.task = 'IDLE';
          g.targetCrystalId = null;
          continue;
        }
        if (Math.hypot(g.x - crystal.tx, g.y - crystal.ty) <= 1.05) {
          g.carryingCrystalValue = crystal.value;
          g.targetCrystalId = null;
          g.task = 'RETURNING_CRYSTAL';
          this.state.crystals = this.state.crystals.filter((c) => c.id !== crystal.id);
          this.spawnBurst(crystal.tx, crystal.ty, '#fde047', 6, 35);
          this.emitAudio({
            type: 'CRYSTAL_PICKUP',
            owner: g.owner,
            value: crystal.value,
            tx: crystal.tx,
            ty: crystal.ty,
          });
          const temple = this.state.structures.find((s) => s.owner === g.owner && s.kind === 'TEMPLE');
          if (temple) {
            const path = findTilePath(this.state, g.x, g.y, temple.tx, temple.ty);
            if (path) g.path = path;
          }
        } else if (g.repathCooldown <= 0) {
          const path = findTilePath(this.state, g.x, g.y, crystal.tx, crystal.ty);
          if (path) g.path = path;
          else {
            crystal.claimedByGolemId = null;
            g.targetCrystalId = null;
            g.task = 'IDLE';
          }
          g.repathCooldown = 1.2;
        }
        continue;
      }

      // IDLE: Find nearest reachable unclaimed Aether Crystal
      if (g.repathCooldown > 0) continue;
      const candidates = this.state.crystals
        .filter((c) => c.spawnAnim >= 0.9 && (c.claimedByGolemId === null || c.claimedByGolemId === g.id))
        .map((c) => ({ c, dist: Math.hypot(c.tx - g.x, c.ty - g.y) }))
        .sort((a, b) => a.dist - b.dist);

      let found = false;
      for (const item of candidates.slice(0, 6)) {
        const path = findTilePath(this.state, g.x, g.y, item.c.tx, item.c.ty);
        if (path) {
          item.c.claimedByGolemId = g.id;
          g.task = 'HARVESTING';
          g.targetCrystalId = item.c.id;
          g.path = path;
          found = true;
          break;
        }
      }
      if (!found) {
        g.repathCooldown = 1.4;
      }
    }
  }

  private dispatchHighPriestToCapture(owner: FactionId, targetPriest: Priest): boolean {
    const highPriest = this.state.priests.find(
      (p) => p.owner === owner && !p.isRogue && p.state === 'ACTIVE' && p.carryingPriestId === null
    );
    if (!highPriest) return false;

    const path = findTilePath(this.state, highPriest.x, highPriest.y, targetPriest.x, targetPriest.y);
    if (!path) return false;

    highPriest.captureTargetPriestId = targetPriest.id;
    highPriest.returningToAltar = false;
    highPriest.targetPath = path;
    return true;
  }

  private beginSacrifice(sacrificer: FactionId, priest: Priest, altar: Structure): void {
    priest.state = 'SACRIFICING';
    priest.x = altar.tx;
    priest.y = altar.ty;
    priest.sacrificeTimer = 2.0;
    priest.sacrificedBy = sacrificer;

    const isGrand = !priest.isRogue;
    const sacFury = this.state.factions[sacrificer].fury;
    this.state.sacrificeBeams.push({
      tx: altar.tx,
      ty: altar.ty,
      fury: sacFury,
      progress: 0,
      duration: 2.1,
      isVictory: isGrand,
      owner: sacrificer,
    });

    this.emitAudio({
      type: 'SACRIFICE_BEGUN',
      fury: sacFury,
      isGrand,
      tx: altar.tx,
      ty: altar.ty,
    });
    this.triggerShake(isGrand ? 5.2 : 3.2, altar.tx, altar.ty);
    this.hitstopTimer = 0.045;
    this.spawnBurst(altar.tx, altar.ty, '#fde047', 30, 95);

    const victimName =
      priest.owner === 'PLAYER'
        ? 'your High Priest'
        : isAiFaction(priest.owner)
          ? `the ${this.state.factions[priest.owner].label} High Priest`
          : 'a Rogue Priest';

    if (sacrificer === 'PLAYER') {
      this.focusOnTile(altar.tx, altar.ty);
      this.pushAlert(
        isGrand
          ? `Invoking the Grand Sacrifice of ${victimName}!`
          : 'Altar Ritual invoked! Elemental mastery ascending...',
        'SACRIFICE',
        4
      );
    } else {
      const sacName = this.state.factions[sacrificer].label;
      this.pushAlert(
        isGrand
          ? `${sacName} High Priest is sacrificing ${victimName}!`
          : `${sacName} Rival completed an Altar Sacrifice and unlocked Tier-2 units!`,
        'WARNING',
        5
      );
    }
    this.emitHud();
  }

  private completeSacrifice(priest: Priest): void {
    priest.state = 'SACRIFICED';
    const sacrificer = priest.sacrificedBy;
    if (!sacrificer || !isFactionId(sacrificer)) return;

    const faction = this.state.factions[sacrificer];
    faction.sacrificesCompleted += 1;

    if (priest.isRogue) {
      const unlockedTier2 = faction.knowledgeTier < 2;
      faction.knowledgeTier = 2;
      faction.stormPower += 120;
      const tier2Name = STRUCTURE_CATALOG[FURY_META[faction.fury].tier2Unit].name;
      if (sacrificer === 'PLAYER') {
        this.addFloatingText(
          priest.x,
          priest.y,
          unlockedTier2 ? `${tier2Name.toUpperCase()} UNLOCKED!` : '+120 AE',
          '#fde047'
        );
        this.pushAlert(
          unlockedTier2
            ? `Altar Ritual complete! ${tier2Name} unlocked (+120 Aether).`
            : 'Altar Ritual complete! +120 Aether granted.',
          'SACRIFICE',
          6
        );
      }
      this.emitHud();
      return;
    }

    // Grand Sacrifice of a High Priest!
    if (priest.owner === 'PLAYER') {
      this.outcomeReason = 'PRIEST_SACRIFICE';
      this.phase = 'DEFEAT';
      this.audio.setAmbience(false, this.state.factions.PLAYER.fury);
      this.syncMusicState();
      this.emitAudio({ type: 'DEFEAT' });
      this.heldKeys.clear();
      this.emitHud();
      return;
    }

    if (isAiFaction(priest.owner)) {
      this.eliminateAiFaction(priest.owner, sacrificer, 'SACRIFICE', priest.x, priest.y);
    }
  }

  private eliminateAiFaction(
    victimId: AiFactionId,
    eliminator: Owner,
    cause: 'SACRIFICE' | 'TEMPLE',
    fxX: number,
    fxY: number
  ): void {
    const victimFaction = this.state.factions[victimId];
    if (!victimFaction || victimFaction.eliminated) return;
    victimFaction.eliminated = true;

    // Unlock Tier-2 mastery for the conquering faction if not yet unlocked
    let unlockedTier2 = false;
    let tier2Name = '';
    if (isFactionId(eliminator)) {
      const winnerFaction = this.state.factions[eliminator];
      if (winnerFaction) {
        unlockedTier2 = winnerFaction.knowledgeTier < 2;
        winnerFaction.knowledgeTier = 2;
        tier2Name = STRUCTURE_CATALOG[FURY_META[winnerFaction.fury].tier2Unit].name;
      }
    }

    // Remove defeated rival's Golems, release any captive they held, and dismiss their High Priest cleanly
    this.state.golems = this.state.golems.filter((g) => g.owner !== victimId);
    for (const p of this.state.priests) {
      if (p.owner === victimId && !p.isRogue) {
        this.releaseCarriedPriest(p);
        // If another High Priest was carrying this rival Priest when their Temple fell, clear the carry link
        if (p.carriedByPriestId !== null) {
          const carrier = this.state.priests.find((c) => c.id === p.carriedByPriestId);
          if (carrier && carrier.carryingPriestId === p.id) {
            carrier.carryingPriestId = null;
            carrier.returningToAltar = false;
            carrier.targetPath = [];
          }
          p.carriedByPriestId = null;
        }
        p.state = 'SACRIFICED';
      }
    }

    const victimTemple = this.state.structures.find((s) => s.owner === victimId && s.kind === 'TEMPLE');
    if (victimTemple) {
      this.spawnBurst(victimTemple.tx, victimTemple.ty, victimFaction.color, 24, 90);
    }
    recomputePowerGrids(this.state);

    const remainingRivals = this.state.aiFactionIds.filter(
      (id) => !this.state.factions[id].eliminated
    ).length;

    if (remainingRivals === 0) {
      this.outcomeReason = cause === 'TEMPLE' ? 'TEMPLE_DESTRUCTION' : 'PRIEST_SACRIFICE';
      this.phase = 'VICTORY';
      this.audio.setAmbience(false, this.state.factions.PLAYER.fury);
      this.syncMusicState();
      this.emitAudio({ type: 'VICTORY' });
      this.recordLocalVictory();
      this.heldKeys.clear();
    } else {
      if (isFactionId(eliminator)) {
        this.state.factions[eliminator].stormPower += 150;
      }
      const actionVerb = cause === 'TEMPLE' ? 'High Temple shattered' : 'High Priest sacrificed';
      if (eliminator === 'PLAYER') {
        this.addFloatingText(
          fxX,
          fxY,
          unlockedTier2
            ? `${tier2Name.toUpperCase()} UNLOCKED! +150 AE`
            : `${victimFaction.label.toUpperCase()} FALLEN! +150 AE`,
          '#fde047'
        );
      }
      this.pushAlert(
        unlockedTier2 && eliminator === 'PLAYER'
          ? `${victimFaction.label} ${actionVerb}! ${tier2Name} unlocked (+150 AE). ${remainingRivals} rival${remainingRivals === 1 ? '' : 's'} remain.`
          : `${victimFaction.label} ${actionVerb}! ${remainingRivals} rival${remainingRivals === 1 ? '' : 's'} remain.`,
        'SACRIFICE',
        6.5
      );
    }
    this.emitHud();
  }

  private updateVictoryConditions(dt: number): void {
    const state = this.state;
    const rules = this.victoryRules;
    const totalSites = state.sacredSites.length;
    const requiredSites = getRequiredSacredSites(totalSites);

    // 1 & 2. Altar Dominance (only evaluated when enabled and not yet completed for continued play)
    if (rules.altarDominance && !this.achievedAltVictories.has('ALTAR_DOMINANCE')) {
      for (const site of state.sacredSites) {
        const island = state.islands.find((isl) => isl.id === site.islandId);
        if (!island) continue;

        const tileSet = new Set(island.tiles.map((pt) => `${pt.x},${pt.y}`));
        const guardedByNeutral = state.structures.some(
          (s) => s.owner === 'NEUTRAL' && tileSet.has(`${s.tx},${s.ty}`)
        );
        site.guardedByNeutral = guardedByNeutral;

        const poweringFactions: FactionId[] = [];
        for (const id of state.activeFactionIds) {
          if (state.factions[id].eliminated) continue;
          if (island.tiles.some((pt) => isTilePoweredBy(state, pt.x, pt.y, id))) {
            poweringFactions.push(id);
          }
        }

        const prevController = site.controller;
        if (guardedByNeutral) {
          site.controller = null;
          site.contested = poweringFactions.length > 0;
        } else if (poweringFactions.length === 1) {
          site.controller = poweringFactions[0];
          site.contested = false;
        } else if (poweringFactions.length > 1) {
          site.controller = null;
          site.contested = true;
        } else {
          site.controller = null;
          site.contested = false;
        }

        if (site.controller !== prevController && site.controller !== null) {
          const col = this.getFactionColor(site.controller);
          this.spawnBurst(site.tx, site.ty, col, 14, 65);
          if (site.controller === 'PLAYER') {
            this.addFloatingText(site.tx, site.ty, `${site.name.toUpperCase()} CLAIMED`, '#fde047');
          }
        }
      }

      for (const id of state.activeFactionIds) {
        const faction = state.factions[id];
        if (!faction || faction.eliminated) {
          if (faction) faction.dominanceSeconds = 0;
          continue;
        }

        const controlled = state.sacredSites.filter((s) => s.controller === id).length;
        if (totalSites > 0 && controlled >= requiredSites) {
          faction.dominanceSeconds = Math.min(ALTAR_DOMINANCE_DURATION, faction.dominanceSeconds + dt);
          const ratio = faction.dominanceSeconds / ALTAR_DOMINANCE_DURATION;
          const remaining = Math.max(1, Math.ceil(ALTAR_DOMINANCE_DURATION - faction.dominanceSeconds));

          if (ratio >= 0.8 && !this.dominanceWarned80.has(id)) {
            this.dominanceWarned80.add(id);
            this.pushAlert(
              id === 'PLAYER'
                ? `Altar Dominance at 80% — hold your ${controlled} sacred sites for ${remaining}s to win!`
                : `${this.getFactionLabel(id)} nears Altar Dominance (${remaining}s left)! Sever their bridges to the central sites!`,
              id === 'PLAYER' ? 'SACRIFICE' : 'WARNING',
              6
            );
          } else if (ratio >= 0.5 && !this.dominanceWarned50.has(id)) {
            this.dominanceWarned50.add(id);
            this.pushAlert(
              id === 'PLAYER'
                ? `Altar Dominance halfway! Hold ${requiredSites}/${totalSites} sacred sites for ${remaining}s.`
                : `${this.getFactionLabel(id)} holds ${controlled}/${totalSites} sacred sites (${remaining}s to Altar Dominance)!`,
              id === 'PLAYER' ? 'INFO' : 'WARNING',
              5.5
            );
          }

          if (faction.dominanceSeconds >= ALTAR_DOMINANCE_DURATION) {
            for (const s of state.sacredSites) {
              if (s.controller === id) {
                this.state.sacrificeBeams.push({
                  tx: s.tx,
                  ty: s.ty,
                  fury: faction.fury,
                  progress: 0,
                  duration: 2.2,
                  isVictory: true,
                  owner: id,
                });
                this.spawnBurst(s.tx, s.ty, faction.color, 20, 95);
              }
            }
            this.finishAlternativeVictory(id, 'ALTAR_DOMINANCE');
            return;
          }
        } else {
          faction.dominanceSeconds = Math.max(0, faction.dominanceSeconds - dt * 0.45);
          if (faction.dominanceSeconds < ALTAR_DOMINANCE_DURATION * 0.35) {
            this.dominanceWarned50.delete(id);
          }
          if (faction.dominanceSeconds < ALTAR_DOMINANCE_DURATION * 0.65) {
            this.dominanceWarned80.delete(id);
          }
        }
      }
    }

    // 3. Evaluate Aether Overload (crystal energy hoarding victory)
    if (rules.aetherOverload && !this.achievedAltVictories.has('AETHER_OVERLOAD')) {
      const target = rules.aetherOverloadTarget || AETHER_OVERLOAD_TARGET;
      for (const id of state.activeFactionIds) {
        const faction = state.factions[id];
        if (!faction || faction.eliminated) continue;
        const ratio = faction.stormPower / target;

        if (ratio >= 0.9 && !this.overloadWarned90.has(id)) {
          this.overloadWarned90.add(id);
          this.pushAlert(
            id === 'PLAYER'
              ? `Aether Overload imminent (${Math.floor(faction.stormPower).toLocaleString()}/${target.toLocaleString()} AE)!`
              : `${this.getFactionLabel(id)} is nearing Aether Overload (${Math.floor(faction.stormPower).toLocaleString()}/${target.toLocaleString()} AE)!`,
            id === 'PLAYER' ? 'SACRIFICE' : 'WARNING',
            6
          );
        } else if (ratio >= 0.7 && !this.overloadWarned70.has(id)) {
          this.overloadWarned70.add(id);
          this.pushAlert(
            id === 'PLAYER'
              ? `Aether reserves surging (${Math.floor(faction.stormPower).toLocaleString()}/${target.toLocaleString()} AE) — hold to trigger Aether Overload!`
              : `${this.getFactionLabel(id)} is hoarding Aether (${Math.floor(faction.stormPower).toLocaleString()}/${target.toLocaleString()} AE)!`,
            id === 'PLAYER' ? 'INFO' : 'WARNING',
            5.5
          );
        } else if (ratio < 0.6) {
          this.overloadWarned70.delete(id);
          this.overloadWarned90.delete(id);
        } else if (ratio < 0.8) {
          this.overloadWarned90.delete(id);
        }

        if (faction.stormPower >= target) {
          const temple = state.structures.find((s) => s.owner === id && s.kind === 'TEMPLE');
          if (temple) {
            this.state.sacrificeBeams.push({
              tx: temple.tx,
              ty: temple.ty,
              fury: faction.fury,
              progress: 0,
              duration: 2.4,
              isVictory: true,
              owner: id,
            });
            this.spawnBurst(temple.tx, temple.ty, '#fde047', 28, 110);
          }
          this.finishAlternativeVictory(id, 'AETHER_OVERLOAD');
          return;
        }
      }
    }
  }

  private finishAlternativeVictory(winner: FactionId, reason: 'AETHER_OVERLOAD' | 'ALTAR_DOMINANCE'): void {
    this.outcomeReason = reason;
    this.winnerLabel = this.getFactionLabel(winner);
    this.audio.setAmbience(false, this.state.factions.PLAYER.fury);
    this.heldKeys.clear();
    if (winner === 'PLAYER') {
      this.achievedAltVictories.add(reason);
      this.phase = 'VICTORY';
      this.syncMusicState();
      this.emitAudio({ type: 'VICTORY' });
      this.recordLocalVictory();
    } else {
      this.phase = 'DEFEAT';
      this.syncMusicState();
      this.emitAudio({ type: 'DEFEAT' });
    }
    this.emitHud();
  }

  private recordLocalVictory(): void {
    try {
      const key = 'aether_isles_skirmish_wins';
      const prev = Number(localStorage.getItem(key) || '0');
      localStorage.setItem(key, String(prev + 1));
    } catch {
      // Ignore storage failures
    }
  }

  private updateEffects(dt: number): void {
    // Lightning arcs
    this.state.lightningArcs = this.state.lightningArcs.filter((arc) => {
      arc.life -= dt;
      return arc.life > 0;
    });

    // Sacrifice beams
    this.state.sacrificeBeams = this.state.sacrificeBeams.filter((beam) => {
      beam.progress += dt / beam.duration;
      return beam.progress < 1;
    });

    // High Priest capture explosions
    this.state.captureExplosions = this.state.captureExplosions.filter((exp) => {
      exp.progress += dt / exp.duration;
      return exp.progress < 1;
    });

    // Elemental impact decals, build snaps & stone crumble effects
    this.state.impactEffects = this.state.impactEffects.filter((fx) => {
      fx.progress += dt / fx.duration;
      return fx.progress < 1;
    });

    // Pooled particles
    for (const pt of this.state.particles) {
      if (!pt.active) continue;
      pt.life -= dt;
      if (pt.life <= 0) {
        pt.active = false;
        continue;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vz -= pt.gravity * dt;
      pt.z = Math.max(0, pt.z + pt.vz * dt);
    }

    // Floating combat/gain texts
    this.state.floatingTexts = this.state.floatingTexts.filter((ft) => {
      ft.life -= dt;
      return ft.life > 0;
    });
  }

  private spawnBurst(tx: number, ty: number, color: string, count: number, liftSpeed: number): void {
    let spawned = 0;
    for (const pt of this.state.particles) {
      if (pt.active) continue;
      const ang = Math.random() * Math.PI * 2;
      const spd = 0.6 + Math.random() * 2.2;
      pt.active = true;
      pt.x = tx;
      pt.y = ty;
      pt.z = 8 + Math.random() * 10;
      pt.vx = Math.cos(ang) * spd;
      pt.vy = Math.sin(ang) * spd;
      pt.vz = liftSpeed * (0.4 + Math.random() * 0.7);
      pt.gravity = 135;
      pt.size = 2.2 + Math.random() * 2.8;
      pt.color = color;
      pt.alpha = 0.95;
      pt.maxLife = 0.35 + Math.random() * 0.38;
      pt.life = pt.maxLife;
      spawned++;
      if (spawned >= count) break;
    }
  }

  private spawnImpact(
    x: number,
    y: number,
    kind: ImpactEffectKind,
    color: string,
    duration: number,
    scale = 1
  ): void {
    if (this.state.impactEffects.length >= 48) {
      this.state.impactEffects.shift();
    }
    this.state.impactEffects.push({
      x,
      y,
      kind,
      color,
      progress: 0,
      duration,
      scale,
      seed: Math.random() * Math.PI * 2,
    });
  }

  private addFloatingText(x: number, y: number, text: string, color: string): void {
    this.state.floatingTexts.push({
      x,
      y,
      text,
      color,
      life: 1.4,
      maxLife: 1.4,
    });
  }

  private pushAlert(text: string, tone: 'INFO' | 'WARNING' | 'SACRIFICE', duration: number): void {
    this.alertBanner = { text, tone, timer: duration };
  }

  private render(): void {
    renderWorld(this.ctx, this.viewW, this.viewH, this.state, {
      camera: this.camera,
      hoverTile: this.hoverTile,
      placement: this.placement,
      selectedId: this.selectedId,
      selectedKind: this.selectedKind,
      hoveredId: this.hoveredId,
      hoveredKind: this.hoveredKind,
      rangeOverlay: this.rangeOverlay,
      time: this.animTime,
    });

    if (this.minimapCanvas && this.minimapCtx && this.phase !== 'TITLE_MENU') {
      if (this.minimapFrameCounter === 0) {
        renderMinimap(
          this.minimapCtx,
          this.minimapCanvas.width,
          this.minimapCanvas.height,
          this.state,
          this.camera,
          this.viewW,
          this.viewH
        );
      }
      this.minimapFrameCounter = (this.minimapFrameCounter + 1) % 4;
    }
  }

  private getFactionLabel(owner: Owner): string {
    if (owner === 'PLAYER') return 'Allied';
    if (owner === 'NEUTRAL') return 'Shrine';
    const f = this.state.factions[owner];
    return this.state.opponentCount > 1 ? `${f.label} Rival` : 'Enemy';
  }

  private getFactionColor(owner: Owner): string {
    if (owner === 'NEUTRAL') return '#f0b429';
    return this.state.factions[owner]?.color ?? '#ef4444';
  }

  private buildSelectedInspect(): SelectedInspect | null {
    if (this.selectedKind === null || this.selectedId === null) return null;

    if (this.selectedKind === 'STRUCTURE') {
      const s = this.state.structures.find((st) => st.id === this.selectedId);
      if (!s) return null;
      const def = STRUCTURE_CATALOG[s.kind];
      return {
        kind: 'STRUCTURE',
        id: s.id,
        title: def.name,
        subtitle:
          s.owner === 'PLAYER'
            ? 'Allied Structure'
            : isAiFaction(s.owner)
              ? `${this.state.factions[s.owner].label} Structure`
              : 'Shrine Guardian',
        owner: s.owner,
        factionColor: this.getFactionColor(s.owner),
        hp: Math.ceil(s.hp),
        maxHp: s.maxHp,
        powered: s.powered,
        statusText: s.powered ? 'Powered · Operational' : 'Unpowered · Reconnect Bridge',
      };
    }

    if (this.selectedKind === 'PRIEST') {
      const p = this.state.priests.find((pr) => pr.id === this.selectedId);
      if (!p) return null;
      const priestTitle = p.isRogue
        ? 'Rogue Priest'
        : p.owner === 'PLAYER'
          ? 'Your High Priest'
          : isAiFaction(p.owner)
            ? `${this.state.factions[p.owner].label} High Priest`
            : 'Rival High Priest';
      return {
        kind: 'PRIEST',
        id: p.id,
        title: priestTitle,
        subtitle: p.isRogue
          ? 'Shrine Ritual unlocks Tier-2 unit'
          : p.owner === 'PLAYER'
            ? 'Click ground to walk · Walk to stunned Priests to capture them'
            : 'Stun & send your High Priest to bring them to your Altar',
        owner: p.owner,
        factionColor: p.isRogue ? '#c084fc' : this.getFactionColor(p.owner),
        hp: Math.ceil(p.hp),
        maxHp: p.maxHp,
        statusText:
          p.state === 'STUNNED'
            ? `Stunned (${Math.ceil(p.stunTimer)}s) · Walk your High Priest over to capture`
            : p.state === 'CARRIED'
              ? 'Bound & Carried toward Altar'
              : p.carryingPriestId !== null
                ? 'Carrying Captured Priest to Altar'
                : p.captureTargetPriestId !== null
                  ? 'Marching to Capture Stunned Priest'
                  : 'Active · Channeling Aura',
        canCommandCapture: p.state === 'STUNNED' && p.owner !== 'PLAYER',
      };
    }

    if (this.selectedKind === 'GOLEM') {
      const g = this.state.golems.find((go) => go.id === this.selectedId);
      if (!g) return null;
      return {
        kind: 'GOLEM',
        id: g.id,
        title:
          g.owner === 'PLAYER'
            ? 'Allied Aether Golem'
            : isAiFaction(g.owner)
              ? `${this.state.factions[g.owner].label} Aether Golem`
              : 'Rival Aether Golem',
        subtitle: 'Aether Crystal Harvester',
        owner: g.owner,
        factionColor: this.getFactionColor(g.owner),
        hp: Math.ceil(g.hp),
        maxHp: g.maxHp,
        statusText:
          g.task === 'RETURNING_CRYSTAL'
            ? `Returning +${g.carryingCrystalValue} AE Crystal`
            : g.task === 'HARVESTING'
              ? 'Harvesting Aether Crystal'
              : 'Scanning Connected Islands',
      };
    }

    if (this.selectedKind === 'GEYSER') {
      const g = this.state.geysers.find((ge) => ge.id === this.selectedId);
      if (!g) return null;
      return {
        kind: 'GEYSER',
        id: g.id,
        title: g.isSuper ? 'Rich Aether Vent' : 'Aether Vent',
        subtitle: 'Erupts Aether Crystals for Golems',
        owner: 'NEUTRAL',
        factionColor: '#f0b429',
        hp: 100,
        maxHp: 100,
        statusText: g.isSuper ? 'High Yield · +65 AE Crystals' : 'Standard Yield · +50 AE Crystals',
      };
    }

    return null;
  }

  private describeStructureObjective(s: Structure): string {
    const def = STRUCTURE_CATALOG[s.kind];

    if (!s.powered && s.owner !== 'NEUTRAL') {
      return 'Offline — reconnect bridge to High Temple';
    }

    if (s.kind === 'TEMPLE') {
      if (!this.victoryRules.templeDestruction) {
        return 'Sanctified Aether core — protected by ancient ward (Temple Siege disabled)';
      }
      return s.owner === 'PLAYER'
        ? 'Projecting Aether grid & receiving Crystals — defend from rival siege!'
        : 'Rival Aether core — shatter this High Temple to eliminate their faction!';
    }
    if (s.kind === 'ALTAR') {
      const activeSacrifice = this.state.priests.find(
        (p) => p.state === 'SACRIFICING' && Math.hypot(p.x - s.tx, p.y - s.ty) <= 1.5
      );
      if (activeSacrifice) {
        return activeSacrifice.isRogue
          ? 'Channeling Rogue Priest Ritual (Tier-2 Unlock)'
          : 'Channeling Grand Priest Ritual!';
      }
      return 'Awaiting captured Priest from High Priest';
    }
    if (s.kind === 'WINDMILL') {
      return `Generating +${def.passiveIncome ?? 4.5} Aether/sec`;
    }
    if (s.kind === 'STONE_BLOCKER') {
      return 'Intercepting hostile directional bolts & shells';
    }
    if (s.kind === 'FROST_BLOCKER') {
      const chilling = this.state.golems.some(
        (g) => g.owner !== s.owner && Math.hypot(g.x - s.tx, g.y - s.ty) <= (def.slowAuraRadius ?? 3.5)
      );
      return chilling
        ? 'Blocking lane fire & chilling enemy Golems'
        : 'Blocking lane fire & regenerating glacial armor';
    }

    const target = this.acquireTargetForStructure(s);
    if (target) {
      if (target.entityType === 'PRIEST') {
        const p = this.state.priests.find((pr) => pr.id === target.id);
        if (p?.isRogue) return 'Firing on Rogue Priest';
        if (p?.carryingPriestId !== null) return 'Intercepting Priest-carrying High Priest!';
        return p?.owner === 'PLAYER' ? 'Targeting Your High Priest!' : 'Targeting Rival High Priest';
      }
      if (target.entityType === 'GOLEM') {
        return 'Engaging hostile Aether Golem';
      }
      if (target.entityType === 'STRUCTURE') {
        const st = this.state.structures.find((x) => x.id === target.id);
        return st ? `Firing on ${STRUCTURE_CATALOG[st.kind].name}` : 'Firing on enemy structure';
      }
      if (target.entityType === 'BRIDGE') {
        return 'Cutting hostile sky-bridge';
      }
    }

    return def.directional
      ? `Guarding ${directionLabel(s.facing)} lane — awaiting target`
      : 'Guarding perimeter — awaiting target';
  }

  private buildHoveredInspect(): HoverInspect | null {
    if (this.phase !== 'PLAYING' || this.hoveredKind === null || this.hoveredId === null) return null;

    if (this.hoveredKind === 'STRUCTURE') {
      const s = this.state.structures.find((st) => st.id === this.hoveredId);
      if (!s) return null;
      const def = STRUCTURE_CATALOG[s.kind];
      const iso = tileToIso(s.tx, s.ty);
      const pos = worldToScreen(iso.x, iso.y, this.camera, this.viewW, this.viewH);

      let rangeLabel = 'None';
      if (def.range > 0) {
        rangeLabel = def.directional
          ? `${def.range} tiles · Lane (${directionLabel(s.facing)})`
          : `${def.range} tiles · 360°`;
      } else if (def.slowAuraRadius) {
        rangeLabel = `${def.slowAuraRadius} tiles · Chill Aura`;
      }

      let combatStats: string | undefined;
      if (def.fireRate > 0) {
        const traits: string[] = [`${def.damage} dmg`, `${def.fireRate.toFixed(2)}/s`];
        if (def.chainCount) traits.push(`${def.chainCount}× Chain`);
        if (def.splashRadius) traits.push(`Splash ${def.splashRadius}`);
        if (def.pierceCount) traits.push(`Pierces ${def.pierceCount}`);
        combatStats = traits.join(' · ');
      } else if (def.regenPerSec) {
        combatStats = `Regen +${def.regenPerSec} HP/s`;
      } else if (def.passiveIncome) {
        combatStats = `+${def.passiveIncome} AE/s`;
      }

      return {
        kind: 'STRUCTURE',
        id: s.id,
        title: def.name,
        factionLabel: this.getFactionLabel(s.owner),
        factionColor: this.getFactionColor(s.owner),
        owner: s.owner,
        hp: Math.ceil(s.hp),
        maxHp: s.maxHp,
        rangeLabel,
        combatStats,
        objective: this.describeStructureObjective(s),
        powered: s.owner === 'NEUTRAL' ? true : s.powered,
        screenX: pos.sx,
        screenY: pos.sy,
      };
    }

    if (this.hoveredKind === 'PRIEST') {
      const p = this.state.priests.find((pr) => pr.id === this.hoveredId);
      if (!p || p.state === 'SACRIFICED' || p.state === 'CARRIED') return null;
      const iso = tileToIso(p.x, p.y);
      const pos = worldToScreen(iso.x, iso.y, this.camera, this.viewW, this.viewH);

      let objective = 'Channeling 2.2-tile structure repair aura';
      if (p.state === 'STUNNED') {
        objective = `Stunned (${Math.ceil(p.stunTimer)}s) — walk your High Priest here to capture`;
      } else if (p.state === 'SACRIFICING') {
        objective = 'Being bound at the Altar!';
      } else if (p.isRogue) {
        objective = 'Guarding Shrine Isle (Altar Ritual unlocks Tier-2 unit)';
      } else if (p.carryingPriestId !== null) {
        const captive = this.state.priests.find((pr) => pr.id === p.carryingPriestId);
        const label = captive?.isRogue
          ? 'Rogue Priest'
          : captive?.owner === 'PLAYER'
            ? 'Your High Priest'
            : captive && isAiFaction(captive.owner)
              ? `${this.state.factions[captive.owner].label} High Priest`
              : 'Rival High Priest';
        objective = `Carrying bound ${label} back to Altar`;
      } else if (p.captureTargetPriestId !== null) {
        const target = this.state.priests.find((pr) => pr.id === p.captureTargetPriestId);
        const label = target?.isRogue
          ? 'Rogue Priest'
          : target?.owner === 'PLAYER'
            ? 'Your High Priest'
            : target && isAiFaction(target.owner)
              ? `${this.state.factions[target.owner].label} High Priest`
              : 'Rival High Priest';
        objective = `Walking to capture stunned ${label}`;
      } else if (p.targetPath.length > 0) {
        objective = 'Walking across connected sky-islands';
      }

      const title = p.isRogue
        ? 'Rogue Priest'
        : p.owner === 'PLAYER'
          ? 'Your High Priest'
          : isAiFaction(p.owner)
            ? `${this.state.factions[p.owner].label} High Priest`
            : 'Enemy High Priest';

      return {
        kind: 'PRIEST',
        id: p.id,
        title,
        factionLabel: p.isRogue ? 'Neutral' : this.getFactionLabel(p.owner),
        factionColor: p.isRogue ? '#c084fc' : this.getFactionColor(p.owner),
        owner: p.owner,
        hp: Math.ceil(p.hp),
        maxHp: p.maxHp,
        rangeLabel: p.isRogue ? 'No Attack · Shrine Relic' : '2.2 tiles · Repair Aura & Priest Capture',
        combatStats: p.isRogue ? undefined : '+9 HP/s repair · Captures stunned Priests',
        objective,
        screenX: pos.sx,
        screenY: pos.sy,
      };
    }

    if (this.hoveredKind === 'GOLEM') {
      const g = this.state.golems.find((go) => go.id === this.hoveredId);
      if (!g) return null;
      const iso = tileToIso(g.x, g.y);
      const pos = worldToScreen(iso.x, iso.y, this.camera, this.viewW, this.viewH);

      let objective = 'Scanning connected islands for Aether Crystals';
      if (g.task === 'RETURNING_CRYSTAL') {
        objective = `Returning +${g.carryingCrystalValue} AE Crystal to Temple`;
      } else if (g.task === 'HARVESTING') {
        objective = 'Moving to harvest Aether Crystal';
      }

      return {
        kind: 'GOLEM',
        id: g.id,
        title:
          g.owner === 'PLAYER'
            ? 'Allied Aether Golem'
            : isAiFaction(g.owner)
              ? `${this.state.factions[g.owner].label} Aether Golem`
              : 'Enemy Aether Golem',
        factionLabel: this.getFactionLabel(g.owner),
        factionColor: this.getFactionColor(g.owner),
        owner: g.owner,
        hp: Math.ceil(g.hp),
        maxHp: g.maxHp,
        rangeLabel: 'Harvester · Aether Crystals',
        combatStats: g.slowTimer > 0 ? 'Chilled (50% speed)' : `Speed ${g.speed.toFixed(1)} tiles/s`,
        objective,
        screenX: pos.sx,
        screenY: pos.sy,
      };
    }

    if (this.hoveredKind === 'GEYSER') {
      const g = this.state.geysers.find((ge) => ge.id === this.hoveredId);
      if (!g) return null;
      const iso = tileToIso(g.tx, g.ty);
      const pos = worldToScreen(iso.x, iso.y, this.camera, this.viewW, this.viewH);
      const nextSec = Math.max(1, Math.ceil(g.eruptTimer));

      return {
        kind: 'GEYSER',
        id: g.id,
        title: g.isSuper ? 'Rich Aether Vent' : 'Aether Vent',
        factionLabel: 'Resource',
        factionColor: '#f0b429',
        owner: 'NEUTRAL',
        hp: 100,
        maxHp: 100,
        rangeLabel: 'Resource Vent · No Attack',
        combatStats: g.isSuper ? '+65 AE per Crystal' : '+50 AE per Crystal',
        objective: `Erupting next Aether Crystal in ${nextSec}s`,
        screenX: pos.sx,
        screenY: pos.sy,
      };
    }

    return null;
  }

  private emitHud(): void {
    const pf = this.state.factions.PLAYER;
    const primaryAiId = this.state.aiFactionIds[0] ?? 'AI_1';
    const af = this.state.factions[primaryAiId];
    const playerGolems = this.state.golems.filter((g) => g.owner === 'PLAYER').length;
    const connected = countConnectedIslands(this.state, 'PLAYER');

    const playerPriest = this.state.priests.find((p) => p.owner === 'PLAYER');

    const rivals: RivalHudSummary[] = this.state.aiFactionIds.map((aiId) => {
      const f = this.state.factions[aiId];
      const priest = this.state.priests.find((p) => p.owner === aiId && !p.isRogue);
      return {
        id: aiId,
        label: f.label,
        color: f.color,
        fury: f.fury,
        hp: Math.ceil(priest?.hp ?? 0),
        maxHp: priest?.maxHp ?? 240,
        state: priest?.state ?? (f.eliminated ? 'SACRIFICED' : 'ACTIVE'),
        eliminated: f.eliminated,
      };
    });

    const rivalsEliminated = rivals.filter((r) => r.eliminated).length;
    const primaryRival = rivals[0];

    const stunnedTargets = this.state.priests
      .filter((p) => p.state === 'STUNNED' && p.owner !== 'PLAYER')
      .map((p) => ({
        priestId: p.id,
        label: p.isRogue
          ? 'Rogue Priest'
          : isAiFaction(p.owner)
            ? `${this.state.factions[p.owner].label} High Priest`
            : 'Enemy High Priest',
        x: p.x,
        y: p.y,
        isEnemyHighPriest: !p.isRogue,
        stunRemaining: Math.ceil(p.stunTimer),
      }));

    const totalSites = this.state.sacredSites.length;
    const requiredSites = getRequiredSacredSites(totalSites);
    const playerControlledSites = this.state.sacredSites.filter((s) => s.controller === 'PLAYER').length;

    let leadingOverloadOwner: FactionId = 'PLAYER';
    let leadingOverloadAether = Math.floor(pf.stormPower);
    let dominanceLeaderOwner: FactionId | null = null;
    let dominanceLeaderSeconds = 0;
    let dominanceLeaderSites = 0;

    for (const id of this.state.activeFactionIds) {
      const f = this.state.factions[id];
      if (!f || f.eliminated) continue;
      if (f.stormPower > leadingOverloadAether) {
        leadingOverloadAether = Math.floor(f.stormPower);
        leadingOverloadOwner = id;
      }
      const controlled = this.state.sacredSites.filter((s) => s.controller === id).length;
      if (
        f.dominanceSeconds > dominanceLeaderSeconds ||
        (dominanceLeaderOwner === null && controlled >= requiredSites)
      ) {
        dominanceLeaderOwner = id;
        dominanceLeaderSeconds = f.dominanceSeconds;
        dominanceLeaderSites = controlled;
      }
    }

    const victoryProgress: VictoryProgressSnapshot = {
      aetherTarget: this.victoryRules.aetherOverloadTarget,
      playerAether: Math.floor(pf.stormPower),
      leadingOverloadOwner,
      leadingOverloadLabel: this.getFactionLabel(leadingOverloadOwner),
      leadingOverloadColor: this.getFactionColor(leadingOverloadOwner),
      leadingOverloadAether,
      aetherOverloadAchieved: this.achievedAltVictories.has('AETHER_OVERLOAD'),
      dominanceDuration: ALTAR_DOMINANCE_DURATION,
      requiredSites,
      totalSites,
      playerControlledSites,
      playerDominanceSeconds: pf.dominanceSeconds,
      dominanceLeaderOwner,
      dominanceLeaderLabel: dominanceLeaderOwner ? this.getFactionLabel(dominanceLeaderOwner) : null,
      dominanceLeaderColor: dominanceLeaderOwner ? this.getFactionColor(dominanceLeaderOwner) : null,
      dominanceLeaderSeconds,
      dominanceLeaderSites,
      altarDominanceAchieved: this.achievedAltVictories.has('ALTAR_DOMINANCE'),
      sites: this.state.sacredSites.map((s) => ({ ...s })),
    };

    const remainingRivals = rivals.filter((r) => !r.eliminated).length;

    this.onHudUpdate({
      phase: this.phase,
      elapsedSeconds: Math.floor(this.state.elapsedSeconds),
      stormPower: Math.floor(pf.stormPower),
      golemCount: playerGolems,
      maxGolems: MAX_GOLEMS,
      golemCost: GOLEM_COST,
      connectedIslands: connected,
      totalIslands: this.state.islands.length,
      knowledgeTier: pf.knowledgeTier,
      playerFury: pf.fury,
      aiFury: af.fury,
      difficulty: this.state.difficulty,
      opponentCount: this.state.opponentCount,
      gridSize: this.state.gridSize,
      rivals,
      bridgeQueue: [...pf.bridgeQueue],
      placement: this.placement,
      speedMultiplier: this.speedMultiplier,
      muted: this.audio.isMuted(),
      musicVolume: this.audio.getMusicVolume(),
      sfxVolume: this.audio.getSfxVolume(),
      currentTrackTitle: this.audio.getCurrentTrackTitle(),
      rangeOverlay: { ...this.rangeOverlay },
      selected: this.buildSelectedInspect(),
      hovered: this.buildHoveredInspect(),
      playerPriestHp: Math.ceil(playerPriest?.hp ?? 0),
      playerPriestMaxHp: playerPriest?.maxHp ?? 240,
      playerPriestState: playerPriest?.state ?? 'ACTIVE',
      aiPriestHp: primaryRival?.hp ?? 0,
      aiPriestMaxHp: primaryRival?.maxHp ?? 240,
      aiPriestState: primaryRival?.state ?? 'ACTIVE',
      stunnedTargets,
      alertBanner: this.alertBanner ? { text: this.alertBanner.text, tone: this.alertBanner.tone } : null,
      victoryRules: { ...this.victoryRules },
      victoryProgress,
      matchStats: {
        elapsedSeconds: Math.floor(this.state.elapsedSeconds),
        playerFury: pf.fury,
        aiFury: af.fury,
        difficulty: this.state.difficulty,
        opponentCount: this.state.opponentCount,
        rivalsEliminated,
        crystalsHarvested: pf.crystalsHarvested,
        bridgesPlaced: pf.bridgesPlaced,
        towersDestroyed: pf.towersDestroyed,
        sacrificesCompleted: pf.sacrificesCompleted,
        islandsConnected: connected,
        outcomeReason: this.outcomeReason,
        winnerLabel: this.winnerLabel,
        canContinuePlaying: this.phase === 'VICTORY' && remainingRivals > 0,
        achievedAltVictories: Array.from(this.achievedAltVictories),
      },
    });
  }
}
