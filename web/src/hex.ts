// Pointy-top hexagon geometry (axial coords) + the game's color palette.

export const HEX_SIZE = 26; // center-to-vertex radius in px
const SQRT3 = Math.sqrt(3);

export interface Pt { x: number; y: number; }

// Neighbour directions — MUST match engine DIRS order.
export const DIRS: [number, number][] = [
  [+1, 0], [+1, -1], [0, -1], [-1, 0], [-1, +1], [0, +1],
];

export function axialToPixel(q: number, r: number, size = HEX_SIZE): Pt {
  return { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r };
}

// Polygon points string for a pointy-top hex centered at (cx,cy).
export function hexPoints(cx: number, cy: number, size = HEX_SIZE): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push(`${(cx + size * Math.cos(a)).toFixed(2)},${(cy + size * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

export interface Palette { name: string; base: string; light: string; dark: string; }

// red, orange, yellow, green, blue, purple — index matches engine ColorId.
export const PALETTE: Palette[] = [
  { name: "Red",    base: "#e23b2e", light: "#ff8a7a", dark: "#8f1c14" },
  { name: "Orange", base: "#f08a1d", light: "#ffc173", dark: "#9c520a" },
  { name: "Yellow", base: "#f1c40f", light: "#ffe788", dark: "#9c7e00" },
  { name: "Green",  base: "#36a84a", light: "#83e08c", dark: "#176e26" },
  { name: "Blue",   base: "#2a9fd6", light: "#8fe0ff", dark: "#0f5f86" },
  { name: "Purple", base: "#9b4ec0", light: "#d29bea", dark: "#5e2880" },
];
