// Authoritative Ingenious game server: HTTP (serves the built web app) + a
// WebSocket endpoint at /ws for online rooms of up to 4 players. The same WASM
// engine the browser uses validates every move and plays the CPU seats.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { loadEngine, type Game } from "./engine.js";
import type { ClientMsg, ServerMsg, LobbyState, PlayerInfo, TimerConfig, ChatMsg } from "./protocol.js";
import { Clock } from "./clock.js";

const CHAT_HISTORY = 60; // recent chat lines kept per room and replayed on (re)join
const CHAT_MAX_LEN = 300;
const NAME_MAX_LEN = 24;
const MAX_ROOMS = 500;   // global cap so a create-loop can't grow memory unbounded

// Coerce an untrusted wire value to a safe display string: drop control chars,
// collapse whitespace, cap length. Returns "" if nothing usable remains.
function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001F\u007F]+/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
function cleanName(v: unknown, fallback: string): string {
  return cleanText(v, NAME_MAX_LEN) || fallback;
}

const DEFAULT_TIMER: TimerConfig = { mode: "off" };

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const CPU_DELAY = 550;
// How long to wait for a dropped human to reconnect before auto-piloting their
// turn, and how long to keep an abandoned (everyone-gone) room alive so the
// players can come back to it.
const DISCONNECT_GRACE = 15000;
const ROOM_REAP_DELAY = 300000; // keep an abandoned game alive 5 min for rejoins
const COLOR_NAMES = ["red", "orange", "yellow", "green", "blue", "purple"];

interface Seat {
  type: "human" | "cpu";
  name: string;
  ws: WebSocket | null;
  connected: boolean;
  aiLevel: number;
  isHost: boolean;
  token: string; // secret a human presents to reclaim this seat after a drop ("" for CPU)
}
type Action =
  | { kind: "move"; seat: number; tileIndex: number; q: number; r: number; dir: number; flip: number }
  | { kind: "swap"; seat: number }
  | { kind: "pass"; seat: number };

interface Room {
  id: string;
  numPlayers: number;
  seats: Seat[];
  seed: number;
  boardRadius: number;
  started: boolean;
  game: Game | null;
  history: Action[];
  lastPlaced: { q: number; r: number }[];
  message: string;
  cpuTimer: NodeJS.Timeout | null;
  reapTimer: NodeJS.Timeout | null; // pending deletion of an abandoned room
  timer: TimerConfig;               // configured at create time
  clock: Clock | null;              // live once started (if timer active)
  flagTimer: NodeJS.Timeout | null; // fires when the running seat would flag
  timedOut: boolean;                // a seat ran out -> game over, flagged lose
  chat: ChatMsg[];                  // recent chat history (capped)
}
interface Ctx { roomId: string; seat: number; }

const rooms = new Map<string, Room>();
const browsing = new Set<WebSocket>();    // connections viewing the open-games list
const ctxOf = new WeakMap<WebSocket, Ctx>();
let EngineModule: Awaited<ReturnType<typeof loadEngine>>;

// ---------- helpers ----------
function seatFilled(s: Seat): boolean { return s.type === "cpu" || (s.type === "human" && s.ws != null); }

// A seat plays itself when it's a CPU, or a human who has dropped — that keeps
// the game moving without permanently kicking a player who can still reconnect.
function autopilots(s: Seat): boolean { return s.type === "cpu" || !s.connected; }

function newToken(): string {
  let t = "";
  for (let i = 0; i < 3; i++) t += Math.floor(Math.random() * 0x100000000).toString(36);
  return t;
}

function newRoomId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  do {
    id = "";
    for (let i = 0; i < 4; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  } while (rooms.has(id));
  return id;
}

