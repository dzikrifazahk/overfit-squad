"use client";

import type { ReactNode } from "react";
import { askAgent } from "@/lib/chat";
import { placeInText } from "@/lib/places";
import { useStore } from "@/lib/store";

const STEPS = [
  { title: "Read the map", body: "Colour shows how a territory is doing against its target. Red is behind, green is ahead. Switch the layer to change what the colour means." },
  { title: "Zoom in", body: "Click a province, then a city or regency. Village dots exist for West Java only. You can also type a place name in the chat and the map flies there." },
  { title: "Ask why", body: "Ask the agent about a gap, who owns it, how the team is doing, or what to do next. Every number comes from the data, not from the model." },
  { title: "Act", body: "Review the plan the agent drafts in Inbox & Actions, approve it, and the tasks appear on the map." },
];

const SCREENS = [
  { name: "Performance Map", body: "The whole country on one map, down to cities and regencies, with villages for West Java. Hover the legend to see what each colour means." },
  { name: "Territory Details", body: "For the selected territory: raw and adjusted attainment, where the gap comes from, the drivers behind it, who is accountable, the team, and similar territories that do better." },
  { name: "Inbox & Actions", body: "Alerts, plans waiting for approval and the audit log. Nothing is carried out until a person approves it." },
  { name: "Telegram window", body: "A simulated phone showing what a manager receives: the 07:00 digest, urgent alerts with a clarifying question, and a single escalation if nobody responds." },
  { name: "Demo controls", body: "\"07:00 digest\" sends the morning summary. \"Inject event\" creates a sudden drop in a village. \"+4 hours\" moves the demo clock forward so the escalation can be seen." },
];

const LAYERS = [
  { name: "Raw", body: "Actual revenue divided by target. The plain scorecard, no adjustments." },
  { name: "Adjusted", body: "Adds back losses the team could not control, such as an outage, and compares with what the territory could realistically deliver. Fairer for hard territories." },
  { name: "Performance × Capacity", body: "Adjusted result combined with how full the team is. It separates a coaching problem from a staffing problem." },
];

const CAPABILITIES = [
  { title: "Explain a gap", body: "Splits the gap into what the team controls, what it does not, and targets set too high, and shows the drivers.", ask: "Why is Garut behind target?" },
  { title: "Check fairness", body: "Tells a drop caused by an outage from a real performance problem.", ask: "Why is Cianjur red?" },
  { title: "Find the owner", body: "Shows who is accountable and the chain above them, with their job description.", ask: "Who owns revenue in Garut?" },
  { title: "Check the team", body: "Open positions, capacity and team health, reported for groups only.", ask: "How is the Garut team doing?" },
  { title: "Find good examples", body: "Finds similar territories that perform better, so there is someone to learn from.", ask: "Who is doing well and could be an example for Garut?" },
  { title: "Draft an action plan", body: "Turns the findings into dated tasks with an owner and an approver, ready for your decision.", ask: "Draft an action plan for Garut" },
  { title: "Look up a policy", body: "Answers from the SOPs and policies and names the document it used.", ask: "What is the escalation SOP?" },
  { title: "Control the map", body: "Switch layers or move the map by asking.", ask: "Show the quadrant map" },
];

const RULES = [
  "Numbers come from data tools, never from the model's memory.",
  "It does not rank, score or suggest sanctions for individual people. Team results are discussed as groups.",
  "Team figures are shown only for groups of five or more people, so no one can be singled out.",
  "Actions are drafted by the agent and carried out only after a person approves them.",
  "All data is synthetic and the company, PT Nusantara Seluler, is fictional.",
  "The morning digest, alerts and escalation are simulated in this prototype.",
];

const GLOSSARY = [
  ["Attainment", "Actual revenue as a percentage of a reference. 100% means on target."],
  ["Controllable gap", "The part of a shortfall the team could have influenced, for example vacancies or outlet activity."],
  ["Capacity", "Filled positions as a share of planned positions."],
  ["PIC", "Person in charge: the manager accountable for a result."],
  ["P1 alert", "An urgent alert that interrupts a person. Each person gets at most three a day."],
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export default function GuidePanel() {
  const { s, d } = useStore();

  function tryIt(q: string) {
    if (s.chatBusy) return;
    d({ type: "TAB", tab: "map" });
    d({ type: "CHAT_OPEN", open: true });
    const place = s.m ? placeInText(s.m, q) : null;
    if (place) d({ type: "SELECT", selection: place });
    void askAgent(s, d, q);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1040px] px-8 pb-10 pt-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Guide</p>
        <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight">How to use Overfit Agent</h1>
        <p className="mt-2 max-w-[720px] text-[14px] leading-relaxed text-muted">
          Overfit Agent puts revenue, the people accountable for it and the next step on one map. This page explains the screens, what you can ask,
          and the rules the agent follows.
        </p>

        <Section title="Start in four steps">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            {STEPS.map((x, i) => (
              <div key={x.title} className="rounded-2xl bg-brand-soft p-4">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</div>
                <div className="mt-3 text-sm font-bold">{x.title}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-slate-700">{x.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="What Overfit Agent can do" hint="Press Try to run the example in the chat">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {CAPABILITIES.map((x) => (
              <div key={x.title} className="flex flex-col rounded-2xl border border-line bg-white p-4">
                <div className="text-sm font-bold">{x.title}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{x.body}</p>
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                  <span className="text-[12.5px] italic text-slate-700">“{x.ask}”</span>
                  <button
                    onClick={() => tryIt(x.ask)}
                    disabled={s.chatBusy}
                    className="shrink-0 rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-40"
                  >
                    Try
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="The screens">
          <div className="divide-y divide-line rounded-2xl border border-line bg-white">
            {SCREENS.map((x) => (
              <div key={x.name} className="grid grid-cols-1 gap-1 px-4 py-3 md:grid-cols-[200px_1fr] md:gap-4">
                <div className="text-sm font-bold">{x.name}</div>
                <p className="text-[12.5px] leading-relaxed text-muted">{x.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Three ways to colour the map">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {LAYERS.map((x) => (
              <div key={x.name} className="rounded-2xl border border-line bg-white p-4">
                <div className="text-sm font-bold text-brand">{x.name}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{x.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Section title="Rules it follows">
            <ul className="space-y-2 rounded-2xl bg-slate-50 p-4">
              {RULES.map((r) => (
                <li key={r} className="flex gap-2.5 text-[12.5px] leading-relaxed text-slate-700">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                  {r}
                </li>
              ))}
            </ul>
            <button
              onClick={() => tryIt("Rank the 10 worst employees")}
              disabled={s.chatBusy}
              className="mt-3 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-brand-soft hover:text-brand-strong disabled:opacity-40"
            >
              See the agent decline a ranking request
            </button>
          </Section>

          <Section title="Words you will see">
            <dl className="space-y-2.5 rounded-2xl border border-line bg-white p-4">
              {GLOSSARY.map(([term, def]) => (
                <div key={term}>
                  <dt className="text-[12.5px] font-bold">{term}</dt>
                  <dd className="text-[12.5px] leading-relaxed text-muted">{def}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
