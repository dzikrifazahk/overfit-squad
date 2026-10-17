"use client";

import { useState } from "react";
import { QUADRANTS, attainmentCss } from "@/lib/colors";
import { useStore } from "@/lib/store";
import type { Quadrant } from "@/lib/types";

const STEPS = [
  { v: 85, label: "≤85%", name: "Critical", note: "far below" },
  { v: 90, label: "90%", name: "Well below", note: "well below" },
  { v: 95, label: "95%", name: "Slightly below", note: "slightly below" },
  { v: 100, label: "100%", name: "On target", note: "right on" },
  { v: 105, label: "105%", name: "Above", note: "above" },
  { v: 110, label: "≥110%", name: "Far above", note: "far above" },
];

const QUADRANT_TIPS: Record<Quadrant, string> = {
  performing_staffed: "Adjusted attainment ≥97% and at least 90% of positions filled. Recognise the team and share their practices.",
  performing_understaffed: "On track despite open positions. Recognise the team and backfill before the workload becomes a problem.",
  missing_staffed: "Below 97% adjusted with a full team, so this is a coaching issue: look at drivers such as active outlets or stock.",
  missing_understaffed: "Below 97% adjusted and short-staffed. Backfill first; coaching alone will not close the gap.",
};

/** Map legend. Hover (or focus) any item to see what it means. */
export default function MapControls() {
  const { s } = useStore();
  const [tip, setTip] = useState<string | null>(null);
  const sel = s.selection;
  const prov = sel.kode?.split(".")[0];
  const raw = s.layer === "raw";
  const ref = raw ? "the target" : "the revenue expected from the territory’s potential";

  const hover = (text: string) => ({
    tabIndex: 0,
    onMouseEnter: () => setTip(text),
    onMouseLeave: () => setTip(null),
    onFocus: () => setTip(text),
    onBlur: () => setTip(null),
  });

  return (
    <div className={`absolute bottom-7 z-20 max-w-[380px] rounded-2xl bg-white/95 p-3 text-[11px] shadow-lg ring-1 ring-line backdrop-blur ${s.tab === "map" ? "left-3" : "left-[584px]"}`}>
      {tip && (
        <div role="tooltip" className="pointer-events-none absolute bottom-full left-0 right-0 mb-2 rounded-xl bg-ink px-3 py-2 text-xs leading-snug text-white shadow-lg">
          {tip}
        </div>
      )}

      {s.layer === "bivariate" ? (
        <div className="space-y-1">
          <div
            className="mb-1.5 cursor-help font-semibold underline decoration-dotted decoration-slate-300 underline-offset-2"
            {...hover("Each territory is coloured by two things at once: adjusted attainment (≥97% or not) and team capacity (≥90% of planned positions filled).")}
          >
            Performance × Capacity
          </div>
          {(Object.keys(QUADRANTS) as Quadrant[]).map((q) => (
            <div key={q} className="flex cursor-help items-center gap-2 rounded px-0.5 hover:bg-slate-50" {...hover(QUADRANT_TIPS[q])}>
              <span className="h-3 w-3 rounded-sm" style={{ background: `rgb(${QUADRANTS[q].color.join(",")})` }} />
              <span>{QUADRANTS[q].label}</span>
              <span className="text-muted">→ {QUADRANTS[q].action}</span>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div
            className="mb-1.5 cursor-help font-semibold underline decoration-dotted decoration-slate-300 underline-offset-2"
            {...hover(raw
              ? "Raw attainment = actual revenue ÷ target. It compares what was sold with the plan, regardless of how hard the territory is."
              : "Adjusted attainment = (actual revenue + estimated loss from non-controllable events) ÷ revenue expected from the territory’s potential. Fairer for areas hit by outages or given unrealistic targets.")}
          >
            {raw ? "Raw attainment (actual / target)" : "Adjusted attainment (vs expected from potential)"}
          </div>
          <div className="flex items-start gap-0.5">
            {STEPS.map((st) => (
              <div key={st.v} className="w-[52px] cursor-help text-center" {...hover(`${st.label} of ${ref} — ${st.name}. ${st.v < 100 ? "Red means the territory is behind." : st.v > 100 ? "Green means the territory is ahead." : "Pale means it is on plan."}`)}>
                <div className="h-2.5 rounded-[2px]" style={{ background: attainmentCss(st.v) }} />
                <div className="mt-0.5 tabular-nums text-muted">{st.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {prov && prov !== "32" && sel.level !== "province" && <div className="mt-1.5 text-muted">Village-level detail is only available for the demo province, West Java.</div>}
    </div>
  );
}
