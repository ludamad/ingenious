// Server-authoritative turn clock — mirror of web/src/match/clock.ts. Two modes:
// "perMove" (fresh budget each turn) and "chess" (running total + increment).
// A seat whose clock hits zero is flagged and loses.
import type { ClockState, TimerConfig } from "./protocol.js";

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

  // Pause: settle elapsed time into the running seat and stop counting. The
  // seat stays "running" so resume() can pick it back up.
  private paused: number | null = null;
  pause() {
    if (!this.active() || this.paused != null || this.running == null) return;
    this.settle();
    this.paused = this.running;
  }
  // Resume counting for the seat that was running when we paused.
  resume() {
    if (this.paused == null) return;
    this.turnStart = this.now();
    this.paused = null;
  }

  private settle() {
    // While paused, wall time must not be charged to the (still-"running") seat,
    // so any state()/check() during the pause window leaves remaining untouched.
    if (this.running == null || this.paused != null) return;
    const t = this.now();
    this.remaining[this.running] = Math.max(0, this.remaining[this.running] - (t - this.turnStart));
    this.turnStart = t;
  }

  // Point the clock at whoever is current now; handle turn hand-offs (settle the
  // previous seat, add chess increment, refill perMove budget). No-op while the
  // same seat keeps playing (e.g. a bonus placement).
  sync(current: number, gameOver: boolean) {
    if (!this.active()) return;
    if (gameOver) { this.settle(); this.running = null; return; }
    if (this.running === current) return;
    if (this.running != null) {
      this.settle();
      if (this.cfg.mode === "chess") this.remaining[this.running] += (this.cfg.incrementSec ?? 0) * 1000;
    }
    if (this.cfg.mode === "perMove") this.remaining[current] = (this.cfg.perMoveSec ?? 30) * 1000;
    this.running = current;
    this.turnStart = this.now();
  }

  // If the running seat has run out, flag it and stop. Returns the flagged seat.
  check(): number | null {
    if (this.running == null) return null;
    if (this.remaining[this.running] - (this.now() - this.turnStart) <= 0) {
      const s = this.running;
      this.remaining[s] = 0;
      this.flagged[s] = true;
      this.running = null;
      return s;
    }
    return null;
  }

  // Milliseconds until the running seat flags (Infinity if no one is running).
  msUntilFlag(): number {
    if (this.running == null) return Infinity;
    return Math.max(0, this.remaining[this.running] - (this.now() - this.turnStart));
  }

  anyFlagged(): boolean { return this.flagged.some(Boolean); }
  flaggedSeats(): number[] { return this.flagged.flatMap((f, i) => (f ? [i] : [])); }

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
