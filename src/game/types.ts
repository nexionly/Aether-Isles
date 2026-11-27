export type Fury = 'WIND' | 'RAIN' | 'THUNDER';
export type Alignment = 'SUN' | Fury;
export type Difficulty = 'INITIATE' | 'ARCHON' | 'STORMLORD';
export type AiFactionId = 'AI_1' | 'AI_2' | 'AI_3' | 'AI_4' | 'AI_5' | 'AI_6';
export type FactionId = 'PLAYER' | AiFactionId;
export type Owner = FactionId | 'NEUTRAL';
export type GamePhase = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'VICTORY' | 'DEFEAT';
export type SpeedMultiplier = 1 | 2 | 3 | 5;

/**
 * Cardinal directions on the isometric tile grid:
 * 0 = North (-y), 1 = East (+x), 2 = South (+y), 3 = West (-x)
 */
export type Direction = 0 | 1 | 2 | 3;

export type TileKind = 'VOID' | 'LAND' | 'BRIDGE';

export type TetrominoKey = 'I3' | 'I4' | 'L' | 'J' | 'T' | 'S' | 'Z' | 'CORNER';

export type StructureKind =
  | 'TEMPLE'
  | 'ALTAR'
  | 'SUN_DISC'
  | 'STONE_BLOCKER'
  | 'WINDMILL'
  | 'OUTPOST'
  | 'WATCHTOWER'
  | 'BARRIER_PYLON'
  | 'BRIDGE_MINE'
  | 'WIND_CROSSBOW'
  | 'WHIRLWIND_SPIRE'
  | 'ZEPHYR_CANNON'
  | 'RAIN_CANNON'
  | 'FROST_BLOCKER'
  | 'MAN_O_WAR'
  | 'THUNDER_CANNON'
  | 'SPARK_PYLON'
  | 'ARC_SPIRE'
  | 'STORM_OBELISK';

export type BuildOptionKind =
  | 'SUN_DISC'
  | 'STONE_BLOCKER'
  | 'WINDMILL'
  | 'OUTPOST'
  | 'WATCHTOWER'
  | 'BARRIER_PYLON'
  | 'BRIDGE_MINE'
  | 'WIND_CROSSBOW'
  | 'WHIRLWIND_SPIRE'
  | 'ZEPHYR_CANNON'
  | 'RAIN_CANNON'
  | 'FROST_BLOCKER'
  | 'MAN_O_WAR'
  | 'THUNDER_CANNON'
  | 'SPARK_PYLON'
  | 'ARC_SPIRE';

export type AerialUnitKind =
  | 'SUN_FLYER'
  | 'SKY_TRANSPORT'
  | 'ROVING_WHIRLWIND'
  | 'SKY_LEVIATHAN';

export type TechUnlockKey = BuildOptionKind | AerialUnitKind;

export type PriestAbilityId = 'RECALL' | 'SANCTUARY' | 'TEMPEST_CAST';

export interface Tile {
  x: number;
  y: number;
  kind: TileKind;
  islandId: number; // -1 for VOID or BRIDGE
  owner: Owner | null; // For BRIDGE tiles
  hp: number;
  maxHp: number;
  poweredMask: number; // Bitmask per FactionId (bit 0 = PLAYER, bits 1..6 = AI_1..AI_6)
  variant: number; // Deterministic noise 0..1 for painterly tile shading
  hitFlash: number;
  unpoweredSeconds: number; // Tracks bridge decay when severed from Temple/Outpost
}

export interface IslandInfo {
  id: number;
  name: string;
  role: 'PLAYER_HOME' | 'AI_HOME' | 'GEYSER' | 'CITADEL' | 'SHRINE';
  homeOwner?: FactionId;
  centerX: number;
  centerY: number;
  tiles: Array<{ x: number; y: number }>;
}

export interface StructureDef {
  kind: StructureKind;
  name: string;
  shortName: string;
  alignment: Alignment;
  cost: number;
  maxHp: number;
  range: number; // in tiles
  damage: number;
  fireRate: number; // shots per second (0 if non-attacking)
  directional: boolean;
  tier: 1 | 2;
  role: 'CORE' | 'OFFENSE' | 'DEFENSE' | 'ECONOMY';
  description: string;
  canBuildOnBridge: boolean;
  splashRadius?: number;
  chainCount?: number;
  pierceCount?: number;
  regenPerSec?: number;
  slowAuraRadius?: number;
  blocksDirectional?: boolean;
  passiveIncome?: number;
  projectileSpeed?: number;
  visionRadius?: number;
  isPowerHub?: boolean;
  isFencePylon?: boolean;
  isMine?: boolean;
}

