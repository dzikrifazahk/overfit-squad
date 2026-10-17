"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { askAgent } from "@/lib/chat";
import { shortName } from "@/lib/format";
import { placeInText } from "@/lib/places";
import { peopleIndex } from "@/lib/proactive";
import { useStore } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";

const DEFAULT_TOPIC = "Garut"; // demo cluster used for suggestions when the map shows the whole country

function Icon({ d, size = 18, stroke = 1.6 }: { d: string | string[]; size?: number; stroke?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(Array.isArray(d) ? d : [d]).map((p) => <path key={p} d={p} />)}
    </svg>
  );
}
const ICONS = {
  sparkle: ["M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z", "M15.5 13.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"],
  pin: ["M10 17s5.5-4.7 5.5-9A5.5 5.5 0 0 0 4.5 8c0 4.3 5.5 9 5.5 9z", "M10 9.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z"],
  trend: ["M3 16h14", "M5 13V9", "M9 13V6", "M13 13V8", "M16.5 5.5l-3 3-2-2L7 11"],
  person: ["M10 10a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z", "M3.8 16.5c.6-3 3-4.6 6.2-4.6s5.6 1.6 6.2 4.6"],
  people: ["M7.5 9.5a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z", "M2.5 16c.4-2.7 2.4-4.2 5-4.2s4.6 1.5 5 4.2", "M13 4.3a2.6 2.6 0 0 1 0 5.2", "M14.5 12c1.6.5 2.7 1.8 3 4"],
  tasks: ["M3.5 5.5l1.4 1.4L7 4.5", "M3.5 11l1.4 1.4L7 10", "M10 6h6.5", "M10 11.5h6.5", "M3.5 16.2h13"],
  book: ["M10 5.5C8.6 4.5 6.5 4 4 4v10.5c2.5 0 4.6.5 6 1.5 1.4-1 3.5-1.5 6-1.5V4c-2.5 0-4.6.5-6 1.5z", "M10 5.5V16"],
  up: ["M10 16V4.5", "M5 9.5l5-5 5 5"],
  minus: ["M5 10h10"],
  chevron: ["M5.5 8l4.5 4.5L14.5 8"],
};