function send(ws: WebSocket | null, msg: ServerMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function lobbyState(room: Room): LobbyState {
  return {
    roomId: room.id,
    numPlayers: room.numPlayers,
    started: room.started,
    seats: room.seats.map((s) => ({ type: s.type, name: s.name, filled: seatFilled(s), isHost: s.isHost })),
    timer: room.timer,
  };
}
function broadcastLobby(room: Room) {
  for (const s of room.seats) send(s.ws, { t: "lobby", lobby: lobbyState(room) });
  broadcastRooms(); // open-games list may have changed
}

// open, joinable games (not started, with at least one open human seat)
function roomBriefs() {
  const out = [];
  for (const room of rooms.values()) {
    if (room.started) continue;
    const humanSeats = room.seats.filter((s) => s.type === "human");
    const filled = humanSeats.filter((s) => s.ws != null).length;
    if (filled >= humanSeats.length) continue; // no open seat
    const host = room.seats.find((s) => s.isHost)?.name ?? "Host";
    out.push({ roomId: room.id, host, humanFilled: filled, humanTotal: humanSeats.length,
      numPlayers: room.numPlayers, boardRadius: room.boardRadius || 5 });
  }
  return out;
}
function broadcastRooms() {
  const list = roomBriefs();
  for (const ws of browsing) send(ws, { t: "rooms", rooms: list });
}

function players(room: Room): PlayerInfo[] {
  return room.seats.map((s) => ({ name: s.name, type: s.type, connected: s.connected }));
}

// ---------- chat ----------
function pushChat(room: Room, msg: ChatMsg) {
  room.chat.push(msg);
  if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
  for (const s of room.seats) send(s.ws, { t: "chat", msg });
}
// A server-authored system line (joins/leaves/drops/reconnects/game events).
function systemChat(room: Room, text: string) {
  pushChat(room, { seat: -1, name: "", text, ts: Date.now(), system: true });
}
function sendChatHistory(ws: WebSocket, room: Room) {
  if (room.chat.length) send(ws, { t: "chatHistory", msgs: room.chat });
}

// Ranking when a seat has flagged: flagged seats lose (ordered last), the rest
// keep the engine's ranking among themselves.
function timeoutRanking(room: Room): number[] {
  const flagged = new Set(room.clock?.flaggedSeats() ?? []);
  const survivors = (room.game?.ranking() ?? []).filter((p) => !flagged.has(p));
  const losers = room.seats.map((_, i) => i).filter((p) => flagged.has(p));
  return [...survivors, ...losers];
}

function broadcast(room: Room) {
  const g = room.game;
  if (!g) return;
  const state = g.state();
  const current = g.current();
  const finished = g.finished() || room.timedOut;
  const canSwap = !room.timedOut && g.canSwap();
  const ranking = finished ? (room.timedOut ? timeoutRanking(room) : g.ranking()) : [];
  const handCounts = state.hands.map((h: any[]) => h.length);
  const clock = room.clock?.active() ? room.clock.state() : undefined;
  // a human may undo their own last action, but only while no one has acted since
  const lastSeat = room.history.length ? room.history[room.history.length - 1].seat : -1;

  for (let seat = 0; seat < room.seats.length; seat++) {
    const ws = room.seats[seat].ws;
    if (!ws) continue;
    const canUndo = !room.timedOut && lastSeat === seat && room.seats[seat].type === "human";
    // redact: only the viewer's own rack is revealed
    const redactedHands = state.hands.map((h: any[], i: number) =>
      i === seat ? h : h.map(() => ({ a: -1, b: -1 })));
    const msg: ServerMsg = {
      t: "snapshot",
      state: { ...state, hands: redactedHands },
      handCounts,
      players: players(room),
      current,
      canSwap,
      canUndo,
      pendingBonus: state.pendingBonus,
      legalMoves: seat === current && !finished ? g.legalMoves() : [],
      lastPlaced: room.lastPlaced,
      message: room.message,
      gameOver: finished,
      ranking,
      clock,
    };
    send(ws, msg);
  }
}

const DIRS: [number, number][] = [[+1, 0], [+1, -1], [0, -1], [-1, 0], [-1, +1], [0, +1]];

function describe(room: Room, mover: number, res: { deltas: { color: number; points: number }[]; ingenious: number }) {
  const gained = res.deltas.map((d) => `${d.points} ${COLOR_NAMES[d.color]}`).join(", ");
  room.message = `${room.seats[mover].name} scored ${gained || "0"}` +
    (res.ingenious ? ` — Ingenious! ×${res.ingenious}` : "");
}

function clearTimer(room: Room) { if (room.cpuTimer) { clearTimeout(room.cpuTimer); room.cpuTimer = null; } }
function cancelReap(room: Room) { if (room.reapTimer) { clearTimeout(room.reapTimer); room.reapTimer = null; } }
function clearFlagTimer(room: Room) { if (room.flagTimer) { clearTimeout(room.flagTimer); room.flagTimer = null; } }

// Point the room clock at the current seat and arm a timer to fire exactly when
// that seat would run out of time. Called from step() on every position change.
function syncClock(room: Room) {
  const c = room.clock, g = room.game;
  if (!c || !c.active() || !g) return;
  clearFlagTimer(room);
  if (room.timedOut) return;
  c.sync(g.current(), g.finished());
  if (g.finished()) return;
  const ms = c.msUntilFlag();
  if (ms === Infinity) return;
  room.flagTimer = setTimeout(() => {
    room.flagTimer = null;
    const seat = c.check();
    if (seat == null) { step(room); return; } // not actually out yet — re-arm
    onFlag(room, seat);
  }, ms + 20); // small cushion so check() sees the seat as expired
}

// A seat ran out of time: end the game; flagged seats lose (ranked last).
function onFlag(room: Room, seat: number) {
  room.timedOut = true;
  clearTimer(room);
  clearFlagTimer(room);
  room.message = `${room.seats[seat].name} ran out of time.`;
  systemChat(room, `⏱ ${room.seats[seat].name} ran out of time and loses.`);
  broadcast(room);
}

// Everyone has dropped: keep the room (and its game) around for a while so the
// players can reconnect, then delete it if nobody comes back.
function scheduleReap(room: Room) {
  cancelReap(room);
  clearTimer(room);
  clearFlagTimer(room);
  room.clock?.pause(); // freeze clocks while everyone is away
  room.reapTimer = setTimeout(() => {
    room.reapTimer = null;
    if (room.seats.every((s) => s.ws == null)) {
      clearTimer(room);
      clearFlagTimer(room);
      try { room.game?.delete(); } catch { /* ignore */ }
      rooms.delete(room.id);
      broadcastRooms();
    }
  }, ROOM_REAP_DELAY);
}

// Drive the game forward: broadcast, then auto-resolve CPU seats, dropped
// humans (after a grace period), and stuck humans.
function step(room: Room) {
  // Re-evaluating the position invalidates any pending autopilot tick (e.g. the
  // grace timer for a seat whose player just reconnected); the branches below
  // reschedule one if it's still needed.
  clearTimer(room);
  if (room.timedOut) { broadcast(room); return; }
  // Hand the clock to whoever is current now and (re)arm the flag timer.
  syncClock(room);
  broadcast(room);
  const g = room.game;
  if (!g || g.finished()) return;
  const cur = g.current();
  const seat = room.seats[cur];

  if (autopilots(seat)) {
    // Give a dropped human a chance to come back before the AI takes their turn.
    const delay = seat.type === "cpu" ? CPU_DELAY : DISCONNECT_GRACE;
    room.cpuTimer = setTimeout(() => {
      room.cpuTimer = null;
      if (!room.game) return;
      // The player may have reconnected during the grace window — if so, hand
      // control back to them instead of auto-playing.
      if (!autopilots(room.seats[room.game.current()])) { step(room); return; }
      doCpu(room);
      step(room);
    }, delay);
    return;
  }
  // human with no possible action -> auto pass to keep things moving
  if (!g.hasAnyMove() && !g.canSwap()) {
    g.pass();
    room.lastPlaced = [];
    room.message = `${seat.name} has no move — passed.`;
    step(room);
  }
  // otherwise wait for the human's action
}

function doCpu(room: Room) {
  const g = room.game!;
  const cur = g.current();
  const seat = room.seats[cur];
  if (g.hasAnyMove()) {
    const m = g.aiMove(seat.aiLevel);
    const res = g.applyMove(m.tileIndex, m.q, m.r, m.dir, m.flip);
    room.history.push({ kind: "move", seat: cur, tileIndex: m.tileIndex, q: m.q, r: m.r, dir: m.dir, flip: m.flip });
    const [dx, dy] = DIRS[m.dir];
    room.lastPlaced = [{ q: m.q, r: m.r }, { q: m.q + dx, r: m.r + dy }];
    describe(room, cur, res);
  } else if (g.canSwap()) {
    g.swap(); room.history.push({ kind: "swap", seat: cur }); room.lastPlaced = []; room.message = `${seat.name} swapped tiles.`;
  } else {
    g.pass(); room.history.push({ kind: "pass", seat: cur }); room.lastPlaced = []; room.message = `${seat.name} passed.`;
  }
}

// ---------- message handling ----------
function handle(ws: WebSocket, msg: ClientMsg) {
  switch (msg.t) {
    case "list": browsing.add(ws); return send(ws, { t: "rooms", rooms: roomBriefs() });
    case "create": return doCreate(ws, msg);
    case "join": return doJoin(ws, msg);
    case "rejoin": return doRejoin(ws, msg);
    case "start": return doStart(ws);
    case "undo": return doUndo(ws);
    case "chat": return doChat(ws, msg);
    case "move":
    case "swap":
    case "pass": return doAction(ws, msg);
  }
}

function doChat(ws: WebSocket, msg: Extract<ClientMsg, { t: "chat" }>) {
  const ctx = ctxOf.get(ws); if (!ctx) return;
  const room = rooms.get(ctx.roomId); if (!room) return;
  const seat = room.seats[ctx.seat];
  if (!seat || seat.ws !== ws) return;
  const text = cleanText(msg.text, CHAT_MAX_LEN);
  if (!text) return;
  pushChat(room, { seat: ctx.seat, name: seat.name, text, ts: Date.now() });
}

// Clamp a client-supplied timer config to sane bounds (don't trust the wire).
function sanitizeTimer(t: TimerConfig | undefined): TimerConfig {
  if (!t || t.mode === "off") return DEFAULT_TIMER;
  const clamp = (v: number | undefined, lo: number, hi: number, dflt: number) =>
    Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v as number) ? (v as number) : dflt)));
  if (t.mode === "perMove") return { mode: "perMove", perMoveSec: clamp(t.perMoveSec, 5, 600, 30) };
  if (t.mode === "chess") {
    return { mode: "chess", totalSec: clamp(t.totalSec, 30, 3600, 300), incrementSec: clamp(t.incrementSec, 0, 60, 5) };
  }
  return DEFAULT_TIMER;
}

