import type { GameState, Move, HeatCell } from "../engine/engine";
export type { Move, HeatCell };

export type SeatType = "human" | "cpu";

export interface PlayerInfo {
  name: string;
  type: SeatType;
  aiLevel?: number;
  connected?: boolean; // online only
}

// --- timers ---
export type TimerMode = "off" | "perMove" | "chess";
export interface TimerConfig {
  mode: TimerMode;
  perMoveSec?: number;   // perMove: fresh budget each turn
  totalSec?: number;     // chess: starting budget per player
  incrementSec?: number; // chess: seconds added after each completed turn
}
export const DEFAULT_TIMER: TimerConfig = { mode: "off" };

// Clock snapshot. remainingMs is each seat's time left as of `asOf` (ms epoch);
// the UI ticks the running seat down from `asOf`, which avoids depending on
// client/server clock agreement for the displayed value. flagged[] marks seats
// that ran out of time (they lose). running is the seat counting down now.
export interface ClockState {
  mode: TimerMode;
  remainingMs: number[];
  running: number | null;
  flagged: boolean[];
  asOf: number;
}

// Everything the in-game UI needs, produced by either controller.
export interface Snapshot {
  state: GameState;            // hands may be redacted (online)
  handCounts: number[];
  players: PlayerInfo[];
  mySeat: number | null;       // seat this client may act for right now
  yourTurn: boolean;
  legalMoves: Move[];          // for the actionable seat (own info)
  canSwap: boolean;
  canUndo: boolean;
  pendingBonus: number;
  lastPlaced: { q: number; r: number }[]; // [anchor, partner] of the last move
  // a move being previewed (opponent "lining up" their tile) — ghosted on board
  previewMove: { q: number; r: number; dir: number; a: number; b: number } | null;
  message: string;
  gameOver: boolean;
  ranking: number[];
  reconnecting?: boolean; // online only: socket is down and trying to recover
  clock?: ClockState;     // present when a timer is active
  // Per rack-tile placement heatmaps for the acting seat, precomputed by the
  // engine once per position (indexed by hand tile index). The UI just looks up
  // cells on hover/select — no recompute. Absent when it isn't your turn.
  heatmaps?: HeatCell[][];
}

export interface Match {
  snapshot(): Snapshot;
  onUpdate(cb: () => void): () => void;
  place(m: Move): void;
  swap(): void;
  pass(): void;
  undo(): void;
  dispose(): void;
}

export class Emitter {
  private subs = new Set<() => void>();
  onUpdate(cb: () => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  protected emit() { for (const s of this.subs) s(); }
}
