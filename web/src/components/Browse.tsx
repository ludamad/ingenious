import { useState } from "react";
import { useSyncExternalStore } from "react";
import type { OnlineMatch } from "../match/OnlineMatch";
import { cellsAcross } from "../board";
import { DEFAULT_TIMER } from "../match/types";

export function Browse({ match, onLeave }: { match: OnlineMatch; onLeave: () => void }) {
  useSyncExternalStore((cb) => match.onUpdate(cb), () => match.version());
  const rooms = match.rooms();
  const err = match.error();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const myName = name.trim() || "Player";

  // Create a default room and drop straight into the lobby — the host configures
  // players / CPUs / timer / board size there (no duplicate setup form here).
  function create() {
    match.create(2, [], 1, 0, myName, DEFAULT_TIMER);
  }

  return (
    <div className="menu">
      <div className="menu-card">
        <div className="browse-head">
          <h1 className="logo small">Play Online</h1>
          <button className="textlink" onClick={onLeave}>← menu</button>
        </div>

        <label className="namebox">
          <span className="namebox-label">Your name</span>
          <span className="namebox-field">
            <span className="namebox-pen" aria-hidden="true">✎</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Player" maxLength={24} />
          </span>
        </label>

        {err && <p className="hint err">{err}</p>}

        <div className="browse-section">
          <div className="browse-section-head">
            <h3>Open games</h3>
            <button className="textlink" onClick={() => match.refresh()}>⟳ refresh</button>
          </div>
          {rooms.length === 0 ? (
            <p className="empty-rooms"><span className="empty-ic">🔍</span> No open games right now — create one below.</p>
          ) : (
            <ul className="roomlist">
              {rooms.map((r) => (
                <li key={r.roomId} className="room-card">
                  <span className="room-code-pill">{r.roomId}</span>
                  <div className="room-info">
                    <span className="room-host">{r.host}'s game</span>
                    <span className="room-chips">
                      <span className="rchip"><span className="chip-ic">👥</span>{r.humanFilled}/{r.humanTotal}</span>
                      <span className="rchip"><span className="chip-ic">⬡</span>{cellsAcross(r.boardRadius)}-hex</span>
                    </span>
                  </div>
                  <button className="primary" onClick={() => match.join(r.roomId, myName)}>Join</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="browse-actions">
          <button className="primary big" onClick={create}>+ Create a game</button>
          <p className="create-hint">You'll set players, timer and board size in the room.</p>
        </div>

        <div className="joincode">
          <span>Have a code?</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD" maxLength={6} />
          <button className="ghost" disabled={!code.trim()} onClick={() => match.join(code.trim(), myName)}>Join</button>
        </div>
      </div>
    </div>
  );
}
