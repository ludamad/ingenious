import type { GameState, Move } from "../engine/engine";
export type { Move };

export type SeatType = "human" | "cpu";

export interface PlayerInfo {
  name: string;
  type: SeatType;
  aiLevel?: number;
  connected?: boolean; // online only
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
