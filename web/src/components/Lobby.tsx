import { useSyncExternalStore } from "react";
import type { OnlineMatch } from "../match/OnlineMatch";
import { timerLabel } from "./TimerSettings";
import { Chat } from "./Chat";

export function Lobby({ match, onLeave }: { match: OnlineMatch; onLeave: () => void }) {
  useSyncExternalStore((cb) => match.onUpdate(cb), () => match.lobby());
  const lobby = match.lobby();
  const seat = match.mySeatIndex();
  const err = match.error();

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
    return <div className="menu"><div className="menu-card"><p>Connecting…</p></div></div>;
  }

  const humanSeats = lobby.seats.filter((s) => s.type === "human");
  const filled = humanSeats.filter((s) => s.filled).length;
  const isHost = seat === lobby.seats.findIndex((s) => s.isHost);
  const allReady = humanSeats.every((s) => s.filled);

  return (
    <div className="menu"><div className="menu-card lobby">
      <h1 className="logo small">Room {lobby.roomId}</h1>
      <p className="tagline">Share the code · {filled}/{humanSeats.length} players joined · ⏱ {timerLabel(lobby.timer)}</p>
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
