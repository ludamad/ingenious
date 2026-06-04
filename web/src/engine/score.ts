// Heatmap presentation helpers. The heatmap VALUES are computed by the C++
// engine (Game.tileHeatmap → the authoritative scorer that also drives
// applyMove), delivered per rack tile. This module only turns those values into
// a per-cell lookup and a color, so the preview can never disagree with what a
// move actually scores.
import type { HeatCell } from "./engine";

const k = (q: number, r: number) => `${q},${r}`;

// Index a tile's heatmap cells as "q,r" -> best points.
export function heatMap(cells: HeatCell[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (cells) for (const c of cells) m.set(k(c.q, c.r), c.points);
  return m;
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
