import { useMemo } from "react";
import { axialToPixel, hexPoints, DIRS, PALETTE, HEX_SIZE } from "../hex";
import { Symbol } from "./Symbol";
import type { GameState, Move, Tile } from "../engine/engine";

const key = (q: number, r: number) => `${q},${r}`;

interface Props {
  state: GameState;
  legalMoves: Move[];
  selectedTileIndex: number | null;
  selectedTile: Tile | null;
  flip: number;
  anchor: { q: number; r: number } | null;
  interactive: boolean;
  lastPlaced: { q: number; r: number }[];
  previewMove: { q: number; r: number; dir: number; a: number; b: number } | null;
  onSelectAnchor: (cell: { q: number; r: number } | null) => void;
  onPlace: (m: Move) => void;
}

export function Board(props: Props) {
  const { state, legalMoves, selectedTileIndex, selectedTile, flip, anchor, interactive, lastPlaced, previewMove } = props;

  const candidates = useMemo(
    () => legalMoves.filter((m) => m.tileIndex === selectedTileIndex && m.flip === flip),
    [legalMoves, selectedTileIndex, flip],
  );
  const anchorSet = useMemo(() => new Set(candidates.map((m) => key(m.q, m.r))), [candidates]);
  const partnerMoves = useMemo(() => {
    const map = new Map<string, Move>();
    if (anchor) {
      for (const m of candidates) {
        if (m.q === anchor.q && m.r === anchor.r) {
          map.set(key(m.q + DIRS[m.dir][0], m.r + DIRS[m.dir][1]), m);
        }
      }
    }
    return map;
  }, [candidates, anchor]);

  const { viewBox, cells } = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const cs = state.cells.map((c) => {
      const p = axialToPixel(c.q, c.r);
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      return { ...c, ...p };
    });
    const pad = HEX_SIZE * 1.4;
    return {
      cells: cs,
      viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
    };
  }, [state.cells]);

  // the partner half of the last move animates in slightly after the anchor half
  const partnerKey = lastPlaced.length > 1 ? key(lastPlaced[1].q, lastPlaced[1].r) : "";

  const firstColor = selectedTile ? (flip ? selectedTile.b : selectedTile.a) : -1;
  const secondColor = selectedTile ? (flip ? selectedTile.a : selectedTile.b) : -1;

  // opponent preview ("lining up" a tile)
  const prevAnchorKey = previewMove ? key(previewMove.q, previewMove.r) : "";
  const prevPartnerKey = previewMove
    ? key(previewMove.q + DIRS[previewMove.dir][0], previewMove.r + DIRS[previewMove.dir][1]) : "";

  function clickCell(q: number, r: number, color: number) {
    if (!interactive || selectedTileIndex == null) return;
    if (color !== -1) return;
    const k = key(q, r);
    if (anchor && anchor.q === q && anchor.r === r) { props.onSelectAnchor(null); return; }
    if (anchor && partnerMoves.has(k)) { props.onPlace(partnerMoves.get(k)!); return; }
    if (anchorSet.has(k)) { props.onSelectAnchor({ q, r }); return; }
  }

  return (
    <svg className="board" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="gemDark" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#3a4250" />
          <stop offset="55%" stopColor="#20262f" />
          <stop offset="100%" stopColor="#10141a" />
        </radialGradient>
        <radialGradient id="emptyHex" cx="35%" cy="28%" r="85%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#e6eef6" />
          <stop offset="100%" stopColor="#cbd8e6" />
        </radialGradient>
        <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.4" floodColor="#0b1b2b" floodOpacity="0.35" />
        </filter>
      </defs>

      {cells.map((c) => {
        const k = key(c.q, c.r);
        const inactive = c.color === -3;       // reserved outer ring (fewer players)
        const occupied = c.color >= 0;          // a placed/printed gem
        const isAnchor = anchor && anchor.q === c.q && anchor.r === c.r;
        const isPartnerCand = !!anchor && partnerMoves.has(k);
        const isAnchorCand = !anchor && selectedTileIndex != null && anchorSet.has(k);
        const isPrevA = k === prevAnchorKey;
        const isPrevB = k === prevPartnerKey;
        const cls = [
          "hex",
          inactive ? "inactive" : occupied ? "filled" : "empty",
          isAnchorCand ? "cand" : "",
          isPartnerCand ? "partner" : "",
          isAnchor ? "anchor" : "",
          (isPrevA || isPrevB) ? "preview" : "",
        ].join(" ").trim();

        return (
          <g key={k} transform={`translate(${c.x} ${c.y})`}
             className={cls} onClick={() => clickCell(c.q, c.r, c.color)}>
            <polygon points={hexPoints(0, 0)}
              fill={inactive ? "#d7e0ea" : occupied ? "url(#gemDark)" : "url(#emptyHex)"}
              stroke={inactive ? "#c0ccda" : occupied ? PALETTE[c.color].dark : "#9fb3c8"}
              strokeWidth={occupied ? 1.5 : 1}
              filter={occupied ? "url(#soft)" : undefined} />
            {occupied && (
              <g className="gem-enter" style={k === partnerKey ? { animationDelay: "0.18s" } : undefined}>
                <Symbol color={c.color} />
              </g>
            )}

            {/* my placement ghosts */}
            {isAnchor && firstColor >= 0 && <g opacity={0.85}><Symbol color={firstColor} /></g>}
            {isPartnerCand && secondColor >= 0 && <g opacity={0.5}><Symbol color={secondColor} /></g>}

            {/* opponent preview ghosts */}
            {isPrevA && <g className="ghost-a"><Symbol color={previewMove!.a} /></g>}
            {isPrevB && <g className="ghost-b"><Symbol color={previewMove!.b} /></g>}
          </g>
        );
      })}
    </svg>
  );
}
