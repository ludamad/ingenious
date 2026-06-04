// Wire protocol shared (by convention) with the server. Keep in sync with
// server/src/protocol.ts.
import type { GameState, Move, HeatCell } from "../engine/engine";
import type { PlayerInfo, ClockState, TimerConfig } from "./types";

export interface LobbySeat { type: "human" | "cpu"; name: string; filled: boolean; isHost: boolean; }
export interface LobbyState {
  roomId: string;
  numPlayers: number;
  seats: LobbySeat[];
  started: boolean;
  timer: TimerConfig;
  boardRadius: number;   // 0 = classic for the player count
  fillCpu: boolean;      // host setting: fill empty seats with CPU on start
}

// a joinable game shown in the lobby browser
export interface RoomBrief {
  roomId: string;
  host: string;
  humanFilled: number;
  humanTotal: number;
  numPlayers: number;
  boardRadius: number;
}

// A chat line. `seat` is the author's seat (-1 for server/system messages);
// `system` lines are join/leave/drop notices rendered differently.
export interface ChatMsg {
  seat: number;
  name: string;
  text: string;
  ts: number;
  system?: boolean;
}

// server -> client
export type ServerMsg =
  | { t: "joined"; roomId: string; seat: number; token: string }
  | { t: "lobby"; lobby: LobbyState }
  | { t: "snapshot"; state: GameState; handCounts: number[]; players: PlayerInfo[];
      current: number; canSwap: boolean; canUndo: boolean; pendingBonus: number; legalMoves: Move[];
      lastPlaced: { q: number; r: number }[]; message: string;
      gameOver: boolean; ranking: number[]; clock?: ClockState; heatmaps?: HeatCell[][] }
  | { t: "rooms"; rooms: RoomBrief[] }
  | { t: "chat"; msg: ChatMsg }                 // one new line
  | { t: "chatHistory"; msgs: ChatMsg[] }       // recent backlog on (re)join
  | { t: "error"; message: string };

// client -> server
export type ClientMsg =
  | { t: "list" }
  | { t: "create"; numPlayers: number; cpuSeats: number[]; aiLevel: number; boardRadius: number; name: string; timer?: TimerConfig }
  | { t: "join"; roomId: string; name: string }
  | { t: "quickplay"; name: string }   // join the next open lobby, or create one
  | { t: "rejoin"; roomId: string; token: string }
  | { t: "rename"; name: string }      // change your display name in the lobby
  | { t: "config"; numPlayers?: number; boardRadius?: number; timer?: TimerConfig; fillCpu?: boolean } // host edits lobby settings
  | { t: "start" }
  | { t: "move"; tileIndex: number; q: number; r: number; dir: number; flip: number }
  | { t: "swap" }
  | { t: "pass" }
  | { t: "undo" }
  | { t: "chat"; text: string };
