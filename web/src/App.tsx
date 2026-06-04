import { useState, useSyncExternalStore } from "react";
import { Menu } from "./components/Menu";
import { Browse } from "./components/Browse";
import { Lobby } from "./components/Lobby";
import { GameView } from "./components/GameView";
import { LocalMatch } from "./match/LocalMatch";
import { OnlineMatch } from "./match/OnlineMatch";
import type { PlayerInfo, Match, TimerConfig } from "./match/types";
import { DEFAULT_TIMER } from "./match/types";

type Screen =
  | { k: "menu" }
  | { k: "loading" }
  | { k: "online"; match: OnlineMatch }
  | { k: "game"; match: Match };

// Remember the player's chosen name across sessions (used for quick play).
const NAME_KEY = "ingenious.name";
export function loadName(): string {
  try { return localStorage.getItem(NAME_KEY) || "Player"; } catch { return "Player"; }
}
export function saveName(n: string) { try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ } }

// Open an online match. Resumes an in-progress game from a saved session;
// otherwise jumps straight into the next available lobby (quick play default).
function openOnline(): OnlineMatch {
  const m = new OnlineMatch();
  if (!OnlineMatch.hasSession()) m.quickplay(loadName());
  return m;
}

export function App() {
  // Default landing: drop straight into online play — resume a game in progress,
  // else quick-join the next open lobby (creating one if none). Single-player is
  // reachable from there via the menu.
  const [screen, setScreen] = useState<Screen>(() => ({ k: "online", match: openOnline() }));

  function leave() {
    if (screen.k === "game" || screen.k === "online") screen.match.dispose();
    setScreen({ k: "menu" });
  }

  async function startLocal(players: PlayerInfo[], boardRadius: number, timer: TimerConfig = DEFAULT_TIMER) {
    setScreen({ k: "loading" });
    const seed = Math.floor(Math.random() * 0x7fffffff) + 1;
    // Seat 0 always plays first in the engine, so shuffle the players to
    // randomize who goes first.
    const match = await LocalMatch.create(shuffle(players), seed, boardRadius, timer);
    setScreen({ k: "game", match });
  }

  function playOnline() {
    setScreen({ k: "online", match: openOnline() });
  }

  switch (screen.k) {
    case "menu":
      return <Menu onStartLocal={startLocal} onPlayOnline={playOnline} />;
    case "loading":
      return <div className="menu"><div className="menu-card"><p>Loading engine…</p></div></div>;
    case "online":
      return <OnlineScreen match={screen.match} onLeave={leave} />;
    case "game":
      return <GameView match={screen.match} onLeave={leave} />;
  }
}

// Fisher–Yates shuffle (returns a new array; input untouched).
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One OnlineMatch spans browsing → lobby → game; render the right screen for its phase.
function OnlineScreen({ match, onLeave }: { match: OnlineMatch; onLeave: () => void }) {
  useSyncExternalStore((cb) => match.onUpdate(cb), () => match.version());
  const phase = match.phase();
  const link = match.linkState();

  if (phase === "game") return <GameView match={match} onLeave={onLeave} />;
  if (phase === "lobby") return <Lobby match={match} onLeave={onLeave} />;

  // Browse phase: distinguish "can't reach the server" from a normal browse so
  // an offline user isn't stranded on a dead Create/Join screen.
  if (link === "closed") {
    return (
      <div className="menu"><div className="menu-card">
        <h2>Can't reach the server</h2>
        <p className="hint">{match.error() || "Online play needs the game server, which isn't reachable right now."}</p>
        <button className="primary" onClick={onLeave}>Back to menu</button>
      </div></div>
    );
  }
  // Still connecting / resuming a reloaded game: hold a splash.
  if (match.resuming() || (!match.listReady() && link !== "online")) {
    return <div className="menu"><div className="menu-card"><p className="finding"><span className="spinner" /> Connecting…</p></div></div>;
  }
  return <Browse match={match} onLeave={onLeave} />;
}
