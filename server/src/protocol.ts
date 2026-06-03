// Wire protocol — mirror of web/src/match/protocol.ts.
export interface Move { tileIndex: number; q: number; r: number; dir: number; flip: number; }
export interface PlayerInfo { name: string; type: "human" | "cpu"; aiLevel?: number; connected?: boolean; }

export type TimerMode = "off" | "perMove" | "chess";
export interface TimerConfig { mode: TimerMode; perMoveSec?: number; totalSec?: number; incrementSec?: number; }
export interface ClockState { mode: TimerMode; remainingMs: number[]; running: number | null; flagged: boolean[]; asOf: number; }

export interface LobbySeat { type: "human" | "cpu"; name: string; filled: boolean; isHost: boolean; }
export interface LobbyState { roomId: string; numPlayers: number; seats: LobbySeat[]; started: boolean; timer: TimerConfig; }
export interface RoomBrief { roomId: string; host: string; humanFilled: number; humanTotal: number; numPlayers: number; boardRadius: number; }
export interface ChatMsg { seat: number; name: string; text: string; ts: number; system?: boolean; }

export type ClientMsg =
  | { t: "list" }
  | { t: "create"; numPlayers: number; cpuSeats: number[]; aiLevel: number; boardRadius: number; name: string; timer?: TimerConfig }
  | { t: "join"; roomId: string; name: string }
  | { t: "rejoin"; roomId: string; token: string }
  | { t: "start" }
  | { t: "move"; tileIndex: number; q: number; r: number; dir: number; flip: number }
  | { t: "swap" }
  | { t: "pass" }
  | { t: "undo" }
  | { t: "chat"; text: string };

export type ServerMsg =
  | { t: "joined"; roomId: string; seat: number; token: string }
  | { t: "lobby"; lobby: LobbyState }
  | { t: "snapshot"; state: any; handCounts: number[]; players: PlayerInfo[];
      current: number; canSwap: boolean; canUndo: boolean; pendingBonus: number; legalMoves: Move[];
      lastPlaced: { q: number; r: number }[]; message: string;
      gameOver: boolean; ranking: number[]; clock?: ClockState }
  | { t: "rooms"; rooms: RoomBrief[] }
  | { t: "chat"; msg: ChatMsg }
  | { t: "chatHistory"; msgs: ChatMsg[] }
  | { t: "error"; message: string };
