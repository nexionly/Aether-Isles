import React from 'react';
import { TETROMINOES, rotateCells } from '../game/catalog';
import type { AerialUnitKind, BuildOptionKind, Direction, TetrominoKey } from '../game/types';

export function AetherIslesTitleLockup({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 540 124"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Aether Isles: Skybridge Siege"
    >
      <defs>
        <linearGradient id="aiGold" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFF4CC" />
          <stop offset="48%" stopColor="#E6B84C" />
          <stop offset="100%" stopColor="#9C6F23" />
        </linearGradient>
        <linearGradient id="aiCrest" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7CECE0" />
          <stop offset="55%" stopColor="#F5D061" />
          <stop offset="100%" stopColor="#C084FC" />
        </linearGradient>
      </defs>

      {/* Carved Skyward Horizon Rule & Crest */}
      <path d="M10 82 L152 82" stroke="url(#aiGold)" strokeWidth="1.5" strokeOpacity="0.65" />
      <path d="M388 82 L530 82" stroke="url(#aiGold)" strokeWidth="1.5" strokeOpacity="0.65" />
      <polygon points="270,2 279,14 270,22 261,14" fill="url(#aiCrest)" />
      <path d="M236 14 L256 14 M284 14 L304 14" stroke="#D6BC86" strokeWidth="1.2" strokeOpacity="0.7" />

      {/* Main Display Wordmark */}
      <text
        x="270"
        y="68"
        textAnchor="middle"
        fill="url(#aiGold)"
        fontFamily="Cinzel, Georgia, serif"
        fontWeight="800"
        fontSize="50"
        letterSpacing="6"
      >
        AETHER ISLES
      </text>

      {/* Subtitle */}
      <text
        x="270"
        y="108"
        textAnchor="middle"
        fill="#DCEAF5"
        fontFamily="Cinzel, Georgia, serif"
        fontWeight="600"
        fontSize="17"
        letterSpacing="7"
      >
        SKYBRIDGE SIEGE
      </text>
    </svg>
  );
}

export function TetrominoPreview({
  piece,
  rotation = 0,
  color = '#2dd4bf',
  size = 36,
}: {
  piece: TetrominoKey;
  rotation?: Direction;
  color?: string;
  size?: number;
}) {
  const cells = rotateCells(TETROMINOES[piece].cells, rotation);
  const maxX = Math.max(...cells.map((c) => c.x));
  const maxY = Math.max(...cells.map((c) => c.y));
  const cols = maxX + 1;
  const rows = maxY + 1;
  const cellSize = Math.min(8.5, 28 / Math.max(cols, rows));
  const totalW = cols * cellSize;
  const totalH = rows * cellSize;
  const ox = (36 - totalW) * 0.5;
  const oy = (36 - totalH) * 0.5;

  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      {cells.map((c, idx) => (
        <g key={idx}>
          <rect
            x={ox + c.x * cellSize + 0.8}
            y={oy + c.y * cellSize + 0.8}
            width={cellSize - 1.6}
            height={cellSize - 1.6}
            rx={1.5}
            fill="#8c8578"
            stroke="#e2d8c5"
            strokeWidth={0.7}
          />
          <rect
            x={ox + c.x * cellSize + cellSize * 0.3}
            y={oy + c.y * cellSize + cellSize * 0.3}
            width={cellSize * 0.4}
            height={cellSize * 0.4}
            rx={0.6}
            fill={color}
          />
        </g>
      ))}
    </svg>
  );
}

export function StormCrystalIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <polygon points="12,2 19,10 12,22 5,10" fill="#F0B429" stroke="#FEF3C7" strokeWidth="1.4" />
      <polygon points="12,2 19,10 12,11" fill="#FEF08A" />
    </svg>
  );
}

export function GolemGlyph({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="8" y="3" width="8" height="5" rx="1.5" fill="#CBD5E1" />
      <rect x="5" y="9" width="14" height="9" rx="2.5" fill="#94A3B8" stroke="#E2E8F0" strokeWidth="1.1" />
      <circle cx="12" cy="13.5" r="2.2" fill="#F0B429" />
      <rect x="7" y="18" width="3.5" height="4" rx="1" fill="#64748B" />
      <rect x="13.5" y="18" width="3.5" height="4" rx="1" fill="#64748B" />
    </svg>
  );
}

