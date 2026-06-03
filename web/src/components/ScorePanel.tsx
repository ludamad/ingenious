// Per-player scoreboard: six color counters (0..cap), each shown as a row of
// holes with a colored peg that slides as the score advances — like the
// physical Ingenious score board. The lowest counter is the player's running
// result, so it's highlighted.
import { PALETTE } from "../hex";
import { Symbol } from "./Symbol";
import { ClockBadge } from "./Clock";
import type { ClockState } from "../match/types";

interface Props {
  name: string;
  scores: number[];
  cap: number;
  active: boolean;
  isYou: boolean;
  result: number;
  cpu?: boolean;   // a CPU seat
  away?: boolean;  // a human who has dropped and is being auto-played
  clock?: ClockState; // present when a timer is active
  seat: number;       // this panel's seat index (for the clock)
}

export function ScorePanel({ name, scores, cap, active, isYou, result, cpu, away, clock, seat }: Props) {
  const lowest = Math.min(...scores);
  // render discrete holes for the standard 0..18 track; for the long solitaire
  // track (0..36) fall back to a smooth rail so it stays compact.
  const showHoles = cap <= 18;

  return (
    <div className={"score-panel" + (active ? " active" : "") + (away ? " away" : "")}>
      <div className="score-head">
        <span className="pname">
          {name}{cpu ? " 🤖" : ""}{isYou ? " (you)" : ""}
          {away && <span className="away-tag" title="Disconnected — auto-playing until they reconnect">💤 away</span>}
        </span>
        <span className="score-head-right">
          {clock && clock.mode !== "off" && <ClockBadge clock={clock} seat={seat} active={active} />}
          <span className="presult" title="Lowest counter = your result">{result}</span>
        </span>
      </div>
      <div className="tracks">
        {scores.map((v, c) => {
          const pct = (v / cap) * 100;
          const isLow = v === lowest;
          const maxed = v >= cap;
          return (
            <div className={"track" + (isLow ? " low" : "")} key={c}>
              <svg className="track-gem" width={20} height={20} viewBox="-11 -11 22 22">
                <Symbol color={c} size={9} />
              </svg>
              <div className="rail">
                {showHoles && (
                  <div className="holes">
                    {Array.from({ length: cap + 1 }).map((_, i) => (
                      <span key={i} className={"hole" + (i <= v ? " on" : "")}
                        style={i <= v ? { background: PALETTE[c].base } : undefined} />
                    ))}
                  </div>
                )}
                {/* the sliding peg */}
                <span className={"peg" + (maxed ? " maxed" : "")}
                  style={{ left: `${pct}%`, background: PALETTE[c].base, borderColor: PALETTE[c].dark }} />
                {maxed && <span className="ing">Ingenious!</span>}
              </div>
              <span className="val">{v}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
