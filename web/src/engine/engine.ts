// Loads the C++/WASM Ingenious engine and exposes a typed interface.
// @ts-ignore - emscripten glue ships without type declarations
import createIngeniousRaw from "./ingenious.mjs";
const createIngenious = createIngeniousRaw as (opts?: Record<string, unknown>) => Promise<EngineModule>;

export const COLORS = ["red", "orange", "yellow", "green", "blue", "purple"] as const;
export type ColorId = 0 | 1 | 2 | 3 | 4 | 5;
export const EMPTY = -1;

export interface Cell { q: number; r: number; color: number; } // color: -1 empty, 0..5
export interface Tile { a: number; b: number; }
export interface Move { tileIndex: number; q: number; r: number; dir: number; flip: number; }
export interface ScoreDelta { color: number; points: number; }

export interface GameState {
  numPlayers: number;
  regionRadius: number;
  cap: number;
  solitaire: boolean;
  current: number;
  pendingBonus: number;
  finished: boolean;
  firstRound: boolean;
  bagCount: number;
  cells: Cell[];
  scores: number[][]; // [player][color]
  hands: Tile[][];    // [player][tile]
}

export interface ApplyResult {
  ok: boolean;
  deltas: ScoreDelta[];
  ingenious: number;
  bonusPending: boolean;
  turnEnded: boolean;
  gameOver: boolean;
}

// The WASM-backed game object (one per match).
export interface Game {
  state(): GameState;
  legalMoves(): Move[];
  applyMove(tileIndex: number, q: number, r: number, dir: number, flip: number): ApplyResult;
  aiMove(level: number): Move;
  canSwap(): boolean;
  swap(): boolean;
  pass(): boolean;
  hasAnyMove(): boolean;
  finished(): boolean;
  current(): number;
  playerScore(p: number): number;
  ranking(): number[];
  delete(): void;
}

interface EngineModule {
  // boardRadius <= 0 selects the classic size for the player count.
  Game: new (numPlayers: number, seed: number, boardRadius: number) => Game;
}

let modulePromise: Promise<EngineModule> | null = null;

export function loadEngine(): Promise<EngineModule> {
  if (!modulePromise) {
    modulePromise = createIngenious({
      // wasm lives in the public dir; resolve under the app's base URL so it
      // works both at the root (dev) and under a GitHub Pages subpath
      locateFile: (path: string) =>
        (path.endsWith(".wasm") ? import.meta.env.BASE_URL + "ingenious.wasm" : path),
    });
  }
  return modulePromise;
}
