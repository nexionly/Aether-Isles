import { AiCommander } from './ai';
import {
  WebAudioManager,
  type AudioHookEvent,
  type AudioHookListener,
  type AudioSpatialContext,
} from './audio';
import {
  AERIAL_CATALOG,
  AETHER_OVERLOAD_OPTIONS,
  AETHER_OVERLOAD_TARGET,
  ALTAR_DOMINANCE_DURATION,
  BRIDGE_DECAY_DPS,
  BRIDGE_DECAY_GRACE_SECONDS,
  BRIDGE_TILE_HP,
  ENERGY_FENCE_MAX_SPAN,
  FURY_META,
  GOLEM_COST,
  MAX_AERIAL_UNITS,
  MAX_GOLEMS,
  PRIEST_ABILITY_CATALOG,
  RECLAIM_REFUND_RATE,
  STRUCTURE_CATALOG,
  TETROMINOES,
  buildTechUnlockChoices,
  clampOpponentCount,
  directionLabel,
  directionVector,
  getCombatPalette,
  getNextSpeedMultiplier,
  getRequiredSacredSites,
  getWorldIsoBounds,
  isAerialUnitKind,
  isAiFaction,
  isFactionId,
  loadVictoryRules,
  randomTetrominoKey,
  saveVictoryRules,
} from './catalog';
import { getDifficultyProfile } from './difficulty';
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
  AerialUnit,
  AerialUnitKind,
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
  PriestAbilityId,
  RangeOverlayState,
  RivalHudSummary,
  SelectedInspect,
  SpeedMultiplier,
  Structure,
  TechUnlockKey,
  VictoryCelebrationParticle,
  VictoryCelebrationState,
  VictoryCelebrationTheme,
  VictoryProgressSnapshot,
  VictoryRules,
} from './types';
import { buildWeatherHudSummary, getLocalizedStormFactorAtIso, updateWeatherState } from './weather';
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
  private victoryCelebration: VictoryCelebrationState | null = null;
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
  private hoveredKind: 'STRUCTURE' | 'PRIEST' | 'GOLEM' | 'GEYSER' | 'AERIAL' | null = null;
  private rangeOverlay: RangeOverlayState = {
    enabled: false,
    WIND: true,
    RAIN: true,
    THUNDER: true,
  };
  private placement: PlacementMode = { type: 'SELECT' };
  private selectedId: number | null = null;
  private selectedKind: 'STRUCTURE' | 'PRIEST' | 'GOLEM' | 'GEYSER' | 'AERIAL' | null = null;
  private fogUpdateTimer = 0;
  private fenceZapTimer = 0;

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
    this.audio.setWeatherAmbience(0, 0);
    this.stormGustTimer = 8 + Math.random() * 6;
    const clampedOpp = clampOpponentCount(opponentCount);
    this.state = createInitialWorld(fury, difficulty, clampedOpp, this.victoryRules);
    this.ai.reset();
    this.phase = 'PLAYING';
    this.syncMusicState();
    this.outcomeReason = undefined;
    this.winnerLabel = undefined;
    this.victoryCelebration = null;
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
    this.fogUpdateTimer = 0;
    this.fenceZapTimer = 0;
    this.recomputeEnergyFences();
    this.recomputeFogOfWar();
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
      fogOfWar:
        typeof patch.fogOfWar === 'boolean'
          ? patch.fogOfWar
          : this.victoryRules.fogOfWar,
    };
    saveVictoryRules(this.victoryRules);
    this.state.victoryRules = { ...this.victoryRules };

    if (this.victoryRules.fogOfWar) {
      this.state.fogGrid.fill(0);
      this.recomputeFogOfWar();
    } else {
      this.state.fogGrid.fill(2);
    }

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
    this.victoryCelebration = null;
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
    this.victoryCelebration = null;
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

  public focusPlayerPriest(): void {
    const playerPriest = this.state.priests.find((p) => p.owner === 'PLAYER' && !p.isRogue);
    if (!playerPriest || playerPriest.state === 'SACRIFICED') {
      this.centerOnHome();
      return;
    }

    // If our High Priest is currently being carried by a rival, track the carrier's live position
    let focusX = playerPriest.x;
    let focusY = playerPriest.y;
    if (playerPriest.state === 'CARRIED') {
      const carrier = this.state.priests.find((p) => p.carryingPriestId === playerPriest.id);
      if (carrier) {
        focusX = carrier.x;
        focusY = carrier.y;
      }
    }

    this.focusOnTile(focusX, focusY);
    // Gently frame closer if zoomed far out so the High Priest is immediately legible
    const minComfortZoom = this.viewW < 640 ? 0.78 : 0.92;
    if (this.camera.zoom < minComfortZoom) {
      this.camera.zoom = minComfortZoom;
    }

    // Select the High Priest so the player can command them immediately
    this.placement = { type: 'SELECT' };
    this.selectedKind = 'PRIEST';
    this.selectedId = playerPriest.id;

    // Crisp golden locator ping on the canvas
    this.spawnImpact(focusX, focusY, 'BUILD_SNAP', '#fde047', 0.65, 1.35);
    this.spawnBurst(focusX, focusY, '#fde047', 8, 42);
    this.emitAudio({ type: 'UI_ROTATE' });
    this.emitHud();
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

    // 1. Prefer an idle Sky Transport if available and no bridge path exists (airlift over open void!)
    const idleTransport = this.state.aerialUnits.find(
      (a) => a.owner === 'PLAYER' && a.kind === 'SKY_TRANSPORT' && a.carryingPriestId === null
    );
    const playerPriest = this.state.priests.find((p) => p.owner === 'PLAYER' && !p.isRogue);
    const priestCanWalk =
      playerPriest &&
      playerPriest.state === 'ACTIVE' &&
      playerPriest.carryingPriestId === null &&
      findTilePath(this.state, playerPriest.x, playerPriest.y, targetPriest.x, targetPriest.y) !== null;

    if (idleTransport && !priestCanWalk) {
      idleTransport.captureTargetPriestId = targetPriest.id;
      idleTransport.targetX = targetPriest.x;
      idleTransport.targetY = targetPriest.y;
      idleTransport.returningToAltar = false;
      this.selectedKind = 'AERIAL';
      this.selectedId = idleTransport.id;
      this.pushAlert('Aether Dirigible dispatched to airlift the stunned Priest over open sky!', 'SACRIFICE', 4.5);
      this.emitAudio({ type: 'UI_ROTATE' });
      this.emitHud();
      return;
    }

    // 2. Dispatch Your High Priest if active, free, and connected by bridge
    if (playerPriest && playerPriest.state === 'ACTIVE' && playerPriest.carryingPriestId === null) {
      const assigned = this.dispatchHighPriestToCapture('PLAYER', targetPriest);
      if (assigned) {
        this.selectedKind = 'PRIEST';
        this.selectedId = playerPriest.id;
        this.pushAlert('Your High Priest is marching to capture the stunned Priest!', 'SACRIFICE', 4.5);
        this.emitAudio({ type: 'UI_ROTATE' });
        this.emitHud();
        return;
      }
    }

    // 3. Fallback to an idle/harvesting Aether Golem if High Priest is busy/stunned
    const candidateGolem = this.state.golems
      .filter((g) => g.owner === 'PLAYER' && g.carryingPriestId === null && g.carryingCrystalValue === 0)
      .sort((a, b) => Math.hypot(a.x - targetPriest.x, a.y - targetPriest.y) - Math.hypot(b.x - targetPriest.x, b.y - targetPriest.y))[0];
    if (candidateGolem) {
      const path = findTilePath(this.state, candidateGolem.x, candidateGolem.y, targetPriest.x, targetPriest.y);
      if (path && path.length > 0) {
        candidateGolem.task = 'CAPTURING_PRIEST';
        candidateGolem.captureTargetPriestId = targetPriest.id;
        candidateGolem.targetCrystalId = null;
        candidateGolem.repairTarget = null;
        candidateGolem.path = path;
        this.selectedKind = 'GOLEM';
        this.selectedId = candidateGolem.id;
        this.pushAlert('Aether Golem dispatched to haul the stunned Priest back to your Altar!', 'SACRIFICE', 4.5);
        this.emitAudio({ type: 'UI_ROTATE' });
        this.emitHud();
        return;
      }
    }

    // 4. Final fallback to Sky Transport even if High Priest was busy
    if (idleTransport) {
      idleTransport.captureTargetPriestId = targetPriest.id;
      idleTransport.targetX = targetPriest.x;
      idleTransport.targetY = targetPriest.y;
      idleTransport.returningToAltar = false;
      this.selectedKind = 'AERIAL';
      this.selectedId = idleTransport.id;
      this.pushAlert('Aether Dirigible dispatched to airlift the stunned Priest!', 'SACRIFICE', 4.5);
      this.emitAudio({ type: 'UI_ROTATE' });
      this.emitHud();
      return;
    }

    this.pushAlert('Bridge to that island or summon an Aether Dirigible to airlift the stunned Priest.', 'WARNING', 5);
    this.emitAudio({ type: 'UI_INVALID' });
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
    } else if (code === 'KeyP') {
      this.focusPlayerPriest();
    } else if (code === 'KeyQ') {
      this.castPriestAbility('RECALL');
    } else if (code === 'KeyE') {
      this.castPriestAbility('SANCTUARY');
    } else if (code === 'KeyT') {
      this.castPriestAbility('TEMPEST_CAST');
    } else if (code === 'Delete' || code === 'Backspace') {
      this.reclaimSelectedStructure();
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
    } else if (code >= 'Digit2' && code <= 'Digit9') {
      const idx = Number(code.replace('Digit', '')) - 2;
      const pf = this.state.factions.PLAYER;
      const palette = getCombatPalette(pf.fury, pf.unlockedTechs);
      const kind = palette[idx];
      if (kind) {
        if (pf.unlockedTechs.includes(kind)) {
          this.setPlacement({ type: 'STRUCTURE', kind, facing: 0 });
        } else {
          this.pushAlert('Unlock advanced and cross-aspect units by sacrificing a Rogue or rival Priest at your Altar.', 'INFO', 4);
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

  private isTileVisibleToPlayer(tx: number, ty: number): boolean {
    if (!this.victoryRules.fogOfWar) return true;
    const rx = Math.round(tx);
    const ry = Math.round(ty);
    if (!inBounds(rx, ry, this.state.gridSize)) return false;
    return this.state.fogGrid[ry * this.state.gridSize + rx] >= 2;
  }

  private resolveHoveredEntity(txFrac: number, tyFrac: number, tx: number, ty: number): void {
    let nextKind: 'STRUCTURE' | 'PRIEST' | 'GOLEM' | 'GEYSER' | 'AERIAL' | null = null;
    let nextId: number | null = null;

    // 0. Aerial Units (flying above islands/void)
    let bestAerialDist = 1.05;
    for (const a of this.state.aerialUnits) {
      if (a.owner !== 'PLAYER' && !this.isTileVisibleToPlayer(a.x, a.y)) continue;
      const d = Math.hypot(a.x - txFrac, a.y - tyFrac);
      if (d < bestAerialDist) {
        bestAerialDist = d;
        nextKind = 'AERIAL';
        nextId = a.id;
      }
    }

    // 1. Priests (priority hit-test so moving/stunned priests are effortless to inspect)
    if (nextId === null) {
      let bestPriestDist = 0.88;
      for (const p of this.state.priests) {
        if (p.state === 'SACRIFICED' || p.state === 'CARRIED') continue;
        if (p.owner !== 'PLAYER' && !this.isTileVisibleToPlayer(p.x, p.y)) continue;
        const d = Math.hypot(p.x - txFrac, p.y - tyFrac);
        if (d < bestPriestDist) {
          bestPriestDist = d;
          nextKind = 'PRIEST';
          nextId = p.id;
        }
      }
    }

    // 2. Aether Golems
    if (nextId === null) {
      let bestGolemDist = 0.85;
      for (const g of this.state.golems) {
        if (g.owner !== 'PLAYER' && !this.isTileVisibleToPlayer(g.x, g.y)) continue;
        const d = Math.hypot(g.x - txFrac, g.y - tyFrac);
        if (d < bestGolemDist) {
          bestGolemDist = d;
          nextKind = 'GOLEM';
          nextId = g.id;
        }
      }
    }

    // 3. Structures on tile (hide enemy camouflaged Bridge Mines & fogged hostile structures)
    if (nextId === null && inBounds(tx, ty, this.state.gridSize)) {
      const s = getStructureAt(this.state, tx, ty);
      if (s) {
        const hiddenMine = s.kind === 'BRIDGE_MINE' && s.owner !== 'PLAYER';
        const foggedEnemy = s.owner !== 'PLAYER' && !this.isTileVisibleToPlayer(s.tx, s.ty);
        if (!hiddenMine && !foggedEnemy) {
          nextKind = 'STRUCTURE';
          nextId = s.id;
        }
      }
    }

    // 4. Geysers on tile (visible if explored or no fog)
    if (nextId === null && inBounds(tx, ty, this.state.gridSize)) {
      const fogVal = this.victoryRules.fogOfWar ? this.state.fogGrid[ty * this.state.gridSize + tx] : 2;
      if (fogVal >= 1) {
        const geyser = this.state.geysers.find((g) => g.tx === tx && g.ty === ty);
        if (geyser) {
          nextKind = 'GEYSER';
          nextId = geyser.id;
        }
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
    const tileVisible = this.isTileVisibleToPlayer(tx, ty);

    // 1. Did player click on a stunned Rogue or AI Priest?
    const clickedStunned = this.state.priests.find(
      (p) =>
        p.state === 'STUNNED' &&
        p.owner !== 'PLAYER' &&
        Math.hypot(p.x - tx, p.y - ty) <= 1.25 &&
        this.isTileVisibleToPlayer(p.x, p.y)
    );
    if (clickedStunned) {
      // If a Player Sky Transport is currently selected & empty, command it to airlift directly!
      if (this.selectedKind === 'AERIAL' && this.selectedId !== null) {
        const transport = this.state.aerialUnits.find(
          (a) =>
            a.id === this.selectedId &&
            a.owner === 'PLAYER' &&
            a.kind === 'SKY_TRANSPORT' &&
            a.carryingPriestId === null
        );
        if (transport) {
          transport.captureTargetPriestId = clickedStunned.id;
          transport.targetX = clickedStunned.x;
          transport.targetY = clickedStunned.y;
          transport.returningToAltar = false;
          this.spawnBurst(clickedStunned.x, clickedStunned.y, '#67e8f9', 8, 42);
          this.pushAlert('Aether Dirigible flying to airlift the stunned Priest!', 'SACRIFICE', 4);
          this.emitAudio({ type: 'UI_ROTATE' });
          this.emitHud();
          return;
        }
      }
      this.commandCaptureStunnedPriest(clickedStunned.id);
      return;
    }

    // 2. Did player click on an Aerial Unit?
    const clickedAerial = this.state.aerialUnits.find(
      (a) =>
        Math.hypot(a.x - tx, a.y - ty) <= 1.15 &&
        (a.owner === 'PLAYER' || this.isTileVisibleToPlayer(a.x, a.y))
    );
    if (clickedAerial) {
      this.selectedKind = 'AERIAL';
      this.selectedId = clickedAerial.id;
      this.emitHud();
      return;
    }

    // 3. Did player click on any Priest?
    const clickedPriest = this.state.priests.find(
      (p) =>
        p.state !== 'CARRIED' &&
        p.state !== 'SACRIFICED' &&
        Math.hypot(p.x - tx, p.y - ty) <= 1.1 &&
        (p.owner === 'PLAYER' || this.isTileVisibleToPlayer(p.x, p.y))
    );
    if (clickedPriest) {
      this.selectedKind = 'PRIEST';
      this.selectedId = clickedPriest.id;
      this.emitHud();
      return;
    }

    // 4. Did player click on a Golem?
    const clickedGolem = this.state.golems.find(
      (g) =>
        Math.hypot(g.x - tx, g.y - ty) <= 1.0 &&
        (g.owner === 'PLAYER' || this.isTileVisibleToPlayer(g.x, g.y))
    );
    if (clickedGolem) {
      this.selectedKind = 'GOLEM';
      this.selectedId = clickedGolem.id;
      this.emitHud();
      return;
    }

    // 5. Did player click on their own Altar while High Priest or Sky Transport is carrying a captive?
    const rawStruct = getStructureAt(this.state, tx, ty);
    const clickedStruct =
      rawStruct &&
      (rawStruct.owner === 'PLAYER' || (tileVisible && rawStruct.kind !== 'BRIDGE_MINE'))
        ? rawStruct
        : null;

    if (clickedStruct && clickedStruct.owner === 'PLAYER' && clickedStruct.kind === 'ALTAR') {
      if (this.selectedKind === 'PRIEST' && this.selectedId !== null) {
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
      if (this.selectedKind === 'AERIAL' && this.selectedId !== null) {
        const transport = this.state.aerialUnits.find(
          (a) => a.id === this.selectedId && a.owner === 'PLAYER' && a.carryingPriestId !== null
        );
        if (transport) {
          transport.targetX = clickedStruct.tx;
          transport.targetY = clickedStruct.ty;
          transport.returningToAltar = true;
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

    // 6. Did player click on a Geyser?
    const clickedGeyser = this.state.geysers.find((g) => g.tx === tx && g.ty === ty);
    if (clickedGeyser) {
      this.selectedKind = 'GEYSER';
      this.selectedId = clickedGeyser.id;
      this.emitHud();
      return;
    }

    // 7. If an allied Aerial Unit is selected, fly directly to any tile (even over open void!)
    if (this.selectedKind === 'AERIAL' && this.selectedId !== null) {
      const flyer = this.state.aerialUnits.find((a) => a.id === this.selectedId && a.owner === 'PLAYER');
      if (flyer && inBounds(tx, ty, this.state.gridSize)) {
        flyer.targetX = tx;
        flyer.targetY = ty;
        if (flyer.carryingPriestId === null) {
          flyer.captureTargetPriestId = null;
        } else {
          flyer.returningToAltar = false;
        }
        this.spawnBurst(tx, ty, '#67e8f9', 6, 36);
        this.emitAudio({ type: 'UI_ROTATE' });
        return;
      }
    }

    // 8. If Player High Priest is currently selected and tile is walkable ground, walk High Priest there!
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

      if (this.phase === 'PLAYING' || this.phase === 'TITLE_MENU') {
        const prevWeatherPhase = this.state.weather.phase;
        const weatherDt =
          this.phase === 'PLAYING'
            ? clampedDt * Math.min(this.speedMultiplier, 1.8)
            : clampedDt * 0.55;
        const strikes = updateWeatherState(
          this.state.weather,
          weatherDt,
          this.state.gridSize,
          this.state.islands,
          this.state.factions.PLAYER.fury,
          { x: this.camera.x, y: this.camera.y }
        );

        if (this.phase === 'PLAYING') {
          const localStorm = getLocalizedStormFactorAtIso(
            this.state.weather,
            this.camera.x,
            this.camera.y
          );
          this.audio.setWeatherAmbience(
            Math.min(1, this.state.weather.rainIntensity + localStorm * 0.35),
            Math.min(1, this.state.weather.stormIntensity * 0.65 + localStorm * 0.55)
          );

          for (const strike of strikes) {
            const { sx, sy } = worldToScreen(
              strike.isoX,
              strike.isoY,
              this.camera,
              this.viewW,
              this.viewH
            );
            const halfW = Math.max(1, this.viewW * 0.5);
            const halfH = Math.max(1, this.viewH * 0.5);
            const normDist = Math.hypot((sx - halfW) / halfW, (sy - halfH) / halfH);
            if (normDist < 1.35) {
              const proximity = Math.max(0, 1 - normDist / 1.35);
              this.state.weather.globalFlash = Math.max(
                this.state.weather.globalFlash,
                (0.28 + proximity * 0.68) * strike.intensity
              );
              this.emitAudio({
                type: 'WEATHER_THUNDER',
                intensity: (0.4 + proximity * 0.6) * strike.intensity,
                tx: strike.isoX,
                ty: strike.isoY,
              });
            }
          }

          if (this.state.weather.phase !== prevWeatherPhase) {
            this.emitHud();
          }
        }
      }

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
      } else if (this.phase === 'VICTORY') {
        this.updateEffects(clampedDt);
        this.updateVictoryCelebration(clampedDt);
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
    const aiDiffMult = getDifficultyProfile(state.difficulty).passiveAetherMultiplier;
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

    // 2. Severed Bridge Decay, Structures, Energy Fences & Bridge Mines
    this.updateBridgeDecay(dt);
    this.updateStructures(dt);
    this.updateEnergyFences(dt);
    this.updateBridgeMines(dt);

    // 3. Priests (movement, repair aura, abilities, stun timer, sacrifice ritual)
    this.updatePriests(dt);

    // 4. Golems (harvesting, crystal delivery, priest hauling, auto-repair)
    this.updateGolems(dt);

    // 5. Mobile & Flying Combat / Transport Units
    this.updateAerialUnits(dt);

    // 6. Projectiles & Visual FX
    this.updateProjectiles(dt);
    this.updateEffects(dt);

    // 7. Optional Fog of War Scouting Update (4x/sec)
    if (this.victoryRules.fogOfWar) {
      this.fogUpdateTimer -= dt;
      if (this.fogUpdateTimer <= 0) {
        this.fogUpdateTimer = 0.25;
        this.recomputeFogOfWar();
      }
    }

    // 8. AI High Priest Commander (damp AI decision speedup at 2x/3x/5x so computer doesn't outpace human clicks)
    const aiThinkDt = this.speedMultiplier > 1 ? dt / Math.pow(this.speedMultiplier, 0.45) : dt;
    this.ai.update(state, aiThinkDt, {
      placeBridge: this.placeBridge.bind(this),
      placeStructure: this.placeStructure.bind(this),
      summonGolem: this.summonGolem.bind(this),
    });

    // 9. Alternative Victory Conditions (Altar Dominance & Aether Overload)
    if (this.phase === 'PLAYING') {
      this.updateVictoryConditions(dt);
    }

    // 10. Throttled HUD snapshot
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
    this.recomputeEnergyFences();
    if (owner === 'PLAYER' && this.victoryRules.fogOfWar) {
      this.recomputeFogOfWar();
    }

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
    if (!faction.unlockedTechs.includes(kind)) return false;
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
    if (def.isPowerHub) {
      recomputePowerGrids(this.state);
    }
    if (def.isFencePylon) {
      this.recomputeEnergyFences();
    }
    if (owner === 'PLAYER' && this.victoryRules.fogOfWar) {
      this.recomputeFogOfWar();
    }
    this.spawnBurst(tx, ty, faction.color, 10, 48);
    this.spawnImpact(tx, ty, 'BUILD_SNAP', faction.color, 0.62, 1.05);

    this.emitAudio({ type: 'STRUCTURE_BUILT', owner, kind, tx, ty });
    return true;
  }

  public reclaimSelectedStructure(): boolean {
    if (this.phase !== 'PLAYING' || this.selectedKind !== 'STRUCTURE' || this.selectedId === null) {
      return false;
    }
    return this.reclaimStructure(this.selectedId);
  }

  public reclaimStructure(structId: number): boolean {
    const st = this.state.structures.find((s) => s.id === structId && s.owner === 'PLAYER');
    if (!st || st.kind === 'TEMPLE' || st.kind === 'ALTAR') return false;
    const def = STRUCTURE_CATALOG[st.kind];
    const refund = Math.round(def.cost * RECLAIM_REFUND_RATE);

    this.state.structures = this.state.structures.filter((s) => s.id !== st.id);
    this.state.factions.PLAYER.stormPower += refund;
    if (this.selectedKind === 'STRUCTURE' && this.selectedId === st.id) {
      this.selectedKind = null;
      this.selectedId = null;
    }
    if (def.isPowerHub) {
      recomputePowerGrids(this.state);
    }
    if (def.isFencePylon) {
      this.recomputeEnergyFences();
    }
    if (this.victoryRules.fogOfWar) {
      this.recomputeFogOfWar();
    }

    this.spawnBurst(st.tx, st.ty, '#f0b429', 14, 58);
    this.spawnImpact(st.tx, st.ty, 'BUILD_SNAP', '#f0b429', 0.65, 0.9);
    this.addFloatingText(st.tx, st.ty, `+${refund} AE RECLAIMED`, '#fde047');
    this.emitAudio({ type: 'CRYSTAL_PICKUP', owner: 'PLAYER', value: refund, tx: st.tx, ty: st.ty });
    this.emitHud();
    return true;
  }

  public summonPlayerAerialUnit(kind: AerialUnitKind): boolean {
    if (this.phase !== 'PLAYING') return false;
    const ok = this.summonAerialUnit('PLAYER', kind);
    if (!ok) {
      this.emitAudio({ type: 'UI_INVALID' });
    }
    this.emitHud();
    return ok;
  }

  public summonAerialUnit(owner: FactionId, kind: AerialUnitKind): boolean {
    const faction = this.state.factions[owner];
    if (!faction || faction.eliminated) return false;
    if (!faction.unlockedTechs.includes(kind)) return false;
    const def = AERIAL_CATALOG[kind];
    const count = this.state.aerialUnits.filter((a) => a.owner === owner).length;
    if (count >= MAX_AERIAL_UNITS || faction.stormPower < def.cost) return false;

    const temple = this.state.structures.find((s) => s.owner === owner && s.kind === 'TEMPLE');
    if (!temple) return false;

    faction.stormPower -= def.cost;
    const angle = Math.random() * Math.PI * 2;
    const spawnX = temple.tx + Math.cos(angle) * 1.4;
    const spawnY = temple.ty + Math.sin(angle) * 1.4;

    const unit: AerialUnit = {
      id: this.state.nextEntityId++,
      kind,
      owner,
      x: spawnX,
      y: spawnY,
      altitude: kind === 'ROVING_WHIRLWIND' ? 14 : 34,
      hp: def.maxHp,
      maxHp: def.maxHp,
      speed: def.speed,
      cooldown: 0.4,
      targetX: spawnX + Math.cos(angle) * 2.5,
      targetY: spawnY + Math.sin(angle) * 2.5,
      hasManualOrder: false,
      carryingPriestId: null,
      captureTargetPriestId: null,
      returningToAltar: false,
      hitFlash: 0,
      animPhase: Math.random() * Math.PI * 2,
      heading: angle,
    };
    this.state.aerialUnits.push(unit);
    this.spawnBurst(spawnX, spawnY, faction.color, 14, 60);
    this.spawnImpact(spawnX, spawnY, 'WIND_BURST', faction.color, 0.72, 1.0);
    this.emitAudio({ type: 'GOLEM_SUMMONED', owner, tx: spawnX, ty: spawnY });
    if (owner === 'PLAYER') {
      this.selectedKind = 'AERIAL';
      this.selectedId = unit.id;
      this.placement = { type: 'SELECT' };
      this.addFloatingText(spawnX, spawnY, `${def.shortName.toUpperCase()} LAUNCHED`, '#67e8f9');
      if (this.victoryRules.fogOfWar) {
        this.recomputeFogOfWar();
      }
    }
    return true;
  }

  public chooseTechUnlock(key: TechUnlockKey): boolean {
    if (this.phase !== 'PLAYING' || !this.state.pendingTechChoices) return false;
    const opt = this.state.pendingTechChoices.find((c) => c.key === key);
    if (!opt) return false;
    const pf = this.state.factions.PLAYER;
    if (!pf.unlockedTechs.includes(key)) {
      pf.unlockedTechs.push(key);
    }
    this.state.pendingTechChoices = null;
    const altar = this.state.structures.find((s) => s.owner === 'PLAYER' && s.kind === 'ALTAR');
    if (altar) {
      this.spawnBurst(altar.tx, altar.ty, '#fde047', 20, 80);
      this.addFloatingText(altar.tx, altar.ty, `${opt.shortName.toUpperCase()} MASTERED!`, '#fde047');
    }
    this.pushAlert(
      `Altar Knowledge Unlocked: ${opt.name} is now available in your ${opt.isAerial ? 'Sky Fleet' : 'Combat'} dock!`,
      'SACRIFICE',
      5.5
    );
    this.emitAudio({ type: 'UI_ROTATE' });
    this.emitHud();
    return true;
  }

  public castPriestAbility(abilityId: PriestAbilityId): boolean {
    if (this.phase !== 'PLAYING') return false;
    const priest = this.state.priests.find((p) => p.owner === 'PLAYER' && !p.isRogue);
    const pf = this.state.factions.PLAYER;
    const def = PRIEST_ABILITY_CATALOG.find((a) => a.id === abilityId);
    if (!priest || !def) return false;

    if (priest.state !== 'ACTIVE') {
      this.pushAlert('Your High Priest must be active to channel Priest Abilities!', 'WARNING', 3.5);
      this.emitAudio({ type: 'UI_INVALID' });
      this.emitHud();
      return false;
    }
    if (priest.abilityCooldowns[abilityId] > 0.05) {
      this.emitAudio({ type: 'UI_INVALID' });
      return false;
    }
    if (pf.stormPower < def.cost) {
      this.pushAlert(`${def.name} requires ${def.cost} AE.`, 'INFO', 3);
      this.emitAudio({ type: 'UI_INVALID' });
      this.emitHud();
      return false;
    }

    if (abilityId === 'RECALL') {
      const temple = this.state.structures.find((s) => s.owner === 'PLAYER' && s.kind === 'TEMPLE');
      if (!temple) return false;
      const dest = findNearestWalkableFreeTile(this.state, temple.tx, temple.ty, 'PLAYER');
      pf.stormPower -= def.cost;
      priest.abilityCooldowns.RECALL = def.maxCooldown;
      this.releaseCarriedPriest(priest);
      this.spawnBurst(priest.x, priest.y, '#67e8f9', 18, 70);
      priest.x = dest.x;
      priest.y = dest.y;
      priest.targetPath = [];
      priest.captureTargetPriestId = null;
      priest.returningToAltar = false;
      this.spawnBurst(dest.x, dest.y, '#fde047', 24, 85);
      this.spawnImpact(dest.x, dest.y, 'BUILD_SNAP', '#67e8f9', 0.9, 1.3);
      this.addFloatingText(dest.x, dest.y, 'TEMPLE RECALL!', '#67e8f9');
      this.focusOnTile(dest.x, dest.y);
      this.emitAudio({ type: 'ELEMENTAL_STORM', storm: 'WIND_CYCLONE', fury: pf.fury, intensity: 0.85, tx: dest.x, ty: dest.y });
      this.emitHud();
      return true;
    }

    if (abilityId === 'SANCTUARY') {
      pf.stormPower -= def.cost;
      priest.abilityCooldowns.SANCTUARY = def.maxCooldown;
      priest.shieldTimer = 6.0;
      priest.hp = Math.min(priest.maxHp, priest.hp + 45);
      for (const s of this.state.structures) {
        if (s.owner === 'PLAYER' && Math.hypot(s.tx - priest.x, s.ty - priest.y) <= 4.2) {
          s.hp = Math.min(s.maxHp, s.hp + 55);
        }
      }
      const r = 4;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const tx = Math.round(priest.x + dx);
          const ty = Math.round(priest.y + dy);
          if (!inBounds(tx, ty, this.state.gridSize)) continue;
          const t = this.state.tiles[ty][tx];
          if (t.kind === 'BRIDGE' && t.owner === 'PLAYER' && Math.hypot(tx - priest.x, ty - priest.y) <= 4.2) {
            t.hp = Math.min(t.maxHp, t.hp + 45);
          }
        }
      }
      this.spawnBurst(priest.x, priest.y, '#fde047', 24, 85);
      this.spawnImpact(priest.x, priest.y, 'BUILD_SNAP', '#fde047', 1.1, 1.45);
      this.addFloatingText(priest.x, priest.y, 'AEGIS WARD!', '#fde047');
      this.emitAudio({ type: 'SACRIFICE_BEGUN', fury: pf.fury, isGrand: false, tx: priest.x, ty: priest.y });
      this.emitHud();
      return true;
    }

    if (abilityId === 'TEMPEST_CAST') {
      pf.stormPower -= def.cost;
      priest.abilityCooldowns.TEMPEST_CAST = def.maxCooldown;
      const radius = 4.8;
      if (pf.fury === 'WIND') {
        this.applyAreaDamage('PLAYER', priest.x, priest.y, radius, 44, 1.45);
        this.spawnBurst(priest.x, priest.y, '#2dd4bf', 28, 105);
        this.spawnImpact(priest.x, priest.y, 'WIND_BURST', '#2dd4bf', 1.0, 1.65);
        this.addFloatingText(priest.x, priest.y, 'GALE NOVA!', '#2dd4bf');
        this.emitAudio({ type: 'ELEMENTAL_STORM', storm: 'WIND_CYCLONE', fury: 'WIND', intensity: 1, tx: priest.x, ty: priest.y });
      } else if (pf.fury === 'RAIN') {
        this.applyAreaDamage('PLAYER', priest.x, priest.y, radius, 38, 1.15);
        for (const g of this.state.golems) {
          if (g.owner !== 'PLAYER' && Math.hypot(g.x - priest.x, g.y - priest.y) <= radius) {
            g.slowTimer = Math.max(g.slowTimer, 4.5);
          }
        }
        for (const s of this.state.structures) {
          if (s.owner === 'PLAYER' && Math.hypot(s.tx - priest.x, s.ty - priest.y) <= radius) {
            s.hp = Math.min(s.maxHp, s.hp + 35);
          }
        }
        this.spawnBurst(priest.x, priest.y, '#38bdf8', 28, 95);
        this.spawnImpact(priest.x, priest.y, 'RAIN_SPLASH', '#38bdf8', 1.1, 1.65);
        this.addFloatingText(priest.x, priest.y, 'GLACIAL DELUGE!', '#38bdf8');
        this.emitAudio({ type: 'ELEMENTAL_STORM', storm: 'RAIN_DELUGE', fury: 'RAIN', intensity: 1, tx: priest.x, ty: priest.y });
      } else {
        // THUNDER: Chain Tempest striking up to 4 hostile targets near the High Priest
        const targets: Array<{ x: number; y: number }> = [];
        for (const p of this.state.priests) {
          if (p.owner !== 'PLAYER' && p.state === 'ACTIVE' && Math.hypot(p.x - priest.x, p.y - priest.y) <= radius + 1) {
            targets.push({ x: p.x, y: p.y });
          }
        }
        for (const a of this.state.aerialUnits) {
          if (a.owner !== 'PLAYER' && Math.hypot(a.x - priest.x, a.y - priest.y) <= radius + 1) {
            targets.push({ x: a.x, y: a.y });
          }
        }
        for (const st of this.state.structures) {
          if (st.owner !== 'PLAYER' && st.kind !== 'ALTAR' && Math.hypot(st.tx - priest.x, st.ty - priest.y) <= radius + 1) {
            targets.push({ x: st.tx, y: st.ty });
          }
        }
        for (const g of this.state.golems) {
          if (g.owner !== 'PLAYER' && Math.hypot(g.x - priest.x, g.y - priest.y) <= radius + 1) {
            targets.push({ x: g.x, y: g.y });
          }
        }
        const strikes = targets.slice(0, 4);
        if (strikes.length > 0) {
          for (const tgt of strikes) {
            this.applyAreaDamage('PLAYER', tgt.x, tgt.y, 1.15, 58, 1.5);
            this.state.lightningArcs.push({
              points: [{ x: priest.x, y: priest.y }, { x: tgt.x, y: tgt.y }],
              color: '#facc15',
              life: 0.32,
              maxLife: 0.32,
              width: 3.6,
            });
            this.spawnBurst(tgt.x, tgt.y, '#c084fc', 12, 65);
          }
        } else {
          this.applyAreaDamage('PLAYER', priest.x, priest.y, radius, 45, 1.4);
        }
        this.spawnImpact(priest.x, priest.y, 'SCORCH_RING', '#c084fc', 1.15, 1.55);
        this.addFloatingText(priest.x, priest.y, 'CHAIN TEMPEST!', '#c084fc');
        this.emitAudio({ type: 'ELEMENTAL_STORM', storm: 'THUNDER_ARC', fury: 'THUNDER', intensity: 1, tx: priest.x, ty: priest.y });
      }
      this.triggerShake(2.8, priest.x, priest.y);
      this.emitHud();
      return true;
    }

    return false;
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
      captureTargetPriestId: null,
      carryingPriestId: null,
      repairTarget: null,
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

  private recomputeFogOfWar(): void {
    const N = this.state.gridSize;
    if (this.state.fogGrid.length !== N * N) {
      this.state.fogGrid = new Uint8Array(N * N);
    }
    const grid = this.state.fogGrid;
    if (!this.victoryRules.fogOfWar) {
      grid.fill(2);
      return;
    }
    // Downgrade currently visible tiles (2) to explored shroud (1)
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === 2) grid[i] = 1;
    }

    const revealCircle = (cx: number, cy: number, radius: number) => {
      const rCeil = Math.ceil(radius);
      const rSq = radius * radius;
      const minY = Math.max(0, Math.floor(cy - rCeil));
      const maxY = Math.min(N - 1, Math.ceil(cy + rCeil));
      const minX = Math.max(0, Math.floor(cx - rCeil));
      const maxX = Math.min(N - 1, Math.ceil(cx + rCeil));
      for (let y = minY; y <= maxY; y++) {
        const dy = y - cy;
        const row = y * N;
        for (let x = minX; x <= maxX; x++) {
          const dx = x - cx;
          if (dx * dx + dy * dy <= rSq) {
            grid[row + x] = 2;
          }
        }
      }
    };

    // Player home island is always illuminated
    const homeIsle = this.state.islands.find((isl) => isl.role === 'PLAYER_HOME');
    if (homeIsle) {
      const approxRadius = Math.sqrt(homeIsle.tiles.length / Math.PI);
      revealCircle(homeIsle.centerX, homeIsle.centerY, approxRadius + 5.5);
    }

    // Player structures
    for (const s of this.state.structures) {
      if (s.owner !== 'PLAYER') continue;
      const def = STRUCTURE_CATALOG[s.kind];
      const baseVis = def.visionRadius ?? (s.kind === 'TEMPLE' ? 10 : 6);
      const radius = s.powered || s.kind === 'TEMPLE' || s.kind === 'OUTPOST' ? baseVis : Math.min(4.5, baseVis);
      revealCircle(s.tx, s.ty, radius);
    }

    // Player bridges grant short frontier sight
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const t = this.state.tiles[y][x];
        if (t.kind === 'BRIDGE' && t.owner === 'PLAYER') {
          revealCircle(x, y, 3.2);
        }
      }
    }

    // Player High Priest
    for (const p of this.state.priests) {
      if (p.owner === 'PLAYER' && p.state !== 'SACRIFICED' && p.state !== 'CARRIED') {
        revealCircle(p.x, p.y, 7.5);
      }
    }

    // Player Golems
    for (const g of this.state.golems) {
      if (g.owner === 'PLAYER') {
        revealCircle(g.x, g.y, 5.2);
      }
    }

    // Player Aerial Units (superior sky scouts!)
    for (const a of this.state.aerialUnits) {
      if (a.owner === 'PLAYER') {
        revealCircle(a.x, a.y, AERIAL_CATALOG[a.kind].visionRadius);
      }
    }
  }

  private recomputeEnergyFences(): void {
    const pylons = this.state.structures.filter(
      (s) => s.kind === 'BARRIER_PYLON' && s.powered && s.hp > 0
    );
    const links: typeof this.state.energyFences = [];

    for (let i = 0; i < pylons.length; i++) {
      const a = pylons[i];
      for (let j = i + 1; j < pylons.length; j++) {
        const b = pylons[j];
        if (!isFactionId(a.owner) || a.owner !== b.owner) continue;
        const sameCol = a.tx === b.tx;
        const sameRow = a.ty === b.ty;
        if (!sameCol && !sameRow) continue;
        const span = Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);
        if (span < 2 || span > ENERGY_FENCE_MAX_SPAN) continue;

        // Avoid overlapping redundant links if another friendly pylon sits directly between a and b
        const hasMidPylon = pylons.some((m) => {
          if (m.id === a.id || m.id === b.id || m.owner !== a.owner) return false;
          if (sameCol && m.tx === a.tx) {
            return m.ty > Math.min(a.ty, b.ty) && m.ty < Math.max(a.ty, b.ty);
          }
          if (sameRow && m.ty === a.ty) {
            return m.tx > Math.min(a.tx, b.tx) && m.tx < Math.max(a.tx, b.tx);
          }
          return false;
        });
        if (hasMidPylon) continue;

        links.push({
          owner: a.owner,
          ax: a.tx,
          ay: a.ty,
          bx: b.tx,
          by: b.ty,
          pylonAId: a.id,
          pylonBId: b.id,
          active: true,
        });
      }
    }
    this.state.energyFences = links;
  }

  private updateBridgeDecay(dt: number): void {
    const N = this.state.gridSize;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const tile = this.state.tiles[y][x];
        if (tile.kind !== 'BRIDGE') {
          tile.unpoweredSeconds = 0;
          continue;
        }
        if (tile.poweredMask === 0) {
          tile.unpoweredSeconds += dt;
          if (tile.unpoweredSeconds > BRIDGE_DECAY_GRACE_SECONDS) {
            this.damageBridgeTile(x, y, BRIDGE_DECAY_DPS * dt);
          }
        } else if (tile.unpoweredSeconds > 0) {
          tile.unpoweredSeconds = Math.max(0, tile.unpoweredSeconds - dt * 3);
        }
      }
    }
  }

  private pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    if (lenSq <= 0.0001) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
    return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
  }

  private updateEnergyFences(dt: number): void {
    if (this.state.energyFences.length === 0) return;
    this.fenceZapTimer -= dt;
    if (this.fenceZapTimer > 0) return;
    this.fenceZapTimer = 0.32;

    for (const fence of this.state.energyFences) {
      if (!fence.active) continue;
      for (const p of this.state.priests) {
        if (p.state !== 'ACTIVE' || p.owner === fence.owner) continue;
        if (this.pointToSegmentDist(p.x, p.y, fence.ax, fence.ay, fence.bx, fence.by) <= 0.62) {
          this.damagePriest(p, 11, fence.owner);
          this.spawnBurst(p.x, p.y, '#38bdf8', 5, 36);
        }
      }
      for (const g of [...this.state.golems]) {
        if (g.owner === fence.owner) continue;
        if (this.pointToSegmentDist(g.x, g.y, fence.ax, fence.ay, fence.bx, fence.by) <= 0.62) {
          this.damageGolem(g, 14);
          this.spawnBurst(g.x, g.y, '#38bdf8', 5, 36);
        }
      }
    }
  }

  private updateBridgeMines(_dt: number): void {
    const mines = this.state.structures.filter((s) => s.kind === 'BRIDGE_MINE');
    if (mines.length === 0) return;

    for (const mine of mines) {
      let triggered = false;
      for (const p of this.state.priests) {
        if (p.state === 'ACTIVE' && p.owner !== mine.owner && Math.hypot(p.x - mine.tx, p.y - mine.ty) <= 0.92) {
          triggered = true;
          break;
        }
      }
      if (!triggered) {
        for (const g of this.state.golems) {
          if (g.owner !== mine.owner && Math.hypot(g.x - mine.tx, g.y - mine.ty) <= 0.92) {
            triggered = true;
            break;
          }
        }
      }
      if (triggered) {
        this.state.structures = this.state.structures.filter((s) => s.id !== mine.id);
        this.applyAreaDamage(mine.owner, mine.tx, mine.ty, 1.75, 95, 1.25);
        this.spawnBurst(mine.tx, mine.ty, '#f97316', 24, 92);
        this.spawnImpact(mine.tx, mine.ty, 'SCORCH_RING', '#fb923c', 1.4, 1.35);
        this.triggerShake(2.8, mine.tx, mine.ty);
        this.addFloatingText(mine.tx, mine.ty, 'SNARE DETONATED!', '#fb923c');
        this.emitAudio({
          type: 'PROJECTILE_IMPACT',
          alignment: 'SUN',
          heavy: true,
          tx: mine.tx,
          ty: mine.ty,
        });
        if (this.selectedKind === 'STRUCTURE' && this.selectedId === mine.id) {
          this.selectedKind = null;
          this.selectedId = null;
        }
      }
    }
  }

  private updateAerialUnits(dt: number): void {
    for (const a of [...this.state.aerialUnits]) {
      if (a.hitFlash > 0) a.hitFlash = Math.max(0, a.hitFlash - dt * 5);
      if (a.cooldown > 0) a.cooldown = Math.max(0, a.cooldown - dt);
      a.animPhase += dt * (a.kind === 'ROVING_WHIRLWIND' ? 8.5 : 3.2);

      const def = AERIAL_CATALOG[a.kind];

      // 1. Sky Transport Priest-Airlift Behavior
      if (def.canTransportPriest && isFactionId(a.owner)) {
        const ownerId = a.owner;
        if (a.carryingPriestId !== null) {
          const altar = this.state.structures.find((s) => s.owner === ownerId && s.kind === 'ALTAR');
          const captive = this.state.priests.find((p) => p.id === a.carryingPriestId);
          if (!altar || !captive) {
            a.carryingPriestId = null;
            a.returningToAltar = false;
          } else {
            if (a.returningToAltar) {
              a.targetX = altar.tx;
              a.targetY = altar.ty;
            }
            if (Math.hypot(a.x - altar.tx, a.y - altar.ty) <= 1.25) {
              a.carryingPriestId = null;
              a.returningToAltar = false;
              this.beginSacrifice(ownerId, captive, altar);
            }
          }
        } else if (a.captureTargetPriestId !== null) {
          const target = this.state.priests.find((p) => p.id === a.captureTargetPriestId);
          if (!target || target.state !== 'STUNNED') {
            a.captureTargetPriestId = null;
          } else {
            a.targetX = target.x;
            a.targetY = target.y;
            if (Math.hypot(a.x - target.x, a.y - target.y) <= 1.15) {
              target.state = 'CARRIED';
              target.carriedByPriestId = null;
              a.carryingPriestId = target.id;
              a.captureTargetPriestId = null;
              a.returningToAltar = true;
              const altar = this.state.structures.find((s) => s.owner === ownerId && s.kind === 'ALTAR');
              if (altar) {
                a.targetX = altar.tx;
                a.targetY = altar.ty;
              }
              this.spawnBurst(target.x, target.y, '#67e8f9', 14, 60);
              this.addFloatingText(a.x, a.y, 'AIRLIFTED!', '#67e8f9');
              this.pushAlert('Aether Dirigible airlifted the stunned Priest! Returning to Altar!', 'SACRIFICE', 5);
              this.emitHud();
            }
          }
        } else {
          // Automatic pickup if hovering right over a stunned hostile Priest
          const nearbyStunned = this.state.priests.find(
            (p) => p.state === 'STUNNED' && p.owner !== ownerId && Math.hypot(p.x - a.x, p.y - a.y) <= 1.1
          );
          if (nearbyStunned) {
            nearbyStunned.state = 'CARRIED';
            nearbyStunned.carriedByPriestId = null;
            a.carryingPriestId = nearbyStunned.id;
            a.returningToAltar = true;
            const altar = this.state.structures.find((s) => s.owner === ownerId && s.kind === 'ALTAR');
            if (altar) {
              a.targetX = altar.tx;
              a.targetY = altar.ty;
            }
            this.addFloatingText(a.x, a.y, 'AIRLIFTED!', '#67e8f9');
          }
        }
      }

      // 2. Roving Whirlwind autonomous hunter drift when close to waypoint
      if (a.kind === 'ROVING_WHIRLWIND' && Math.hypot(a.targetX - a.x, a.targetY - a.y) < 0.7) {
        let nearest: { x: number; y: number; dist: number } | null = null;
        for (const p of this.state.priests) {
          if (p.state !== 'ACTIVE' || p.owner === a.owner) continue;
          const d = Math.hypot(p.x - a.x, p.y - a.y);
          if (d <= 12 && (!nearest || d < nearest.dist)) nearest = { x: p.x, y: p.y, dist: d };
        }
        if (!nearest) {
          for (const st of this.state.structures) {
            if (st.owner === a.owner || st.kind === 'ALTAR' || st.kind === 'BRIDGE_MINE') continue;
            if (st.kind === 'TEMPLE' && !this.victoryRules.templeDestruction) continue;
            const d = Math.hypot(st.tx - a.x, st.ty - a.y);
            if (d <= 11 && (!nearest || d < nearest.dist)) nearest = { x: st.tx, y: st.ty, dist: d };
          }
        }
        if (nearest) {
          a.targetX = nearest.x;
          a.targetY = nearest.y;
        }
      }

      // 3. Flight kinematics over open sky
      const dx = a.targetX - a.x;
      const dy = a.targetY - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.08) {
        const moveSpeed = def.speed * (a.carryingPriestId !== null ? 0.85 : 1);
        const step = Math.min(dist, moveSpeed * dt);
        a.x = Math.max(0.5, Math.min(this.state.gridSize - 1.5, a.x + (dx / dist) * step));
        a.y = Math.max(0.5, Math.min(this.state.gridSize - 1.5, a.y + (dy / dist) * step));
        a.heading = Math.atan2(dy, dx);
      }

      // 4. Aerial Weapons
      if (def.fireRate > 0 && def.damage > 0 && a.cooldown <= 0) {
        if (a.kind === 'ROVING_WHIRLWIND') {
          // Continuous AoE vortex pulse if any enemy is within range
          const hasEnemyInRange =
            this.state.priests.some((p) => p.state === 'ACTIVE' && p.owner !== a.owner && Math.hypot(p.x - a.x, p.y - a.y) <= def.range) ||
            this.state.golems.some((g) => g.owner !== a.owner && Math.hypot(g.x - a.x, g.y - a.y) <= def.range) ||
            this.state.aerialUnits.some((o) => o.owner !== a.owner && Math.hypot(o.x - a.x, o.y - a.y) <= def.range) ||
            this.state.structures.some(
              (st) =>
                st.owner !== a.owner &&
                st.kind !== 'ALTAR' &&
                (st.kind !== 'TEMPLE' || this.victoryRules.templeDestruction) &&
                Math.hypot(st.tx - a.x, st.ty - a.y) <= def.range
            );
          if (hasEnemyInRange) {
            this.applyAreaDamage(a.owner, a.x, a.y, def.range, def.damage, 1.25);
            this.spawnBurst(a.x, a.y, '#5eead4', 8, 46);
            a.cooldown = 1 / def.fireRate;
          }
        } else {
          // Acquire closest hostile target in range (aerial -> priest -> golem -> structure -> bridge)
          let target: { x: number; y: number } | null = null;
          let bestScore = -999;

          for (const other of this.state.aerialUnits) {
            if (other.owner === a.owner) continue;
            const d = Math.hypot(other.x - a.x, other.y - a.y);
            if (d <= def.range && 125 - d * 5 > bestScore) {
              bestScore = 125 - d * 5;
              target = { x: other.x, y: other.y };
            }
          }
          for (const p of this.state.priests) {
            if (p.state !== 'ACTIVE' || p.owner === a.owner) continue;
            const d = Math.hypot(p.x - a.x, p.y - a.y);
            if (d <= def.range && 115 - d * 5 > bestScore) {
              bestScore = 115 - d * 5;
              target = { x: p.x, y: p.y };
            }
          }
          for (const g of this.state.golems) {
            if (g.owner === a.owner) continue;
            const d = Math.hypot(g.x - a.x, g.y - a.y);
            if (d <= def.range && 95 - d * 5 > bestScore) {
              bestScore = 95 - d * 5;
              target = { x: g.x, y: g.y };
            }
          }
          for (const st of this.state.structures) {
            if (st.owner === a.owner || st.kind === 'ALTAR' || st.kind === 'BRIDGE_MINE') continue;
            if (st.kind === 'TEMPLE' && !this.victoryRules.templeDestruction) continue;
            const d = Math.hypot(st.tx - a.x, st.ty - a.y);
            if (d <= def.range && 88 - d * 5 > bestScore) {
              bestScore = 88 - d * 5;
              target = { x: st.tx, y: st.ty };
            }
          }

          if (target) {
            const tdx = target.x - a.x;
            const tdy = target.y - a.y;
            const tdist = Math.hypot(tdx, tdy) || 1;
            const speed = a.kind === 'SKY_LEVIATHAN' ? 10.5 : 13;
            this.state.projectiles.push({
              id: this.state.nextEntityId++,
              owner: a.owner,
              alignment: def.alignment,
              kind: a.kind === 'SKY_LEVIATHAN' ? 'MANOWAR_BOLT' : 'WIND_BOLT',
              x: a.x,
              y: a.y,
              vx: (tdx / tdist) * speed,
              vy: (tdy / tdist) * speed,
              targetX: target.x,
              targetY: target.y,
              damage: def.damage,
              splashRadius: a.kind === 'SKY_LEVIATHAN' ? 0.9 : 0,
              pierceLeft: 1,
              hitEntityIds: [],
              directional: false,
              life: tdist / speed + 0.14,
              maxLife: tdist / speed + 0.14,
              arcHeight: 16,
              age: 0,
              bridgeBonus: 1.15,
            });
            a.heading = Math.atan2(tdy, tdx);
            a.cooldown = 1 / def.fireRate;
          }
        }
      }
    }
  }

  private releaseAerialCarriedPriest(a: AerialUnit): void {
    if (a.carryingPriestId === null) return;
    const captive = this.state.priests.find((p) => p.id === a.carryingPriestId);
    if (captive) {
      captive.state = 'ACTIVE';
      captive.carriedByPriestId = null;
      captive.hp = Math.round(captive.maxHp * 0.7);
      captive.x = captive.homeTx;
      captive.y = captive.homeTy;
      captive.targetPath = [];
      this.addFloatingText(captive.x, captive.y, 'PRIEST RESCUED!', '#38bdf8');
    }
    a.carryingPriestId = null;
    a.returningToAltar = false;
  }

  private releaseGolemCarriedPriest(g: Golem): void {
    if (g.carryingPriestId === null) return;
    const captive = this.state.priests.find((p) => p.id === g.carryingPriestId);
    if (captive) {
      captive.state = 'ACTIVE';
      captive.carriedByPriestId = null;
      captive.hp = Math.round(captive.maxHp * 0.7);
      captive.x = captive.homeTx;
      captive.y = captive.homeTy;
      captive.targetPath = [];
      this.addFloatingText(captive.x, captive.y, 'PRIEST RESCUED!', '#38bdf8');
    }
    g.carryingPriestId = null;
    g.captureTargetPriestId = null;
  }

  private damageAerialUnit(a: AerialUnit, amount: number, _attacker: Owner): void {
    a.hp -= amount;
    a.hitFlash = 1;
    if (a.hp <= 0) {
      this.releaseAerialCarriedPriest(a);
      this.state.aerialUnits = this.state.aerialUnits.filter((item) => item.id !== a.id);
      this.spawnBurst(a.x, a.y, '#67e8f9', 16, 68);
      this.spawnImpact(a.x, a.y, 'CRUMBLE', '#bae6fd', 0.85, 0.9);
      this.emitAudio({
        type: 'PROJECTILE_IMPACT',
        alignment: AERIAL_CATALOG[a.kind].alignment,
        heavy: false,
        tx: a.x,
        ty: a.y,
      });
      if (this.selectedKind === 'AERIAL' && this.selectedId === a.id) {
        this.selectedKind = null;
        this.selectedId = null;
      }
      this.recomputeFogOfWar();
    }
  }

  private offerPlayerTechUnlock(stolenFury?: Fury): void {
    const pf = this.state.factions.PLAYER;
    const choices = buildTechUnlockChoices(pf.fury, pf.unlockedTechs, stolenFury);
    if (choices.length > 0) {
      this.state.pendingTechChoices = choices;
    }
  }

  private acquireTargetForStructure(
    s: Structure
  ): { x: number; y: number; entityType: 'PRIEST' | 'GOLEM' | 'AERIAL' | 'STRUCTURE' | 'BRIDGE'; id?: number } | null {
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
      entityType: 'PRIEST' | 'GOLEM' | 'AERIAL' | 'STRUCTURE' | 'BRIDGE';
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

    // 2. Hostile Aerial Units (airlifts carrying a Priest are top priority!)
    for (const a of this.state.aerialUnits) {
      if (!isEnemy(a.owner)) continue;
      const check = isInArc(a.x, a.y);
      if (check.ok) {
        const score = (a.carryingPriestId !== null ? 155 : 108) - check.dist * 4;
        if (!best || score > best.score) best = { x: a.x, y: a.y, entityType: 'AERIAL', id: a.id, score };
      }
    }

    // 3. Hostile Golems
    for (const g of this.state.golems) {
      if (!isEnemy(g.owner)) continue;
      const check = isInArc(g.x, g.y);
      if (check.ok) {
        const score = (g.carryingPriestId !== null ? 140 : 95) - check.dist * 5;
        if (!best || score > best.score) best = { x: g.x, y: g.y, entityType: 'GOLEM', id: g.id, score };
      }
    }

    // 4. Hostile Structures (skip Altars & camouflaged Bridge Mines)
    for (const st of this.state.structures) {
      if (!isEnemy(st.owner)) continue;
      if (st.kind === 'ALTAR' || st.kind === 'BRIDGE_MINE') continue;
      if (st.kind === 'TEMPLE' && !this.victoryRules.templeDestruction) continue;
      const check = isInArc(st.tx, st.ty);
      if (check.ok) {
        const baseScore =
          STRUCTURE_CATALOG[st.kind].fireRate > 0 ? 90 : st.kind === 'TEMPLE' ? 84 : 72;
        const score = baseScore - check.dist * 5;
        if (!best || score > best.score) best = { x: st.tx, y: st.ty, entityType: 'STRUCTURE', id: st.id, score };
      }
    }

    // 5. Hostile Bridges (enables iconic bridge-cutting!)
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
        if (st.owner === s.owner || st.kind === 'ALTAR' || st.kind === 'BRIDGE_MINE') continue;
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
      for (const a of this.state.aerialUnits) {
        if (a.owner === s.owner || !isFresh(a.x, a.y)) continue;
        const d = Math.hypot(a.x - curX, a.y - curY);
        if (d <= 2.6 && (!next || d < next.dist)) next = { x: a.x, y: a.y, dist: d };
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

      // Directional projectiles are intercepted by Stone/Glacial Bulwarks and linked Barrier Energy Fences!
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
        } else {
          // Check linked Barrier Pylon Energy Fences
          for (const fence of this.state.energyFences) {
            if (!fence.active || fence.owner === proj.owner) continue;
            if (this.pointToSegmentDist(proj.x, proj.y, fence.ax, fence.ay, fence.bx, fence.by) <= 0.42) {
              this.spawnBurst(proj.x, proj.y, '#38bdf8', 9, 52);
              expired = true;
              break;
            }
          }
        }
      }

      // Check direct hit against enemy structures, golems, aerial units, priests, or target tile
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
            for (const a of [...this.state.aerialUnits]) {
              if (a.owner === proj.owner || proj.hitEntityIds.includes(a.id)) continue;
              if (Math.hypot(a.x - proj.x, a.y - proj.y) <= 0.72) {
                proj.hitEntityIds.push(a.id);
                this.damageAerialUnit(a, proj.damage, proj.owner);
                hit = true;
                break;
              }
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
              if (st.owner === proj.owner || st.kind === 'ALTAR' || st.kind === 'BRIDGE_MINE') continue;
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
    for (const a of [...this.state.aerialUnits]) {
      if (a.owner !== attacker && Math.hypot(a.x - cx, a.y - cy) <= radius) {
        this.damageAerialUnit(a, damage, attacker);
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

      const defLost = STRUCTURE_CATALOG[st.kind];
      if (defLost.isPowerHub || defLost.isFencePylon || st.kind === 'WATCHTOWER') {
        recomputePowerGrids(this.state);
        this.recomputeEnergyFences();
        this.recomputeFogOfWar();
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

      // Any Golem standing on the collapsed bridge falls into the abyss (rescuing any captive Priest!)
      const doomedGolems = this.state.golems.filter((g) => Math.round(g.x) === tx && Math.round(g.y) === ty);
      for (const dg of doomedGolems) {
        this.releaseGolemCarriedPriest(dg);
      }
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
      this.recomputeEnergyFences();
      this.recomputeFogOfWar();
      if (lostOwner === 'PLAYER') {
        this.pushAlert('A bridge section collapsed! Check your Aether power grid.', 'WARNING', 4.5);
      }
    }
  }

  private damageGolem(g: Golem, amount: number): void {
    g.hp -= amount;
    g.hitFlash = 1;
    if (g.hp <= 0) {
      this.releaseGolemCarriedPriest(g);
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
    const effective = p.shieldTimer > 0 ? amount * 0.5 : amount;
    p.hp -= effective;
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
      if (p.shieldTimer > 0) p.shieldTimer = Math.max(0, p.shieldTimer - dt);
      if (p.abilityCooldowns.RECALL > 0) p.abilityCooldowns.RECALL = Math.max(0, p.abilityCooldowns.RECALL - dt);
      if (p.abilityCooldowns.SANCTUARY > 0) p.abilityCooldowns.SANCTUARY = Math.max(0, p.abilityCooldowns.SANCTUARY - dt);
      if (p.abilityCooldowns.TEMPEST_CAST > 0) p.abilityCooldowns.TEMPEST_CAST = Math.max(0, p.abilityCooldowns.TEMPEST_CAST - dt);

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

      // 1. Golem hauling a captured Priest back to own Altar!
      if (g.task === 'RETURNING_PRIEST' && g.carryingPriestId !== null && isFactionId(g.owner)) {
        const altar = this.state.structures.find((s) => s.owner === g.owner && s.kind === 'ALTAR');
        const captive = this.state.priests.find((pr) => pr.id === g.carryingPriestId);
        if (!altar || !captive) {
          g.carryingPriestId = null;
          g.task = 'IDLE';
          continue;
        }
        if (Math.hypot(g.x - altar.tx, g.y - altar.ty) <= 1.35) {
          g.carryingPriestId = null;
          g.task = 'IDLE';
          this.beginSacrifice(g.owner, captive, altar);
        } else if (g.repathCooldown <= 0) {
          const path = findTilePath(this.state, g.x, g.y, altar.tx, altar.ty);
          if (path) g.path = path;
          g.repathCooldown = 1.1;
        }
        continue;
      }

      // 2. Golem marching to pick up a stunned hostile/rogue Priest
      if (g.task === 'CAPTURING_PRIEST' && g.captureTargetPriestId !== null && isFactionId(g.owner)) {
        const target = this.state.priests.find((pr) => pr.id === g.captureTargetPriestId);
        if (!target || target.state !== 'STUNNED') {
          g.captureTargetPriestId = null;
          g.task = 'IDLE';
          continue;
        }
        if (Math.hypot(g.x - target.x, g.y - target.y) <= 1.2) {
          target.state = 'CARRIED';
          target.carriedByPriestId = null;
          g.carryingPriestId = target.id;
          g.captureTargetPriestId = null;
          g.task = 'RETURNING_PRIEST';
          this.spawnBurst(target.x, target.y, '#fde047', 12, 52);
          this.addFloatingText(g.x, g.y, 'HAULING PRIEST!', '#fde047');
          const altar = this.state.structures.find((s) => s.owner === g.owner && s.kind === 'ALTAR');
          if (altar) {
            const path = findTilePath(this.state, g.x, g.y, altar.tx, altar.ty);
            if (path) g.path = path;
          }
        } else if (g.repathCooldown <= 0) {
          const path = findTilePath(this.state, g.x, g.y, target.x, target.y);
          if (path) g.path = path;
          else {
            g.captureTargetPriestId = null;
            g.task = 'IDLE';
          }
          g.repathCooldown = 1.2;
        }
        continue;
      }

      // 3. Golem returning harvested Crystal to High Temple
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

      // 4. Golem harvesting an Aether Crystal
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

      // 5. Golem auto-repairing a nearby damaged allied structure or bridge!
      if (g.task === 'REPAIRING' && g.repairTarget) {
        const rt = g.repairTarget;
        if (rt.kind === 'STRUCTURE') {
          const st = this.state.structures.find((s) => s.id === rt.id && s.owner === g.owner);
          if (!st || st.hp >= st.maxHp - 0.5) {
            g.repairTarget = null;
            g.task = 'IDLE';
            continue;
          }
          if (Math.hypot(g.x - st.tx, g.y - st.ty) <= 1.65) {
            st.hp = Math.min(st.maxHp, st.hp + 15 * dt);
            if (Math.random() < dt * 3.5) {
              this.spawnBurst(st.tx, st.ty, '#fde047', 2, 22);
            }
          } else if (g.repathCooldown <= 0) {
            const path = findTilePath(this.state, g.x, g.y, st.tx, st.ty);
            if (path) g.path = path;
            else {
              g.repairTarget = null;
              g.task = 'IDLE';
            }
            g.repathCooldown = 1.2;
          }
          continue;
        } else {
          const tile = inBounds(rt.tx, rt.ty, this.state.gridSize) ? this.state.tiles[rt.ty][rt.tx] : null;
          if (!tile || tile.kind !== 'BRIDGE' || tile.owner !== g.owner || tile.hp >= tile.maxHp - 0.5) {
            g.repairTarget = null;
            g.task = 'IDLE';
            continue;
          }
          if (Math.hypot(g.x - rt.tx, g.y - rt.ty) <= 1.65) {
            tile.hp = Math.min(tile.maxHp, tile.hp + 18 * dt);
            if (Math.random() < dt * 3.5) {
              this.spawnBurst(rt.tx, rt.ty, '#fde047', 2, 22);
            }
          } else if (g.repathCooldown <= 0) {
            const path = findTilePath(this.state, g.x, g.y, rt.tx, rt.ty);
            if (path) g.path = path;
            else {
              g.repairTarget = null;
              g.task = 'IDLE';
            }
            g.repathCooldown = 1.2;
          }
          continue;
        }
      }

      // IDLE: 1st priority — Find nearest reachable unclaimed Aether Crystal
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

      // 2nd priority when no crystals available — Auto-repair damaged allied structures!
      if (!found) {
        const damagedStruct = this.state.structures
          .filter((s) => s.owner === g.owner && s.hp < s.maxHp * 0.95 && Math.hypot(s.tx - g.x, s.ty - g.y) <= 15)
          .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        if (damagedStruct) {
          const path = findTilePath(this.state, g.x, g.y, damagedStruct.tx, damagedStruct.ty);
          if (path && path.length > 0) {
            g.task = 'REPAIRING';
            g.repairTarget = { kind: 'STRUCTURE', tx: damagedStruct.tx, ty: damagedStruct.ty, id: damagedStruct.id };
            g.path = path;
            found = true;
          }
        }
      }

      // 3rd priority — Auto-repair nearby damaged allied bridges!
      if (!found) {
        const N = this.state.gridSize;
        const r = 10;
        let bestBridge: { tx: number; ty: number; ratio: number } | null = null;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const tx = Math.round(g.x) + dx;
            const ty = Math.round(g.y) + dy;
            if (!inBounds(tx, ty, N)) continue;
            const t = this.state.tiles[ty][tx];
            if (t.kind === 'BRIDGE' && t.owner === g.owner && t.hp < t.maxHp * 0.85) {
              const ratio = t.hp / Math.max(1, t.maxHp);
              if (!bestBridge || ratio < bestBridge.ratio) {
                bestBridge = { tx, ty, ratio };
              }
            }
          }
        }
        if (bestBridge) {
          const path = findTilePath(this.state, g.x, g.y, bestBridge.tx, bestBridge.ty);
          if (path && path.length > 0) {
            g.task = 'REPAIRING';
            g.repairTarget = { kind: 'BRIDGE', tx: bestBridge.tx, ty: bestBridge.ty };
            g.path = path;
            found = true;
          }
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
      const ownTier2 = FURY_META[faction.fury].tier2Unit;
      if (sacrificer === 'PLAYER') {
        this.offerPlayerTechUnlock();
        this.addFloatingText(priest.x, priest.y, 'ALTAR KNOWLEDGE! +120 AE', '#fde047');
        this.pushAlert(
          unlockedTier2
            ? 'Altar Ritual complete! Choose your Altar Knowledge unlock (+120 Aether).'
            : 'Altar Ritual complete! Choose a cross-aspect or Sky Fleet unlock (+120 Aether).',
          'SACRIFICE',
          6
        );
      } else if (!faction.unlockedTechs.includes(ownTier2)) {
        faction.unlockedTechs.push(ownTier2);
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
    if (isFactionId(eliminator)) {
      const winnerFaction = this.state.factions[eliminator];
      if (winnerFaction) {
        unlockedTier2 = winnerFaction.knowledgeTier < 2;
        winnerFaction.knowledgeTier = 2;
        if (eliminator !== 'PLAYER') {
          const ownTier2 = FURY_META[winnerFaction.fury].tier2Unit;
          if (!winnerFaction.unlockedTechs.includes(ownTier2)) {
            winnerFaction.unlockedTechs.push(ownTier2);
          }
        }
      }
    }

    // Remove defeated rival's Golems & Aerial Units, release any captive they held, and dismiss their High Priest cleanly
    for (const g of this.state.golems) {
      if (g.owner === victimId) this.releaseGolemCarriedPriest(g);
    }
    this.state.golems = this.state.golems.filter((g) => g.owner !== victimId);
    for (const a of this.state.aerialUnits) {
      if (a.owner === victimId) this.releaseAerialCarriedPriest(a);
    }
    this.state.aerialUnits = this.state.aerialUnits.filter((a) => a.owner !== victimId);

    for (const p of this.state.priests) {
      if (p.owner === victimId && !p.isRogue) {
        this.releaseCarriedPriest(p);
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
    this.recomputeEnergyFences();

    const remainingRivals = this.state.aiFactionIds.filter(
      (id) => !this.state.factions[id].eliminated
    ).length;

    if (remainingRivals === 0) {
      this.outcomeReason = cause === 'TEMPLE' ? 'TEMPLE_DESTRUCTION' : 'PRIEST_SACRIFICE';
      this.phase = 'VICTORY';
      this.triggerVictoryCelebration(this.outcomeReason);
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
        this.offerPlayerTechUnlock(victimFaction.fury);
        this.addFloatingText(
          fxX,
          fxY,
          `${victimFaction.label.toUpperCase()} FALLEN! +150 AE`,
          '#fde047'
        );
      }
      this.pushAlert(
        eliminator === 'PLAYER'
          ? `${victimFaction.label} ${actionVerb}! Choose a stolen ${FURY_META[victimFaction.fury].name} or Sky tech (+150 AE). ${remainingRivals} rival${remainingRivals === 1 ? '' : 's'} remain.`
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
      this.triggerVictoryCelebration(reason);
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

  private triggerVictoryCelebration(reason: OutcomeReason): void {
    const playerFaction = this.state.factions.PLAYER;
    const aspectColor = FURY_META[playerFaction.fury].color;

    let theme: VictoryCelebrationTheme;
    let primaryColor: string;
    let accentColor: string;

    if (reason === 'AETHER_OVERLOAD') {
      theme = 'AETHER_COLLECTION';
      primaryColor = '#f0b429';
      accentColor = '#67e8f9';
    } else if (reason === 'PRIEST_SACRIFICE' || reason === 'ALTAR_DOMINANCE') {
      theme = 'ALTAR_RITUAL';
      primaryColor = '#c084fc';
      accentColor = '#f0b429';
    } else {
      theme = 'TEMPLE_SIEGE';
      primaryColor = '#f0b429';
      accentColor = aspectColor;
    }

    this.victoryCelebration = {
      theme,
      reason,
      elapsed: 0,
      burstTimer: 0.55,
      ambientTimer: 0.08,
      primaryColor,
      accentColor,
      particles: [],
      rings: [],
    };

    // World-space focal burst at the player's Temple or Altar/Sacred Sites
    if (theme === 'AETHER_COLLECTION') {
      const temple = this.state.structures.find((s) => s.owner === 'PLAYER' && s.kind === 'TEMPLE');
      if (temple) {
        this.spawnBurst(temple.tx, temple.ty, '#fde047', 26, 115);
        this.spawnBurst(temple.tx, temple.ty, '#67e8f9', 16, 85);
      }
      // Opening screen-space golden crystal prism bursts
      this.spawnVictoryCelebrationBurst(this.victoryCelebration, 0.5, 0.48, 1.25);
      this.spawnVictoryCelebrationBurst(this.victoryCelebration, 0.16, 0.72, 0.95);
      this.spawnVictoryCelebrationBurst(this.victoryCelebration, 0.84, 0.72, 0.95);
    } else if (theme === 'ALTAR_RITUAL') {
      const altar = this.state.structures.find((s) => s.owner === 'PLAYER' && s.kind === 'ALTAR');
      if (altar) {
        this.spawnBurst(altar.tx, altar.ty, '#c084fc', 24, 105);
        this.spawnBurst(altar.tx, altar.ty, '#fde047', 16, 85);
      }
      // Opening screen-space sacred ritual sigil blooms + ascending spirit waves
      this.spawnVictoryCelebrationBurst(this.victoryCelebration, 0.5, 0.5, 1.3);
      this.spawnVictoryCelebrationBurst(this.victoryCelebration, 0.2, 0.55, 0.9);
      this.spawnVictoryCelebrationBurst(this.victoryCelebration, 0.8, 0.55, 0.9);
    } else {
      const temple = this.state.structures.find((s) => s.owner === 'PLAYER' && s.kind === 'TEMPLE');
      if (temple) {
        this.spawnBurst(temple.tx, temple.ty, aspectColor, 24, 105);
      }
      this.spawnVictoryCelebrationBurst(this.victoryCelebration, 0.24, 0.34, 1.05);
      this.spawnVictoryCelebrationBurst(this.victoryCelebration, 0.76, 0.34, 1.05);
      this.spawnVictoryCelebrationBurst(this.victoryCelebration, 0.5, 0.42, 1.15);
    }
  }

  private spawnVictoryCelebrationBurst(
    cel: VictoryCelebrationState,
    nx: number,
    ny: number,
    intensity = 1
  ): void {
    const MAX_PARTICLES = 150;
    const aspectColor = FURY_META[this.state.factions.PLAYER.fury].color;

    if (cel.theme === 'AETHER_COLLECTION') {
      cel.rings.push({
        nx,
        ny,
        progress: 0,
        duration: 1.55,
        maxRadius: 0.24 * intensity,
        color: '#fde047',
        secondaryColor: '#67e8f9',
        style: 'CRYSTAL_PRISM',
        rotation: Math.random() * Math.PI * 0.5,
        vRot: (Math.random() < 0.5 ? -1 : 1) * 0.35,
      });

      const palette = ['#fde047', '#f0b429', '#fef08a', '#67e8f9', '#fbbf24'];
      const count = Math.round(24 * intensity);
      for (let i = 0; i < count && cel.particles.length < MAX_PARTICLES; i++) {
        const isCrystal = i % 3 !== 2;
        const angle = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.45;
        const speed = (isCrystal ? 0.16 : 0.26) + Math.random() * 0.24 * intensity;
        const col = palette[i % palette.length];
        cel.particles.push({
          nx: nx + (Math.random() - 0.5) * 0.03,
          ny: ny + (Math.random() - 0.5) * 0.03,
          vx: Math.cos(angle) * speed * 0.85,
          vy: Math.sin(angle) * speed - (isCrystal ? 0.14 : 0.08),
          size: isCrystal ? 7 + Math.random() * 7 : 3 + Math.random() * 3.5,
          rotation: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * (isCrystal ? 4.2 : 2.5),
          life: 1.9 + Math.random() * 1.4,
          maxLife: 3.3,
          color: col,
          coreColor: '#ffffff',
          shape: isCrystal ? 'CRYSTAL' : i % 6 === 2 ? 'STAR' : 'SPARK',
          swayPhase: Math.random() * Math.PI * 2,
          swayAmp: isCrystal ? 0.015 : 0.008,
          swayFreq: 2.2 + Math.random() * 1.5,
          gravity: isCrystal ? 0.26 : 0.14,
          drag: 0.96,
          twinkleSpeed: 6 + Math.random() * 5,
          runeVariant: i % 3,
        });
      }
    } else if (cel.theme === 'ALTAR_RITUAL') {
      cel.rings.push({
        nx,
        ny,
        progress: 0,
        duration: 2.1,
        maxRadius: 0.25 * intensity,
        color: '#c084fc',
        secondaryColor: '#f0b429',
        style: 'RITUAL_SIGIL',
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() < 0.5 ? -1 : 1) * 0.45,
      });

      const palette = ['#c084fc', '#e879f9', '#f0b429', '#fde047', aspectColor];
      const count = Math.round(22 * intensity);
      for (let i = 0; i < count && cel.particles.length < MAX_PARTICLES; i++) {
        const angle = (i / Math.max(1, count)) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
        const speed = 0.08 + Math.random() * 0.14 * intensity;
        const shape: VictoryCelebrationParticle['shape'] =
          i % 4 === 0 ? 'RUNE' : i % 4 === 1 || i % 4 === 2 ? 'WISP' : 'STAR';
        const col = palette[i % palette.length];
        cel.particles.push({
          nx: nx + Math.cos(angle) * 0.025,
          ny: ny + Math.sin(angle) * 0.025,
          vx: Math.cos(angle) * speed * 0.72,
          vy: Math.sin(angle) * speed * 0.6 - 0.11,
          size: shape === 'RUNE' ? 9 + Math.random() * 5 : shape === 'WISP' ? 6 + Math.random() * 5 : 4 + Math.random() * 3.5,
          rotation: shape === 'RUNE' ? (Math.random() - 0.5) * 0.35 : Math.random() * Math.PI * 2,
          vRot: shape === 'RUNE' ? (Math.random() - 0.5) * 0.55 : (Math.random() - 0.5) * 2.2,
          life: 2.3 + Math.random() * 1.6,
          maxLife: 3.9,
          color: col,
          coreColor: shape === 'RUNE' ? '#fef08a' : '#ffffff',
          shape,
          swayPhase: Math.random() * Math.PI * 2,
          swayAmp: shape === 'WISP' ? 0.045 : 0.025,
          swayFreq: 2.0 + Math.random() * 1.4,
          gravity: -0.055,
          drag: 0.94,
          twinkleSpeed: 4.5 + Math.random() * 4,
          runeVariant: i % 4,
        });
      }
    } else {
      cel.rings.push({
        nx,
        ny,
        progress: 0,
        duration: 1.45,
        maxRadius: 0.2 * intensity,
        color: '#fde047',
        secondaryColor: aspectColor,
        style: 'SIEGE_BURST',
        rotation: Math.random() * Math.PI * 2,
        vRot: 0.4,
      });

      const palette = ['#fef08a', '#f0b429', aspectColor, '#fb923c', '#ffffff'];
      const count = Math.round(24 * intensity);
      for (let i = 0; i < count && cel.particles.length < MAX_PARTICLES; i++) {
        const angle = (i / Math.max(1, count)) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
        const speed = 0.14 + Math.random() * 0.22 * intensity;
        const shape: VictoryCelebrationParticle['shape'] = i % 3 === 0 ? 'STAR' : 'SPARK';
        cel.particles.push({
          nx,
          ny,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.06,
          size: shape === 'STAR' ? 6 + Math.random() * 4.5 : 3.5 + Math.random() * 3,
          rotation: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 3.8,
          life: 1.6 + Math.random() * 1.2,
          maxLife: 2.8,
          color: palette[i % palette.length],
          coreColor: '#ffffff',
          shape,
          swayPhase: Math.random() * Math.PI * 2,
          swayAmp: 0.01,
          swayFreq: 2.4,
          gravity: 0.2,
          drag: 0.95,
          twinkleSpeed: 7 + Math.random() * 5,
          runeVariant: i % 3,
        });
      }
    }
  }

  private spawnVictoryAmbientParticles(cel: VictoryCelebrationState): void {
    const MAX_PARTICLES = 150;
    if (cel.particles.length >= MAX_PARTICLES) return;
    const aspectColor = FURY_META[this.state.factions.PLAYER.fury].color;

    if (cel.theme === 'AETHER_COLLECTION') {
      // Rising fountains of golden faceted crystals & prism sparks along left/right flanks
      const side = Math.random() < 0.5 ? 0.06 + Math.random() * 0.22 : 0.72 + Math.random() * 0.22;
      const isCrystal = Math.random() < 0.62;
      cel.particles.push({
        nx: side,
        ny: 1.03,
        vx: (side < 0.5 ? 1 : -1) * (0.02 + Math.random() * 0.06) + (Math.random() - 0.5) * 0.05,
        vy: -(0.34 + Math.random() * 0.22),
        size: isCrystal ? 6.5 + Math.random() * 6 : 3 + Math.random() * 3,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 3.4,
        life: 2.4 + Math.random() * 1.2,
        maxLife: 3.6,
        color: Math.random() < 0.24 ? '#67e8f9' : Math.random() < 0.55 ? '#fde047' : '#f0b429',
        coreColor: '#ffffff',
        shape: isCrystal ? 'CRYSTAL' : 'SPARK',
        swayPhase: Math.random() * Math.PI * 2,
        swayAmp: 0.012,
        swayFreq: 2.4,
        gravity: 0.21,
        drag: 0.985,
        twinkleSpeed: 6.5,
        runeVariant: 0,
      });
    } else if (cel.theme === 'ALTAR_RITUAL') {
      // Ethereal rising soul wisps & floating arcane runes spiraling gently upward across the screen
      const nx = Math.random() < 0.8 ? (Math.random() < 0.5 ? 0.05 + Math.random() * 0.26 : 0.69 + Math.random() * 0.26) : 0.28 + Math.random() * 0.44;
      const roll = Math.random();
      const shape: VictoryCelebrationParticle['shape'] = roll < 0.34 ? 'RUNE' : roll < 0.78 ? 'WISP' : 'STAR';
      cel.particles.push({
        nx,
        ny: 1.02,
        vx: (Math.random() - 0.5) * 0.025,
        vy: -(0.12 + Math.random() * 0.11),
        size: shape === 'RUNE' ? 8.5 + Math.random() * 5 : shape === 'WISP' ? 5.5 + Math.random() * 4.5 : 4 + Math.random() * 3,
        rotation: shape === 'RUNE' ? (Math.random() - 0.5) * 0.3 : Math.random() * Math.PI * 2,
        vRot: shape === 'RUNE' ? (Math.random() - 0.5) * 0.45 : (Math.random() - 0.5) * 1.8,
        life: 3.2 + Math.random() * 1.8,
        maxLife: 5.0,
        color: roll < 0.45 ? '#c084fc' : roll < 0.72 ? '#e879f9' : roll < 0.9 ? '#f0b429' : aspectColor,
        coreColor: '#fef08a',
        shape,
        swayPhase: Math.random() * Math.PI * 2,
        swayAmp: 0.04 + Math.random() * 0.03,
        swayFreq: 1.8 + Math.random() * 1.2,
        gravity: -0.025,
        drag: 0.99,
        twinkleSpeed: 4.5,
        runeVariant: Math.floor(Math.random() * 4),
      });
    } else {
      // Rising triumph embers along the flanks
      const nx = Math.random() < 0.5 ? 0.04 + Math.random() * 0.25 : 0.71 + Math.random() * 0.25;
      cel.particles.push({
        nx,
        ny: 1.02,
        vx: (Math.random() - 0.5) * 0.04,
        vy: -(0.18 + Math.random() * 0.14),
        size: 3.5 + Math.random() * 3.5,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 3,
        life: 2.2 + Math.random() * 1.2,
        maxLife: 3.4,
        color: Math.random() < 0.5 ? '#fde047' : aspectColor,
        coreColor: '#ffffff',
        shape: Math.random() < 0.45 ? 'STAR' : 'SPARK',
        swayPhase: Math.random() * Math.PI * 2,
        swayAmp: 0.022,
        swayFreq: 2.5,
        gravity: 0.03,
        drag: 0.985,
        twinkleSpeed: 6,
        runeVariant: 0,
      });
    }
  }

  private updateVictoryCelebration(dt: number): void {
    const cel = this.victoryCelebration;
    if (!cel) return;

    cel.elapsed += dt;
    cel.burstTimer -= dt;
    cel.ambientTimer -= dt;

    if (cel.ambientTimer <= 0) {
      cel.ambientTimer = cel.theme === 'AETHER_COLLECTION' ? 0.085 : 0.11;
      this.spawnVictoryAmbientParticles(cel);
    }

    if (cel.burstTimer <= 0) {
      cel.burstTimer = cel.theme === 'AETHER_COLLECTION' ? 0.85 + Math.random() * 0.45 : 1.05 + Math.random() * 0.55;
      // Frame bursts predominantly around the perimeter of the centered victory card so they shine vividly
      const leftSide = Math.random() < 0.5;
      const bx = leftSide ? 0.08 + Math.random() * 0.22 : 0.7 + Math.random() * 0.22;
      const by =
        cel.theme === 'AETHER_COLLECTION'
          ? 0.22 + Math.random() * 0.52
          : cel.theme === 'ALTAR_RITUAL'
            ? 0.24 + Math.random() * 0.5
            : 0.15 + Math.random() * 0.35;
      this.spawnVictoryCelebrationBurst(cel, bx, by, 0.82 + Math.random() * 0.32);
    }

    // Update rings
    cel.rings = cel.rings.filter((r) => {
      r.progress += dt / r.duration;
      r.rotation += r.vRot * dt;
      return r.progress < 1;
    });

    // Update particles
    const nextParticles: VictoryCelebrationParticle[] = [];
    for (const pt of cel.particles) {
      pt.life -= dt;
      if (pt.life <= 0) continue;
      const dragPow = Math.pow(pt.drag, dt * 60);
      pt.vx *= dragPow;
      pt.vy = pt.vy * dragPow + pt.gravity * dt;
      const sway = Math.cos(cel.elapsed * pt.swayFreq + pt.swayPhase) * pt.swayAmp;
      pt.nx += (pt.vx + sway) * dt;
      pt.ny += pt.vy * dt;
      pt.rotation += pt.vRot * dt;
      if (pt.nx > -0.15 && pt.nx < 1.15 && pt.ny > -0.18 && pt.ny < 1.18) {
        nextParticles.push(pt);
      }
    }
    cel.particles = nextParticles;
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
      victoryCelebration: this.phase === 'VICTORY' ? this.victoryCelebration : null,
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
      const canReclaim = s.owner === 'PLAYER' && s.kind !== 'TEMPLE' && s.kind !== 'ALTAR' && def.cost > 0;
      const reclaimRefund = canReclaim ? Math.max(5, Math.round(def.cost * RECLAIM_REFUND_RATE)) : undefined;
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
        canReclaim,
        reclaimRefund,
      };
    }

    if (this.selectedKind === 'AERIAL') {
      const a = this.state.aerialUnits.find((u) => u.id === this.selectedId);
      if (!a) return null;
      const def = AERIAL_CATALOG[a.kind];
      return {
        kind: 'AERIAL',
        id: a.id,
        title: def.name,
        subtitle:
          a.owner === 'PLAYER'
            ? def.canTransportPriest
              ? 'Click anywhere to fly · Click stunned Priests to airlift'
              : 'Click anywhere on map to fly & engage'
            : `${this.getFactionLabel(a.owner)} Sky Unit`,
        owner: a.owner,
        factionColor: this.getFactionColor(a.owner),
        hp: Math.ceil(a.hp),
        maxHp: a.maxHp,
        statusText:
          a.carryingPriestId !== null
            ? 'Airlifting Captured Priest to Altar'
            : a.captureTargetPriestId !== null
              ? 'Flying to Airlift Stunned Priest'
              : def.fireRate > 0
                ? `Airborne · ${def.damage} dmg · Vision ${def.visionRadius}`
                : `Airborne Scout & Transport · Vision ${def.visionRadius}`,
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
          ? 'Shrine Ritual unlocks Altar Knowledge'
          : p.owner === 'PLAYER'
            ? 'Click ground to walk · Q Recall · E Ward · T Surge'
            : 'Stun & send High Priest, Golem, or Dirigible to capture',
        owner: p.owner,
        factionColor: p.isRogue ? '#c084fc' : this.getFactionColor(p.owner),
        hp: Math.ceil(p.hp),
        maxHp: p.maxHp,
        statusText:
          p.state === 'STUNNED'
            ? `Stunned (${Math.ceil(p.stunTimer)}s) · Send High Priest, Golem, or Dirigible`
            : p.state === 'CARRIED'
              ? 'Bound & Carried toward Altar'
              : p.carryingPriestId !== null
                ? 'Carrying Captured Priest to Altar'
                : p.captureTargetPriestId !== null
                  ? 'Marching to Capture Stunned Priest'
                  : p.shieldTimer > 0
                    ? `Aegis Ward Active (${Math.ceil(p.shieldTimer)}s · -50% dmg)`
                    : 'Active · Channeling Repair Aura',
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
        subtitle: 'Harvester · Auto-Repair · Priest Hauler',
        owner: g.owner,
        factionColor: this.getFactionColor(g.owner),
        hp: Math.ceil(g.hp),
        maxHp: g.maxHp,
        statusText:
          g.task === 'RETURNING_PRIEST'
            ? 'Hauling Captured Priest to Altar'
            : g.task === 'CAPTURING_PRIEST'
              ? 'Marching to Capture Stunned Priest'
              : g.task === 'REPAIRING'
                ? 'Repairing Damaged Structure/Bridge'
                : g.task === 'RETURNING_CRYSTAL'
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

    if (s.kind === 'BRIDGE_MINE') {
      return 'Armed camouflaged snare — detonates on hostile Priests or Golems';
    }

    if (!s.powered && s.owner !== 'NEUTRAL') {
      return 'Offline — reconnect bridge to High Temple or Outpost';
    }

    if (s.kind === 'TEMPLE') {
      if (!this.victoryRules.templeDestruction) {
        return 'Sanctified Aether core — protected by ancient ward (Temple Siege disabled)';
      }
      return s.owner === 'PLAYER'
        ? 'Projecting Aether grid & receiving Crystals — defend from rival siege!'
        : 'Rival Aether core — shatter this High Temple to eliminate their faction!';
    }
    if (s.kind === 'OUTPOST') {
      return 'Forward Aether Relay — sustains local islands & bridges if supply lines break';
    }
    if (s.kind === 'WATCHTOWER') {
      return `Sky Observatory — pierces Fog of War across ${def.visionRadius ?? 14} tiles`;
    }
    if (s.kind === 'BARRIER_PYLON') {
      const linked = this.state.energyFences.filter((f) => f.pylonAId === s.id || f.pylonBId === s.id).length;
      return linked > 0
        ? `Linked (${linked} fence${linked === 1 ? '' : 's'}) — blocking lane fire & zapping intruders`
        : 'Place another Pylon in-line within 5 tiles to weave an Energy Fence';
    }
    if (s.kind === 'ALTAR') {
      const activeSacrifice = this.state.priests.find(
        (p) => p.state === 'SACRIFICING' && Math.hypot(p.x - s.tx, p.y - s.ty) <= 1.5
      );
      if (activeSacrifice) {
        return activeSacrifice.isRogue
          ? 'Channeling Rogue Priest Ritual (Altar Knowledge Unlock)'
          : 'Channeling Grand Priest Ritual!';
      }
      return 'Awaiting captured Priest from High Priest, Golem, or Dirigible';
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
      if (target.entityType === 'AERIAL') {
        return 'Engaging hostile Sky Unit';
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

    if (this.hoveredKind === 'AERIAL') {
      const a = this.state.aerialUnits.find((u) => u.id === this.hoveredId);
      if (!a) return null;
      const def = AERIAL_CATALOG[a.kind];
      const iso = tileToIso(a.x, a.y);
      const pos = worldToScreen(iso.x, iso.y, this.camera, this.viewW, this.viewH);
      return {
        kind: 'AERIAL',
        id: a.id,
        title: def.name,
        factionLabel: this.getFactionLabel(a.owner),
        factionColor: this.getFactionColor(a.owner),
        owner: a.owner,
        hp: Math.ceil(a.hp),
        maxHp: a.maxHp,
        rangeLabel: def.range > 0 ? `${def.range} tiles · Vision ${def.visionRadius}` : `Transport · Vision ${def.visionRadius}`,
        combatStats: def.fireRate > 0 ? `${def.damage} dmg · ${def.fireRate.toFixed(2)}/s` : `Speed ${def.speed.toFixed(1)} · Airlifts Priests`,
        objective:
          a.carryingPriestId !== null
            ? 'Airlifting bound Priest straight to Altar'
            : a.captureTargetPriestId !== null
              ? 'Flying to airlift stunned Priest'
              : def.description,
        screenX: pos.sx,
        screenY: pos.sy,
      };
    }

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
      } else if (s.kind === 'WATCHTOWER') {
        rangeLabel = `${def.visionRadius ?? 14} tiles · Long-Range Vision`;
      } else if (s.kind === 'BARRIER_PYLON') {
        rangeLabel = `${ENERGY_FENCE_MAX_SPAN} tiles · Energy Fence Span`;
      } else if (s.kind === 'OUTPOST') {
        rangeLabel = 'Island Hub · Independent Power Grid';
      } else if (s.kind === 'BRIDGE_MINE') {
        rangeLabel = '1.8 tiles · Proximity Detonation';
      }

      let combatStats: string | undefined;
      if (def.fireRate > 0) {
        const traits: string[] = [`${def.damage} dmg`, `${def.fireRate.toFixed(2)}/s`];
        if (def.chainCount) traits.push(`${def.chainCount}× Chain`);
        if (def.splashRadius) traits.push(`Splash ${def.splashRadius}`);
        if (def.pierceCount) traits.push(`Pierces ${def.pierceCount}`);
        combatStats = traits.join(' · ');
      } else if (s.kind === 'BRIDGE_MINE') {
        combatStats = '95 splash dmg · Hidden from rivals';
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
        powered: s.owner === 'NEUTRAL' || s.kind === 'BRIDGE_MINE' ? true : s.powered,
        screenX: pos.sx,
        screenY: pos.sy,
      };
    }

    if (this.hoveredKind === 'PRIEST') {
      const p = this.state.priests.find((pr) => pr.id === this.hoveredId);
      if (!p || p.state === 'SACRIFICED' || p.state === 'CARRIED') return null;
      const iso = tileToIso(p.x, p.y);
      const pos = worldToScreen(iso.x, iso.y, this.camera, this.viewW, this.viewH);

      let objective = 'Channeling 2.5-tile structure repair aura';
      if (p.state === 'STUNNED') {
        objective = `Stunned (${Math.ceil(p.stunTimer)}s) — capture with High Priest, Golem, or Dirigible`;
      } else if (p.state === 'SACRIFICING') {
        objective = 'Being bound at the Altar!';
      } else if (p.isRogue) {
        objective = 'Guarding Shrine Isle (Altar Ritual unlocks Altar Knowledge)';
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
        rangeLabel: p.isRogue ? 'No Attack · Shrine Relic' : '2.5 tiles · Repair Aura & Abilities',
        combatStats: p.isRogue
          ? undefined
          : p.shieldTimer > 0
            ? `Aegis Ward (${Math.ceil(p.shieldTimer)}s · -50% dmg)`
            : '+9 HP/s repair · Captures stunned Priests',
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

      let objective = 'Scanning connected islands for Crystals or repairs';
      if (g.task === 'RETURNING_PRIEST') {
        objective = 'Hauling bound Priest back to Altar!';
      } else if (g.task === 'CAPTURING_PRIEST') {
        objective = 'Marching to capture stunned Priest';
      } else if (g.task === 'REPAIRING') {
        objective = 'Mending damaged allied structure or sky-bridge';
      } else if (g.task === 'RETURNING_CRYSTAL') {
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
        rangeLabel: 'Harvester · Auto-Repair · Hauler',
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
    const playerAerials = this.state.aerialUnits.filter((a) => a.owner === 'PLAYER').length;
    const connected = countConnectedIslands(this.state, 'PLAYER');

    const playerPriest = this.state.priests.find((p) => p.owner === 'PLAYER' && !p.isRogue);

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
      .filter((p) => p.state === 'STUNNED' && p.owner !== 'PLAYER' && this.isTileVisibleToPlayer(p.x, p.y))
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

    const priestAbilities = PRIEST_ABILITY_CATALOG.map((def) => {
      const cd = playerPriest ? playerPriest.abilityCooldowns[def.id] : def.maxCooldown;
      const ready =
        Boolean(playerPriest && playerPriest.state === 'ACTIVE') &&
        cd <= 0.05 &&
        pf.stormPower >= def.cost;
      return {
        id: def.id,
        name: def.name,
        hotkey: def.hotkey,
        cost: def.cost,
        cooldown: Math.ceil(cd),
        maxCooldown: def.maxCooldown,
        ready,
        description: def.description,
      };
    });

    const remainingRivals = rivals.filter((r) => !r.eliminated).length;

    this.onHudUpdate({
      phase: this.phase,
      elapsedSeconds: Math.floor(this.state.elapsedSeconds),
      stormPower: Math.floor(pf.stormPower),
      golemCount: playerGolems,
      maxGolems: MAX_GOLEMS,
      golemCost: GOLEM_COST,
      aerialCount: playerAerials,
      maxAerialUnits: MAX_AERIAL_UNITS,
      connectedIslands: connected,
      totalIslands: this.state.islands.length,
      knowledgeTier: pf.knowledgeTier,
      unlockedTechs: [...pf.unlockedTechs],
      pendingTechChoices: this.state.pendingTechChoices ? [...this.state.pendingTechChoices] : null,
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
      playerPriestShieldTimer: Math.ceil(playerPriest?.shieldTimer ?? 0),
      weather: buildWeatherHudSummary(this.state.weather),
      priestAbilities,
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