// Detach a socket from whatever room/seat it currently holds (same handling as
// a disconnect) — used before create/join so a client can't hold two seats and
// leak its old room. onClose is hoisted (function declaration).
function vacate(ws: WebSocket) { onClose(ws); }

function doCreate(ws: WebSocket, msg: Extract<ClientMsg, { t: "create" }>) {
  if (rooms.size >= MAX_ROOMS) return send(ws, { t: "error", message: "Server is busy — try again shortly." });
  // Leave any room this socket already occupies, so repeated creates can't leak
  // orphaned rooms holding this ws in seat 0.
  vacate(ws);
  const n = Math.max(2, Math.min(4, msg.numPlayers | 0));
  const id = newRoomId();
  const cpuSeats: number[] = Array.isArray(msg.cpuSeats) ? msg.cpuSeats : [];
  let cpuCount = 0;
  const seats: Seat[] = [];
  for (let i = 0; i < n; i++) {
    const isCpu = i !== 0 && cpuSeats.includes(i);
    seats.push({
      type: isCpu ? "cpu" : "human",
      name: isCpu ? `CPU ${++cpuCount}` : i === 0 ? cleanName(msg.name, "Host") : `Seat ${i + 1}`,
      ws: i === 0 ? ws : null,
      connected: i === 0,
      aiLevel: msg.aiLevel ?? 1,
      isHost: i === 0,
      token: i === 0 ? newToken() : "",
    });
  }
  const timer = sanitizeTimer(msg.timer);
  const room: Room = { id, numPlayers: n, seats, seed: (Math.floor(Math.random() * 0x7fffffff) + 1),
    boardRadius: msg.boardRadius | 0, started: false, game: null, history: [], lastPlaced: [], message: "",
    cpuTimer: null, reapTimer: null, timer, clock: null, flagTimer: null, timedOut: false, chat: [] };
  rooms.set(id, room);
  browsing.delete(ws);
  ctxOf.set(ws, { roomId: id, seat: 0 });
  send(ws, { t: "joined", roomId: id, seat: 0, token: room.seats[0].token });
  broadcastLobby(room);
}

