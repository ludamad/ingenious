// Dependency-free confetti burst for the win screen. Renders a fixed full-screen
// layer of colored gem-shards that fall, drift and spin via CSS, using the game
// palette so it feels native. Purely decorative (pointer-events: none).
import { useMemo } from "react";
import { PALETTE } from "../hex";

export function Confetti({ count = 90 }: { count?: number }) {
  // Build the pieces once — positions/colors are stable for the burst's life.
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const color = PALETTE[i % PALETTE.length].base;
        const left = Math.round((i * 9301 + 49297) % 100);      // spread across width
        const delay = ((i * 37) % 1000) / 1000;                  // 0–1s stagger
        const dur = 2.6 + ((i * 53) % 1800) / 1000;              // 2.6–4.4s fall
        const drift = (((i * 71) % 120) - 60).toString();        // -60..60 px sideways
        const size = 7 + (i % 4) * 3;                            // 7–16 px
        const round = i % 3 === 0;                                // mix shapes
        return { color, left, delay, dur, drift, size, round, i };
      }),
    [count],
  );

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.5,
            background: p.color,
            borderRadius: p.round ? "50%" : "1px",
            // custom props consumed by the keyframes in styles.css
            ["--drift" as string]: `${p.drift}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
          }}
        />
      ))}
    </div>
  );
}