export interface Structure {
  id: number;
  kind: StructureKind;
  owner: Owner;
  tx: number;
  ty: number;
  facing: Direction;
  hp: number;
  maxHp: number;
  cooldown: number;
  powered: boolean;
  hitFlash: number;
  recoil: number;
  animPhase: number;
  buildProgress: number; // 0..1 brief pop-in animation
}

export type PriestState = 'ACTIVE' | 'STUNNED' | 'CARRIED' | 'SACRIFICING' | 'SACRIFICED';

export interface Priest {
  id: number;
  owner: Owner;
  isRogue: boolean;
  x: number; // fractional tile coords
  y: number;
  homeTx: number;
  homeTy: number;
  hp: number;
  maxHp: number;
  state: PriestState;
  stunTimer: number;
  carriedByPriestId: number | null;
  captureTargetPriestId: number | null;
  carryingPriestId: number | null;
  returningToAltar: boolean;
  repathCooldown: number;
  targetPath: Array<{ x: number; y: number }>;
  hitFlash: number;
  animPhase: number;
  sacrificeTimer: number;
  sacrificedBy: Owner | null;
  shieldTimer: number;
  abilityCooldowns: Record<PriestAbilityId, number>;
}

export type GolemTask =
  | 'IDLE'
  | 'HARVESTING'
  | 'RETURNING_CRYSTAL'
  | 'CAPTURING_PRIEST'
  | 'RETURNING_PRIEST'
  | 'REPAIRING';

export interface Golem {
  id: number;
  owner: Owner;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number; // tiles/sec
  task: GolemTask;
  targetCrystalId: number | null;
  carryingCrystalValue: number;
  captureTargetPriestId: number | null;
  carryingPriestId: number | null;
  repairTarget: { kind: 'STRUCTURE' | 'BRIDGE'; id?: number; tx: number; ty: number } | null;
  path: Array<{ x: number; y: number }>;
  repathCooldown: number;
  hitFlash: number;
  slowTimer: number;
  walkPhase: number;
}

export interface AerialUnitDef {
  kind: AerialUnitKind;
  name: string;
  shortName: string;
  alignment: Alignment;
  cost: number;
  maxHp: number;
  speed: number;
  range: number;
  damage: number;
  fireRate: number;
  visionRadius: number;
  tier: 1 | 2;
  canTransportPriest?: boolean;
  splashRadius?: number;
  regenPerSec?: number;
  description: string;
}

export interface AerialUnit {
  id: number;
  kind: AerialUnitKind;
  owner: FactionId;
  x: number;
  y: number;
  altitude: number;
  hp: number;
  maxHp: number;
  speed: number;
  cooldown: number;
  targetX: number;
  targetY: number;
  hasManualOrder: boolean;
  carryingPriestId: number | null;
  captureTargetPriestId: number | null;
  returningToAltar: boolean;
  hitFlash: number;
  animPhase: number;
  heading: number;
}

export interface EnergyFenceLink {
  owner: FactionId;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  pylonAId: number;
  pylonBId: number;
  active: boolean;
}

export interface TechUnlockOption {
  key: TechUnlockKey;
  isAerial: boolean;
  name: string;
  shortName: string;
  alignment: Alignment;
  cost: number;
  description: string;
  badge: string;
}

export interface Geyser {
  id: number;
  tx: number;
  ty: number;
  islandId: number;
  eruptTimer: number;
  eruptInterval: number;
  isSuper: boolean;
  pulsePhase: number;
}

export interface Crystal {
  id: number;
  tx: number;
  ty: number;
  x: number;
  y: number;
  value: number;
  claimedByGolemId: number | null;
  spawnAnim: number; // 0..1 arc drop from geyser
  fromX: number;
  fromY: number;
  bobPhase: number;
}

export interface Projectile {
  id: number;
  owner: Owner;
  alignment: Alignment;
  kind:
    | 'DISC'
    | 'WIND_BOLT'
    | 'ZEPHYR_BLADE'
    | 'RAIN_ORB'
    | 'THUNDER_SHELL'
    | 'OBELISK_BOLT'
    | 'MANOWAR_BOLT';
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  damage: number;
  splashRadius: number;
  pierceLeft: number;
  hitEntityIds: number[];
  directional: boolean;
  life: number;
  maxLife: number;
  arcHeight: number;
  age: number;
  bridgeBonus: number;
}

