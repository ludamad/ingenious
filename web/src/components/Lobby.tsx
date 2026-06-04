import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import type { OnlineMatch } from "../match/OnlineMatch";
import { TimerSettings, timerLabel } from "./TimerSettings";
import { Chat } from "./Chat";
import { saveName, loadName } from "../App";
import { MIN_RADIUS, MAX_RADIUS, cellsAcross } from "../board";

export function Lobby({ match, onLeave }: { match: OnlineMatch; onLeave: () => void }) {
  useSyncExternalStore((cb) => match.onUpdate(cb), () => match.version());
  const lobby = match.lobby();
  const seat = match.mySeatIndex();
  const err = match.error();

  // local editable name (seeded from the server seat / saved name)
  const mySeatName = seat != null && lobby ? lobby.seats[seat]?.name : "";
  const [name, setName] = useState(mySeatName || loadName());
  useEffect(() => { if (mySeatName) setName(mySeatName); }, [mySeatName]);

  if (err && !lobby) {
    return (
      <div className="menu"><div className="menu-card">
        <h2>Could not connect</h2>
        <p className="hint">{err}</p>
        <button className="primary" onClick={onLeave}>Back</button>
      </div></div>
    );
  }
  if (!lobby) {
    return <div className="menu"><div className="menu-card"><p>Finding a game…</p></div></div>;
  }

  const humanSeats = lobby.seats.filter((s) => s.type === "human");
  const filled = humanSeats.filter((s) => s.filled).length;
  const isHost = seat === lobby.seats.findIndex((s) => s.isHost);
  const allReady = lobby.fillCpu || humanSeats.every((s) => s.filled);

  function commitName() {
    const n = name.trim();
    if (n && n !== mySeatName) { saveName(n); match.rename(n); }
  }

  return (
    <div className="menu"><div className="menu-card lobby">
      <h1 className="logo small">Room {lobby.roomId}</h1>
      <p className="tagline">Share the code · {filled}/{humanSeats.length} joined · ⏱ {timerLabel(lobby.timer)} · {cellsAcross(lobby.boardRadius || 5)}-hex</p>

      <label className="field col">
        <span>Your name</span>
        <input value={name} maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="Your name" />
      </label>

      <ul className="seatlist">
        {lobby.seats.map((s, i) => (
          <li key={i} className={i === seat ? "me" : ""}>
            <span className="seat-n">Seat {i + 1}</span>
            <span className="seat-name">
              {s.type === "cpu" ? "CPU 🤖" : s.filled ? s.name : <em>open…</em>}
              {s.isHost ? " · host" : ""}
              {i === seat ? " · you" : ""}
            </span>
          </li>
        ))}
      </ul>

      {isHost && <HostSettings match={match} lobby={lobby} />}

      {err && <p className="hint err">{err}</p>}
      {isHost ? (
        <button className="primary big" disabled={!allReady} onClick={() => match.start()}>
          {allReady ? "Start game" : "Waiting for players…"}
        </button>
      ) : (
        <p className="hint">Waiting for the host to start…</p>
      )}
      <Chat match={match} />
      <button className="ghost" onClick={onLeave}>Leave</button>
    </div></div>
  );
}

// Host-only controls to change the game type while still in the lobby. Each
// change is sent immediately; the server re-lays the seats and re-broadcasts.
function HostSettings({ match, lobby }: { match: OnlineMatch; lobby: NonNullable<ReturnType<OnlineMatch["lobby"]>> }) {
  const radius = lobby.boardRadius || 5;
  return (
    <div className="host-settings">
      <h3>Game settings</h3>
      <label className="field"><span>Players</span>
        <div className="seg">
          {[2, 3, 4].map((n) => (
            <button key={n} className={lobby.numPlayers === n ? "on" : ""}
              onClick={() => match.configure({ numPlayers: n })}>{n}</button>
          ))}
        </div>
      </label>
      <label className="checkrow">
        <input type="checkbox" checked={lobby.fillCpu}
          onChange={(e) => match.configure({ fillCpu: e.target.checked })} />
        <span>Fill empty seats with CPU</span>
      </label>
      <TimerSettings value={lobby.timer} onChange={(t) => match.configure({ timer: t })} />
      <label className="field"><span>Board size</span>
        <div className="stepper">
          <button onClick={() => match.configure({ boardRadius: Math.max(MIN_RADIUS, radius - 1) })} disabled={radius <= MIN_RADIUS}>−</button>
          <span className="stepper-val">{cellsAcross(radius)} hexes</span>
          <button onClick={() => match.configure({ boardRadius: Math.min(MAX_RADIUS, radius + 1) })} disabled={radius >= MAX_RADIUS}>+</button>
        </div>
      </label>
    </div>
  );
}
