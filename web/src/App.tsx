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

export function App() {
  // If a previous tab left an online game mid-play, drop straight back into it
  // and let OnlineMatch reclaim the seat (falling back to browsing if it's gone).
  const [screen, setScreen] = useState<Screen>(() =>
    OnlineMatch.hasSession() ? { k: "online", match: new OnlineMatch() } : { k: "menu" });

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
    setScreen({ k: "online", match: new OnlineMatch() });
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
  // Resuming a game after a reload: hold a splash instead of flashing the
  // browser before the rejoined snapshot arrives.
  if (phase === "browse" && match.resuming()) {
    return <div className="menu"><div className="menu-card"><p>Reconnecting…</p></div></div>;
  }
  if (phase === "game") return <GameView match={match} onLeave={onLeave} />;
  if (phase === "lobby") return <Lobby match={match} onLeave={onLeave} />;
  return <Browse match={match} onLeave={onLeave} />;
}
