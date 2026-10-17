"use client";

import dynamic from "next/dynamic";
import { StoreProvider, useStore } from "@/lib/store";
import ChatPanel from "./ChatPanel";
import DetailPanel from "./DetailPanel";
import GuidePanel from "./GuidePanel";
import InboxPanel from "./InboxPanel";
import MapControls from "./MapControls";
import PhoneSim from "./PhoneSim";
import SubTabBar from "./SubTabBar";
import TopBar from "./TopBar";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <Loading /> });

function Loading() {
  return <div className="flex h-full items-center justify-center text-sm text-muted">Loading map…</div>;
}

const FLOAT = "pointer-events-auto rounded-2xl border border-line/80 bg-white/95 shadow-lg backdrop-blur";

function Shell({ mapsKey, mapId }: { mapsKey: string; mapId: string }) {
  const { s, d } = useStore();
  const guide = s.tab === "guide";
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-canvas">
      {/* Full-screen map; everything else floats on top of it. */}
      <div className="absolute inset-0">{s.m ? <MapView apiKey={mapsKey} mapId={mapId} /> : <Loading />}</div>

      <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex flex-col items-center gap-2">
        <div className="pointer-events-auto w-full rounded-[28px] border border-line/80 bg-white/95 px-4 py-2 shadow-lg backdrop-blur"><TopBar /></div>
        {!guide && <SubTabBar />}
      </div>

      {s.m && guide && (
        <section className={`${FLOAT} absolute inset-x-3 bottom-7 top-[92px] z-20 overflow-hidden rounded-[28px] !bg-white`}>
          <GuidePanel />
        </section>
      )}

      {s.m && !guide && s.tab !== "map" && (
        <section className={`${FLOAT} absolute bottom-7 left-3 top-[204px] z-20 w-[560px] overflow-hidden`}>
          {s.tab === "detail" ? <DetailPanel /> : <InboxPanel />}
        </section>
      )}

      {guide ? null : s.chatOpen ? (
        <aside className={`${FLOAT} absolute bottom-7 right-3 top-[204px] z-20 flex w-[400px] flex-col overflow-hidden rounded-[28px]`}>
          {s.m ? <ChatPanel /> : <p className="p-4 text-sm text-muted">Loading data…</p>}
        </aside>
      ) : (
        <button
          onClick={() => d({ type: "CHAT_OPEN", open: true })}
          className="pointer-events-auto absolute bottom-7 right-3 z-20 flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-brand-strong"
          aria-label="Open chat agent"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3h0A1.5 1.5 0 0 1 4 11.5z" /></svg>
          Chat agent
          {s.chatBusy && <span className="h-2 w-2 animate-pulse rounded-full bg-white" />}
        </button>
      )}

      {s.m && !guide && <MapControls />}
      {s.m && !guide && <PhoneSim />}
    </div>
  );
}

export default function AppShell({ mapsKey, mapId }: { mapsKey: string; mapId: string }) {
  return (
    <StoreProvider>
      <Shell mapsKey={mapsKey} mapId={mapId} />
    </StoreProvider>
  );
}