/** Small markdown subset: **bold**, *italic*, `code`, and "* " / "- " bullets. Tolerates half-typed markers while streaming. */
function Rich({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.replace(/^(\s*)[*-]\s+/, "$1• "));
  return (
    <>
      {lines.map((line, li) => (
        <Fragment key={li}>
          {li > 0 && "\n"}
          {line.split("**").map((seg, i) =>
            i % 2 === 1 ? (
              <strong key={i}>{seg}</strong>
            ) : (
              <Fragment key={i}>
                {seg.split(/(\*[^*\n]+\*|`[^`\n]+`)/g).map((p, k) =>
                  p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <em key={k}>{p.slice(1, -1)}</em>
                    : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={k} className="rounded bg-slate-100 px-1 text-[11.5px]">{p.slice(1, -1)}</code>
                    : <Fragment key={k}>{p}</Fragment>,
                )}
              </Fragment>
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}

/** Reveals `text` progressively (typing effect). Catches up faster the larger the backlog, so streaming never lags far behind. */
function useTypewriter(text: string, live: boolean): number {
  const [shown, setShown] = useState(live ? 0 : text.length);
  const shownRef = useRef(shown);
  const textRef = useRef(text);
  const liveRef = useRef(live);
  textRef.current = text;
  liveRef.current = live;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const len = textRef.current.length;
      const cur = Math.min(shownRef.current, len);
      if (cur < len) {
        const backlog = len - cur;
        const step = Math.max(1, Math.ceil(backlog / (liveRef.current ? 14 : 5)));
        shownRef.current = cur + step;
        setShown(shownRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return Math.min(shown, text.length);
}

function AgentMessage({ c }: { c: ChatMessage }) {
  const shown = useTypewriter(c.text, !!c.streaming);
  const typing = !!c.streaming || shown < c.text.length;
  const blocked = c.meta?.includes("blocked");
  return (
    <div className={`max-w-[94%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${blocked ? "border border-amber-300 bg-amber-50" : "bg-slate-50"}`}>
      {shown === 0 && c.streaming ? (
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className="flex gap-0.5" aria-hidden="true">
            {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand/70" style={{ animationDelay: `${i * 120}ms` }} />)}
          </span>
          {c.status ?? "Thinking…"}
        </span>
      ) : (
        <>
          <Rich text={c.text.slice(0, shown)} />
          {typing && <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-brand" aria-hidden="true" />}
          {c.streaming && c.status && shown > 0 && <div className="mt-1.5 text-[10.5px] text-muted">{c.status}</div>}
        </>
      )}
      {!typing && (c.citations?.length || c.meta) && (
        <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-muted">
          {c.citations?.map((x) => <span key={x} className="rounded bg-white px-1.5 py-0.5 ring-1 ring-line">📄 {x}</span>)}
          {c.meta && <span className="py-0.5">{c.meta}</span>}
        </div>
      )}
    </div>
  );
}

export default function ChatPanel() {
  const { s, d } = useStore();
  const m = s.m!;
  const [input, setInput] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const me = peopleIndex(m)[s.persona];

  // Place shown in the context bar, and the topic used for suggested questions.
  const sel = s.selection;
  const regKode = sel.kode && sel.level !== "province" ? sel.kode.split(".").slice(0, 2).join(".") : null;
  const place =
    sel.level === "national" ? "Indonesia"
    : sel.level === "province" ? m.provinces[sel.kode!]?.name ?? "Province"
    : sel.level === "desa" ? `Village ${s.desa.find((x) => x.kode === sel.kode)?.name ?? ""}`.trim()
    : shortName(m.regencies[regKode!]?.name ?? "");
  const topic = sel.level === "national" ? DEFAULT_TOPIC : sel.level === "desa" || sel.level === "regency" ? shortName(m.regencies[regKode!]?.name ?? DEFAULT_TOPIC) : place;

  const starters = [
    { icon: ICONS.trend, label: `Trace the performance gap of ${topic}`, ask: `Why is ${topic} behind target?` },
    { icon: ICONS.person, label: `See who owns ${topic} revenue`, ask: `Who owns revenue in ${topic}?` },
    { icon: ICONS.people, label: "Understand team condition", ask: `How is the ${topic} team doing?` },
    { icon: ICONS.tasks, label: "Draft an action plan", ask: `Draft an action plan for ${topic}` },
  ];
  const more = [
    `Who is doing well and could be an example for ${topic}?`,
    "Show the quadrant map",
    "Show the adjusted map",
    "What is the escalation SOP?",
    "Why is Cianjur red?",
    "Rank the 10 worst employees",
  ];

  const last = s.chat[s.chat.length - 1];
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (s.chat.length === 0) el.scrollTop = 0; // empty state: always show the greeting from the top
    else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [s.chat.length, last?.text, last?.status]);

  function send(text: string) {
    const q = text.trim();
    if (!q || s.chatBusy) return;
    setInput("");
    setShowGuide(false);
    stick.current = true;
    // Start flying to a territory named in the question right away, instead of waiting for the agent's answer.
    const place = s.m ? placeInText(s.m, q) : null;
    if (place) d({ type: "SELECT", selection: place });
    void askAgent(s, d, q);
  }

  const dot = s.agentSource === "mock" ? "bg-amber-500" : "bg-emerald-500";
  const subtitle = s.agentSource === "mock" ? "Prototype mode · mock agent" : "Territory analysis assistant";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Icon d={ICONS.sparkle} size={22} /></div>
        <div className="min-w-0 flex-1 leading-tight">
          <h2 className="text-[15px] font-bold tracking-tight">Overfit Agent</h2>
          <p className="flex items-center gap-1.5 text-xs text-muted" title={s.agentSource === "mock" ? "AGENT_URL is not set; answers come from a rule-based mock." : "Connected to the ADK + Gemini (Vertex AI) agent; numbers come from BigQuery through tools."}>
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{subtitle}
          </p>
        </div>
        <button onClick={() => d({ type: "CHAT_OPEN", open: false })} className="rounded-lg p-1.5 text-muted hover:bg-slate-100 hover:text-ink" aria-label="Minimise chat agent" title="Minimise">
          <Icon d={ICONS.minus} />
        </button>
      </div>

      <div className="flex items-center gap-2 border-y border-line bg-slate-50 px-4 py-2 text-xs">
        <span className="text-ink"><Icon d={ICONS.pin} size={16} /></span>
        <span className="truncate text-sm font-bold">{place}</span>
        <span className="ml-auto shrink-0 text-muted">Follows map selection</span>
      </div>

      <div ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {s.chat.length === 0 ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">From insight to action</p>
            <h3 className="mt-3 text-[26px] font-bold leading-tight tracking-tight">Hi {me?.name?.split(" ")[0]},<br />what would you like to explore?</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">Understand territory performance, get to know the team, and decide the next step.</p>

            <div className="mt-6 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Start here</span>
              <button onClick={() => setShowMore((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink" aria-expanded={showMore}>
                More <span className={`transition ${showMore ? "rotate-180" : ""}`}><Icon d={ICONS.chevron} size={14} /></span>
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {starters.map((c) => (
                <button key={c.label} onClick={() => send(c.ask)} className="flex min-h-[104px] flex-col items-start justify-between rounded-2xl border border-line bg-white p-3.5 text-left text-[13px] leading-snug transition hover:border-brand/40 hover:bg-brand-soft/40">
                  <span className="text-slate-600"><Icon d={c.icon} size={20} /></span>
                  <span className="mt-3 font-medium">{c.label}</span>
                </button>
              ))}
            </div>
            {showMore && (
              <div className="mt-3 flex flex-col gap-1.5">
                {more.map((q) => (
                  <button key={q} onClick={() => send(q)} className="rounded-xl border border-line px-3 py-2 text-left text-xs text-slate-700 hover:border-brand/40 hover:bg-brand-soft/40 hover:text-brand-strong">{q}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {s.chat.map((c) =>
              c.role === "user" ? (
                <div key={c.id} className="flex justify-end">
                  <div className="max-w-[88%] whitespace-pre-line rounded-2xl bg-ink px-3.5 py-2.5 text-[13px] leading-relaxed text-white">{c.text}</div>
                </div>
              ) : (
                <AgentMessage key={c.id} c={c} />
              ),
            )}
          </div>
        )}
      </div>

      <div className="relative border-t border-line px-3 pb-2 pt-3">
        {showGuide && (
          <div className="absolute inset-x-3 bottom-full z-10 mb-1 max-h-72 overflow-y-auto rounded-2xl border border-line bg-white p-1.5 shadow-lg" role="menu" aria-label="Example questions">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Example questions</div>
            {[...starters.map((x) => x.ask), ...more].map((q) => (
              <button key={q} role="menuitem" onClick={() => send(q)} className="block w-full rounded-xl px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-brand-soft hover:text-brand-strong">{q}</button>
            ))}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="rounded-2xl border border-line bg-white p-3 focus-within:border-brand">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setShowGuide(false)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }}
            rows={2}
            placeholder="Ask about a territory or team…"
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          <div className="mt-1 flex items-center justify-between">
            <button type="button" onClick={() => setShowGuide((v) => !v)} aria-expanded={showGuide}
              className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-ink ${showGuide ? "bg-slate-100 text-ink" : ""}`}>
              <Icon d={ICONS.book} size={18} /> Guide
            </button>
            <button disabled={s.chatBusy || !input.trim()} aria-label="Send" title="Send"
              className="flex h-10 w-12 items-center justify-center rounded-xl bg-brand text-white transition hover:bg-brand-strong disabled:opacity-40">
              <Icon d={ICONS.up} size={20} stroke={2} />
            </button>
          </div>
        </form>
        <p className="mt-2 text-center text-[11px] text-muted">Enter to send · Shift + Enter for a new line</p>
      </div>
    </div>
  );
}