function doJoin(ws: WebSocket, msg: Extract<ClientMsg, { t: "join" }>) {
  const code = String(msg.roomId ?? "").toUpperCase();
  const room = rooms.get(code);
  if (!room) return send(ws, { t: "error", message: "Room not found." });
  if (room.started) return send(ws, { t: "error", message: "Game already started." });
  const seatIdx = room.seats.findIndex((s) => s.type === "human" && s.ws == null);
  if (seatIdx < 0) return send(ws, { t: "error", message: "Room is full." });
  vacate(ws); // leave any other room first
  const seat = room.seats[seatIdx];
  seat.ws = ws; seat.connected = true; seat.name = cleanName(msg.name, `Seat ${seatIdx + 1}`);
  seat.token = newToken();
  browsing.delete(ws);
  ctxOf.set(ws, { roomId: room.id, seat: seatIdx });
  send(ws, { t: "joined", roomId: room.id, seat: seatIdx, token: seat.token });
  sendChatHistory(ws, room);
  systemChat(room, `${seat.name} joined.`);
  broadcastLobby(room);
}

// Reclaim a seat after a disconnect by presenting the secret token issued at
// join time. Works mid-game (the seat was kept as a dropped human, auto-piloted
// in the meantime) and is the path the client uses to recover from any drop.
function doRejoin(ws: WebSocket, msg: Extract<ClientMsg, { t: "rejoin" }>) {
  const room = rooms.get(String(msg.roomId ?? "").toUpperCase());
  if (!room) return send(ws, { t: "error", message: "That game is no longer available." });
  const token = typeof msg.token === "string" ? msg.token : "";
  const seatIdx = token ? room.seats.findIndex((s) => s.type === "human" && s.token !== "" && s.token === token) : -1;
  if (seatIdx < 0) return send(ws, { t: "error", message: "Could not find your seat to reconnect." });
  const seat = room.seats[seatIdx];
  if (seat.ws && seat.ws !== ws) { try { seat.ws.close(); } catch { /* ignore */ } }
  cancelReap(room);
  room.clock?.resume(); // unfreeze clocks now someone is back
  const wasDown = !seat.connected;
  seat.ws = ws; seat.connected = true;
  browsing.delete(ws);
  ctxOf.set(ws, { roomId: room.id, seat: seatIdx });
  send(ws, { t: "joined", roomId: room.id, seat: seatIdx, token: seat.token });
  sendChatHistory(ws, room);
  if (wasDown) systemChat(room, `${seat.name} reconnected.`);
  if (room.started && room.game) {
    room.message = `${seat.name} reconnected.`;
    step(room); // re-broadcast live state and recompute autopilot
  } else {
    broadcastLobby(room);
  }
}

