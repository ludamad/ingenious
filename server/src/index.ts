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
import type { ClientMsg, ServerMsg, LobbyState, PlayerInfo } from "./protocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const CPU_DELAY = 550;
const COLOR_NAMES = ["red", "orange", "yellow", "green", "blue", "purple"];

interface Seat {
  type: "human" | "cpu";
  name: string;
  ws: WebSocket | null;
  connected: boolean;
  aiLevel: number;
  isHost: boolean;
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
}
interface Ctx { roomId: string; seat: number; }

const rooms = new Map<string, Room>();
const browsing = new Set<WebSocket>();    // connections viewing the open-games list
const ctxOf = new WeakMap<WebSocket, Ctx>();
let EngineModule: Awaited<ReturnType<typeof loadEngine>>;

// ---------- helpers ----------
function seatFilled(s: Seat): boolean { return s.type === "cpu" || (s.type === "human" && s.ws != null); }

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

function broadcast(room: Room) {
  const g = room.game;
  if (!g) return;
  const state = g.state();
  const current = g.current();
  const finished = g.finished();
  const canSwap = g.canSwap();
  const ranking = finished ? g.ranking() : [];
  const handCounts = state.hands.map((h: any[]) => h.length);
  // a human may undo their own last action, but only while no one has acted since
  const lastSeat = room.history.length ? room.history[room.history.length - 1].seat : -1;

  for (let seat = 0; seat < room.seats.length; seat++) {
    const ws = room.seats[seat].ws;
    if (!ws) continue;
    const canUndo = lastSeat === seat && room.seats[seat].type === "human";
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

// Drive the game forward: broadcast, then auto-resolve CPU seats and stuck humans.
function step(room: Room) {
  broadcast(room);
  const g = room.game;
  if (!g || g.finished()) { clearTimer(room); return; }
  const cur = g.current();
  const seat = room.seats[cur];

  if (seat.type === "cpu") {
    clearTimer(room);
    room.cpuTimer = setTimeout(() => {
      room.cpuTimer = null;
      if (!room.game) return;
      doCpu(room);
      step(room);
    }, CPU_DELAY);
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
    case "start": return doStart(ws);
    case "undo": return doUndo(ws);
    case "move":
    case "swap":
    case "pass": return doAction(ws, msg);
  }
}

function doCreate(ws: WebSocket, msg: Extract<ClientMsg, { t: "create" }>) {
  const n = Math.max(2, Math.min(4, msg.numPlayers | 0));
  const id = newRoomId();
  let cpuCount = 0;
  const seats: Seat[] = [];
  for (let i = 0; i < n; i++) {
    const isCpu = i !== 0 && msg.cpuSeats.includes(i);
    seats.push({
      type: isCpu ? "cpu" : "human",
      name: isCpu ? `CPU ${++cpuCount}` : i === 0 ? (msg.name || "Host") : `Seat ${i + 1}`,
      ws: i === 0 ? ws : null,
      connected: i === 0,
      aiLevel: msg.aiLevel ?? 1,
      isHost: i === 0,
    });
  }
  const room: Room = { id, numPlayers: n, seats, seed: (Math.floor(Math.random() * 0x7fffffff) + 1),
    boardRadius: msg.boardRadius | 0, started: false, game: null, history: [], lastPlaced: [], message: "", cpuTimer: null };
  rooms.set(id, room);
  browsing.delete(ws);
  ctxOf.set(ws, { roomId: id, seat: 0 });
  send(ws, { t: "joined", roomId: id, seat: 0 });
  broadcastLobby(room);
}

function doJoin(ws: WebSocket, msg: Extract<ClientMsg, { t: "join" }>) {
  const room = rooms.get(msg.roomId.toUpperCase());
  if (!room) return send(ws, { t: "error", message: "Room not found." });
  if (room.started) return send(ws, { t: "error", message: "Game already started." });
  const seatIdx = room.seats.findIndex((s) => s.type === "human" && s.ws == null);
  if (seatIdx < 0) return send(ws, { t: "error", message: "Room is full." });
  const seat = room.seats[seatIdx];
  seat.ws = ws; seat.connected = true; seat.name = msg.name || `Seat ${seatIdx + 1}`;
  browsing.delete(ws);
  ctxOf.set(ws, { roomId: room.id, seat: seatIdx });
  send(ws, { t: "joined", roomId: room.id, seat: seatIdx });
  broadcastLobby(room);
}

function doStart(ws: WebSocket) {
  const ctx = ctxOf.get(ws); if (!ctx) return;
  const room = rooms.get(ctx.roomId); if (!room) return;
  if (!room.seats[ctx.seat]?.isHost) return send(ws, { t: "error", message: "Only the host can start." });
  if (room.started) return;
  if (!room.seats.every(seatFilled)) return send(ws, { t: "error", message: "Waiting for all seats to fill." });

  room.game = new EngineModule.Game(room.numPlayers, room.seed, room.boardRadius);
  room.history = [];
  room.started = true;
  room.message = "Game started — first round: play next to a printed symbol.";
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
  seat.ws = null; seat.connected = false;

  if (!room.started) {
    // free the seat again for someone else
    if (!seat.isHost) seat.name = `Seat ${ctx.seat + 1}`;
    // if nobody is connected, drop the room
    if (room.seats.every((s) => s.ws == null)) rooms.delete(room.id);
    broadcastLobby(room);
    broadcastRooms();
    return;
  }
  // mid-game: let a CPU take over so play continues
  seat.type = "cpu";
  seat.name = `${seat.name} 🤖`;
  if (room.seats.every((s) => s.ws == null)) {
    clearTimer(room);
    try { room.game?.delete(); } catch { /* ignore */ }
    rooms.delete(room.id);
    return;
  }
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
    // SPA fallback
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
