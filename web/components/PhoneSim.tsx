"use client";

import { useEffect, useRef, useState } from "react";
import { hhmm } from "@/lib/format";
import { peopleIndex } from "@/lib/proactive";
import { useStore } from "@/lib/store";

/** Simulated Telegram chat on the persona's phone: where the proactive agent reaches people. */
export default function PhoneSim() {
  const { s, d } = useStore();
  const [open, setOpen] = useState(true);
  const msgs = s.phone.filter((p) => p.to === s.persona);
  const end = useRef<HTMLDivElement>(null);
  const name = s.m ? peopleIndex(s.m)[s.persona]?.name : "";
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);
  // Chat open: Telegram sits to the left of the panel. Chat collapsed: the Telegram pill sits right next to the
  // "Chat agent" button (side by side), and the phone window opens above that row.
  const pill = s.chatOpen ? { right: 424, bottom: 28 } : { right: 168, bottom: 28 };
  const phone = s.chatOpen ? { right: 424, bottom: 28 } : { right: 12, bottom: 84 };
  const unread = msgs.filter((p) => p.buttons && !p.done).length;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={pill} className="absolute z-20 rounded-full bg-[#229ED9] px-4 py-2 text-xs font-semibold text-white shadow-lg">
        📱 Telegram {unread > 0 && <span className="ml-1 rounded-full bg-white px-1.5 text-[#229ED9]">{unread}</span>}
      </button>
    );
  }
  return (
    <div style={phone} className="absolute z-20 flex h-[440px] w-[300px] flex-col overflow-hidden rounded-[22px] border-4 border-slate-800 bg-[#e6ebee] shadow-2xl">
      <div className="flex items-center justify-between bg-[#229ED9] px-3 py-2 text-white">
        <div className="leading-tight">
          <div className="text-xs font-semibold">Overfit Agent Bot</div>
          <div className="text-[10px] opacity-90">{name}’s phone · simulated</div>
        </div>
        <button onClick={() => setOpen(false)} className="text-xs opacity-80 hover:opacity-100" aria-label="Close">✕</button>
      </div>
      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto p-2">
        {msgs.length === 0 && (
          <p className="mt-16 px-4 text-center text-[11px] text-slate-500">No messages yet. Click “07:00 digest” or “Inject event” above.</p>
        )}
        {msgs.map((p) => (
          <div key={p.id} className={`rounded-xl bg-white p-2 text-[11.5px] shadow-sm ${p.tier === "P1" ? "border-l-4 border-red-500" : ""}`}>
            <div className="whitespace-pre-line">{p.text}</div>
            {p.buttons && (
              <div className="mt-2 flex flex-wrap gap-1">
                {p.buttons.map((b) => (
                  <button
                    key={b.label}
                    disabled={p.done}
                    onClick={() => d({ type: "PHONE", msgId: p.id, action: b.action })}
                    className="rounded-md bg-[#e8f4fb] px-2 py-1 text-[11px] font-medium text-[#1a7fb3] hover:bg-[#d6ecf8] disabled:opacity-40"
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-1 text-right text-[9.5px] text-slate-400">{hhmm(p.time)}{p.done ? " · ✓" : ""}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