export function PriestGlyph({
  color = '#f0b429',
  className = 'w-3.5 h-3.5',
}: {
  color?: string;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {/* Subtle celestial halo arc */}
      <path
        d="M6.5 9.2 A6 6 0 0 1 17.5 9.2"
        stroke="#F5DFAA"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeOpacity="0.85"
      />
      {/* Sculpted High Priest mitre crown */}
      <path
        d="M12 2.5 L16 8.2 L14.4 10.6 H9.6 L8 8.2 Z"
        fill={color}
        stroke="#FEF3C7"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Brow jewel */}
      <circle cx="12" cy="7.2" r="1.1" fill="#FFFBEB" />
      {/* Ceremonial hooded shoulders / mantle */}
      <path
        d="M5.5 21 C5.8 15.8 8.4 12.6 12 12.6 C15.6 12.6 18.2 15.8 18.5 21 Z"
        fill={color}
        fillOpacity="0.9"
        stroke="#FEF3C7"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Gold stole trim */}
      <path d="M12 12.8 V20.6" stroke="#FEF08A" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function StructureGlyph({
  kind,
  color,
  className = 'w-6 h-6',
}: {
  kind: BuildOptionKind;
  color: string;
  className?: string;
}) {
  switch (kind) {
    case 'SUN_DISC':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <ellipse cx="12" cy="11" rx="8" ry="4.5" fill={color} stroke="#FEF3C7" strokeWidth="1.4" />
          <circle cx="12" cy="11" r="2.2" fill="#17202C" />
          <path d="M9 15.5 L15 15.5 L16 20 L8 20 Z" fill="#94A3B8" />
        </svg>
      );
    case 'STONE_BLOCKER':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M4 8 H8 V11 H10 V8 H14 V11 H16 V8 H20 V20 H4 Z" fill="#A8A095" stroke="#E2D8C5" strokeWidth="1.2" />
        </svg>
      );
    case 'WINDMILL':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M9 21 L10.5 11 H13.5 L15 21 Z" fill="#A8A095" />
          <path d="M12 10 L12 3 L15 5 V9 Z M12 10 L19 10 L17 13 H13 Z M12 10 L12 17 L9 15 V11 Z M12 10 L5 10 L7 7 H11 Z" fill={color} />
          <circle cx="12" cy="10" r="1.8" fill="#FEF3C7" />
        </svg>
      );
    case 'WIND_CROSSBOW':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M5 12 Q12 4 19 12" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
          <line x1="12" y1="4" x2="12" y2="20" stroke="#E2E8F0" strokeWidth="2.2" strokeLinecap="round" />
          <polygon points="12,2 15,7 9,7" fill={color} />
        </svg>
      );
    case 'WHIRLWIND_SPIRE':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <polygon points="12,3 16,20 8,20" fill="#94A3B8" />
          <ellipse cx="12" cy="10" rx="7" ry="2.6" stroke={color} strokeWidth="1.8" />
          <ellipse cx="12" cy="15" rx="9" ry="3" stroke={color} strokeWidth="1.5" />
        </svg>
      );
    case 'ZEPHYR_CANNON':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M4 15 Q12 5 20 15" stroke="#5EEAD4" strokeWidth="2.5" />
          <path d="M12 3 L16 12 L12 10 L8 12 Z" fill={color} />
          <rect x="9" y="14" width="6" height="6" rx="1" fill="#CBD5E1" />
        </svg>
      );
    case 'RAIN_CANNON':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <circle cx="12" cy="10" r="6.5" fill={color} stroke="#E0F2FE" strokeWidth="1.4" />
          <path d="M7 17 H17 L18 21 H6 Z" fill="#64748B" />
        </svg>
      );
    case 'FROST_BLOCKER':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <polygon points="6,19 8,7 12,4 16,7 18,19" fill={color} stroke="#E0F2FE" strokeWidth="1.3" />
          <line x1="12" y1="5" x2="12" y2="18" stroke="#F0F9FF" strokeWidth="1.2" />
        </svg>
      );
    case 'MAN_O_WAR':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M5 12 A7 7 0 0 1 19 12 Z" fill={color} stroke="#E0F2FE" strokeWidth="1.3" />
          <path d="M8 12 V20 M12 12 V21 M16 12 V19" stroke="#7DD3FC" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'THUNDER_CANNON':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <rect x="5" y="7" width="14" height="7" rx="2" fill="#475569" stroke="#FACC15" strokeWidth="1.5" />
          <circle cx="19" cy="10.5" r="2.5" fill={color} />
          <rect x="7" y="15" width="10" height="5" rx="1" fill="#64748B" />
        </svg>
      );
    case 'SPARK_PYLON':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <polygon points="12,5 16,20 8,20" fill="#64748B" />
          <path d="M13 3 L9 10 H13 L10 16" stroke="#FACC15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="5" r="2.8" fill={color} />
        </svg>
      );
    case 'ARC_SPIRE':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <polygon points="12,4 15.5,21 8.5,21" fill="#3B2F52" stroke="#D6BC86" strokeWidth="1.2" />
          <circle cx="12" cy="5.5" r="3.4" fill="#FACC15" />
          <path d="M5 9 L9 7 M19 9 L15 7" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'OUTPOST':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <polygon points="12,3 17,10 12,17 7,10" fill={color} stroke="#FEF3C7" strokeWidth="1.3" />
          <ellipse cx="12" cy="10" rx="9" ry="3.2" stroke="#F5D061" strokeWidth="1.2" />
          <path d="M6 20 L8 16 H16 L18 20 Z" fill="#94A3B8" stroke="#E2D8C5" strokeWidth="1" />
        </svg>
      );
    case 'WATCHTOWER':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M9 21 L10 9 H14 L15 21 Z" fill="#CBD5E1" stroke="#64748B" strokeWidth="1" />
          <path d="M7 9 H17" stroke="#EAB308" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="6" r="2.8" fill="#67E8F9" stroke="#FEF3C7" strokeWidth="1.1" />
          <path d="M14.5 5.5 L20 3.5" stroke="#FDE047" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'BARRIER_PYLON':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M8 21 L9.5 11 H14.5 L16 21 Z" fill="#94A3B8" />
          <path d="M9.5 11 L7 5 M14.5 11 L17 5" stroke="#EAB308" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="7" r="2.6" fill="#38BDF8" stroke="#E0F2FE" strokeWidth="1.1" />
          <path d="M3 7 H7 M17 7 H21" stroke="#38BDF8" strokeWidth="1.4" strokeDasharray="2 1.5" />
        </svg>
      );
    case 'BRIDGE_MINE':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <ellipse cx="12" cy="14" rx="8" ry="4.5" fill="#7C2D12" stroke="#F59E0B" strokeWidth="1.4" />
          <circle cx="12" cy="13" r="2.8" fill="#FB923C" />
          <path d="M12 4 V8 M6 6 L8.5 9 M18 6 L15.5 9" stroke="#FDE047" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

