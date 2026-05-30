import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Board } from "./Board";
import { Rack } from "./Tiles";
import { ScorePanel } from "./ScorePanel";
import type { Match } from "../match/types";
import type { Move } from "../engine/engine";
import { sound, isMuted, setMuted } from "../sound";

function useSnapshot(match: Match) {
  return useSyncExternalStore(
    (cb) => match.onUpdate(cb),
    () => match.snapshot(),
  );
}

export function GameView({ match, onLeave }: { match: Match; onLeave: () => void }) {
  const snap = useSnapshot(match);
  const [selected, setSelected] = useState<number | null>(null);
  const [flip, setFlip] = useState(0);
  const [anchor, setAnchor] = useState<{ q: number; r: number } | null>(null);
  const [muted, setMutedState] = useState(isMuted());

  const { state } = snap;
  const seat = snap.mySeat;
  const hand = seat != null && state.hands[seat] ? state.hands[seat] : [];
  const canSelect = snap.yourTurn && !snap.gameOver;

  // sound effects, by diffing successive snapshots (local / CPU / online alike)
  const prev = useRef<{ lp: string; total: number; maxed: number; over: boolean; yours: boolean } | null>(null);
  useEffect(() => {
    const lp = JSON.stringify(snap.lastPlaced);
    const flat = (state.scores ?? []).flat();
    const total = flat.reduce((a, b) => a + b, 0);
    const maxed = flat.filter((v) => v >= state.cap).length;
    const p = prev.current;
    if (p) {
      if (snap.lastPlaced.length > 0 && lp !== p.lp) sound.place();
      if (maxed > p.maxed) sound.ingenious();
      else if (total > p.total) sound.score(total - p.total);
      if (snap.gameOver && !p.over) sound.gameOver();
      else if (snap.yourTurn && !p.yours && !snap.gameOver) sound.yourTurn();
    }
    prev.current = { lp, total, maxed, over: snap.gameOver, yours: snap.yourTurn };
  }, [snap]);

  // reset tile selection when the turn / hand changes
  useEffect(() => { setSelected(null); setAnchor(null); setFlip(0); }, [state.current, snap.handCounts[seat ?? -1], snap.gameOver]);

  function selectTile(i: number) { sound.select(); setSelected(i); setAnchor(null); }
  function doFlip() { setFlip((f) => (f ? 0 : 1)); setAnchor(null); }
  function place(m: Move) { match.place(m); setSelected(null); setAnchor(null); setFlip(0); }
  function toggleMute() { const m = !muted; setMuted(m); setMutedState(m); }
  function doUndo() { sound.undo(); match.undo(); }

  const selectedTile = selected != null && hand[selected] ? hand[selected] : null;

  return (
    <div className="game">
      <header className="topbar">
        <div className="brand">Ingenious</div>
        <div className="turn-msg">{snap.message}</div>
        <div className="topbar-right">
          <span className="bag" title="Tiles left in bag">🛍 {state.bagCount}</span>
          {snap.canUndo && <button className="ghost icon" onClick={doUndo} title="Undo last move">↶</button>}
          <button className="ghost icon" onClick={toggleMute} title={muted ? "Unmute" : "Mute"}>
            {muted ? "🔇" : "🔊"}
          </button>
          <button className="ghost" onClick={onLeave}>Leave</button>
        </div>
      </header>

      <div className="layout">
        <aside className="scoreboard">
          {snap.players.map((p, i) => (
            <ScorePanel key={i} name={p.name + (p.type === "cpu" ? " 🤖" : "")}
              scores={state.scores[i] ?? [0, 0, 0, 0, 0, 0]} cap={state.cap}
              active={i === state.current && !snap.gameOver} isYou={i === seat}
              result={state.scores[i] ? Math.min(...state.scores[i]) : 0} />
          ))}
        </aside>

        <main className="board-wrap">
          <Board
            state={state}
            legalMoves={canSelect ? snap.legalMoves : []}
            selectedTileIndex={selected}
            selectedTile={selectedTile}
            flip={flip}
            anchor={anchor}
            interactive={canSelect}
            lastPlaced={snap.lastPlaced}
            previewMove={snap.previewMove}
            onSelectAnchor={setAnchor}
            onPlace={place}
          />
        </main>
      </div>

      <footer className="bottombar">
        {seat != null && hand.length > 0 ? (
          <Rack tiles={hand} selectedIndex={selected} flip={flip}
            disabled={!canSelect} onSelect={selectTile} onFlip={doFlip} />
        ) : (
          <div className="waiting">{snap.gameOver ? "" : "Waiting…"}</div>
        )}
        <div className="actions">
          {snap.canSwap && <button className="primary" onClick={() => match.swap()}>Swap rack</button>}
          {snap.yourTurn && snap.pendingBonus > 0 && <span className="bonus-pill">★ Bonus play</span>}
        </div>
      </footer>

      {snap.gameOver && <GameOver snap={snap} onLeave={onLeave} />}
    </div>
  );
}

function GameOver({ snap, onLeave }: { snap: ReturnType<Match["snapshot"]>; onLeave: () => void }) {
  const ranking = snap.ranking.length ? snap.ranking : snap.players.map((_, i) => i);
  return (
    <div className="overlay">
      <div className="modal">
        <h2>{snap.players.length === 1 ? "Solitaire complete" : "Game over"}</h2>
        <ol className="results">
          {ranking.map((p, idx) => {
            const sc = snap.state.scores[p] ?? [];
            const sorted = [...sc].sort((a, b) => a - b);
            return (
              <li key={p} className={idx === 0 ? "winner" : ""}>
                <span className="medal">{idx === 0 ? "🏆" : `#${idx + 1}`}</span>
                <span className="rname">{snap.players[p]?.name}</span>
                <span className="rscore">{sorted[0]}</span>
                <span className="rdetail">({sorted.join(" · ")})</span>
              </li>
            );
          })}
        </ol>
        <button className="primary" onClick={onLeave}>Back to menu</button>
      </div>
    </div>
  );
}
