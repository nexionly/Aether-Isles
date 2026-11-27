import type { Alignment, BuildOptionKind, FactionId, Fury, Owner, StructureKind } from './types';

const MUTE_KEY = 'aether_isles_audio_muted';
const MUSIC_VOL_KEY = 'aether_isles_music_volume';
const SFX_VOL_KEY = 'aether_isles_sfx_volume';

export type MusicMode = 'TITLE' | 'GAMEPLAY' | 'CREDITS';

export interface MusicTrackInfo {
  id: string;
  title: string;
  role: string;
  src: string;
  mode: MusicMode;
}

export const MUSIC_TRACKS: readonly MusicTrackInfo[] = [
  {
    id: 'title_main',
    title: 'Above the Skybridge',
    role: 'Main Title Theme',
    src: '/assets/aistudio/Main_Screen_Music_848addba.mp4',
    mode: 'TITLE',
  },
  {
    id: 'gameplay_1',
    title: 'Archipelago Ascent',
    role: 'Skirmish Theme I',
    src: '/assets/aistudio/Game_Play_Music_01_-_Archipelago_Ascent_876414ef.mp4',
    mode: 'GAMEPLAY',
  },
  {
    id: 'gameplay_2',
    title: 'Meridian of the Clouds',
    role: 'Skirmish Theme II',
    src: '/assets/aistudio/Game_Play_Music_02_-__Meridian_of_the._Clouds_9c84d382.mp4',
    mode: 'GAMEPLAY',
  },
  {
    id: 'gameplay_3',
    title: 'Above the Ancient Cloud Kingdoms',
    role: 'Skirmish Theme III',
    src: '/assets/aistudio/Game_Play_Music_03_-_Above_the_Ancient_Cloud_Kingdoms_360fb92f.mp4',
    mode: 'GAMEPLAY',
  },
  {
    id: 'credits_main',
    title: 'Threshold of Dread',
    role: 'Credits Theme',
    src: '/assets/aistudio/Game_Credits_Music_1da76520.mp4',
    mode: 'CREDITS',
  },
];

const TITLE_TRACK = MUSIC_TRACKS[0];
const GAMEPLAY_TRACKS = MUSIC_TRACKS.filter((t) => t.mode === 'GAMEPLAY');
const CREDITS_TRACK = MUSIC_TRACKS[4];

/** Slight headroom so music blends warmly beneath crisp combat SFX at 100% */
const MUSIC_HEADROOM = 0.72;
/** Crossfade slightly before each MP4's silent end bumper */
const OUTRO_TRIM_SEC = 3.6;
const FADE_TICK_MS = 40;

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function loadStoredVolume(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return clampUnit(parsed);
  } catch {
    // Ignore storage failures
  }
  return fallback;
}

export type ElementalStormEffect =
  | 'GEYSER_ERUPT'
  | 'WIND_CYCLONE'
  | 'RAIN_DELUGE'
  | 'THUNDER_ARC'
  | 'SACRIFICE_SURGE'
  | 'AMBIENT_GUST';

export interface AudioSpatialContext {
  /** Stereo pan from -0.85 (left) to +0.85 (right) */
  pan: number;
  /** Distance/visibility attenuation from 0 (off-screen/inaudible) to 1 (center focus) */
  gain: number;
}

export type AudioHookEvent =
  | {
      type: 'BRIDGE_PLACED';
      owner: FactionId;
      cells: number;
      linkedNewIsland: boolean;
      tx: number;
      ty: number;
    }
  | { type: 'BRIDGE_BROKEN'; tx: number; ty: number }
  | { type: 'STRUCTURE_BUILT'; owner: FactionId; kind: BuildOptionKind; tx: number; ty: number }
  | { type: 'GOLEM_SUMMONED'; owner: FactionId; tx: number; ty: number }
  | { type: 'CRYSTAL_PICKUP'; owner: Owner; value: number; tx: number; ty: number }
  | { type: 'CRYSTAL_HARVESTED'; owner: FactionId; value: number; tx: number; ty: number }
  | {
      type: 'TOWER_FIRED';
      owner: Owner;
      kind: StructureKind;
      alignment: Alignment;
      tx: number;
      ty: number;
    }
  | { type: 'PROJECTILE_IMPACT'; alignment: Alignment; heavy: boolean; tx: number; ty: number }
  | {
      type: 'ELEMENTAL_STORM';
      storm: ElementalStormEffect;
      fury?: Fury;
      intensity?: number;
      tx?: number;
      ty?: number;
    }
  | { type: 'PRIEST_STUNNED'; isPlayer: boolean; tx: number; ty: number }
  | { type: 'PRIEST_CAPTURED'; byPlayer: boolean; tx: number; ty: number }
  | { type: 'SACRIFICE_BEGUN'; fury: Fury; isGrand: boolean; tx: number; ty: number }
  | { type: 'VICTORY' }
  | { type: 'DEFEAT' }
  | { type: 'UI_ROTATE' }
  | { type: 'UI_INVALID' };

export type AudioHookListener = (event: AudioHookEvent, spatial: AudioSpatialContext) => void;

const DEFAULT_SPATIAL: AudioSpatialContext = { pan: 0, gain: 1 };

/**
 * Web Audio API Manager handling engine audio hook events with spatial stereo panning,
 * master dynamics compression, polyphony throttling, procedural elemental synthesis,
 * and continuous high-altitude storm ambience.
 */