// Randomly permute the seats so a random player takes seat 0 (who moves first),
// then remap each connected client's ws→seat so everyone still drives their own.
function shuffleSeats(room: Room) {
  for (let i = room.seats.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [room.seats[i], room.seats[j]] = [room.seats[j], room.seats[i]];
  }
  for (let i = 0; i < room.seats.length; i++) {
    const ws = room.seats[i].ws;
    if (ws) ctxOf.set(ws, { roomId: room.id, seat: i });
  }
}

function doStart(ws: WebSocket) {
  const ctx = ctxOf.get(ws); if (!ctx) return;
  const room = rooms.get(ctx.roomId); if (!room) return;
  if (!room.seats[ctx.seat]?.isHost) return send(ws, { t: "error", message: "Only the host can start." });
  if (room.started) return;
  if (!room.seats.every(seatFilled)) return send(ws, { t: "error", message: "Waiting for all seats to fill." });

  // Seat 0 always plays first, so shuffle the seats to randomize who goes first.
  shuffleSeats(room);

  room.game = new EngineModule.Game(room.numPlayers, room.seed, room.boardRadius);
  room.history = [];
  room.started = true;
  room.timedOut = false;
  room.clock = room.timer.mode !== "off" ? new Clock(room.timer, room.numPlayers) : null;
  room.message = "Game started — first round: play next to a printed symbol.";
  systemChat(room, `Game on! ${room.seats[room.game.current()].name} goes first.`);
  broadcastRooms(); // room is no longer open to join
  step(room);
}

