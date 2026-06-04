import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import type { OnlineMatch } from "../match/OnlineMatch";
import type { LobbyState } from "../match/protocol";
import { TimerSettings, timerLabel } from "./TimerSettings";
import { Chat } from "./Chat";
import { Symbol } from "./Symbol";
import { saveName, loadName } from "../App";
import { MIN_RADIUS, MAX_RADIUS, cellsAcross } from "../board";

export function Lobby({ match, onLeave }: { match: OnlineMatch; onLeave: () => void }) {
  useSyncExternalStore((cb) => match.onUpdate(cb), () => match.version());
  const lobby = match.lobby();
  const seat = match.mySeatIndex();
  const err = match.error();

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
    return <div className="menu"><div className="menu-card"><p className="finding"><span className="spinner" /> Finding a game…</p></div></div>;
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
      <LobbyHeader lobby={lobby} />

      <ul className="seat-grid">
        {lobby.seats.map((s, i) => (
          <SeatCard key={i} s={s} index={i} you={i === seat} />
        ))}
      </ul>

      <label className="namebox">
        <span className="namebox-label">Your name</span>
        <span className="namebox-field">
          <span className="namebox-pen" aria-hidden="true">✎</span>
          <input value={name} maxLength={24}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            placeholder="Your name" />
        </span>
      </label>

      {isHost ? <HostSettings match={match} lobby={lobby} />
        : <SettingsSummary lobby={lobby} />}

      {err && <p className="hint err">{err}</p>}

      {isHost ? (
        <button className="primary big start-btn" disabled={!allReady} onClick={() => match.start()}>
          {allReady ? "▶ Start game" : `Waiting for players… (${filled}/${humanSeats.length})`}
        </button>
      ) : (
        <p className="waiting-host"><span className="spinner" /> Waiting for the host to start…</p>
      )}

      <Chat match={match} />
      <div className="lobby-foot">
        <button className="ghost" onClick={() => match.leaveToBrowse()}>← Leave room</button>
        <button className="textlink" onClick={onLeave}>Main menu</button>
      </div>
    </div></div>
  );
}

// --- header: copyable room code + at-a-glance chips ---
function LobbyHeader({ lobby }: { lobby: LobbyState }) {
  const [copied, setCopied] = useState(false);
  const humans = lobby.seats.filter((s) => s.type === "human");
  const filled = humans.filter((s) => s.filled).length;
  function copy() {
    try {
      void navigator.clipboard?.writeText(lobby.roomId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch { /* ignore */ }
  }
  return (
    <div className="lobby-head">
      <div className="lobby-head-top">
        <span className="lobby-eyebrow">Game room</span>
        <button className="code-pill" onClick={copy} title="Copy room code">
          <span className="code-pill-code">{lobby.roomId}</span>
          <span className="code-pill-copy">{copied ? "✓ copied" : "⧉ copy"}</span>
        </button>
      </div>
      <div className="lobby-chips">
        <span className="chip"><span className="chip-ic">👥</span>{filled}/{humans.length} players</span>
        <span className="chip"><span className="chip-ic">⏱</span>{timerLabel(lobby.timer)}</span>
        <span className="chip"><span className="chip-ic">⬡</span>{cellsAcross(lobby.boardRadius || 5)}-hex board</span>
        {lobby.fillCpu && <span className="chip"><span className="chip-ic">🤖</span>CPU fill</span>}
      </div>
    </div>
  );
}

// --- a single seat as a graphical card with a gem avatar ---
function SeatCard({ s, index, you }: { s: LobbyState["seats"][number]; index: number; you: boolean }) {
  const color = index % 6;                  // seat color, tying into the gem palette
  const open = s.type === "human" && !s.filled;
  const cls = "seat-card" + (you ? " me" : "") + (open ? " open" : "") + (s.type === "cpu" ? " cpu" : "");
  return (
    <li className={cls}>
      <span className="seat-avatar" style={open ? undefined : { borderColor: `var(--seat-${color})` }}>
        {s.type === "cpu"
          ? <span className="seat-bot">🤖</span>
          : open
            ? <span className="seat-q">?</span>
            : <svg viewBox="-13 -13 26 26" width="28" height="28"><Symbol color={color} size={11} /></svg>}
      </span>
      <span className="seat-info">
        <span className="seat-name">
          {s.type === "cpu" ? "Computer" : open ? <em>Open seat</em> : s.name}
        </span>
        <span className="seat-tags">
          <span className="seat-num">Seat {index + 1}</span>
          {s.isHost && <span className="seat-tag host">👑 host</span>}
          {you && <span className="seat-tag you">you</span>}
        </span>
      </span>
      <span className={"seat-status" + (open ? " pending" : " ready")} title={open ? "Waiting…" : "Ready"} />
    </li>
  );
}

// --- read-only settings summary for non-host players ---
function SettingsSummary({ lobby }: { lobby: LobbyState }) {
  return (
    <div className="settings-summary">
      <span className="ss-row"><span className="ss-ic">⏱</span><span className="ss-lab">Timer</span><span className="ss-val">{timerLabel(lobby.timer)}</span></span>
      <span className="ss-row"><span className="ss-ic">⬡</span><span className="ss-lab">Board</span><span className="ss-val">{cellsAcross(lobby.boardRadius || 5)} hexes</span></span>
    </div>
  );
}

// --- host-only controls to change the game type in the lobby ---
function HostSettings({ match, lobby }: { match: OnlineMatch; lobby: LobbyState }) {
  const radius = lobby.boardRadius || 5;
  return (
    <div className="host-settings">
      <h3><span className="hs-ic">⚙️</span> Game settings</h3>

      <div className="hs-row">
        <span className="hs-label"><span className="hs-ic">👥</span> Players</span>
        <div className="seg pill-seg">
          {[2, 3, 4].map((n) => (
            <button key={n} className={lobby.numPlayers === n ? "on" : ""} aria-pressed={lobby.numPlayers === n}
              onClick={() => match.configure({ numPlayers: n })}>{n}</button>
          ))}
        </div>
      </div>

      <div className="hs-row">
        <span className="hs-label"><span className="hs-ic">🤖</span> Fill empty seats with CPU</span>
        <button role="switch" aria-checked={lobby.fillCpu}
          className={"toggle" + (lobby.fillCpu ? " on" : "")}
          onClick={() => match.configure({ fillCpu: !lobby.fillCpu })}>
          <span className="toggle-knob" />
        </button>
      </div>

      <div className="hs-row col">
        <span className="hs-label"><span className="hs-ic">⏱</span> Timer</span>
        <TimerSettings value={lobby.timer} onChange={(t) => match.configure({ timer: t })} />
      </div>

      <div className="hs-row">
        <span className="hs-label"><span className="hs-ic">⬡</span> Board size</span>
        <div className="stepper">
          <button onClick={() => match.configure({ boardRadius: Math.max(MIN_RADIUS, radius - 1) })} disabled={radius <= MIN_RADIUS}>−</button>
          <span className="stepper-val">{cellsAcross(radius)} hexes</span>
          <button onClick={() => match.configure({ boardRadius: Math.min(MAX_RADIUS, radius + 1) })} disabled={radius >= MAX_RADIUS}>+</button>
        </div>
      </div>
    </div>
  );
}
