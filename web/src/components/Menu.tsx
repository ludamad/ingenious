import { useState, useEffect } from "react";
import type { PlayerInfo, TimerConfig } from "../match/types";
import { DEFAULT_TIMER } from "../match/types";
import { MIN_RADIUS, MAX_RADIUS, STANDARD_RADIUS, cellsAcross } from "../board";
import { pingServer } from "../net/server";
import { TimerSettings } from "./TimerSettings";

interface Props {
  onStartLocal: (players: PlayerInfo[], boardRadius: number, timer: TimerConfig) => void;
  onPlayOnline: () => void;
}

type ServerStatus = "checking" | "online" | "offline";

// Online play needs the realtime server. Probe it live (every 15s) so the menu
// reflects whether a server is actually reachable, rather than a build flag.
function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>("checking");
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const check = async () => {
      const ok = await pingServer(ctrl.signal);
      if (!cancelled) setStatus(ok ? "online" : "offline");
    };
    check();
    const id = window.setInterval(check, 15000);
    return () => { cancelled = true; ctrl.abort(); window.clearInterval(id); };
  }, []);
  return status;
}

export function Menu({ onStartLocal, onPlayOnline }: Props) {
  const [mode, setMode] = useState<"home" | "cpu" | "local">("home");
  const server = useServerStatus();

  return (
    <div className="menu">
      <div className="menu-card">
        <h1 className="logo">Ingenious</h1>
        <p className="tagline">A Reiner Knizia classic · 1–4 players</p>
        {mode === "home" && (
          <div className="home">
            <button className="bigchoice" onClick={() => setMode("cpu")}>
              <span className="bc-emoji">🤖</span><span className="bc-label">Play vs Computer</span>
            </button>
            <button className="bigchoice" onClick={() => setMode("local")}>
              <span className="bc-emoji">👥</span><span className="bc-label">Pass &amp; Play</span>
            </button>
            <button className="bigchoice" onClick={onPlayOnline} disabled={server !== "online"}>
              <span className="bc-emoji">🌐</span><span className="bc-label">Play Online</span>
            </button>
            <p className={`server-status ${server}`}>
              <span className="dot" />
              {server === "checking"
                ? "Checking for server…"
                : server === "online"
                  ? "Server connected"
                  : "Server offline — online play unavailable"}
            </p>
            <button className="textlink" onClick={() => onStartLocal([{ name: "You", type: "human" }], STANDARD_RADIUS, DEFAULT_TIMER)}>
              or play a solitaire challenge →
            </button>
          </div>
        )}
        {mode === "cpu" && <VsCpu onStart={onStartLocal} onBack={() => setMode("home")} />}
        {mode === "local" && <PassPlay onStart={onStartLocal} onBack={() => setMode("home")} />}
      </div>
    </div>
  );
}

function BoardSizeAdvanced({ radius, setRadius, children }:
  { radius: number; setRadius: (r: number) => void; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const label = radius === STANDARD_RADIUS ? "standard" : radius > STANDARD_RADIUS ? `+${radius - STANDARD_RADIUS}` : `${radius - STANDARD_RADIUS}`;
  return (
    <div className="advanced">
      <button className="adv-toggle" onClick={() => setOpen((o) => !o)}>{open ? "▾" : "▸"} Options</button>
      {open && (
        <div className="adv-body">
          {children}
          <label className="field">
            <span>Board size</span>
            <div className="stepper">
              <button onClick={() => setRadius(Math.max(MIN_RADIUS, radius - 1))} disabled={radius <= MIN_RADIUS}>−</button>
              <span className="stepper-val">{cellsAcross(radius)} hexes <em>({label})</em></span>
              <button onClick={() => setRadius(Math.min(MAX_RADIUS, radius + 1))} disabled={radius >= MAX_RADIUS}>+</button>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}

function Seg({ value, options, onChange }: { value: number; options: number[]; onChange: (n: number) => void }) {
  return (
    <div className="seg">
      {options.map((n) => (
        <button key={n} className={value === n ? "on" : ""} aria-pressed={value === n} onClick={() => onChange(n)}>{n}</button>
      ))}
    </div>
  );
}

function VsCpu({ onStart, onBack }: { onStart: (p: PlayerInfo[], r: number, t: TimerConfig) => void; onBack: () => void }) {
  const [opponents, setOpponents] = useState(1);
  const [ai, setAi] = useState(1);
  const [radius, setRadius] = useState(STANDARD_RADIUS);
  const [timer, setTimer] = useState<TimerConfig>(DEFAULT_TIMER);
  function start() {
    const players: PlayerInfo[] = [{ name: "You", type: "human" }];
    for (let i = 1; i <= opponents; i++) players.push({ name: `CPU ${i}`, type: "cpu", aiLevel: ai });
    onStart(players, radius, timer);
  }
  return (
    <div className="setup">
      <button className="textlink back" onClick={onBack}>← Back</button>
      <label className="field"><span>Opponents</span><Seg value={opponents} options={[1, 2, 3]} onChange={setOpponents} /></label>
      <label className="field"><span>Difficulty</span>
        <div className="seg">
          <button className={ai === 0 ? "on" : ""} aria-pressed={ai === 0} onClick={() => setAi(0)}>Easy</button>
          <button className={ai === 1 ? "on" : ""} aria-pressed={ai === 1} onClick={() => setAi(1)}>Normal</button>
        </div>
      </label>
      <TimerSettings value={timer} onChange={setTimer} />
      <BoardSizeAdvanced radius={radius} setRadius={setRadius} />
      <button className="primary big" onClick={start}>Start game</button>
    </div>
  );
}

function PassPlay({ onStart, onBack }: { onStart: (p: PlayerInfo[], r: number, t: TimerConfig) => void; onBack: () => void }) {
  const [count, setCount] = useState(2);
  const [radius, setRadius] = useState(STANDARD_RADIUS);
  const [timer, setTimer] = useState<TimerConfig>(DEFAULT_TIMER);
  function start() {
    const players: PlayerInfo[] = [];
    for (let i = 1; i <= count; i++) players.push({ name: `Player ${i}`, type: "human" });
    onStart(players, radius, timer);
  }
  return (
    <div className="setup">
      <button className="textlink back" onClick={onBack}>← Back</button>
      <p className="hint">Take turns on one device — each player's rack is shown only on their turn.</p>
      <label className="field"><span>Players</span><Seg value={count} options={[2, 3, 4]} onChange={setCount} /></label>
      <TimerSettings value={timer} onChange={setTimer} />
      <BoardSizeAdvanced radius={radius} setRadius={setRadius} />
      <button className="primary big" onClick={start}>Start game</button>
    </div>
  );
}
