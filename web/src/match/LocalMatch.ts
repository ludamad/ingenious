// Drives a game entirely in the browser using the WASM engine.
// Handles solo/solitaire, vs-CPU, and hot-seat (multiple humans, one device).
//
// Undo works by replay: every action is recorded, and undoing rebuilds a fresh
// engine and replays all actions up to the chosen point. The engine is fully
// deterministic from (numPlayers, seed, boardRadius) + the action sequence, so
// the reconstructed state is exact (bag order, racks and all).
import type { Game, Move } from "../engine/engine";
import { loadEngine } from "../engine/engine";
import { PALETTE } from "../hex";
import { Clock, type ClockSnapshot } from "./clock";
import { DEFAULT_TIMER, Emitter, type Match, type PlayerInfo, type Snapshot, type TimerConfig } from "./types";

const CPU_DELAY = 420;
const PREVIEW_HOLD = 360;
const TICK_MS = 250;

// `clock` is the clock state captured just BEFORE the action ran, so undo can
// rewind the clock exactly (see undo()).
type Action =
  | { kind: "move"; seat: number; m: Move; clock: ClockSnapshot | null }
  | { kind: "swap"; seat: number; clock: ClockSnapshot | null }
  | { kind: "pass"; seat: number; clock: ClockSnapshot | null };

export class LocalMatch extends Emitter implements Match {
  private g: Game;
  private make: () => Game;
  private players: PlayerInfo[];
  private history: Action[] = [];
  private lastPlaced: { q: number; r: number }[] = [];
  private preview: Snapshot["previewMove"] = null;
  private message = "";
  private timer: number | null = null;
  private disposed = false;
  private snap!: Snapshot;
  private clock: Clock;
  private clockTick: number | null = null;
  private timedOut = false; // a seat flagged -> game ends, flagged seats lose

  static async create(players: PlayerInfo[], seed: number, boardRadius: number,
    timer: TimerConfig = DEFAULT_TIMER): Promise<LocalMatch> {
    const M = await loadEngine();
    const make = () => new M.Game(players.length, seed, boardRadius);
    return new LocalMatch(make, players, timer);
  }

  private constructor(make: () => Game, players: PlayerInfo[], timer: TimerConfig) {
    super();
    this.make = make;
    this.g = make();
    this.players = players;
    this.clock = new Clock(timer, players.length);
    this.clock.sync(this.g.current(), false);
    this.startClockTick();
    this.message = this.turnMessage();
    this.rebuild();
    this.maybeAuto();
  }

  // Drive the clock display and detect flag-fall. The running seat's remaining
  // time is computed from the snapshot in the UI, but we still poll so a timeout
  // ends the game even if no one acts.
  private startClockTick() {
    if (!this.clock.active() || this.clockTick != null) return;
    this.clockTick = window.setInterval(() => {
      if (this.disposed || this.timedOut) return;
      const seat = this.clock.check();
      if (seat != null) this.onFlag(seat);
      else this.refresh(); // keep clock display live
    }, TICK_MS);
  }

  private onFlag(seat: number) {
    this.timedOut = true;
    if (this.clockTick != null) { clearInterval(this.clockTick); this.clockTick = null; }
    if (this.timer != null) { clearTimeout(this.timer); this.timer = null; }
    this.preview = null;
    this.message = `${this.players[seat].name} ran out of time.`;
    this.refresh();
  }

  snapshot(): Snapshot { return this.snap; }

  place(m: Move) {
    if (this.timedOut || this.players[this.g.current()]?.type !== "human") return;
    this.doMove(m);
  }
  swap() {
    if (this.timedOut || this.players[this.g.current()]?.type !== "human") return;
    if (this.applySwap()) { this.message = this.turnMessage(); this.refresh(); this.maybeAuto(); }
  }
  pass() {
    if (this.timedOut || this.players[this.g.current()]?.type !== "human") return;
    if (this.applyPass()) { this.message = this.turnMessage(); this.refresh(); this.maybeAuto(); }
  }

