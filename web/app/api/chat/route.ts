import { readFile } from "node:fs/promises";
import path from "node:path";
import { streamAdk } from "@/lib/agent/adk";
import { answer } from "@/lib/agent/mock";
import type { Doc, Metrics, Selection, StreamEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

let cache: { m: Metrics; docs: Doc[] } | null = null;

async function data() {
  if (!cache) {
    const dir = path.join(process.cwd(), "public", "data");
    const [m, docs] = await Promise.all([
      readFile(path.join(dir, "metrics.json"), "utf8").then(JSON.parse),
      readFile(path.join(dir, "docs.json"), "utf8").then(JSON.parse),
    ]);
    cache = { m, docs };
  }
  return cache;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The mock agent answers instantly, so stream its text in small chunks to behave like the real one. */
async function* streamMock(m: Metrics, docs: Doc[], body: { message: string; persona: string; selection: Selection; now: string }): AsyncGenerator<StreamEvent> {
  yield { t: "status", text: "Analysing…" };
  await sleep(400);
  const reply = answer({ m, docs, persona: body.persona, selection: body.selection, now: body.now }, body.message);
  if (reply.map) yield { t: "map", map: reply.map };
  for (let i = 0; i < reply.text.length; i += 24) {
    yield { t: "delta", text: reply.text.slice(i, i + 24) };
    await sleep(25);
  }
  yield { t: "done", reply: { ...reply, source: "mock" } };
}

export async function POST(req: Request) {
  const body = (await req.json()) as { message: string; persona: string; sessionId?: string; selection: Selection; now: string };
  if (!body.message?.trim()) return Response.json({ error: "empty message" }, { status: 400 });
  const message = body.message.slice(0, 1000);
  const { m, docs } = await data();
  const agentUrl = process.env.AGENT_URL;

  const events = agentUrl
    ? streamAdk(agentUrl, m, { ...body, message, sessionId: body.sessionId ?? `${body.persona}-default` })
    : streamMock(m, docs, { ...body, message });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of events) controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      } catch (e) {
        controller.enqueue(encoder.encode(JSON.stringify({ t: "error", message: (e as Error).message } satisfies StreamEvent) + "\n"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
