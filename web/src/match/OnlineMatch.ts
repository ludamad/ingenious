// Networked controller. One WebSocket spans three phases: browsing open games,
// sitting in a lobby, and playing. The server is authoritative.
//
// The socket self-heals: if it drops while we're in a lobby or game, we reopen
// it (with backoff) and present the seat token the server handed us at join
// time to reclaim our seat. The token is also stashed in sessionStorage, so a
// full page reload during a game resumes it (see OnlineMatch.hasSession).
import type { Move } from "../engine/engine";
import { Emitter, type Match, type Snapshot, type TimerConfig } from "./types";
import type { ChatMsg, ClientMsg, LobbyState, RoomBrief, ServerMsg } from "./protocol";
import { wsUrl } from "../net/server";

const CHAT_CAP = 200; // keep the local chat log bounded

const SESSION_KEY = "ingenious.session";
interface SavedSession { roomId: string; token: string; }

function loadSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession;
    return s && s.roomId && s.token ? s : null;
  } catch { return null; }
}
function saveSession(s: SavedSession) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

type Link = "connecting" | "online" | "reconnecting" | "closed";

export class OnlineMatch extends Emitter implements Match {
  private ws: WebSocket | null = null;
  private open = false;
  private queue: ClientMsg[] = [];
  private seat: number | null = null;
  private roomId = "";
  private token = "";
  private snap: Snapshot | null = null;
  private lobbyState: LobbyState | null = null;
  private roomList: RoomBrief[] = [];
  private err = "";
  private ver = 0;
  private link: Link = "connecting";
  private disposed = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingRejoin = false;
  private chatLog: ChatMsg[] = [];
  private unread = 0;

  // True if a previous tab/session left a game we can try to rejoin on load.
  static hasSession(): boolean { return loadSession() != null; }

  constructor() {
    super();
    const saved = loadSession();
    if (saved) { this.roomId = saved.roomId; this.token = saved.token; }
    this.connect();
  }

  // --- phase + browse accessors ---
  phase(): "browse" | "lobby" | "game" {
    if (this.snap) return "game";
    if (this.lobbyState) return "lobby";
    return "browse";
  }
  version() { return this.ver; }       // changes whenever anything updates (for stores)
  rooms() { return this.roomList; }
  error() { return this.err; }
  refresh() { this.send({ t: "list" }); }

  // --- browse actions ---
  create(numPlayers: number, cpuSeats: number[], aiLevel: number, boardRadius: number, name: string, timer?: TimerConfig) {
    this.err = "";
    this.send({ t: "create", numPlayers, cpuSeats, aiLevel, boardRadius, name, timer });
  }
  join(roomId: string, name: string) {
    this.err = "";
    this.send({ t: "join", roomId, name });
  }
  // Join the next open lobby (server creates one if none) — the default landing.
  quickplay(name: string) {
    this.err = "";
    this.send({ t: "quickplay", name });
  }

  // --- lobby accessors/actions ---
  lobby(): LobbyState | null { return this.lobbyState; }
  mySeatIndex(): number | null { return this.seat; }
  roomCode(): string { return this.roomId; }
  // mid-rejoin with nothing to show yet (e.g. resuming after a page reload)
  resuming(): boolean { return this.awaitingRejoin && !this.snap && !this.lobbyState; }
  start() { this.send({ t: "start" }); }
  rename(name: string) { this.send({ t: "rename", name }); }
  configure(cfg: { numPlayers?: number; boardRadius?: number; timer?: TimerConfig; fillCpu?: boolean }) {
    this.send({ t: "config", ...cfg });
  }
  inGame(): boolean { return this.snap != null; }

  // --- chat ---
  chat(): ChatMsg[] { return this.chatLog; }
  unreadChat(): number { return this.unread; }
  markChatRead() { if (this.unread) { this.unread = 0; this.bump(); } }
  sendChat(text: string) {
    const t = text.trim();
    if (t) this.send({ t: "chat", text: t });
  }

  // --- Match impl ---
  // Cache the pre-game fallback snapshot and only rebuild it when its inputs
  // (err/link) change, so getSnapshot() stays referentially stable as
  // useSyncExternalStore requires.
  private fallback: Snapshot | null = null;
  private fallbackKey = "";
  snapshot(): Snapshot {
    if (this.snap) return this.snap;
    const key = `${this.err}|${this.link}`;
    if (!this.fallback || this.fallbackKey !== key) {
      this.fallback = {
        state: { numPlayers: 0, regionRadius: 5, cap: 18, solitaire: false, current: 0,
          pendingBonus: 0, finished: false, firstRound: true, bagCount: 0, cells: [], scores: [], hands: [] },
        handCounts: [], players: [], mySeat: null, yourTurn: false, legalMoves: [], canSwap: false, canUndo: false,
        pendingBonus: 0, lastPlaced: [], previewMove: null, message: this.err || "Connecting…", gameOver: false, ranking: [],
        reconnecting: this.link !== "online",
      };
      this.fallbackKey = key;
    }
    return this.fallback;
  }
  place(m: Move) { this.send({ t: "move", ...m }); }
  swap() { this.send({ t: "swap" }); }
  pass() { this.send({ t: "pass" }); }
  undo() { this.send({ t: "undo" }); }
  dispose() {
    this.disposed = true;
    clearSession();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    try { this.ws?.close(); } catch { /* noop */ }
  }

