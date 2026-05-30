// The six glossy gem symbols, one per color, drawn centered at (0,0).
import { PALETTE } from "../hex";

function starPoints(n: number, outer: number, inner: number, rot = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 180) * (rot + (180 / n) * i);
    pts.push(`${(rad * Math.cos(a)).toFixed(2)},${(rad * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function hexPath(rad: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push(`${(rad * Math.cos(a)).toFixed(2)},${(rad * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

export function Symbol({ color, size = 13 }: { color: number; size?: number }) {
  const p = PALETTE[color];
  const stroke = p.dark;
  const fill = p.base;
  switch (color) {
    case 0: // red — 12-spike sun/burst
      return (
        <g>
          <polygon points={starPoints(12, size, size * 0.55)} fill={fill} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
          <circle r={size * 0.42} fill={p.light} opacity={0.55} />
          <circle r={size * 0.42} fill="none" stroke={stroke} strokeWidth={1} />
        </g>
      );
    case 1: // orange — filled hexagon gem
      return (
        <g>
          <polygon points={hexPath(size * 0.95)} fill={fill} stroke={stroke} strokeWidth={1.2} strokeLinejoin="round" />
          <polygon points={hexPath(size * 0.5)} fill={p.light} opacity={0.5} />
        </g>
      );
    case 2: // yellow — 6-petal flower
      return (
        <g>
          {Array.from({ length: 6 }).map((_, i) => {
            const a = (Math.PI / 180) * (60 * i - 90);
            return (
              <circle key={i} cx={Math.cos(a) * size * 0.55} cy={Math.sin(a) * size * 0.55}
                r={size * 0.42} fill={fill} stroke={stroke} strokeWidth={0.9} />
            );
          })}
          <circle r={size * 0.42} fill={p.light} stroke={stroke} strokeWidth={0.9} />
        </g>
      );
    case 3: // green — hexagon ring (outline)
      return (
        <g fill="none" stroke={fill} strokeWidth={size * 0.34} strokeLinejoin="round">
          <polygon points={hexPath(size * 0.82)} />
          <polygon points={hexPath(size * 0.82)} stroke={p.light} strokeWidth={size * 0.12} opacity={0.7} />
        </g>
      );
    case 4: // blue — sharp 6-point star
      return (
        <g>
          <polygon points={starPoints(6, size, size * 0.4)} fill={fill} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
          <polygon points={starPoints(6, size * 0.55, size * 0.22)} fill={p.light} opacity={0.7} />
        </g>
      );
    case 5: // purple — ring
      return (
        <g fill="none">
          <circle r={size * 0.74} stroke={fill} strokeWidth={size * 0.36} />
          <circle r={size * 0.74} stroke={p.light} strokeWidth={size * 0.12} opacity={0.7} />
        </g>
      );
    default:
      return null;
  }
}
