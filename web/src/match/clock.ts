// A turn clock shared by local play (and mirrored server-side for online).
// Two modes: "perMove" gives each turn a fresh budget; "chess" gives each seat a
// running total plus an increment added when their turn ends. A seat whose clock
// hits zero is flagged — they lose.
//
// The clock is driven purely by which seat is current: call sync(current) on
// every state change. A bonus play keeps `current` the same, so it correctly
// counts as one continuous turn.
import type { ClockState, TimerConfig } from "./types";

// Opaque capture of a clock's mutable state, for undo (save before each move,
// restore when reverting). Keep in step with the fields in Clock.
export interface ClockSnapshot {
  remaining: number[];
  flagged: boolean[];
  running: number | null;
  turnStart: number;
}

export class Clock {
  private remaining: number[];
  private flagged: boolean[];
  private running: number | null = null;
  private turnStart = 0;

  constructor(private cfg: TimerConfig, numPlayers: number) {
    const start = cfg.mode === "chess" ? (cfg.totalSec ?? 300) * 1000
      : cfg.mode === "perMove" ? (cfg.perMoveSec ?? 30) * 1000
      : 0;
    this.remaining = Array.from({ length: numPlayers }, () => start);
    this.flagged = Array.from({ length: numPlayers }, () => false);
  }

  active(): boolean { return this.cfg.mode !== "off"; }

  private now(): number { return Date.now(); }

  // Move accumulated elapsed time out of the running seat's budget.
  private settle() {
    if (this.running == null) return;
    const t = this.now();
    const elapsed = t - this.turnStart;
    this.remaining[this.running] = Math.max(0, this.remaining[this.running] - elapsed);
    this.turnStart = t;
  }

  // Point the clock at whoever is current now. Handles turn hand-offs: settles
  // the previous seat, adds the chess increment, and (perMove) refills the new
  // seat's budget. No-op while the same seat keeps playing (e.g. a bonus).
  sync(current: number, gameOver: boolean) {
    if (!this.active()) return;
    if (gameOver) { this.settle(); this.running = null; return; }
    if (this.running === current) return;
    if (this.running != null) {
      this.settle();
      if (this.cfg.mode === "chess") {
        this.remaining[this.running] += (this.cfg.incrementSec ?? 0) * 1000;
      }
    }
    if (this.cfg.mode === "perMove") {
      this.remaining[current] = (this.cfg.perMoveSec ?? 30) * 1000;
    }
    this.running = current;
    this.turnStart = this.now();
  }

  // If the running seat has run out, flag it and stop its clock. Returns the
  // seat that just flagged, or null.
  check(): number | null {
    if (this.running == null) return null;
    const elapsed = this.now() - this.turnStart;
    if (this.remaining[this.running] - elapsed <= 0) {
      const s = this.running;
      this.remaining[s] = 0;
      this.flagged[s] = true;
      this.running = null;
      return s;
    }
    return null;
  }

  anyFlagged(): boolean { return this.flagged.some(Boolean); }
  flaggedSeats(): number[] { return this.flagged.flatMap((f, i) => (f ? [i] : [])); }

  // Capture/restore mutable state so undo can rewind the clock exactly, rather
  // than letting sync() treat the reverted position as a fresh turn hand-off
  // (which would refund a per-move budget or keep already-spent chess time).
  snapshot(): ClockSnapshot {
    this.settle(); // fold elapsed time in so the capture is point-in-time
    return { remaining: this.remaining.slice(), flagged: this.flagged.slice(), running: this.running, turnStart: this.turnStart };
  }
  restore(s: ClockSnapshot) {
    this.remaining = s.remaining.slice();
    this.flagged = s.flagged.slice();
    this.running = s.running;
    this.turnStart = this.now(); // resume counting from now for the restored seat
  }

  // Current clock as of now (settling the running seat first), for the snapshot.
  state(): ClockState {
    this.settle();
    return {
      mode: this.cfg.mode,
      remainingMs: this.remaining.slice(),
      running: this.running,
      flagged: this.flagged.slice(),
      asOf: this.now(),
    };
  }
}