function doAction(ws: WebSocket, msg: ClientMsg) {
  const ctx = ctxOf.get(ws); if (!ctx) return;
  const room = rooms.get(ctx.roomId); if (!room || !room.game) return;
  const g = room.game;
  if (g.current() !== ctx.seat) return send(ws, { t: "error", message: "Not your turn." });

  if (msg.t === "move") {
    const res = g.applyMove(msg.tileIndex, msg.q, msg.r, msg.dir, msg.flip);
    if (!res.ok) return send(ws, { t: "error", message: "Illegal move." });
    room.history.push({ kind: "move", seat: ctx.seat, tileIndex: msg.tileIndex, q: msg.q, r: msg.r, dir: msg.dir, flip: msg.flip });
    const [dx, dy] = DIRS[msg.dir];
    room.lastPlaced = [{ q: msg.q, r: msg.r }, { q: msg.q + dx, r: msg.r + dy }];
    describe(room, ctx.seat, res);
  } else if (msg.t === "swap") {
    if (!g.swap()) return send(ws, { t: "error", message: "Cannot swap now." });
    room.history.push({ kind: "swap", seat: ctx.seat });
    room.lastPlaced = []; room.message = `${room.seats[ctx.seat].name} swapped tiles.`;
  } else if (msg.t === "pass") {
    if (!g.pass()) return send(ws, { t: "error", message: "Cannot pass now." });
    room.history.push({ kind: "pass", seat: ctx.seat });
    room.lastPlaced = [];
  }
  step(room);
}

// Undo a player's own most recent action — only allowed while no one else has
// acted since. Rebuilds the engine by replaying the remaining history.
function doUndo(ws: WebSocket) {
  const ctx = ctxOf.get(ws); if (!ctx) return;
  const room = rooms.get(ctx.roomId); if (!room || !room.started) return;
  const h = room.history;
  if (!h.length) return send(ws, { t: "error", message: "Nothing to undo." });
  if (h[h.length - 1].seat !== ctx.seat) {
    return send(ws, { t: "error", message: "You can only undo your own last move." });
  }
  clearTimer(room);
  h.pop();
  rebuildGame(room);
  const last = h[h.length - 1];
  room.lastPlaced = last && last.kind === "move"
    ? [{ q: last.q, r: last.r }, { q: last.q + DIRS[last.dir][0], r: last.r + DIRS[last.dir][1] }]
    : [];
  room.message = `${room.seats[ctx.seat].name} undid their move.`;
  step(room);
}