  // Revert to just before the most recent human-controlled action (and any CPU
  // moves that followed it), so it's the human's decision again.
  undo() {
    if (this.timedOut) return;
    let cut = -1;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.players[this.history[i].seat]?.type === "human") { cut = i; break; }
    }
    if (cut < 0) return;
    if (this.timer != null) { clearTimeout(this.timer); this.timer = null; }
    const cutClock = this.history[cut].clock; // clock state just before the reverted action
    const replay = this.history.slice(0, cut);

    try { this.g.delete(); } catch { /* already freed */ }
    this.g = this.make();
    for (const a of replay) {
      if (a.kind === "move") this.g.applyMove(a.m.tileIndex, a.m.q, a.m.r, a.m.dir, a.m.flip);
      else if (a.kind === "swap") this.g.swap();
      else this.g.pass();
    }
    this.history = replay;
    const last = replay[replay.length - 1];
    this.lastPlaced = last && last.kind === "move"
      ? [{ q: last.m.q, r: last.m.r }, { q: last.m.q + DIRS[last.m.dir][0], r: last.m.r + DIRS[last.m.dir][1] }]
      : [];
    this.preview = null;
    // Rewind the clock to exactly before the reverted action, rather than letting
    // sync() treat the reverted position as a fresh turn (which would refund a
    // per-move budget / keep already-spent chess time).
    if (cutClock) this.clock.restore(cutClock);
    this.message = `Undo — ${this.turnMessage()}`;
    this.refresh();
    // current is the human whose action we removed, so no CPU auto-play here
  }

  dispose() {
    this.disposed = true;
    if (this.timer != null) clearTimeout(this.timer);
    if (this.clockTick != null) { clearInterval(this.clockTick); this.clockTick = null; }
    try { this.g.delete(); } catch { /* already freed */ }
  }

  // Ranking when a seat has flagged: flagged seats lose (ordered last), the rest
  // keep the engine's ranking among themselves.
  private timeoutRanking(): number[] {
    const flagged = this.clock.flaggedSeats();
    const flaggedSet = new Set(flagged);
    const survivors = this.g.ranking().filter((p) => !flaggedSet.has(p));
    const losers = this.players.map((_, i) => i).filter((p) => flaggedSet.has(p));
    return [...survivors, ...losers];
  }

  // --- internals ---
  private canUndo(): boolean {
    return this.history.some((a) => this.players[a.seat]?.type === "human");
  }

  private rebuild() {
    const state = this.g.state();
    const cur = state.current;
    const over = state.finished || this.timedOut;
    const curHuman = !over && this.players[cur]?.type === "human";
    this.snap = {
      state,
      handCounts: state.hands.map((h) => h.length),
      players: this.players,
      mySeat: curHuman ? cur : null,
      yourTurn: curHuman,
      legalMoves: curHuman ? this.g.legalMoves() : [],
      canSwap: !this.timedOut && this.g.canSwap(),
      canUndo: !this.timedOut && this.canUndo(),
      pendingBonus: state.pendingBonus,
      lastPlaced: this.lastPlaced,
      previewMove: this.preview,
      message: this.message,
      gameOver: over,
      ranking: over ? (this.timedOut ? this.timeoutRanking() : this.g.ranking()) : [],
      clock: this.clock.active() ? this.clock.state() : undefined,
    };
  }
  private refresh() { this.rebuild(); this.emit(); }

  // Clock state as of right now (before the next action) — stored on the action
  // so undo can rewind the clock exactly. null when no timer is running.
  private snapClock(): ClockSnapshot | null {
    return this.clock.active() ? this.clock.snapshot() : null;
  }

  private applySwap(): boolean {
    const seat = this.g.current();
    const clock = this.snapClock();
    if (!this.g.swap()) return false;
    this.history.push({ kind: "swap", seat, clock });
    this.lastPlaced = [];
    return true;
  }
  private applyPass(): boolean {
    const seat = this.g.current();
    const clock = this.snapClock();
    if (!this.g.pass()) return false;
    this.history.push({ kind: "pass", seat, clock });
    this.lastPlaced = [];
    return true;
  }

  private doMove(m: Move) {
    this.preview = null;
    const mover = this.g.current();
    const clock = this.snapClock();
    const res = this.g.applyMove(m.tileIndex, m.q, m.r, m.dir, m.flip);
    if (!res.ok) { this.message = "Illegal move."; this.refresh(); return; }
    this.history.push({ kind: "move", seat: mover, m, clock });
    const [dx, dy] = DIRS[m.dir];
    this.lastPlaced = [{ q: m.q, r: m.r }, { q: m.q + dx, r: m.r + dy }];
    const gained = res.deltas.map((d) => `${d.points} ${PALETTE[d.color].name.toLowerCase()}`).join(", ");
    this.message =
      `${this.players[mover].name} scored ${gained || "0"}` +
      (res.ingenious ? ` — Ingenious! ×${res.ingenious}` : "");
    this.refresh();
    this.maybeAuto();
  }

  private maybeAuto() {
    if (this.disposed || this.timedOut) return;
    if (this.timer != null) { clearTimeout(this.timer); this.timer = null; }
    // hand the clock to whoever is current now (turn change / bonus / game end)
    this.clock.sync(this.g.current(), this.g.finished());
    if (this.g.finished()) { this.message = "Game over."; this.refresh(); return; }
    const cur = this.g.current();
    const p = this.players[cur];

    if (p.type === "cpu") {
      this.timer = window.setTimeout(() => {
        this.timer = null;
        if (this.disposed) return;
        if (this.g.hasAnyMove()) this.cpuPlay(this.g.aiMove(p.aiLevel ?? 1), cur);
        else if (this.applySwap()) { this.message = `${p.name} swapped tiles.`; this.refresh(); this.maybeAuto(); }
        else if (this.applyPass()) { this.message = `${p.name} passed.`; this.refresh(); this.maybeAuto(); }
      }, CPU_DELAY);
      return;
    }

    if (!this.g.hasAnyMove() && !this.g.canSwap()) {
      if (this.applyPass()) { this.message = `${p.name} has no move — passed.`; this.refresh(); this.maybeAuto(); return; }
    }
    this.message = this.turnMessage();
    this.refresh();
  }

  // Show the CPU lining up its tile (ghost), then commit — same anchor→partner
  // pattern a human goes through.
  private cpuPlay(m: Move, seat: number) {
    const tile = this.g.state().hands[seat][m.tileIndex];
    const a = m.flip ? tile.b : tile.a;
    const b = m.flip ? tile.a : tile.b;
    this.preview = { q: m.q, r: m.r, dir: m.dir, a, b };
    this.message = `${this.players[seat].name} is placing a tile…`;
    this.refresh();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.disposed) return;
      this.doMove(m);
    }, PREVIEW_HOLD);
  }

  private turnMessage(): string {
    const s = this.g.state();
    if (s.finished) return "Game over.";
    const p = this.players[s.current];
    const bonus = s.pendingBonus > 0 ? " — bonus play!" : "";
    if (s.firstRound) return `${p.name}: place next to a printed symbol${bonus}`;
    return `${p.name}'s turn${bonus}`;
  }
}

// keep in sync with engine DIRS
const DIRS: [number, number][] = [[+1, 0], [+1, -1], [0, -1], [-1, 0], [-1, +1], [0, +1]];
