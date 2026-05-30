import { useState, useSyncExternalStore } from "react";
import { Menu } from "./components/Menu";
import { Browse } from "./components/Browse";
import { Lobby } from "./components/Lobby";
import { GameView } from "./components/GameView";
import { LocalMatch } from "./match/LocalMatch";
import { OnlineMatch } from "./match/OnlineMatch";
import type { PlayerInfo, Match } from "./match/types";

type Screen =
  | { k: "menu" }
  | { k: "loading" }
  | { k: "online"; match: OnlineMatch }
  | { k: "game"; match: Match };

export function App() {
  const [screen, setScreen] = useState<Screen>({ k: "menu" });

  function leave() {
    if (screen.k === "game" || screen.k === "online") screen.match.dispose();
    setScreen({ k: "menu" });
  }

  async function startLocal(players: PlayerInfo[], boardRadius: number) {
    setScreen({ k: "loading" });
    const seed = Math.floor(Math.random() * 0x7fffffff) + 1;
    const match = await LocalMatch.create(players, seed, boardRadius);
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

// One OnlineMatch spans browsing → lobby → game; render the right screen for its phase.
function OnlineScreen({ match, onLeave }: { match: OnlineMatch; onLeave: () => void }) {
  const phase = useSyncExternalStore((cb) => match.onUpdate(cb), () => match.phase());
  if (phase === "game") return <GameView match={match} onLeave={onLeave} />;
  if (phase === "lobby") return <Lobby match={match} onLeave={onLeave} />;
  return <Browse match={match} onLeave={onLeave} />;
}