export class WebAudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // Continuous ambient storm nodes
  private ambienceSource: AudioBufferSourceNode | null = null;
  private ambienceFilter: BiquadFilterNode | null = null;
  private ambienceLfo: OscillatorNode | null = null;
  private ambienceLfoGain: GainNode | null = null;
  private ambienceDesiredActive = false;
  private ambienceFury: Fury = 'WIND';
  private ambienceIntensity = 0.5;

  private muted = false;
  private musicVolume = 0.65;
  private sfxVolume = 0.85;
  private lastPlayedAt: Record<string, number> = {};

  // Scene-aware soundtrack player state
  private musicMode: MusicMode = 'TITLE';
  private musicDucked = false;
  private currentTrack: MusicTrackInfo = TITLE_TRACK;
  private gameplayOrder: MusicTrackInfo[] = [...GAMEPLAY_TRACKS];
  private gameplayIndex = 0;
  private activeMusicEl: HTMLAudioElement | null = null;
  private fadingMusicEls: Array<{ el: HTMLAudioElement; vol: number }> = [];
  private musicTickId: number | null = null;
  private musicPendingUnlock = false;
  private transitioningOutro = false;
  private trackListeners = new Set<() => void>();

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
    this.musicVolume = loadStoredVolume(MUSIC_VOL_KEY, 0.65);
    this.sfxVolume = loadStoredVolume(SFX_VOL_KEY, 0.85);
    this.shuffleGameplayOrder();
  }

  public onTrackChange(listener: () => void): () => void {
    this.trackListeners.add(listener);
    return () => {
      this.trackListeners.delete(listener);
    };
  }

  private notifyTrackChange(): void {
    for (const listener of this.trackListeners) {
      listener();
    }
  }

  private shuffleGameplayOrder(): void {
    const arr = [...GAMEPLAY_TRACKS];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    this.gameplayOrder = arr;
    this.gameplayIndex = 0;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public getMusicVolume(): number {
    return this.musicVolume;
  }

  public getSfxVolume(): number {
    return this.sfxVolume;
  }

  public getMusicMode(): MusicMode {
    return this.musicMode;
  }

  public getCurrentTrackTitle(): string {
    return this.currentTrack.title;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Ignore storage failures
    }
    this.syncMasterGain();
    this.syncAmbience();
    this.syncMusicPlayback();
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public setMusicVolume(volume: number): void {
    this.musicVolume = clampUnit(volume);
    try {
      localStorage.setItem(MUSIC_VOL_KEY, String(this.musicVolume));
    } catch {
      // Ignore storage failures
    }
    if (this.musicVolume > 0 && !this.muted) {
      this.ensureActiveMusicStarted();
    }
    this.syncMusicPlayback();
  }

  public setSfxVolume(volume: number): void {
    this.sfxVolume = clampUnit(volume);
    try {
      localStorage.setItem(SFX_VOL_KEY, String(this.sfxVolume));
    } catch {
      // Ignore storage failures
    }
    this.syncSfxGain();
    this.syncAmbience();
  }

  public setMusicMode(mode: MusicMode): void {
    if (this.musicMode === mode && this.activeMusicEl) {
      this.syncMusicPlayback();
      return;
    }
    const prevMode = this.musicMode;
    this.musicMode = mode;

    let targetTrack: MusicTrackInfo;
    if (mode === 'TITLE') {
      targetTrack = TITLE_TRACK;
    } else if (mode === 'CREDITS') {
      targetTrack = CREDITS_TRACK;
    } else {
      if (prevMode !== 'GAMEPLAY') {
        this.shuffleGameplayOrder();
      }
      targetTrack = this.gameplayOrder[this.gameplayIndex] ?? GAMEPLAY_TRACKS[0];
    }

    this.startTrack(targetTrack);
  }

  public setMusicDucked(ducked: boolean): void {
    if (this.musicDucked === ducked) return;
    this.musicDucked = ducked;
    this.ensureMusicLoopRunning();
  }

  public nextGameplayTrack(): void {
    if (this.musicMode !== 'GAMEPLAY') return;
    this.gameplayIndex = (this.gameplayIndex + 1) % this.gameplayOrder.length;
    if (this.gameplayIndex === 0) {
      const prevId = this.currentTrack.id;
      this.shuffleGameplayOrder();
      if (this.gameplayOrder.length > 1 && this.gameplayOrder[0].id === prevId) {
        [this.gameplayOrder[0], this.gameplayOrder[1]] = [
          this.gameplayOrder[1],
          this.gameplayOrder[0],
        ];
      }
    }
    const nextTrack = this.gameplayOrder[this.gameplayIndex] ?? GAMEPLAY_TRACKS[0];
    this.startTrack(nextTrack);
  }

  private getTargetMusicVolume(): number {
    if (this.muted || this.musicVolume <= 0.001) return 0;
    const duckFactor = this.musicDucked && this.musicMode !== 'CREDITS' ? 0.48 : 1;
    return Math.min(1, this.musicVolume * duckFactor * MUSIC_HEADROOM);
  }

  private startTrack(track: MusicTrackInfo, forceRestart = false): void {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      this.currentTrack = track;
      this.notifyTrackChange();
      return;
    }

    if (!forceRestart && this.activeMusicEl && this.currentTrack.id === track.id) {
      this.ensureActiveMusicStarted();
      this.ensureMusicLoopRunning();
      return;
    }

    this.transitioningOutro = false;

    // Crossfade out the previous active track smoothly
    if (this.activeMusicEl) {
      const outgoing = this.activeMusicEl;
      outgoing.onended = null;
      this.fadingMusicEls.push({ el: outgoing, vol: outgoing.volume });
      this.activeMusicEl = null;
    }

    const nextEl = new Audio(track.src);
    nextEl.preload = 'auto';
    nextEl.loop = false;
    nextEl.volume = 0;
    nextEl.onended = () => {
      if (this.activeMusicEl === nextEl) {
        this.handleTrackCompleted();
      }
    };

    this.currentTrack = track;
    this.activeMusicEl = nextEl;
    this.notifyTrackChange();

    this.ensureActiveMusicStarted();
    this.ensureMusicLoopRunning();
  }

  private handleTrackCompleted(): void {
    if (this.musicMode === 'GAMEPLAY') {
      this.nextGameplayTrack();
    } else if (this.musicMode === 'CREDITS') {
      this.startTrack(CREDITS_TRACK, true);
    } else {
      this.startTrack(TITLE_TRACK, true);
    }
  }

  private ensureActiveMusicStarted(): void {
    if (!this.activeMusicEl) return;
    if (this.muted || this.musicVolume <= 0.001) {
      this.musicPendingUnlock = false;
      return;
    }
    if (!this.activeMusicEl.paused) {
      this.musicPendingUnlock = false;
      return;
    }
    const playPromise = this.activeMusicEl.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          this.musicPendingUnlock = false;
          this.ensureMusicLoopRunning();
        })
        .catch(() => {
          this.musicPendingUnlock = true;
        });
    }
  }

  private syncMusicPlayback(): void {
    if (!this.activeMusicEl) return;
    if (this.muted || this.musicVolume <= 0.001) {
      this.ensureMusicLoopRunning();
    } else {
      this.ensureActiveMusicStarted();
      this.ensureMusicLoopRunning();
    }
  }

  private ensureMusicLoopRunning(): void {
    if (typeof window === 'undefined') return;
    if (this.musicTickId !== null) return;
    this.musicTickId = window.setInterval(() => this.tickMusic(), FADE_TICK_MS);
  }

  private tickMusic(): void {
    const dt = FADE_TICK_MS / 1000;

    // 1. Fade out outgoing tracks
    if (this.fadingMusicEls.length > 0) {
      const remaining: Array<{ el: HTMLAudioElement; vol: number }> = [];
      for (const item of this.fadingMusicEls) {
        item.vol = Math.max(0, item.vol - dt * 1.15);
        try {
          item.el.volume = item.vol;
        } catch {
          // Ignore volume errors
        }
        if (item.vol <= 0.004) {
          item.el.pause();
          item.el.removeAttribute('src');
          item.el.load();
        } else {
          remaining.push(item);
        }
      }
      this.fadingMusicEls = remaining;
    }

    // 2. Smoothly ramp active track volume & detect early outro for seamless looping/advancing
    const active = this.activeMusicEl;
    if (active) {
      const target = this.getTargetMusicVolume();
      const diff = target - active.volume;
      const step = dt * 1.25;
      let nextVol = active.volume;
      if (Math.abs(diff) <= step) {
        nextVol = target;
      } else {
        nextVol = active.volume + Math.sign(diff) * step;
      }
      nextVol = Math.max(0, Math.min(1, nextVol));
      try {
        active.volume = nextVol;
      } catch {
        // Ignore volume errors
      }

      if (target <= 0.001 && nextVol <= 0.001 && !active.paused) {
        active.pause();
      } else if (target > 0.001 && active.paused && !this.musicPendingUnlock) {
        this.ensureActiveMusicStarted();
      }

      if (
        !this.transitioningOutro &&
        !active.paused &&
        Number.isFinite(active.duration) &&
        active.duration > 10 &&
        active.currentTime >= active.duration - OUTRO_TRIM_SEC
      ) {
        this.transitioningOutro = true;
        this.handleTrackCompleted();
      }
    }
  }

  public unlock(): void {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.initSignalGraph(this.ctx);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        this.syncMasterGain();
        this.syncSfxGain();
        this.syncAmbience();
      }).catch(() => {});
    } else if (this.ctx) {
      this.syncMasterGain();
      this.syncSfxGain();
      this.syncAmbience();
    }

    // Also unlock HTMLAudio soundtrack if autoplay was deferred
    if (this.activeMusicEl && (this.musicPendingUnlock || this.activeMusicEl.paused)) {
      this.ensureActiveMusicStarted();
    }
  }

  public dispose(): void {
    this.stopAmbienceNodes();
    if (this.musicTickId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.musicTickId);
      this.musicTickId = null;
    }
    if (this.activeMusicEl) {
      this.activeMusicEl.onended = null;
      this.activeMusicEl.pause();
      this.activeMusicEl.removeAttribute('src');
      this.activeMusicEl.load();
      this.activeMusicEl = null;
    }
    for (const item of this.fadingMusicEls) {
      item.el.pause();
      item.el.removeAttribute('src');
      item.el.load();
    }
    this.fadingMusicEls = [];
    this.trackListeners.clear();

    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.masterGain = null;
    this.sfxBus = null;
    this.ambienceBus = null;
    this.compressor = null;
    this.noiseBuffer = null;
  }

  /**
   * Central hook handler registered on SkybridgeEngine.onAudioEvent(...)
   */
  public handleEvent = (event: AudioHookEvent, spatial: AudioSpatialContext = DEFAULT_SPATIAL): void => {
    if (this.muted || this.sfxVolume <= 0.001) return;

    switch (event.type) {
      case 'UI_ROTATE':
        this.playRotate();
        break;
      case 'UI_INVALID':
        this.playInvalid();
        break;
      case 'BRIDGE_PLACED': {
        const gain = event.owner === 'PLAYER' ? Math.max(0.75, spatial.gain) : spatial.gain * 0.35;
        if (gain > 0.08) {
          this.playBridgePlace(event.cells, event.linkedNewIsland && event.owner === 'PLAYER', {
            pan: spatial.pan,
            gain,
          });
        }
        break;
      }
      case 'BRIDGE_BROKEN':
        if (spatial.gain > 0.08) {
          this.playBridgeBreak(spatial);
        }
        break;
      case 'STRUCTURE_BUILT': {
        const gain = event.owner === 'PLAYER' ? Math.max(0.8, spatial.gain) : spatial.gain * 0.3;
        if (gain > 0.1) {
          this.playBuild({ pan: spatial.pan, gain });
        }
        break;
      }
      case 'GOLEM_SUMMONED':
        if (event.owner === 'PLAYER') {
          this.playGolemSummon({ pan: spatial.pan, gain: Math.max(0.8, spatial.gain) });
        }
        break;
      case 'CRYSTAL_PICKUP': {
        const gain = event.owner === 'PLAYER' ? Math.max(0.55, spatial.gain * 0.85) : spatial.gain * 0.22;
        if (gain > 0.12) {
          this.playCrystalPickup(event.value >= 60, { pan: spatial.pan, gain });
        }
        break;
      }
      case 'CRYSTAL_HARVESTED':
        if (event.owner === 'PLAYER') {
          this.playCrystalHarvest(event.value >= 60, {
            pan: spatial.pan,
            gain: Math.max(0.8, spatial.gain),
          });
        }
        break;
      case 'TOWER_FIRED': {
        const gain = event.owner === 'PLAYER' ? Math.max(0.6, spatial.gain) : spatial.gain * 0.42;
        if (gain > 0.1) {
          this.playTowerFire(event.kind, event.alignment, { pan: spatial.pan, gain });
        }
        break;
      }
      case 'PROJECTILE_IMPACT':
        if (spatial.gain > 0.1) {
          this.playHit(event.heavy, event.alignment, spatial);
        }
        break;
      case 'ELEMENTAL_STORM':
        this.playElementalStorm(event.storm, event.fury ?? this.ambienceFury, event.intensity ?? 1, spatial);
        break;
      case 'PRIEST_STUNNED':
        this.playPriestStun(event.isPlayer, { pan: spatial.pan, gain: Math.max(0.65, spatial.gain) });
        break;
      case 'PRIEST_CAPTURED':
        this.playPriestCaptured(event.byPlayer, { pan: spatial.pan, gain: Math.max(0.7, spatial.gain) });
        break;
      case 'SACRIFICE_BEGUN':
        this.playSacrifice(event.fury, event.isGrand, { pan: spatial.pan, gain: 1 });
        break;
      case 'VICTORY':
        this.playVictory();
        break;
      case 'DEFEAT':
        this.playDefeat();
        break;
    }
  };

  /**
   * Controls continuous elemental high-altitude storm ambience bed.
   */
  public setAmbience(active: boolean, fury: Fury, intensity = 0.5): void {
    this.ambienceDesiredActive = active;
    this.ambienceFury = fury;
    this.ambienceIntensity = Math.max(0.15, Math.min(1, intensity));
    this.syncAmbience();
  }

  private initSignalGraph(ctx: AudioContext): void {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-14, ctx.currentTime);
    compressor.knee.setValueAtTime(18, ctx.currentTime);
    compressor.ratio.setValueAtTime(6, ctx.currentTime);
    compressor.attack.setValueAtTime(0.004, ctx.currentTime);
    compressor.release.setValueAtTime(0.18, ctx.currentTime);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(this.muted ? 0 : 0.92, ctx.currentTime);

    const sfxBus = ctx.createGain();
    sfxBus.gain.setValueAtTime(this.sfxVolume * 0.95, ctx.currentTime);

    const ambienceBus = ctx.createGain();
    ambienceBus.gain.setValueAtTime(0, ctx.currentTime);

    sfxBus.connect(masterGain);
    ambienceBus.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);

    this.compressor = compressor;
    this.masterGain = masterGain;
    this.sfxBus = sfxBus;
    this.ambienceBus = ambienceBus;
    this.noiseBuffer = this.createPinkNoiseBuffer(ctx, 2.2);
  }

  private createPinkNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Paul Kellet's pink-noise approximation for warm wind, rain, stone, and thunder textures
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11));
      b6 = white * 0.115926;
    }
    return buffer;
  }

  private syncMasterGain(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.92, now, 0.03);
  }

  private syncSfxGain(): void {
    if (!this.ctx || !this.sfxBus) return;
    const now = this.ctx.currentTime;
    this.sfxBus.gain.cancelScheduledValues(now);
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume * 0.95, now, 0.025);
  }

  private syncAmbience(): void {
    if (!this.ctx || !this.ambienceBus || !this.noiseBuffer) return;
    const shouldPlay =
      this.ambienceDesiredActive && !this.muted && this.sfxVolume > 0.001 && this.ctx.state === 'running';
    const now = this.ctx.currentTime;

    if (shouldPlay && !this.ambienceSource) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(1.1, now);

      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.14, now);
      lfoGain.gain.setValueAtTime(95, now);

      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      source.connect(filter);
      filter.connect(this.ambienceBus);

      source.start(now);
      lfo.start(now);

      this.ambienceSource = source;
      this.ambienceFilter = filter;
      this.ambienceLfo = lfo;
      this.ambienceLfoGain = lfoGain;
    }

    if (this.ambienceFilter) {
      const targetFreq =
        this.ambienceFury === 'WIND' ? 540 : this.ambienceFury === 'RAIN' ? 880 : 260;
      const targetQ =
        this.ambienceFury === 'WIND' ? 1.5 : this.ambienceFury === 'RAIN' ? 0.7 : 1.1;
      this.ambienceFilter.frequency.setTargetAtTime(targetFreq, now, 0.4);
      this.ambienceFilter.Q.setTargetAtTime(targetQ, now, 0.4);
    }

    const targetAmp = shouldPlay ? (0.022 + this.ambienceIntensity * 0.024) * this.sfxVolume : 0;
    this.ambienceBus.gain.cancelScheduledValues(now);
    this.ambienceBus.gain.setTargetAtTime(targetAmp, now, shouldPlay ? 0.45 : 0.15);
  }

  private stopAmbienceNodes(): void {
    try {
      this.ambienceSource?.stop();
    } catch {
      // Ignore already-stopped nodes
    }
    try {
      this.ambienceLfo?.stop();
    } catch {
      // Ignore already-stopped nodes
    }
    this.ambienceSource?.disconnect();
    this.ambienceFilter?.disconnect();
    this.ambienceLfo?.disconnect();
    this.ambienceLfoGain?.disconnect();
    this.ambienceSource = null;
    this.ambienceFilter = null;
    this.ambienceLfo = null;
    this.ambienceLfoGain = null;
  }

  private getContext(): AudioContext | null {
    if (this.muted || this.sfxVolume <= 0.001) return null;
    if (!this.ctx) this.unlock();
    if (!this.ctx || !this.sfxBus || this.ctx.state === 'suspended') return null;
    return this.ctx;
  }

  public playVolumeTest(): void {
    if (this.muted || this.sfxVolume <= 0.001) return;
    this.unlock();
    const ctx = this.getContext();
    if (!ctx || !this.sfxBus) return;
    if (!this.throttle('volume_test', 120)) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 2 ? 'sine' : 'triangle';
      const t = now + i * 0.045;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.085, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain).connect(this.sfxBus!);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }

  private throttle(key: string, minIntervalMs: number): boolean {
    const now = performance.now();
    const prev = this.lastPlayedAt[key] ?? 0;
    if (now - prev < minIntervalMs) return false;
    this.lastPlayedAt[key] = now;
    return true;
  }

  private createSpatialOut(ctx: AudioContext, spatial: AudioSpatialContext): AudioNode {
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(Math.max(0.01, Math.min(1.2, spatial.gain)), ctx.currentTime);

    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, spatial.pan)), ctx.currentTime);
      gainNode.connect(panner);
      panner.connect(this.sfxBus!);
    } else {
      gainNode.connect(this.sfxBus!);
    }
    return gainNode;
  }

  private triggerNoiseBurst(
    ctx: AudioContext,
    dest: AudioNode,
    opts: {
      startAt: number;
      duration: number;
      volume: number;
      filterType: BiquadFilterType;
      startFreq: number;
      endFreq?: number;
      q?: number;
      attack?: number;
    }
  ): void {
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.setValueAtTime(opts.startFreq, opts.startAt);
    if (opts.endFreq !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(20, opts.endFreq),
        opts.startAt + opts.duration
      );
    }
    filter.Q.setValueAtTime(opts.q ?? 1, opts.startAt);

    const gain = ctx.createGain();
    const atk = Math.min(opts.attack ?? 0.012, opts.duration * 0.4);
    gain.gain.setValueAtTime(0.0008, opts.startAt);
    gain.gain.linearRampToValueAtTime(opts.volume, opts.startAt + atk);
    gain.gain.exponentialRampToValueAtTime(0.0008, opts.startAt + opts.duration);

    src.connect(filter).connect(gain).connect(dest);
    const offset = Math.random() * Math.max(0.05, this.noiseBuffer.duration - 0.1);
    src.start(opts.startAt, offset);
    src.stop(opts.startAt + opts.duration + 0.03);
  }

  // ==================== INDIVIDUAL PROCEDURAL SOUND SYNTHESIZERS ====================

  public playRotate(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(780, now + 0.05);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.058);
    osc.connect(gain).connect(this.sfxBus!);
    osc.start(now);
    osc.stop(now + 0.065);
  }

  public playInvalid(): void {
    const ctx = this.getContext();
    if (!ctx || !this.throttle('invalid', 110)) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(175, now);
    osc.frequency.linearRampToValueAtTime(118, now + 0.12);
    gain.gain.setValueAtTime(0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(gain).connect(this.sfxBus!);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playBridgePlace(
    cells = 4,
    linkedNewIsland = false,
    spatial: AudioSpatialContext = DEFAULT_SPATIAL
  ): void {
    const ctx = this.getContext();
    if (!ctx || !this.throttle('bridge_place', 45)) return;
    const now = ctx.currentTime;
    const out = this.createSpatialOut(ctx, spatial);

    // 1. Heavy stone masonry lock-in thud
    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(165, now);
    thud.frequency.exponentialRampToValueAtTime(52, now + 0.15);
    thudGain.gain.setValueAtTime(0.2, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
    thud.connect(thudGain).connect(out);
    thud.start(now);
    thud.stop(now + 0.18);

    // 2. Crisp stone grit / mortar scrape
    this.triggerNoiseBurst(ctx, out, {
      startAt: now,
      duration: 0.11,
      volume: 0.09,
      filterType: 'bandpass',
      startFreq: 900,
      endFreq: 420,
      q: 1.4,
    });

    // 3. Harmonic Aether conduit lock chime scaled by tile count
    const baseFreq = cells >= 4 ? 392 : 440;
    const chime = ctx.createOscillator();
    const chimeGain = ctx.createGain();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(baseFreq, now + 0.03);
    chime.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.19);
    chimeGain.gain.setValueAtTime(0.055, now + 0.03);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    chime.connect(chimeGain).connect(out);
    chime.start(now + 0.03);
    chime.stop(now + 0.25);

    // 4. Shimmering Aether grid link chord when connecting a new floating island
    if (linkedNewIsland) {
      [293.66, 440, 587.33, 739.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = idx % 2 === 0 ? 'triangle' : 'sine';
        const t = now + 0.07 + idx * 0.055;
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.065, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + 0.45);
      });
    }
  }

  public playBuild(spatial: AudioSpatialContext = DEFAULT_SPATIAL): void {
    const ctx = this.getContext();
    if (!ctx || !this.throttle('build', 50)) return;
    const now = ctx.currentTime;
    const out = this.createSpatialOut(ctx, spatial);

    this.triggerNoiseBurst(ctx, out, {
      startAt: now,
      duration: 0.09,
      volume: 0.07,
      filterType: 'lowpass',
      startFreq: 680,
      endFreq: 260,
    });

    [220, 330, 440].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 0 ? 'triangle' : 'sine';
      const t = now + i * 0.038;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.075, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  }

  public playGolemSummon(spatial: AudioSpatialContext = DEFAULT_SPATIAL): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const out = this.createSpatialOut(ctx, spatial);

    const rumble = ctx.createOscillator();
    const rGain = ctx.createGain();
    rumble.type = 'triangle';
    rumble.frequency.setValueAtTime(98, now);
    rumble.frequency.exponentialRampToValueAtTime(146.83, now + 0.24);
    rGain.gain.setValueAtTime(0.11, now);
    rGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    rumble.connect(rGain).connect(out);
    rumble.start(now);
    rumble.stop(now + 0.3);

    [329.63, 440, 587.33].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + 0.04 + i * 0.05;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  }

  public playCrystalPickup(
    isSuper = false,
    spatial: AudioSpatialContext = DEFAULT_SPATIAL
  ): void {
    const ctx = this.getContext();
    if (!ctx || !this.throttle('crystal_pickup', 90)) return;
    const now = ctx.currentTime;
    const out = this.createSpatialOut(ctx, spatial);
    const notes = isSuper ? [987.77, 1318.51] : [880, 1174.66];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + idx * 0.035;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.045, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.16);
    });
  }

  public playCrystalHarvest(
    isSuper = false,
    spatial: AudioSpatialContext = DEFAULT_SPATIAL
  ): void {
    const ctx = this.getContext();
    if (!ctx || !this.throttle('crystal_harvest', 75)) return;
    const now = ctx.currentTime;
    const out = this.createSpatialOut(ctx, spatial);
    const notes = isSuper
      ? [587.33, 880, 1174.66, 1479.98]
      : [587.33, 880, 1174.66];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === notes.length - 1 ? 'triangle' : 'sine';
      const t = now + idx * 0.045;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.065, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.27);
    });
  }

  public playTowerFire(
    kind: StructureKind,
    alignment: Alignment,
    spatial: AudioSpatialContext = DEFAULT_SPATIAL
  ): void {
    const ctx = this.getContext();
    if (!ctx || !this.throttle(`fire_${alignment}`, 65)) return;
    const now = ctx.currentTime;
    const out = this.createSpatialOut(ctx, spatial);

    if (kind === 'WHIRLWIND_SPIRE') {
      // Swirling gale vortex pulse
      this.triggerNoiseBurst(ctx, out, {
        startAt: now,
        duration: 0.26,
        volume: 0.11,
        filterType: 'bandpass',
        startFreq: 420,
        endFreq: 1450,
        q: 2.8,
        attack: 0.03,
      });
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.18);
      g.gain.setValueAtTime(0.045, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + 0.24);
      return;
    }

    if (kind === 'ZEPHYR_CANNON') {
      // Piercing twin-blade wind lance
      this.triggerNoiseBurst(ctx, out, {
        startAt: now,
        duration: 0.14,
        volume: 0.09,
        filterType: 'highpass',
        startFreq: 1800,
        endFreq: 750,
      });
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1280, now);
      osc.frequency.exponentialRampToValueAtTime(390, now + 0.11);
      g.gain.setValueAtTime(0.07, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + 0.14);
      return;
    }

    if (kind === 'RAIN_CANNON') {
      // Hollow tidal mortar launch + watery puff
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(310, now);
      osc.frequency.exponentialRampToValueAtTime(115, now + 0.16);
      g.gain.setValueAtTime(0.095, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + 0.19);
      this.triggerNoiseBurst(ctx, out, {
        startAt: now,
        duration: 0.13,
        volume: 0.055,
        filterType: 'bandpass',
        startFreq: 700,
        endFreq: 1200,
        q: 1.5,
      });
      return;
    }

    if (kind === 'MAN_O_WAR') {
      // Deep leviathan pulse + stinging tentacle zap
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(185, now + 0.15);
      g.gain.setValueAtTime(0.08, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + 0.18);

      const zap = ctx.createOscillator();
      const zGain = ctx.createGain();
      zap.type = 'sawtooth';
      zap.frequency.setValueAtTime(1320, now + 0.02);
      zap.frequency.exponentialRampToValueAtTime(520, now + 0.1);
      zGain.gain.setValueAtTime(0.035, now + 0.02);
      zGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      zap.connect(zGain).connect(out);
      zap.start(now + 0.02);
      zap.stop(now + 0.12);
      return;
    }

    if (kind === 'SPARK_PYLON' || kind === 'ARC_SPIRE') {
      // High-voltage electric arc discharge
      const heavy = kind === 'ARC_SPIRE';
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(heavy ? 1650 : 1400, now);
      osc.frequency.exponentialRampToValueAtTime(heavy ? 160 : 280, now + (heavy ? 0.16 : 0.11));
      g.gain.setValueAtTime(heavy ? 0.08 : 0.055, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.18 : 0.12));
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + 0.19);

      this.triggerNoiseBurst(ctx, out, {
        startAt: now,
        duration: heavy ? 0.2 : 0.11,
        volume: heavy ? 0.11 : 0.065,
        filterType: 'highpass',
        startFreq: 2400,
        endFreq: 950,
      });
      return;
    }

    if (kind === 'THUNDER_CANNON') {
      // Heavy siege thunder cannon boom
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(215, now);
      osc.frequency.exponentialRampToValueAtTime(58, now + 0.19);
      g.gain.setValueAtTime(0.095, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + 0.22);

      this.triggerNoiseBurst(ctx, out, {
        startAt: now,
        duration: 0.17,
        volume: 0.09,
        filterType: 'lowpass',
        startFreq: 1400,
        endFreq: 260,
      });
      return;
    }

    // WIND_CROSSBOW, SUN_DISC, STORM_OBELISK
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    if (alignment === 'WIND') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(960, now);
      osc.frequency.exponentialRampToValueAtTime(340, now + 0.08);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      this.triggerNoiseBurst(ctx, out, {
        startAt: now,
        duration: 0.06,
        volume: 0.04,
        filterType: 'bandpass',
        startFreq: 1900,
        endFreq: 1100,
        q: 2.0,
      });
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(700, now);
      osc.frequency.exponentialRampToValueAtTime(430, now + 0.095);
      gain.gain.setValueAtTime(0.055, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    }
    osc.connect(gain).connect(out);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playHit(
    heavy: boolean,
    alignment: Alignment = 'SUN',
    spatial: AudioSpatialContext = DEFAULT_SPATIAL
  ): void {
    const ctx = this.getContext();
    if (!ctx || !this.throttle('hit', 60)) return;
    const now = ctx.currentTime;
    const out = this.createSpatialOut(ctx, spatial);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = heavy ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(heavy ? 132 : 220, now);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 36 : 82, now + (heavy ? 0.18 : 0.085));
    gain.gain.setValueAtTime(heavy ? 0.12 : 0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.2 : 0.095));
    osc.connect(gain).connect(out);
    osc.start(now);
    osc.stop(now + 0.21);

    if (heavy) {
      this.triggerNoiseBurst(ctx, out, {
        startAt: now,
        duration: alignment === 'RAIN' ? 0.22 : 0.14,
        volume: 0.085,
        filterType: alignment === 'RAIN' ? 'bandpass' : 'lowpass',
        startFreq: alignment === 'RAIN' ? 950 : 720,
        endFreq: 190,
      });
    }
  }

  public playElementalStorm(
    storm: ElementalStormEffect,
    fury: Fury = 'WIND',
    intensity = 1,
    spatial: AudioSpatialContext = DEFAULT_SPATIAL
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const clampedGain = Math.max(0.05, Math.min(1, spatial.gain * intensity));
    if (clampedGain < 0.08) return;

    const now = ctx.currentTime;
    const out = this.createSpatialOut(ctx, { pan: spatial.pan, gain: clampedGain });

    switch (storm) {
      case 'GEYSER_ERUPT': {
        if (!this.throttle('storm_geyser', 260)) return;
        // Steamy pressurized Aether geyser plume + crystal pop
        this.triggerNoiseBurst(ctx, out, {
          startAt: now,
          duration: 0.36,
          volume: 0.09,
          filterType: 'bandpass',
          startFreq: 340,
          endFreq: 1250,
          q: 1.8,
          attack: 0.04,
        });
        const pop = ctx.createOscillator();
        const g = ctx.createGain();
        pop.type = 'sine';
        pop.frequency.setValueAtTime(520, now + 0.06);
        pop.frequency.exponentialRampToValueAtTime(980, now + 0.18);
        g.gain.setValueAtTime(0.04, now + 0.06);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        pop.connect(g).connect(out);
        pop.start(now + 0.06);
        pop.stop(now + 0.24);
        break;
      }
      case 'WIND_CYCLONE': {
        if (!this.throttle('storm_wind', 180)) return;
        // Resonant sweeping cyclone gust
        this.triggerNoiseBurst(ctx, out, {
          startAt: now,
          duration: 0.45,
          volume: 0.12,
          filterType: 'bandpass',
          startFreq: 380,
          endFreq: 1650,
          q: 3.4,
          attack: 0.06,
        });
        break;
      }
      case 'RAIN_DELUGE': {
        if (!this.throttle('storm_rain', 150)) return;
        // Pressurized tidal splash burst
        this.triggerNoiseBurst(ctx, out, {
          startAt: now,
          duration: 0.34,
          volume: 0.11,
          filterType: 'bandpass',
          startFreq: 1350,
          endFreq: 320,
          q: 1.1,
          attack: 0.015,
        });
        const sub = ctx.createOscillator();
        const g = ctx.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(160, now);
        sub.frequency.exponentialRampToValueAtTime(52, now + 0.2);
        g.gain.setValueAtTime(0.09, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        sub.connect(g).connect(out);
        sub.start(now);
        sub.stop(now + 0.24);
        break;
      }
      case 'THUNDER_ARC': {
        if (!this.throttle('storm_thunder', 190)) return;
        // Sharp lightning crack + rolling low thunder tail
        this.triggerNoiseBurst(ctx, out, {
          startAt: now,
          duration: 0.14,
          volume: 0.13,
          filterType: 'highpass',
          startFreq: 2100,
          endFreq: 700,
          attack: 0.005,
        });
        this.triggerNoiseBurst(ctx, out, {
          startAt: now + 0.04,
          duration: 0.72,
          volume: 0.16,
          filterType: 'lowpass',
          startFreq: 340,
          endFreq: 75,
          attack: 0.03,
        });
        break;
      }
      case 'SACRIFICE_SURGE': {
        if (!this.throttle('storm_sacrifice', 300)) return;
        const startFreq = fury === 'WIND' ? 520 : fury === 'RAIN' ? 1150 : 280;
        const endFreq = fury === 'WIND' ? 1750 : fury === 'RAIN' ? 380 : 65;
        this.triggerNoiseBurst(ctx, out, {
          startAt: now,
          duration: 1.35,
          volume: 0.15,
          filterType: fury === 'THUNDER' ? 'lowpass' : 'bandpass',
          startFreq,
          endFreq,
          q: fury === 'WIND' ? 2.4 : 1.0,
          attack: 0.12,
        });
        break;
      }
      case 'AMBIENT_GUST': {
        if (!this.throttle('storm_gust', 3500)) return;
        const fStart = fury === 'WIND' ? 460 : fury === 'RAIN' ? 760 : 190;
        const fEnd = fury === 'WIND' ? 980 : fury === 'RAIN' ? 480 : 95;
        this.triggerNoiseBurst(ctx, out, {
          startAt: now,
          duration: 1.6,
          volume: 0.045,
          filterType: fury === 'THUNDER' ? 'lowpass' : 'bandpass',
          startFreq: fStart,
          endFreq: fEnd,
          q: 1.6,
          attack: 0.45,
        });
        break;
      }
    }
  }

  public playBridgeBreak(spatial: AudioSpatialContext = DEFAULT_SPATIAL): void {
    const ctx = this.getContext();
    if (!ctx || !this.throttle('bridge_break', 80)) return;
    const now = ctx.currentTime;
    const out = this.createSpatialOut(ctx, spatial);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.3);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.33);
    osc.connect(gain).connect(out);
    osc.start(now);
    osc.stop(now + 0.35);

    this.triggerNoiseBurst(ctx, out, {
      startAt: now,
      duration: 0.32,
      volume: 0.13,
      filterType: 'lowpass',
      startFreq: 900,
      endFreq: 160,
    });
  }

  public playPriestStun(
    isPlayer = false,
    spatial: AudioSpatialContext = DEFAULT_SPATIAL
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const out = this.createSpatialOut(ctx, spatial);
    const notes = isPlayer ? [466.16, 392, 293.66] : [440, 392, 311.13];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.09;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.11, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.28);
    });
  }

  public playPriestCaptured(
    byPlayer = true,
    spatial: AudioSpatialContext = DEFAULT_SPATIAL
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const out = this.createSpatialOut(ctx, spatial);
    const notes = byPlayer ? [440, 554.37, 659.25, 880] : [349.23, 311.13, 261.63];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.065;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.085, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }

  public playSacrifice(
    fury: Fury = 'WIND',
    isGrand = false,
    spatial: AudioSpatialContext = DEFAULT_SPATIAL
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const out = this.createSpatialOut(ctx, spatial);

    // Deep celestial bass foundation
    const bass = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bass.type = 'sawtooth';
    bass.frequency.setValueAtTime(isGrand ? 73.42 : 82.41, now);
    bass.frequency.exponentialRampToValueAtTime(55, now + 1.15);
    bassGain.gain.setValueAtTime(isGrand ? 0.16 : 0.13, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    bass.connect(bassGain).connect(out);
    bass.start(now);
    bass.stop(now + 1.25);

    // Ascending celestial triad
    const chord = [261.63, 329.63, 392.0, 523.25, 659.25];
    chord.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.08;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.085, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 1.0);
    });

    // Layer elemental storm surge matched to the sacrificer's Aspect
    this.playElementalStorm('SACRIFICE_SURGE', fury, isGrand ? 1 : 0.78, spatial);
  }

  public playVictory(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [392.0, 493.88, 587.33, 783.99, 987.77].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i >= 3 ? 'sine' : 'triangle';
      const t = now + i * 0.11;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.095, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      osc.connect(gain).connect(this.sfxBus!);
      osc.start(t);
      osc.stop(t + 0.7);
    });
  }

  public playDefeat(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [329.63, 293.66, 246.94, 196.0].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.16;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      osc.connect(gain).connect(this.sfxBus!);
      osc.start(t);
      osc.stop(t + 0.48);
    });
  }
}

export { WebAudioManager as GameAudio };
