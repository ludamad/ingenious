// Reusable timer picker for the setup screens (local + online lobby).
// Off / Per-move / Chess (total + increment), mirroring chess-clock options.
import type { TimerConfig, TimerMode } from "../match/types";

const PERMOVE_OPTS = [10, 15, 30, 60];      // seconds per turn
const TOTAL_OPTS = [1, 3, 5, 10];           // minutes total
const INC_OPTS = [0, 2, 5, 10];             // seconds increment

export function TimerSettings({ value, onChange }: { value: TimerConfig; onChange: (c: TimerConfig) => void }) {
  const mode = value.mode;
  function setMode(m: TimerMode) {
    if (m === "off") onChange({ mode: "off" });
    else if (m === "perMove") onChange({ mode: "perMove", perMoveSec: value.perMoveSec ?? 30 });
    else onChange({ mode: "chess", totalSec: value.totalSec ?? 300, incrementSec: value.incrementSec ?? 5 });
  }

  return (
    <div className="timer-settings">
      <label className="field"><span>Timer</span>
        <div className="seg">
          <button className={mode === "off" ? "on" : ""} onClick={() => setMode("off")}>Off</button>
          <button className={mode === "perMove" ? "on" : ""} onClick={() => setMode("perMove")}>Per move</button>
          <button className={mode === "chess" ? "on" : ""} onClick={() => setMode("chess")}>Chess</button>
        </div>
      </label>

      {mode === "perMove" && (
        <label className="field"><span>Seconds / turn</span>
          <div className="seg">
            {PERMOVE_OPTS.map((s) => (
              <button key={s} className={value.perMoveSec === s ? "on" : ""}
                onClick={() => onChange({ mode: "perMove", perMoveSec: s })}>{s}s</button>
            ))}
          </div>
        </label>
      )}

      {mode === "chess" && (
        <>
          <label className="field"><span>Total / player</span>
            <div className="seg">
              {TOTAL_OPTS.map((m) => (
                <button key={m} className={value.totalSec === m * 60 ? "on" : ""}
                  onClick={() => onChange({ ...value, mode: "chess", totalSec: m * 60 })}>{m}m</button>
              ))}
            </div>
          </label>
          <label className="field"><span>Increment</span>
            <div className="seg">
              {INC_OPTS.map((s) => (
                <button key={s} className={(value.incrementSec ?? 0) === s ? "on" : ""}
                  onClick={() => onChange({ ...value, mode: "chess", incrementSec: s })}>+{s}s</button>
              ))}
            </div>
          </label>
        </>
      )}
    </div>
  );
}

// Short human label, e.g. "5m+5s" or "30s/move".
export function timerLabel(c: TimerConfig): string {
  if (c.mode === "off") return "No timer";
  if (c.mode === "perMove") return `${c.perMoveSec ?? 30}s/move`;
  return `${Math.round((c.totalSec ?? 300) / 60)}m+${c.incrementSec ?? 0}s`;
}