  // --- internals ---
  private bump() { this.ver++; this.emit(); }

  // Keep the cached snapshot's reconnecting flag in step with the link state so
  // getSnapshot() stays referentially stable between events (required by
  // useSyncExternalStore) yet reflects connectivity.
  private setLink(l: Link) {
    if (this.link === l) return;
    this.link = l;
    if (this.snap) this.snap = { ...this.snap, reconnecting: l !== "online" };
    this.bump();
  }

  private send(m: ClientMsg) {
    if (this.open && this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else this.queue.push(m);
  }

  private connect() {
    if (this.disposed) return;
    this.link = this.retry === 0 ? "connecting" : "reconnecting";
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.open = true;
      this.retry = 0;
      // Reclaim our seat first if we have one, then ask for the open-games list.
      if (this.token && this.roomId) { this.awaitingRejoin = true; ws.send(JSON.stringify({ t: "rejoin", roomId: this.roomId, token: this.token })); }
      ws.send(JSON.stringify({ t: "list" }));
      for (const m of this.queue) ws.send(JSON.stringify(m));
      this.queue = [];
      this.setLink("online");
      this.bump();
    };
    ws.onmessage = (e) => {
      // Don't trust the wire: a malformed frame must not throw inside the
      // socket callback (where the browser would swallow it and leave us stuck).
      let msg: ServerMsg;
      try { msg = JSON.parse(e.data) as ServerMsg; }
      catch { return; }
      try { this.onMessage(msg); }
      catch { this.err = "Bad message from server"; this.bump(); }
    };
    ws.onerror = () => { /* the close handler drives reconnection */ };
    ws.onclose = () => {
      if (this.ws !== ws) return;       // superseded by a newer socket
      this.open = false;
      if (this.disposed) { this.setLink("closed"); return; }
      // If we have something to come back to (a live game/lobby or a saved seat
      // token), keep trying to reconnect; otherwise this was just a browse drop.
      if (this.snap || this.lobbyState || this.token) {
        this.setLink("reconnecting");
        this.scheduleReconnect();
      } else {
        this.err = this.err || "Disconnected";
        this.setLink("closed");
      }
    };
  }

  private scheduleReconnect() {
    if (this.retryTimer || this.disposed) return;
    const delay = Math.min(8000, 500 * 2 ** this.retry);
    this.retry++;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.connect(); }, delay);
  }

  private onMessage(msg: ServerMsg) {
    switch (msg.t) {
      case "joined":
        this.seat = msg.seat; this.roomId = msg.roomId; this.token = msg.token;
        this.awaitingRejoin = false; this.err = "";
        saveSession({ roomId: msg.roomId, token: msg.token });
        break;
      case "lobby": this.lobbyState = msg.lobby; this.awaitingRejoin = false; break;
      case "rooms": this.roomList = msg.rooms; break;
      case "chatHistory":
        // Replace the local log with the server backlog (de-duped on (re)join).
        this.chatLog = msg.msgs.slice(-CHAT_CAP);
        break;
      case "chat":
        this.chatLog = [...this.chatLog, msg.msg].slice(-CHAT_CAP);
        // count unread for anything not authored by us
        if (msg.msg.seat !== this.seat) this.unread++;
        break;
      case "error":
        this.err = msg.message;
        // A failed rejoin means the seat/room is gone — stop chasing it and
        // drop any stale game/lobby so we fall back to the browser cleanly.
        if (this.awaitingRejoin) {
          this.awaitingRejoin = false;
          this.token = ""; this.roomId = "";
          this.snap = null; this.lobbyState = null;
          clearSession();
          if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
        }
        break;
      case "snapshot": {
        const yourTurn = this.seat != null && msg.current === this.seat && !msg.gameOver;
        this.awaitingRejoin = false;
        if (msg.gameOver) clearSession(); // nothing to resume once it's over
        this.snap = {
          state: msg.state,
          handCounts: msg.handCounts,
          players: msg.players,
          mySeat: this.seat,
          yourTurn,
          legalMoves: yourTurn ? msg.legalMoves : [],
          canSwap: yourTurn && msg.canSwap,
          canUndo: msg.canUndo, // server allows undoing your own last action
          pendingBonus: msg.pendingBonus,
          lastPlaced: msg.lastPlaced,
          previewMove: null,
          message: msg.message,
          gameOver: msg.gameOver,
          ranking: msg.ranking,
          reconnecting: this.link !== "online",
          clock: msg.clock,
          heatmaps: yourTurn ? msg.heatmaps : undefined,
        };
        break;
      }
    }
    this.bump();
  }
}
