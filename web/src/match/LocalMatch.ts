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
import { Emitter, type Match, type PlayerInfo, type Snapshot } from "./types";

const CPU_DELAY = 420;
const PREVIEW_HOLD = 360;

type Action =
  | { kind: "move"; seat: number; m: Move }
  | { kind: "swap"; seat: number }
  | { kind: "pass"; seat: number };

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

  static async create(players: PlayerInfo[], seed: number, boardRadius: number): Promise<LocalMatch> {
    const M = await loadEngine();
    const make = () => new M.Game(players.length, seed, boardRadius);
    return new LocalMatch(make, players);
  }

  private constructor(make: () => Game, players: PlayerInfo[]) {
    super();
    this.make = make;
    this.g = make();
    this.players = players;
    this.message = this.turnMessage();
    this.rebuild();
    this.maybeAuto();
  }

  snapshot(): Snapshot { return this.snap; }

  place(m: Move) {
    if (this.players[this.g.current()]?.type !== "human") return;
    this.doMove(m);
  }
  swap() {
    if (this.players[this.g.current()]?.type !== "human") return;
    if (this.applySwap()) { this.message = this.turnMessage(); this.refresh(); this.maybeAuto(); }
  }
  pass() {
    if (this.players[this.g.current()]?.type !== "human") return;
    if (this.applyPass()) { this.message = this.turnMessage(); this.refresh(); this.maybeAuto(); }
  }

  // Revert to just before the most recent human-controlled action (and any CPU
  // moves that followed it), so it's the human's decision again.
  undo() {
    let cut = -1;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.players[this.history[i].seat]?.type === "human") { cut = i; break; }
    }
    if (cut < 0) return;
    if (this.timer != null) { clearTimeout(this.timer); this.timer = null; }
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
    this.message = `Undo — ${this.turnMessage()}`;
    this.refresh();
    // current is the human whose action we removed, so no CPU auto-play here
  }

  dispose() {
    this.disposed = true;
    if (this.timer != null) clearTimeout(this.timer);
    try { this.g.delete(); } catch { /* already freed */ }
  }

  // --- internals ---
  private canUndo(): boolean {
    return this.history.some((a) => this.players[a.seat]?.type === "human");
  }

  private rebuild() {
    const state = this.g.state();
    const cur = state.current;
    const curHuman = !state.finished && this.players[cur]?.type === "human";
    this.snap = {
      state,
      handCounts: state.hands.map((h) => h.length),
      players: this.players,
      mySeat: curHuman ? cur : null,
      yourTurn: curHuman,
      legalMoves: curHuman ? this.g.legalMoves() : [],
      canSwap: this.g.canSwap(),
      canUndo: this.canUndo(),
      pendingBonus: state.pendingBonus,
      lastPlaced: this.lastPlaced,
      previewMove: this.preview,
      message: this.message,
      gameOver: state.finished,
      ranking: state.finished ? this.g.ranking() : [],
    };
  }
  private refresh() { this.rebuild(); this.emit(); }

  private applySwap(): boolean {
    const seat = this.g.current();
    if (!this.g.swap()) return false;
    this.history.push({ kind: "swap", seat });
    this.lastPlaced = [];
    return true;
  }
  private applyPass(): boolean {
    const seat = this.g.current();
    if (!this.g.pass()) return false;
    this.history.push({ kind: "pass", seat });
    this.lastPlaced = [];
    return true;
  }

  private doMove(m: Move) {
    this.preview = null;
    const mover = this.g.current();
    const res = this.g.applyMove(m.tileIndex, m.q, m.r, m.dir, m.flip);
    if (!res.ok) { this.message = "Illegal move."; this.refresh(); return; }
    this.history.push({ kind: "move", seat: mover, m });
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
    if (this.disposed) return;
    if (this.timer != null) { clearTimeout(this.timer); this.timer = null; }
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