export interface LightningArc {
  points: Array<{ x: number; y: number }>;
  color: string;
  life: number;
  maxLife: number;
  width: number;
}

export interface SacrificeBeam {
  tx: number;
  ty: number;
  fury: Fury;
  progress: number; // 0..1
  duration: number;
  isVictory: boolean;
  owner: Owner;
}

export interface CaptureExplosion {
  x: number;
  y: number;
  primaryColor: string;
  secondaryColor: string;
  progress: number; // 0..1
  duration: number;
  isHighPriest: boolean;
  seed: number;
}

export type ImpactEffectKind =
  | 'CRUMBLE'
  | 'RAIN_SPLASH'
  | 'SCORCH_RING'
  | 'WIND_BURST'
  | 'BUILD_SNAP';

export interface ImpactEffect {
  x: number;
  y: number;
  kind: ImpactEffectKind;
  color: string;
  progress: number; // 0..1
  duration: number;
  scale: number;
  seed: number;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  gravity: number;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export type VictoryCelebrationTheme =
  | 'AETHER_COLLECTION'
  | 'ALTAR_RITUAL'
  | 'TEMPLE_SIEGE';

export type VictoryParticleShape =
  | 'CRYSTAL'
  | 'RUNE'
  | 'WISP'
  | 'SPARK'
  | 'STAR';

export interface VictoryCelebrationParticle {
  nx: number;
  ny: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  vRot: number;
  life: number;
  maxLife: number;
  color: string;
  coreColor: string;
  shape: VictoryParticleShape;
  swayPhase: number;
  swayAmp: number;
  swayFreq: number;
  gravity: number;
  drag: number;
  twinkleSpeed: number;
  runeVariant: number;
}

export interface VictoryCelebrationRing {
  nx: number;
  ny: number;
  progress: number;
  duration: number;
  maxRadius: number;
  color: string;
  secondaryColor: string;
  style: 'CRYSTAL_PRISM' | 'RITUAL_SIGIL' | 'SIEGE_BURST';
  rotation: number;
  vRot: number;
}

export interface VictoryCelebrationState {
  theme: VictoryCelebrationTheme;
  reason: OutcomeReason;
  elapsed: number;
  burstTimer: number;
  ambientTimer: number;
  primaryColor: string;
  accentColor: string;
  particles: VictoryCelebrationParticle[];
  rings: VictoryCelebrationRing[];
}

export interface FactionState {
  owner: FactionId;
  label: string;
  color: string;
  fury: Fury;
  stormPower: number;
  knowledgeTier: 1 | 2;
  bridgeQueue: TetrominoKey[];
  sacrificesCompleted: number;
  crystalsHarvested: number;
  bridgesPlaced: number;
  towersDestroyed: number;
  eliminated: boolean;
  dominanceSeconds: number;
  unlockedTechs: TechUnlockKey[];
}

export type PlacementMode =
  | { type: 'SELECT' }
  | { type: 'BRIDGE'; queueIndex: number; rotation: Direction }
  | { type: 'STRUCTURE'; kind: BuildOptionKind; facing: Direction };

export interface SelectedInspect {
  kind: 'STRUCTURE' | 'PRIEST' | 'GOLEM' | 'GEYSER' | 'AERIAL';
  id: number;
  title: string;
  subtitle: string;
  owner: Owner;
  factionColor?: string;
  hp: number;
  maxHp: number;
  powered?: boolean;
  statusText: string;
  canCommandCapture?: boolean;
  canReclaim?: boolean;
  reclaimRefund?: number;
}

export interface HoverInspect {
  kind: 'STRUCTURE' | 'PRIEST' | 'GOLEM' | 'GEYSER' | 'AERIAL';
  id: number;
  title: string;
  factionLabel: string;
  factionColor: string;
  owner: Owner;
  hp: number;
  maxHp: number;
  rangeLabel: string;
  combatStats?: string;
  objective: string;
  powered?: boolean;
  screenX: number;
  screenY: number;
}

export interface RangeOverlayState {
  enabled: boolean;
  WIND: boolean;
  RAIN: boolean;
  THUNDER: boolean;
}

export type OutcomeReason =
  | 'PRIEST_SACRIFICE'
  | 'TEMPLE_DESTRUCTION'
  | 'AETHER_OVERLOAD'
  | 'ALTAR_DOMINANCE';

export interface VictoryRules {
  /** Primary victory condition — always active and cannot be disabled. */
  priestSacrifice: true;
  /** Shattering rival High Temples eliminates rivals and unlocks Tier-2 mastery. */
  templeDestruction: boolean;
  /** Holding exclusive powered control of majority Sacred Sites for 90s wins the skirmish. */
  altarDominance: boolean;
  /** Hoarding enough crystal reserves triggers Aether Overload victory. */
  aetherOverload: boolean;
  /** Target Aether reserve threshold when Aether Overload is enabled. */
  aetherOverloadTarget: number;
  /** Optional Fog of War shrouding unexplored and un-scouted sky islands. */
  fogOfWar: boolean;
}

export interface SacredSiteState {
  islandId: number;
  name: string;
  role: 'CITADEL' | 'SHRINE';
  tx: number;
  ty: number;
  controller: FactionId | null;
  contested: boolean;
  guardedByNeutral: boolean;
}

export interface VictoryProgressSnapshot {
  aetherTarget: number;
  playerAether: number;
  leadingOverloadOwner: FactionId;
  leadingOverloadLabel: string;
  leadingOverloadColor: string;
  leadingOverloadAether: number;
  aetherOverloadAchieved: boolean;
  dominanceDuration: number;
  requiredSites: number;
  totalSites: number;
  playerControlledSites: number;
  playerDominanceSeconds: number;
  dominanceLeaderOwner: FactionId | null;
  dominanceLeaderLabel: string | null;
  dominanceLeaderColor: string | null;
  dominanceLeaderSeconds: number;
  dominanceLeaderSites: number;
  altarDominanceAchieved: boolean;
  sites: SacredSiteState[];
}

export interface MatchStats {
  elapsedSeconds: number;
  playerFury: Fury;
  aiFury: Fury;
  difficulty: Difficulty;
  opponentCount: number;
  rivalsEliminated: number;
  crystalsHarvested: number;
  bridgesPlaced: number;
  towersDestroyed: number;
  sacrificesCompleted: number;
  islandsConnected: number;
  outcomeReason?: OutcomeReason;
  winnerLabel?: string;
  canContinuePlaying?: boolean;
  achievedAltVictories?: OutcomeReason[];
}

export interface RivalHudSummary {
  id: AiFactionId;
  label: string;
  color: string;
  fury: Fury;
  hp: number;
  maxHp: number;
  state: PriestState;
  eliminated: boolean;
}

export interface HudSnapshot {
  phase: GamePhase;
  elapsedSeconds: number;
  stormPower: number;
  golemCount: number;
  maxGolems: number;
  golemCost: number;
  connectedIslands: number;
  totalIslands: number;
  knowledgeTier: 1 | 2;
  playerFury: Fury;
  aiFury: Fury;
  difficulty: Difficulty;
  opponentCount: number;
  gridSize: number;
  rivals: RivalHudSummary[];
  bridgeQueue: TetrominoKey[];
  placement: PlacementMode;
  speedMultiplier: SpeedMultiplier;
  muted: boolean;
  musicVolume: number;
  sfxVolume: number;
  currentTrackTitle: string;
  rangeOverlay: RangeOverlayState;
  selected: SelectedInspect | null;
  hovered: HoverInspect | null;
  playerPriestHp: number;
  playerPriestMaxHp: number;
  playerPriestState: PriestState;
  aiPriestHp: number;
  aiPriestMaxHp: number;
  aiPriestState: PriestState;
  stunnedTargets: Array<{
    priestId: number;
    label: string;
    x: number;
    y: number;
    isEnemyHighPriest: boolean;
    stunRemaining: number;
  }>;
  alertBanner: { text: string; tone: 'INFO' | 'WARNING' | 'SACRIFICE' } | null;
  victoryRules: VictoryRules;
  victoryProgress: VictoryProgressSnapshot;
  matchStats: MatchStats;
  unlockedTechs: TechUnlockKey[];
  pendingTechChoices: TechUnlockOption[] | null;
  aerialCount: number;
  maxAerialUnits: number;
  priestAbilities: Array<{
    id: PriestAbilityId;
    name: string;
    hotkey: string;
    cost: number;
    cooldown: number;
    maxCooldown: number;
    ready: boolean;
    description: string;
  }>;
  playerPriestShieldTimer: number;
}
