// Wire protocol — mirror of web/src/match/protocol.ts.
export interface Move { tileIndex: number; q: number; r: number; dir: number; flip: number; }
export interface PlayerInfo { name: string; type: "human" | "cpu"; aiLevel?: number; connected?: boolean; }

export interface LobbySeat { type: "human" | "cpu"; name: string; filled: boolean; isHost: boolean; }
export interface LobbyState { roomId: string; numPlayers: number; seats: LobbySeat[]; started: boolean; }
export interface RoomBrief { roomId: string; host: string; humanFilled: number; humanTotal: number; numPlayers: number; boardRadius: number; }

export type ClientMsg =
  | { t: "list" }
  | { t: "create"; numPlayers: number; cpuSeats: number[]; aiLevel: number; boardRadius: number; name: string }
  | { t: "join"; roomId: string; name: string }
  | { t: "start" }
  | { t: "move"; tileIndex: number; q: number; r: number; dir: number; flip: number }
  | { t: "swap" }
  | { t: "pass" }
  | { t: "undo" };

export type ServerMsg =
  | { t: "joined"; roomId: string; seat: number }
  | { t: "lobby"; lobby: LobbyState }
  | { t: "snapshot"; state: any; handCounts: number[]; players: PlayerInfo[];
      current: number; canSwap: boolean; canUndo: boolean; pendingBonus: number; legalMoves: Move[];
      lastPlaced: { q: number; r: number }[]; message: string;
      gameOver: boolean; ranking: number[] }
  | { t: "rooms"; rooms: RoomBrief[] }
  | { t: "error"; message: string };
