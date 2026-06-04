import { useMemo } from "react";
import { axialToPixel, hexPoints, DIRS, PALETTE, HEX_SIZE } from "../hex";
import { Symbol } from "./Symbol";
import { heatMap, heatColor } from "../engine/score";
import type { GameState, Move, Tile, HeatCell } from "../engine/engine";

const key = (q: number, r: number) => `${q},${r}`;

interface Props {
  state: GameState;
  legalMoves: Move[];
  selectedTileIndex: number | null;
  selectedTile: Tile | null;
  // a tile being previewed by hover (no selection needed) — drives the heatmap
  hoverTileIndex?: number | null;
  // per rack-tile placement heatmaps, precomputed by the engine (indexed by
  // hand tile index). Hover/select just looks up the right one — no recompute.
  heatmaps?: HeatCell[][];
  flip: number;
  anchor: { q: number; r: number } | null;
  interactive: boolean;
  lastPlaced: { q: number; r: number }[];
  previewMove: { q: number; r: number; dir: number; a: number; b: number } | null;
  onSelectAnchor: (cell: { q: number; r: number } | null) => void;
  onPlace: (m: Move) => void;
  // explain to the player why a cell they clicked can't take their tile
  onExplain?: (reason: string) => void;
}

export function Board(props: Props) {
  const { state, legalMoves, selectedTileIndex, selectedTile, hoverTileIndex, heatmaps, flip, anchor, interactive, lastPlaced, previewMove } = props;

  // The tile the heatmap should reflect: the selected one, or — when nothing is
  // selected — whatever the player is hovering in the rack. Hover lets you
  // compare spots for every tile without committing to a selection.
  const heatTileIndex = selectedTileIndex ?? hoverTileIndex ?? null;

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
    // Drop reserved/inactive rings (color -3) used only by larger player counts,
    // so the view zooms to just the playable region instead of the full board.
    const cs = state.cells
      .filter((c) => c.color !== -3)
      .map((c) => {
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
  const lastSet = useMemo(() => new Set(lastPlaced.map((p) => key(p.q, p.r))), [lastPlaced]);

  // Heatmap: look up the precomputed per-cell scores for the selected/hovered
  // tile (values come from the engine; this only indexes them into a Map). Only
  // re-indexes when the chosen tile or the heatmap data changes — no scoring.
  const heat = useMemo(() => {
    if (heatTileIndex == null || !heatmaps) return null;
    return heatMap(heatmaps[heatTileIndex]);
  }, [heatmaps, heatTileIndex]);

  const firstColor = selectedTile ? (flip ? selectedTile.b : selectedTile.a) : -1;
  const secondColor = selectedTile ? (flip ? selectedTile.a : selectedTile.b) : -1;

  // opponent preview ("lining up" a tile)
  const prevAnchorKey = previewMove ? key(previewMove.q, previewMove.r) : "";
  const prevPartnerKey = previewMove
    ? key(previewMove.q + DIRS[previewMove.dir][0], previewMove.r + DIRS[previewMove.dir][1]) : "";

  // All cells any tile could legally occupy this turn (anchor or partner), used
  // to distinguish "this tile won't fit here" from "nothing fits here".
  const anyPlayableCell = useMemo(() => {
    const s = new Set<string>();
    for (const m of legalMoves) {
      s.add(key(m.q, m.r));
      s.add(key(m.q + DIRS[m.dir][0], m.r + DIRS[m.dir][1]));
    }
    return s;
  }, [legalMoves]);

  const cellColor = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of state.cells) m.set(key(c.q, c.r), c.color);
    return m;
  }, [state.cells]);
  const hasEmptyNeighbor = (q: number, r: number) =>
    DIRS.some(([dq, dr]) => cellColor.get(key(q + dq, r + dr)) === -1);

  // Why can't the current tile go in this (empty) cell? Returns a short reason.
  function explain(q: number, r: number): string {
    const k = key(q, r);
    if (selectedTileIndex == null) return "Pick a tile from your rack first.";
    if (anchor) {
      return "That's not the cell for this tile's other half — pick a highlighted cell, or tap the anchor again to undo.";
    }
    if (!hasEmptyNeighbor(q, r)) return "No room here — a tile needs two adjacent empty cells.";
    if (state.firstRound && !anyPlayableCell.has(k)) {
      return "First move must touch one of the printed symbols that no one has claimed yet.";
    }
    if (anyPlayableCell.has(k)) return "This tile doesn't fit here — try flipping it or pick another tile.";
    return "No legal placement here for this tile.";
  }

  function clickCell(q: number, r: number, color: number) {
    if (!interactive) return;
    if (color !== -1) return;
    const k = key(q, r);
    if (anchor && anchor.q === q && anchor.r === r) { props.onSelectAnchor(null); return; }
    if (anchor && partnerMoves.has(k)) { props.onPlace(partnerMoves.get(k)!); return; }
    if (!anchor && anchorSet.has(k)) { props.onSelectAnchor({ q, r }); return; }
    props.onExplain?.(explain(q, r));
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
        const isLast = lastSet.has(k);          // part of the most recent move

        // heatmap tint for this empty cell, given the selected/hovered tile.
        // Color is ABSOLUTE (heatColor): hue alone tells you ~how many points a
        // spot is worth (faint at 1, vivid green at 7+) without comparing cells.
        const heatScore = heat ? heat.get(k) : undefined;
        const heatFill = heatScore != null && !occupied ? heatColor(heatScore) : undefined;
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
            {/* heatmap tint: how many points the selected tile could score here */}
            {heatFill && (
              <polygon className="heat" points={hexPoints(0, 0)} fill={heatFill}>
                <title>{`Up to ${heatScore} point${heatScore === 1 ? "" : "s"} here`}</title>
              </polygon>
            )}
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

            {/* outline around the most recently placed tile */}
            {isLast && <polygon className="last-outline" points={hexPoints(0, 0)} />}
          </g>
        );
      })}
    </svg>
  );
}
