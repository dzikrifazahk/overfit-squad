import type { Dispatch } from "react";
import type { Action, State } from "./store";
import type { StreamEvent } from "./types";

// One ADK session per page load and persona (switching persona starts a new conversation context).
const PAGE_ID = Math.random().toString(36).slice(2, 10);

export async function askAgent(s: State, d: Dispatch<Action>, text: string) {
  const q = text.trim();
  if (!q || s.chatBusy) return;
  d({ type: "CHAT_USER", text: q });
  d({ type: "STREAM_START" });
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: q, persona: s.persona, sessionId: `${s.persona}-${PAGE_ID}`, selection: s.selection, now: s.now }),
    });
    if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finished = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line) as StreamEvent;
        if (ev.t === "status") d({ type: "STREAM_STATUS", text: ev.text });
        else if (ev.t === "delta") d({ type: "STREAM_DELTA", text: ev.text });
        else if (ev.t === "map") d({ type: "STREAM_MAP", map: ev.map });
        else if (ev.t === "done") { finished = true; d({ type: "STREAM_DONE", reply: ev.reply }); }
        else if (ev.t === "error") throw new Error(ev.message);
      }
      if (done) break;
    }
    if (!finished) throw new Error("the response ended unexpectedly");
  } catch (e) {
    d({ type: "CHAT_ERROR", text: `Could not reach the agent: ${(e as Error).message}` });
  }
}
