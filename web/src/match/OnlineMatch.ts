// Networked controller. One WebSocket spans three phases: browsing open games,
// sitting in a lobby, and playing. The server is authoritative.
import type { Move } from "../engine/engine";
import { Emitter, type Match, type Snapshot } from "./types";
import type { ClientMsg, LobbyState, RoomBrief, ServerMsg } from "./protocol";

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

export class OnlineMatch extends Emitter implements Match {
  private ws: WebSocket;
  private open = false;
  private queue: ClientMsg[] = [];
  private seat: number | null = null;
  private roomId = "";
  private snap: Snapshot | null = null;
  private lobbyState: LobbyState | null = null;
  private roomList: RoomBrief[] = [];
  private err = "";
  private ver = 0;

  constructor() {
    super();
    this.ws = new WebSocket(wsUrl());
    this.ws.onopen = () => {
      this.open = true;
      this.send({ t: "list" });
      for (const m of this.queue) this.send(m);
      this.queue = [];
      this.bump();
    };
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data) as ServerMsg);
    this.ws.onerror = () => { this.err = "Connection error"; this.bump(); };
    this.ws.onclose = () => { if (!this.snap && !this.lobbyState) this.err = this.err || "Disconnected"; this.bump(); };
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
  create(numPlayers: number, cpuSeats: number[], aiLevel: number, boardRadius: number, name: string) {
    this.err = "";
    this.send({ t: "create", numPlayers, cpuSeats, aiLevel, boardRadius, name });
  }
  join(roomId: string, name: string) {
    this.err = "";
    this.send({ t: "join", roomId, name });
  }

  // --- lobby accessors/actions ---
  lobby(): LobbyState | null { return this.lobbyState; }
  mySeatIndex(): number | null { return this.seat; }
  roomCode(): string { return this.roomId; }
  start() { this.send({ t: "start" }); }
  inGame(): boolean { return this.snap != null; }

  // --- Match impl ---
  snapshot(): Snapshot {
    if (this.snap) return this.snap;
    return {
      state: { numPlayers: 0, regionRadius: 5, cap: 18, solitaire: false, current: 0,
        pendingBonus: 0, finished: false, firstRound: true, bagCount: 0, cells: [], scores: [], hands: [] },
      handCounts: [], players: [], mySeat: null, yourTurn: false, legalMoves: [], canSwap: false, canUndo: false,
      pendingBonus: 0, lastPlaced: [], previewMove: null, message: this.err || "Connecting…", gameOver: false, ranking: [],
    };
  }
  place(m: Move) { this.send({ t: "move", ...m }); }
  swap() { this.send({ t: "swap" }); }
  pass() { this.send({ t: "pass" }); }
  undo() { this.send({ t: "undo" }); }
  dispose() { try { this.ws.close(); } catch { /* noop */ } }

  // --- internals ---
  private bump() { this.ver++; this.emit(); }
  private send(m: ClientMsg) {
    if (this.open && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else this.queue.push(m);
  }

  private onMessage(msg: ServerMsg) {
    switch (msg.t) {
      case "joined": this.seat = msg.seat; this.roomId = msg.roomId; break;
      case "lobby": this.lobbyState = msg.lobby; break;
      case "rooms": this.roomList = msg.rooms; break;
      case "error": this.err = msg.message; break;
      case "snapshot": {
        const yourTurn = this.seat != null && msg.current === this.seat && !msg.gameOver;
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
        };
        break;
      }
    }
    this.bump();
  }
}
