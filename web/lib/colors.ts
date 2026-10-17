import type { Quadrant } from "./types";

type RGB = [number, number, number];

// Diverging scale around 100% attainment (red = below, green = above).
const STOPS: [number, RGB][] = [
  [84, [165, 15, 21]],
  [90, [222, 45, 38]],
  [95, [251, 146, 114]],
  [99, [254, 224, 210]],
  [101, [217, 240, 211]],
  [105, [116, 196, 118]],
  [112, [0, 109, 44]],
];

export function attainmentColor(v: number, alpha = 210): [number, number, number, number] {
  if (v <= STOPS[0][0]) return [...STOPS[0][1], alpha];
  for (let i = 1; i < STOPS.length; i++) {
    const [x1, c1] = STOPS[i];
    const [x0, c0] = STOPS[i - 1];
    if (v <= x1) {
      const t = (v - x0) / (x1 - x0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + t * (c1[k] - c0[k]))).concat(alpha) as [number, number, number, number];
    }
  }
  return [...STOPS[STOPS.length - 1][1], alpha];
}

export function attainmentCss(v: number): string {
  const [r, g, b] = attainmentColor(v);
  return `rgb(${r},${g},${b})`;
}

export const QUADRANTS: Record<Quadrant, { color: RGB; label: string; action: string }> = {
  performing_staffed: { color: [26, 152, 80], label: "On track, fully staffed", action: "Recognise" },
  performing_understaffed: { color: [33, 102, 172], label: "On track but short-staffed", action: "Recognise + backfill" },
  missing_staffed: { color: [224, 130, 20], label: "Off track, fully staffed", action: "Coaching" },
  missing_understaffed: { color: [118, 42, 131], label: "Off track & short-staffed", action: "Backfill first" },
};

export function quadrantOf(adj: number, capacity: number): Quadrant {
  return `${adj >= 97 ? "performing" : "missing"}_${capacity >= 0.9 ? "staffed" : "understaffed"}` as Quadrant;
}

export function quadrantColor(q: Quadrant, alpha = 210): [number, number, number, number] {
  return [...QUADRANTS[q].color, alpha];
}

export const LEGEND_STEPS = [85, 90, 95, 100, 105, 110];