export function AerialGlyph({
  kind,
  color,
  className = 'w-5 h-5',
}: {
  kind: AerialUnitKind;
  color: string;
  className?: string;
}) {
  switch (kind) {
    case 'SUN_FLYER':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M21 12 L7 5 L10 12 L7 19 Z" fill={color} stroke="#FEF3C7" strokeWidth="1.3" strokeLinejoin="round" />
          <circle cx="13" cy="12" r="2" fill="#FEF08A" />
        </svg>
      );
    case 'SKY_TRANSPORT':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <ellipse cx="12" cy="9" rx="8.5" ry="4.8" fill="#E8DEC8" stroke={color} strokeWidth="1.4" />
          <rect x="9.5" y="4.5" width="5" height="9" fill={color} />
          <path d="M9 14 L9.5 18 H14.5 L15 14" stroke="#EAB308" strokeWidth="1.3" />
          <rect x="9" y="17.5" width="6" height="3" rx="0.8" fill="#78350F" stroke="#F5D061" strokeWidth="0.9" />
        </svg>
      );
    case 'ROVING_WHIRLWIND':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <ellipse cx="12" cy="6" rx="7.5" ry="2.5" stroke={color} strokeWidth="1.8" />
          <ellipse cx="12" cy="11.5" rx="5.5" ry="2" stroke="#F0FDFA" strokeWidth="1.6" />
          <ellipse cx="12" cy="16.5" rx="3.4" ry="1.4" stroke={color} strokeWidth="1.5" />
          <circle cx="12" cy="20" r="1.4" fill="#F0FDFA" />
        </svg>
      );
    case 'SKY_LEVIATHAN':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M4 12 A8 7.5 0 0 1 20 12 Q12 16 4 12 Z" fill={color} stroke="#E0F2FE" strokeWidth="1.3" />
          <path d="M8 14 V20 M12 14.5 V21.5 M16 14 V20" stroke="#7DD3FC" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="9" r="2.2" fill="#FEF08A" />
        </svg>
      );
  }
}
