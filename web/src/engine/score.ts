// Client-side scoring, ported from the C++ engine's scoreFrom(), used only to
// preview how many points a placement would earn (the board heatmap). The
// authoritative score still comes from the WASM engine on apply.
import { DIRS } from "../hex";
import type { GameState, Move, Tile } from "./engine";

const k = (q: number, r: number) => `${q},${r}`;

export type ColorMap = Map<string, number>; // "q,r" -> color (-1 empty, 0..5)

export function buildColorMap(state: GameState): ColorMap {
  const m: ColorMap = new Map();
  for (const c of state.cells) m.set(k(c.q, c.r), c.color);
  return m;
}

// Count contiguous same-color cells along the five outward lines (excluding the
// partner direction), stopping at the first gap/different color/edge — exactly
// the engine's scoreFrom. The two halves of a domino exclude the direction that
// points at each other, so scoring against the pre-placement board matches the
// engine's score-after-placing result.
function scoreFrom(colors: ColorMap, q: number, r: number, color: number, excludeDir: number): number {
  let total = 0;
  for (let d = 0; d < 6; d++) {
    if (d === excludeDir) continue;
    let cq = q + DIRS[d][0], cr = r + DIRS[d][1];
    while (colors.get(k(cq, cr)) === color) {
      total++;
      cq += DIRS[d][0];
      cr += DIRS[d][1];
    }
  }
  return total;
}

// Total points a single placement scores (both halves) against the board.
export function moveScore(colors: ColorMap, tile: Tile, m: Move): number {
  const ca = m.flip ? tile.b : tile.a; // color at anchor
  const cb = m.flip ? tile.a : tile.b; // color at partner
  const bq = m.q + DIRS[m.dir][0], br = m.r + DIRS[m.dir][1];
  return scoreFrom(colors, m.q, m.r, ca, m.dir) + scoreFrom(colors, bq, br, cb, (m.dir + 3) % 6);
}

// For the given tile, the best total score achievable at each cell it could
// occupy (anchor or partner), across all of that tile's legal placements.
// Lazily build this once per selection and reuse for every cell on the board.
export function heatmapFor(state: GameState, tile: Tile, tileIndex: number, legalMoves: Move[]): Map<string, number> {
  const colors = buildColorMap(state);
  const best = new Map<string, number>();
  for (const m of legalMoves) {
    if (m.tileIndex !== tileIndex) continue;
    const s = moveScore(colors, tile, m);
    const aK = k(m.q, m.r);
    const bK = k(m.q + DIRS[m.dir][0], m.r + DIRS[m.dir][1]);
    if (s > (best.get(aK) ?? -1)) best.set(aK, s);
    if (s > (best.get(bK) ?? -1)) best.set(bK, s);
  }
  return best;
}

// An ABSOLUTE color for a placement score, so the hue itself tells you roughly
// how good a spot is (a faint wash at 1 point, vivid green at 7+) without having
// to compare cells or normalize per-board. `HEAT_TOP` is where the scale tops
// out — 7 points is already a strong play in Ingenious.
export const HEAT_TOP = 7;

export function heatColor(score: number): string {
  if (score <= 0) return "transparent";
  const t = Math.min(1, score / HEAT_TOP); // 0..1
  // Ramp pale lime -> vivid green; opacity also rises so big scores read boldly.
  const r = Math.round(150 - 110 * t);
  const g = Math.round(205 - 30 * t);
  const b = Math.round(120 - 80 * t);
  const a = (0.22 + 0.5 * t).toFixed(3);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
