// Loads the same WASM engine the browser uses, for authoritative server play.
// @ts-ignore - emscripten glue ships without type declarations
import createIngeniousRaw from "../engine/ingenious.mjs";

export interface Tile { a: number; b: number; }
export interface Move { tileIndex: number; q: number; r: number; dir: number; flip: number; }
export interface GameState {
  numPlayers: number; regionRadius: number; cap: number; solitaire: boolean;
  current: number; pendingBonus: number; finished: boolean; firstRound: boolean;
  bagCount: number; cells: { q: number; r: number; color: number }[];
  scores: number[][]; hands: Tile[][];
}
export interface ApplyResult {
  ok: boolean; deltas: { color: number; points: number }[];
  ingenious: number; bonusPending: boolean; turnEnded: boolean; gameOver: boolean;
}
export interface Game {
  state(): GameState;
  legalMoves(): Move[];
  applyMove(t: number, q: number, r: number, dir: number, flip: number): ApplyResult;
  aiMove(level: number): Move;
  tileHeatmap(tileIndex: number): { q: number; r: number; points: number }[];
  tileHeatmapFor(seat: number, tileIndex: number): { q: number; r: number; points: number }[];
  canSwap(): boolean; swap(): boolean; pass(): boolean;
  hasAnyMove(): boolean; finished(): boolean; current(): number;
  playerScore(p: number): number; ranking(): number[]; delete(): void;
}
interface EngineModule { Game: new (n: number, seed: number, boardRadius: number) => Game; }

const createIngenious = createIngeniousRaw as () => Promise<EngineModule>;
let mod: Promise<EngineModule> | null = null;
export function loadEngine(): Promise<EngineModule> {
  if (!mod) mod = createIngenious();
  return mod;
}
