// Live per-seat clock readouts. The running seat ticks down smoothly from the
// snapshot's `asOf` time, so the display stays correct without trusting the
// client and server clocks to agree (only elapsed time on the running seat).
import { useEffect, useState } from "react";
import type { ClockState } from "../match/types";

function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

// remaining time for a seat right now, ticking the running seat down from asOf
function liveMs(clock: ClockState, seat: number, nowMs: number): number {
  const base = clock.remainingMs[seat] ?? 0;
  if (clock.running === seat && !clock.flagged[seat]) {
    return Math.max(0, base - (nowMs - clock.asOf));
  }
  return base;
}

export function ClockBadge({ clock, seat, active }: { clock: ClockState; seat: number; active: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const isRunning = clock.running === seat && !clock.flagged[seat];
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [isRunning, clock.asOf]);

  const ms = liveMs(clock, seat, now);
  const low = ms <= 10_000 && isRunning;
  const cls = "clock-badge"
    + (active ? " running" : "")
    + (low ? " low" : "")
    + (clock.flagged[seat] ? " flagged" : "");
  return <span className={cls} title={clock.flagged[seat] ? "Out of time" : "Time left"}>
    {clock.flagged[seat] ? "⏱ 0:00" : `⏱ ${fmt(ms)}`}
  </span>;
}
