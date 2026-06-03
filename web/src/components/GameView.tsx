import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { Board } from "./Board";
import { Rack } from "./Tiles";
import { ScorePanel } from "./ScorePanel";
import { Confetti } from "./Confetti";
import type { Match } from "../match/types";
import type { Move } from "../engine/engine";
import { sound, isMuted, setMuted } from "../sound";

function useSnapshot(match: Match) {
  return useSyncExternalStore(
    (cb) => match.onUpdate(cb),
    () => match.snapshot(),
  );
}

// Placement is a small explicit state machine, so the board and rack always
// agree on what (if anything) the player is mid-way through placing:
//   idle  -> no tile picked
//   tile  -> a tile + orientation chosen, waiting for an anchor cell
//   anchor-> anchor chosen, waiting for the partner cell (or to commit)
type Placement =
  | { phase: "idle" }
  | { phase: "tile"; tile: number; flip: number }
  | { phase: "anchor"; tile: number; flip: number; anchor: { q: number; r: number } };

type PlacementAction =
  | { t: "select"; tile: number; flip: number }
  | { t: "flip"; flip: number }
  | { t: "anchor"; anchor: { q: number; r: number } }
  | { t: "clearAnchor" }
  | { t: "reset" };

function placementReducer(s: Placement, a: PlacementAction): Placement {
  switch (a.t) {
    case "select": return { phase: "tile", tile: a.tile, flip: a.flip };
    case "flip": return s.phase === "idle" ? s : { phase: "tile", tile: s.tile, flip: a.flip };
    case "anchor": return s.phase === "idle" ? s : { phase: "anchor", tile: s.tile, flip: s.flip, anchor: a.anchor };
    case "clearAnchor": return s.phase === "anchor" ? { phase: "tile", tile: s.tile, flip: s.flip } : s;
    case "reset": return { phase: "idle" };
  }
}

