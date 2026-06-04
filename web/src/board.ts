// Board-size helpers shared by the setup screens.
// The value is the BASE (2-player / white) radius. The official 2-player area is
// radius 5 — six hexes a side, 11 across. The full board adds two reserved rings
// for 3- and 4-player games.
export const MIN_RADIUS = 3;
export const MAX_RADIUS = 6;
export const STANDARD_RADIUS = 5; // official 2-player area: side 6, 11 across


// hexes across the 2-player play area for a given base radius
export function cellsAcross(radius: number): number {
  return radius * 2 + 1;
}