function rebuildGame(room: Room) {
  try { room.game?.delete(); } catch { /* ignore */ }
  const g = new EngineModule.Game(room.numPlayers, room.seed, room.boardRadius);
  for (const a of room.history) {
    if (a.kind === "move") g.applyMove(a.tileIndex, a.q, a.r, a.dir, a.flip);
    else if (a.kind === "swap") g.swap();
    else g.pass();
  }
  room.game = g;
}

function onClose(ws: WebSocket) {
  browsing.delete(ws);
  const ctx = ctxOf.get(ws); if (!ctx) return;
  const room = rooms.get(ctx.roomId); if (!room) return;
  const seat = room.seats[ctx.seat];
  if (!seat || seat.ws !== ws) return;
  const droppedName = seat.name;
  seat.ws = null; seat.connected = false;

  ctxOf.delete(ws);
  if (!room.started) {
    // Retire the rejoin token (the seat may be reassigned to a new joiner).
    seat.token = "";
    if (!seat.isHost) seat.name = `Seat ${ctx.seat + 1}`;
    // If the host left, hand host to a remaining connected human so the room
    // isn't stuck unstartable (and the next joiner doesn't silently inherit it).
    if (seat.isHost) {
      seat.isHost = false;
      const heir = room.seats.find((s) => s.type === "human" && s.ws != null);
      if (heir) heir.isHost = true;
    }
    systemChat(room, `${droppedName} left.`);
    // if nobody is connected, drop the room
    if (room.seats.every((s) => s.ws == null)) rooms.delete(room.id);
    broadcastLobby(room);
    broadcastRooms();
    return;
  }
  // Mid-game: keep the seat as a (now disconnected) human so the player can
  // reconnect with their token. step() auto-pilots their turns in the meantime.
  if (room.seats.every((s) => s.ws == null)) {
    // nobody left watching — hold the room briefly for reconnects, then reap it
    systemChat(room, `${droppedName} disconnected — game paused for reconnects.`);
    scheduleReap(room);
    return;
  }
  systemChat(room, `${droppedName} disconnected — auto-playing until they return.`);
  room.message = `${droppedName} disconnected — others continue.`;
  step(room);
}

// ---------- HTTP (serve the built web app) ----------
const WEB_DIST = join(__dirname, "../../web/dist");
const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

const http = createServer(async (req, res) => {
  if (req.url === "/api/health") { res.writeHead(200).end("ok"); return; }
  if (!existsSync(WEB_DIST)) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Ingenious server running. Build the web app (web: npm run build) to serve it here, or use the Vite dev server.");
    return;
  }
  let urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = normalize(join(WEB_DIST, urlPath));
  if (!filePath.startsWith(WEB_DIST)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    // SPA fallback for navigations only. A missing asset (.js/.css/.wasm/…) must
    // 404 rather than return index.html — otherwise the browser rejects it for a
    // "text/html" MIME type under strict module-script checking.
    if (extname(urlPath)) { res.writeHead(404).end("Not found"); return; }
    try { res.writeHead(200, { "content-type": "text/html" }).end(await readFile(join(WEB_DIST, "index.html"))); }
    catch { res.writeHead(404).end("Not found"); }
  }
});

const wss = new WebSocketServer({ server: http, path: "/ws" });
wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    try { handle(ws, msg); }
    catch (e) { send(ws, { t: "error", message: "Server error." }); console.error(e); }
  });
  ws.on("close", () => onClose(ws));
  ws.on("error", () => onClose(ws));
});

loadEngine().then((m) => {
  EngineModule = m;
  http.listen(PORT, () => console.log(`Ingenious server on http://localhost:${PORT}  (ws: /ws)`));
});