export function GameView({ match, onLeave }: { match: Match; onLeave: () => void }) {
  const snap = useSnapshot(match);
  const [placement, dispatch] = useReducer(placementReducer, { phase: "idle" });
  const [muted, setMutedState] = useState(isMuted());
  // a transient "why can't I play there" message, shown until the next action
  const [explanation, setExplanation] = useState<string | null>(null);

  const { state } = snap;
  const seat = snap.mySeat;
  const hand = seat != null && state.hands[seat] ? state.hands[seat] : [];
  const reconnecting = !!snap.reconnecting;
  const canSelect = snap.yourTurn && !snap.gameOver && !reconnecting;

  // Which tiles (and orientations) can actually be played this turn, derived
  // from the legal-move list. This is what makes un-playable tiles inert in the
  // UI instead of silently swallowing clicks.
  const legal = canSelect ? snap.legalMoves : [];
  const flipsByTile = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const mv of legal) {
      let set = m.get(mv.tileIndex);
      if (!set) { set = new Set(); m.set(mv.tileIndex, set); }
      set.add(mv.flip);
    }
    return m;
  }, [legal]);
  const placeableTiles = useMemo(() => hand.map((_, i) => flipsByTile.has(i)), [hand, flipsByTile]);
  const hasAnyPlacement = legal.length > 0;

  // derive the flat values the Board/Rack consume from the state machine
  const selected = placement.phase === "idle" ? null : placement.tile;
  const flip = placement.phase === "idle" ? 0 : placement.flip;
  const anchor = placement.phase === "anchor" ? placement.anchor : null;
  const selectedTile = selected != null && hand[selected] ? hand[selected] : null;
  const selectedFlips = selected != null ? flipsByTile.get(selected) : undefined;
  const canFlip = (selectedFlips?.size ?? 0) > 1;

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
      if (snap.gameOver && !p.over) {
        // Fanfare when the result is a "win" worth celebrating: solo, your own
        // online win, or a human winning local play. A loss to the CPU / another
        // player gets the soft cadence instead.
        const winner = snap.ranking[0] ?? 0;
        const solo = snap.players.length === 1;
        const youWon = snap.mySeat != null && winner === snap.mySeat;
        const winnerIsHuman = snap.players[winner]?.type === "human";
        const celebrate = solo || youWon || (snap.mySeat == null && winnerIsHuman);
        if (celebrate) sound.win(); else sound.lose();
      }
      else if (snap.yourTurn && !p.yours && !snap.gameOver) sound.yourTurn();
    }
    prev.current = { lp, total, maxed, over: snap.gameOver, yours: snap.yourTurn };
  }, [snap]);

  // reset the placement (and any explanation) when the turn / hand changes
  useEffect(() => { dispatch({ t: "reset" }); setExplanation(null); }, [state.current, snap.handCounts[seat ?? -1], snap.gameOver]);

  // Player-arranged display order for the rack (hand indices). Reset to natural
  // order whenever the hand size / turn / seat changes, so stale indices never
  // point past the rack.
  const [rackOrder, setRackOrder] = useState<number[]>([]);
  useEffect(() => {
    setRackOrder(hand.map((_, i) => i));
  }, [hand.length, state.current, seat]);
  const order = rackOrder.length === hand.length ? rackOrder : hand.map((_, i) => i);
  function reorderRack(from: number, to: number) {
    setRackOrder(() => {
      const next = order.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function selectTile(i: number) {
    setExplanation(null);
    const flips = flipsByTile.get(i);
    if (!flips || flips.size === 0) return; // not playable (also disabled in the rack)
    sound.select();
    // Prefer the natural orientation; fall back to the only legal one so the
    // player never lands on an orientation with nowhere to place it.
    dispatch({ t: "select", tile: i, flip: flips.has(0) ? 0 : 1 });
  }
  function doFlip() {
    if (placement.phase === "idle" || !canFlip) return;
    setExplanation(null);
    dispatch({ t: "flip", flip: placement.flip ? 0 : 1 });
  }
  function selectAnchor(cell: { q: number; r: number } | null) {
    setExplanation(null);
    dispatch(cell ? { t: "anchor", anchor: cell } : { t: "clearAnchor" });
  }
  function place(m: Move) { setExplanation(null); match.place(m); dispatch({ t: "reset" }); }
  function toggleMute() { const m = !muted; setMuted(m); setMutedState(m); }
  function doUndo() { sound.undo(); match.undo(); }

  // contextual guidance, so a click never feels like it did nothing. An explicit
  // "why can't I play there" explanation takes priority over the generic hint.
  const hint = canSelect
    ? explanation
      ? explanation
      : !hasAnyPlacement
        ? (snap.canSwap ? "No legal placements — swap your rack." : "No legal moves — passing…")
        : placement.phase === "idle"
          ? "Select a tile, then a highlighted cell."
          : placement.phase === "tile"
            ? "Pick a glowing cell to place your tile."
            : "Pick the matching cell, or tap the anchor again to undo."
    : "";

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

      {reconnecting && (
        <div className="reconnect-banner" role="status">
          <span className="spinner" aria-hidden="true" /> Connection lost — reconnecting…
        </div>
      )}

      <div className="layout">
        <aside className="scoreboard">
          {snap.players.map((p, i) => (
            <ScorePanel key={i} name={p.name}
              away={p.type === "human" && p.connected === false}
              cpu={p.type === "cpu"}
              scores={state.scores[i] ?? [0, 0, 0, 0, 0, 0]} cap={state.cap}
              active={i === state.current && !snap.gameOver} isYou={i === seat}
              result={state.scores[i] ? Math.min(...state.scores[i]) : 0}
              clock={snap.clock} seat={i} />
          ))}
        </aside>

        <main className="board-wrap">
          <Board
            state={state}
            legalMoves={legal}
            selectedTileIndex={selected}
            selectedTile={selectedTile}
            flip={flip}
            anchor={anchor}
            interactive={canSelect}
            lastPlaced={snap.lastPlaced}
            previewMove={snap.previewMove}
            onSelectAnchor={selectAnchor}
            onPlace={place}
            onExplain={setExplanation}
          />
        </main>
      </div>

      <footer className="bottombar">
        {seat != null && hand.length > 0 ? (
          <Rack tiles={hand} order={order} selectedIndex={selected} flip={flip}
            disabled={!canSelect} placeable={canSelect ? placeableTiles : undefined} canFlip={canFlip}
            onSelect={selectTile} onFlip={doFlip} onReorder={reorderRack} />
        ) : (
          <div className="waiting">{snap.gameOver ? "" : "Waiting…"}</div>
        )}
        {hint && <span className="turn-hint">{hint}</span>}
        <div className="actions">
          {snap.canSwap && (
            <button className={"primary" + (!hasAnyPlacement ? " pulse" : "")} onClick={() => match.swap()}>
              Swap rack
            </button>
          )}
          {snap.yourTurn && snap.pendingBonus > 0 && <span className="bonus-pill">★ Bonus play</span>}
        </div>
      </footer>

      {snap.gameOver && <GameOver snap={snap} onLeave={onLeave} />}
    </div>
  );
}

function GameOver({ snap, onLeave }: { snap: ReturnType<Match["snapshot"]>; onLeave: () => void }) {
  const ranking = snap.ranking.length ? snap.ranking : snap.players.map((_, i) => i);
  const solo = snap.players.length === 1;
  const winner = ranking[0];
  const youWon = snap.mySeat != null && winner === snap.mySeat;
  const winnerIsHuman = snap.players[winner]?.type === "human";
  // Celebrate a win you're part of: solo, your own online win, or — in local
  // hot-seat / vs-CPU where there's no fixed "you" — any human winning. A CPU
  // win is not celebrated.
  const celebrate = solo || youWon || (snap.mySeat == null && winnerIsHuman);

  const headline = solo
    ? "Solitaire complete!"
    : youWon
      ? "You win! 🎉"
      : celebrate
        ? `${snap.players[winner]?.name ?? "Winner"} wins! 🎉`
        : "Game over";

  return (
    <div className="overlay">
      {celebrate && <Confetti />}
      <div className={"modal win-modal" + (celebrate ? " celebrate" : "")}>
        <div className="win-trophy" aria-hidden="true">🏆</div>
        <h2 className="win-title">{headline}</h2>
        {!solo && (
          <p className="win-sub">
            {youWon ? "Lowest counter takes it — nicely balanced."
              : celebrate ? "Lowest counter takes it!"
              : `${snap.players[winner]?.name ?? "They"} took it this time.`}
          </p>
        )}
        <ol className="results">
          {ranking.map((p, idx) => {
            const sc = snap.state.scores[p] ?? [];
            const sorted = [...sc].sort((a, b) => a - b);
            return (
              <li key={p} className={idx === 0 ? "winner" : ""} style={{ animationDelay: `${0.12 + idx * 0.09}s` }}>
                <span className="medal">{idx === 0 ? "🏆" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`}</span>
                <span className="rname">{snap.players[p]?.name}{p === snap.mySeat ? " (you)" : ""}</span>
                <span className="rscore">{sorted[0]}</span>
                <span className="rdetail">({sorted.join(" · ")})</span>
              </li>
            );
          })}
        </ol>
        <button className="primary big" onClick={onLeave}>Back to menu</button>
      </div>
    </div>
  );
}
