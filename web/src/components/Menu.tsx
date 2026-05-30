import { useState } from "react";
import type { PlayerInfo } from "../match/types";
import { MIN_RADIUS, MAX_RADIUS, STANDARD_RADIUS, cellsAcross } from "../board";

interface Props {
  onStartLocal: (players: PlayerInfo[], boardRadius: number) => void;
  onPlayOnline: () => void;
}

// Online needs the realtime server, which isn't present on the static (Pages)
// build — enable it with VITE_ONLINE=1 when self-hosting the server.
const ONLINE_ENABLED = import.meta.env.VITE_ONLINE === "1";

export function Menu({ onStartLocal, onPlayOnline }: Props) {
  const [mode, setMode] = useState<"home" | "cpu" | "local">("home");

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
            {ONLINE_ENABLED && (
              <button className="bigchoice" onClick={onPlayOnline}>
                <span className="bc-emoji">🌐</span><span className="bc-label">Play Online</span>
              </button>
            )}
            <button className="textlink" onClick={() => onStartLocal([{ name: "You", type: "human" }], STANDARD_RADIUS)}>
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
        <button key={n} className={value === n ? "on" : ""} onClick={() => onChange(n)}>{n}</button>
      ))}
    </div>
  );
}

function VsCpu({ onStart, onBack }: { onStart: (p: PlayerInfo[], r: number) => void; onBack: () => void }) {
  const [opponents, setOpponents] = useState(1);
  const [ai, setAi] = useState(1);
  const [radius, setRadius] = useState(STANDARD_RADIUS);
  function start() {
    const players: PlayerInfo[] = [{ name: "You", type: "human" }];
    for (let i = 1; i <= opponents; i++) players.push({ name: `CPU ${i}`, type: "cpu", aiLevel: ai });
    onStart(players, radius);
  }
  return (
    <div className="setup">
      <button className="textlink back" onClick={onBack}>← back</button>
      <label className="field"><span>Opponents</span><Seg value={opponents} options={[1, 2, 3]} onChange={setOpponents} /></label>
      <label className="field"><span>Difficulty</span>
        <div className="seg">
          <button className={ai === 0 ? "on" : ""} onClick={() => setAi(0)}>Easy</button>
          <button className={ai === 1 ? "on" : ""} onClick={() => setAi(1)}>Normal</button>
        </div>
      </label>
      <BoardSizeAdvanced radius={radius} setRadius={setRadius} />
      <button className="primary big" onClick={start}>Start game</button>
    </div>
  );
}

function PassPlay({ onStart, onBack }: { onStart: (p: PlayerInfo[], r: number) => void; onBack: () => void }) {
  const [count, setCount] = useState(2);
  const [radius, setRadius] = useState(STANDARD_RADIUS);
  function start() {
    const players: PlayerInfo[] = [];
    for (let i = 1; i <= count; i++) players.push({ name: `Player ${i}`, type: "human" });
    onStart(players, radius);
  }
  return (
    <div className="setup">
      <button className="textlink back" onClick={onBack}>← back</button>
      <p className="hint">Take turns on one device — each player's rack is shown only on their turn.</p>
      <label className="field"><span>Players</span><Seg value={count} options={[2, 3, 4]} onChange={setCount} /></label>
      <BoardSizeAdvanced radius={radius} setRadius={setRadius} />
      <button className="primary big" onClick={start}>Start game</button>
    </div>
  );
}
