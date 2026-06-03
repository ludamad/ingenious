// A single domino tile (two gem hexes) + the player's rack of tiles.
import { useState } from "react";
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
          {/* a redacted/empty half (color -1) has no palette entry */}
          <polygon points={hexPoints(0, 0, size)} fill="url(#tileGem)"
            stroke={PALETTE[p.c]?.dark ?? "#3a4250"} strokeWidth={1.5} />
          <Symbol color={p.c} size={size * 0.5} />
        </g>
      ))}
    </svg>
  );
}

interface RackProps {
  tiles: Tile[];
  // display order: hand indices in the order the player has arranged them.
  order: number[];
  selectedIndex: number | null;
  flip: number;
  disabled: boolean;
  // per-tile: does this tile have at least one legal placement this turn?
  // undefined => unknown (don't dim), e.g. when it isn't your turn.
  placeable?: boolean[];
  canFlip?: boolean; // is flipping the selected tile useful (a 2nd legal orientation)?
  onSelect: (i: number) => void;
  onFlip: () => void;
  // move the tile shown at display position `from` to position `to`
  onReorder: (from: number, to: number) => void;
}

export function Rack({ tiles, order, selectedIndex, flip, disabled, placeable, canFlip = true, onSelect, onFlip, onReorder }: RackProps) {
  const [dragPos, setDragPos] = useState<number | null>(null);
  const [overPos, setOverPos] = useState<number | null>(null);

  function drop(toPos: number) {
    if (dragPos != null && dragPos !== toPos) onReorder(dragPos, toPos);
    setDragPos(null); setOverPos(null);
  }

  return (
    <div className={"rack" + (disabled ? " disabled" : "")}>
      {order.map((i, pos) => {
        const t = tiles[i];
        if (!t) return null;
        const sel = i === selectedIndex;
        const shown = sel && flip ? { a: t.b, b: t.a } : t;
        // A tile with no legal placement is dimmed and unclickable so there are
        // no dead clicks — the player can immediately see what's playable.
        const unplaceable = !disabled && placeable != null && !placeable[i];
        const cls = "tile" + (sel ? " selected" : "") + (unplaceable ? " unplaceable" : "")
          + (overPos === pos && dragPos !== pos ? " drop-target" : "")
          + (dragPos === pos ? " dragging" : "");
        return (
          <button key={i} className={cls}
            // Rearranging is allowed whenever it's your turn — even for tiles you
            // can't currently place — since order is purely cosmetic.
            draggable={!disabled}
            onDragStart={() => setDragPos(pos)}
            onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOverPos(pos); } }}
            onDrop={(e) => { e.preventDefault(); drop(pos); }}
            onDragEnd={() => { setDragPos(null); setOverPos(null); }}
            // Click selects; clicking the already-selected tile flips it (when it
            // has a second legal orientation).
            onClick={() => {
              if (disabled || unplaceable) return;
              if (sel && canFlip) onFlip(); else onSelect(i);
            }}
            disabled={disabled || unplaceable}
            title={unplaceable ? "No legal spot for this tile"
              : sel && canFlip ? "Click to flip · drag to rearrange"
              : "Drag to rearrange"}>
            <TileView tile={shown} size={HEX_SIZE * 0.7} />
          </button>
        );
      })}
      <button className="flip-btn" onClick={onFlip}
        disabled={disabled || selectedIndex == null || !canFlip}
        title={canFlip ? "Swap which color leads" : "This tile only fits one way"}>
        ⟲ Flip
      </button>
    </div>
  );
}
