// A single domino tile (two gem hexes) + the player's rack of tiles.
import { hexPoints, PALETTE, HEX_SIZE } from "../hex";
import { Symbol } from "./Symbol";
import type { Tile } from "../engine/engine";

const SQRT3 = Math.sqrt(3);

export function TileView({ tile, size = 18 }: { tile: Tile; size?: number }) {
  const dx = size * SQRT3; // horizontal neighbour offset for pointy-top hexes
  const w = dx + size * SQRT3;
  const h = size * 2;
  const cx = size * SQRT3 / 2 + 2;
  return (
    <svg width={w + 4} height={h + 4} viewBox={`${-cx} ${-size - 2} ${w + 4} ${h + 4}`}>
      <defs>
        <radialGradient id="tileGem" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#3a4250" />
          <stop offset="55%" stopColor="#20262f" />
          <stop offset="100%" stopColor="#10141a" />
        </radialGradient>
      </defs>
      {[{ x: 0, c: tile.a }, { x: dx, c: tile.b }].map((p, i) => (
        <g key={i} transform={`translate(${p.x} 0)`}>
          <polygon points={hexPoints(0, 0, size)} fill="url(#tileGem)"
            stroke={PALETTE[p.c].dark} strokeWidth={1.5} />
          <Symbol color={p.c} size={size * 0.5} />
        </g>
      ))}
    </svg>
  );
}

interface RackProps {
  tiles: Tile[];
  selectedIndex: number | null;
  flip: number;
  disabled: boolean;
  onSelect: (i: number) => void;
  onFlip: () => void;
}

export function Rack({ tiles, selectedIndex, flip, disabled, onSelect, onFlip }: RackProps) {
  return (
    <div className={"rack" + (disabled ? " disabled" : "")}>
      {tiles.map((t, i) => {
        const sel = i === selectedIndex;
        const shown = sel && flip ? { a: t.b, b: t.a } : t;
        return (
          <button key={i} className={"tile" + (sel ? " selected" : "")}
            onClick={() => !disabled && onSelect(i)} disabled={disabled}>
            <TileView tile={shown} size={HEX_SIZE * 0.7} />
          </button>
        );
      })}
      <button className="flip-btn" onClick={onFlip}
        disabled={disabled || selectedIndex == null} title="Swap which color leads">
        ⟲ Flip
      </button>
    </div>
  );
}
