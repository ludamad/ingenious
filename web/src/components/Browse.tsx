import { useState } from "react";
import { useSyncExternalStore } from "react";
import type { OnlineMatch } from "../match/OnlineMatch";
import { MIN_RADIUS, MAX_RADIUS, STANDARD_RADIUS, cellsAcross } from "../board";
import { DEFAULT_TIMER, type TimerConfig } from "../match/types";
import { TimerSettings } from "./TimerSettings";

export function Browse({ match, onLeave }: { match: OnlineMatch; onLeave: () => void }) {
  useSyncExternalStore((cb) => match.onUpdate(cb), () => match.version());
  const rooms = match.rooms();
  const err = match.error();

  const [name, setName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [players, setPlayers] = useState(2);
  const [fillCpu, setFillCpu] = useState(false);
  const [radius, setRadius] = useState(STANDARD_RADIUS);
  const [code, setCode] = useState("");
  const [advOpen, setAdvOpen] = useState(false);
  const [timer, setTimer] = useState<TimerConfig>(DEFAULT_TIMER);

  const myName = name.trim() || "Player";

  function create() {
    const cpuSeats = fillCpu ? Array.from({ length: players - 1 }, (_, i) => i + 1) : [];
    match.create(players, cpuSeats, 1, radius, myName, timer);
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
          {!showCreate ? (
            <button className="primary big" onClick={() => setShowCreate(true)}>+ Create a game</button>
          ) : (
            <div className="create-box">
              <h3>Create a game</h3>
              <label className="field"><span>Seats</span>
                <div className="seg">
                  {[2, 3, 4].map((n) => (
                    <button key={n} className={players === n ? "on" : ""} onClick={() => setPlayers(n)}>{n}</button>
                  ))}
                </div>
              </label>
              <label className="checkrow">
                <input type="checkbox" checked={fillCpu} onChange={(e) => setFillCpu(e.target.checked)} />
                <span>Fill empty seats with CPU</span>
              </label>
              <TimerSettings value={timer} onChange={setTimer} />
              <div className="advanced">
                <button className="adv-toggle" onClick={() => setAdvOpen((o) => !o)}>{advOpen ? "▾" : "▸"} Options</button>
                {advOpen && (
                  <label className="field"><span>Board size</span>
                    <div className="stepper">
                      <button onClick={() => setRadius(Math.max(MIN_RADIUS, radius - 1))} disabled={radius <= MIN_RADIUS}>−</button>
                      <span className="stepper-val">{cellsAcross(radius)} hexes</span>
                      <button onClick={() => setRadius(Math.min(MAX_RADIUS, radius + 1))} disabled={radius >= MAX_RADIUS}>+</button>
                    </div>
                  </label>
                )}
              </div>
              <div className="row">
                <button className="ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="primary" onClick={create}>Create &amp; host</button>
              </div>
            </div>
          )}
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
