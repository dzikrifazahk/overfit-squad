"use client";

import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { cameraForBounds, cameraForPoint, cancelFly, flyTo } from "@/lib/mapFly";
import { APIProvider, ControlPosition, Map, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useRef, useState } from "react";
import { attainmentColor, quadrantColor, quadrantOf } from "@/lib/colors";
import { pct, rupiah } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Att, DesaPoint, Selection } from "@/lib/types";

type Feature = { type: "Feature"; properties: { kode: string; name: string; level: string }; geometry: { type: "MultiPolygon"; coordinates: number[][][][] } };
type FC = { type: "FeatureCollection"; features: Feature[] };
type BBox = [number, number, number, number];

const INDONESIA = { lat: -2.4, lng: 118 };
const INDONESIA_BOUNDS = { west: 94.5, south: -11.5, east: 141.5, north: 6.5 };
// NOTE: no `restriction` on the Google map: with it, fitBounds() zoomed in but left the centre at the national view,
// so agent-driven moves showed an empty (masked) area. Everything outside Indonesia is masked instead.
const MASK_FILL: [number, number, number, number] = [236, 239, 243, 255];

/** Space taken by the floating UI, so fitted regions stay visible. */
function cameraPadding(tab: string, chatOpen: boolean) {
  return { top: 215, bottom: 30, right: chatOpen ? 430 : 30, left: tab === "map" ? 30 : 575 };
}

function bboxOf(f: Feature): BBox {
  let [a, b, c, d] = [180, 90, -180, -90];
  for (const poly of f.geometry.coordinates) for (const [x, y] of poly[0]) {
    a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y);
  }
  return [a, b, c, d];
}

export default function MapView({ apiKey, mapId }: { apiKey: string; mapId: string }) {
  if (!apiKey) {
    return <div className="flex h-full items-center justify-center p-8 text-sm text-muted">Set GOOGLE_MAPS_API_KEY (web/.env.local atau env Cloud Run)</div>;
  }
  return (
    <APIProvider apiKey={apiKey} language="id" region="ID">
      <Map
        mapId={mapId}
        defaultCenter={INDONESIA}
        defaultZoom={5}
        minZoom={4}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        zoomControlOptions={{ position: ControlPosition.LEFT_CENTER }}
        clickableIcons={false}
        style={{ width: "100%", height: "100%" }}
      />
      <DeckLayers />
    </APIProvider>
  );
}

function DeckLayers() {
  const map = useMap();
  const { s, d } = useStore();
  const m = s.m!;
  const overlay = useRef<GoogleMapsOverlay | null>(null);
  const [geo, setGeo] = useState<{ prov: FC; reg: FC; mask: unknown; bbox: Record<string, BBox> } | null>(null);
  const [t, setT] = useState(0);

  useEffect(() => {
    Promise.all(["provinces", "regencies", "mask"].map((n) => fetch(`/data/${n}.geojson`).then((r) => r.json())))
      .then((res) => {
        const [prov, reg, mask] = res as [FC, FC, unknown];
        const bbox: Record<string, BBox> = {};
        for (const f of [...prov.features, ...reg.features]) bbox[f.properties.kode] = bboxOf(f);
        setGeo({ prov, reg, mask, bbox });
      });
  }, []);

  useEffect(() => {
    if (!map) return;
    // Not interleaved: deck draws above the whole basemap (incl. labels), so the mask hides other countries.
    overlay.current = new GoogleMapsOverlay({ interleaved: false });
    overlay.current.setMap(map);
    return () => overlay.current?.setMap(null);
  }, [map]);

  const activeAlerts = s.alerts.filter((a) => a.status !== "resolved" && a.status !== "approved");
  useEffect(() => {
    if (!activeAlerts.length) return;
    let raf = 0;
    let last = 0;
    const loop = (ts: number) => {
      if (ts - last > 50) { setT(ts / 1000); last = ts; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [activeAlerts.length]);

  const sel = s.selection;
  const provKode = sel.kode ? sel.kode.split(".")[0] : null;
  const regKode = sel.level === "regency" || sel.level === "desa" ? sel.kode!.split(".").slice(0, 2).join(".") : null;

  // Camera follows the selection with a smooth fly-to; the first placement is instant.
  const placed = useRef(false);
  useEffect(() => {
    if (!map) return;
    const stop = () => cancelFly(map);
    const el = map.getDiv();
    const l = map.addListener("dragstart", stop);
    el.addEventListener("wheel", stop, { passive: true });
    return () => { l.remove(); el.removeEventListener("wheel", stop); cancelFly(map); };
  }, [map]);

  useEffect(() => {
    if (!map || !geo) return;
    const padding = cameraPadding(s.tab, s.chatOpen);
    let cam: ReturnType<typeof cameraForBounds> | null = null;
    if (sel.level === "national") {
      cam = cameraForBounds(map, INDONESIA_BOUNDS, padding);
    } else if (sel.level === "desa") {
      const p = s.desa.find((x) => x.kode === sel.kode);
      if (p) cam = cameraForPoint(map, p.lat, p.lng, 12, padding);
    } else {
      const b = geo.bbox[sel.kode!];
      if (b) cam = cameraForBounds(map, { west: b[0], south: b[1], east: b[2], north: b[3] }, padding);
    }
    if (!cam) return;
    flyTo(map, cam, !placed.current);
    placed.current = true;
  }, [map, geo, sel.level, sel.kode, s.desa, s.tab, s.chatOpen]);

  const color = useMemo(() => (a: Att | undefined, alpha = 200): [number, number, number, number] => {
    if (!a) return [203, 213, 225, 120];
    if (s.layer === "bivariate") return quadrantColor(quadrantOf(a.adj, a.capacity ?? 1), alpha);
    return attainmentColor(s.layer === "raw" ? a.raw : a.adj, alpha);
  }, [s.layer]);

  const regencyCentroid = (kode: string): [number, number] => {
    const b = geo?.bbox[kode];
    return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [118, -2.4];
  };

  useEffect(() => {
    if (!overlay.current || !geo) return;
    const hl = new Set(s.highlight);
    const select = (selection: Selection) => d({ type: "SELECT", selection });
    const layers = [];

    layers.push(new GeoJsonLayer({
      id: "mask-outside-indonesia", data: geo.mask as never, filled: true, stroked: false, pickable: false,
      getFillColor: MASK_FILL,
    }));

    layers.push(new GeoJsonLayer<Feature["properties"]>({
      id: "provinces",
      data: geo.prov as never,
      pickable: true,
      filled: true,
      stroked: true,
      getFillColor: (f) => (sel.level === "national" ? color(m.provinces[f.properties.kode]) : f.properties.kode === provKode ? [0, 0, 0, 0] : [148, 163, 184, 70]),
      getLineColor: (f) => (hl.has(f.properties.kode) ? [15, 23, 42, 255] : [255, 255, 255, 220]),
      getLineWidth: (f) => (hl.has(f.properties.kode) ? 3 : 1),
      lineWidthUnits: "pixels",
      updateTriggers: { getFillColor: [sel.level, provKode, s.layer], getLineColor: [s.highlight], getLineWidth: [s.highlight] },
      onClick: (info) => { const k = info.object?.properties.kode; if (k && k !== provKode) select({ level: "province", kode: k }); },
    }));

    if (provKode) {
      const feats = geo.reg.features.filter((f) => f.properties.kode.startsWith(provKode + "."));
      layers.push(new GeoJsonLayer<Feature["properties"]>({
        id: "regencies",
        data: { type: "FeatureCollection", features: feats } as never,
        pickable: true,
        filled: true,
        stroked: true,
        getFillColor: (f) => color(m.regencies[f.properties.kode], f.properties.kode === regKode && provKode === "32" ? 60 : 200),
        getLineColor: (f) => (f.properties.kode === regKode || hl.has(f.properties.kode) ? [15, 23, 42, 255] : [255, 255, 255, 230]),
        getLineWidth: (f) => (f.properties.kode === regKode || hl.has(f.properties.kode) ? 3 : 1),
        lineWidthUnits: "pixels",
        updateTriggers: { getFillColor: [s.layer, regKode], getLineColor: [regKode, s.highlight], getLineWidth: [regKode, s.highlight] },
        onClick: (info) => { const k = info.object?.properties.kode; if (k) select({ level: "regency", kode: k }); },
      }));
    }

    if (regKode && provKode === "32") {
      const pts = s.desa.filter((p) => p.kode.startsWith(regKode + "."));
      layers.push(new ScatterplotLayer<DesaPoint>({
        id: "desa",
        data: pts,
        pickable: true,
        getPosition: (p) => [p.lng, p.lat],
        getRadius: (p) => (p.kode === sel.kode || hl.has(p.kode) ? 700 : 380),
        radiusMinPixels: 3,
        radiusMaxPixels: 14,
        getFillColor: (p) => (s.layer === "raw" ? attainmentColor(p.raw, 235) : attainmentColor(p.adj, 235)),
        getLineColor: (p) => (p.kode === sel.kode || hl.has(p.kode) ? [15, 23, 42, 255] : [255, 255, 255, 200]),
        stroked: true,
        lineWidthMinPixels: 1,
        updateTriggers: { getFillColor: [s.layer], getRadius: [sel.kode, s.highlight], getLineColor: [sel.kode, s.highlight] },
        onClick: (info) => { if (info.object) select({ level: "desa", kode: info.object.kode }); },
      }));
    }

    const tasks = s.tasks.filter((x) => x.status === "open");
    if (tasks.length) {
      layers.push(new ScatterplotLayer({
        id: "tasks", data: tasks, pickable: true,
        getPosition: (x: (typeof tasks)[number]) => [x.lng, x.lat],
        getRadius: 900, radiusMinPixels: 6, radiusMaxPixels: 12,
        getFillColor: [37, 99, 235, 240], getLineColor: [255, 255, 255, 255], stroked: true, lineWidthMinPixels: 2,
      }));
    }

    if (activeAlerts.length) {
      const pts = activeAlerts.map((a) => ({ a, pos: a.lat ? [a.lng!, a.lat] : regencyCentroid(m.clusters[a.clusterId].regencies[0]) }));
      const phase = (t % 1.6) / 1.6;
      layers.push(new ScatterplotLayer({
        id: "alert-ring", data: pts, getPosition: (p: (typeof pts)[number]) => p.pos as [number, number],
        getRadius: 1, radiusUnits: "pixels", radiusScale: 10 + phase * 26, filled: false, stroked: true,
        getLineColor: (p: (typeof pts)[number]) => (p.a.tier === "P1" ? [220, 38, 38, Math.round(255 * (1 - phase))] : [234, 88, 12, Math.round(255 * (1 - phase))]),
        lineWidthUnits: "pixels", getLineWidth: 3,
      }));
      layers.push(new ScatterplotLayer({
        id: "alert-dot", data: pts, pickable: true, getPosition: (p: (typeof pts)[number]) => p.pos as [number, number],
        getRadius: 7, radiusUnits: "pixels", getFillColor: [220, 38, 38, 255], getLineColor: [255, 255, 255, 255], stroked: true, lineWidthMinPixels: 2,
      }));
    }

    overlay.current.setProps({
      layers,
      getTooltip: ({ object, layer }) => {
        if (!object || !layer) return null;
        const style = { fontFamily: "inherit", fontSize: "12px", borderRadius: "8px", padding: "8px 10px", background: "#0f172a", color: "white" };
        if (layer.id === "provinces" || layer.id === "regencies") {
          const k = object.properties.kode as string;
          const a = layer.id === "provinces" ? m.provinces[k] : m.regencies[k];
          if (!a) return null;
          const owner = a.cluster_id ? m.clusters[a.cluster_id]?.owner?.name : m.units["BR" + k]?.BM?.name;
          return { html: `<b>${a.name}</b><br/>Raw ${pct(a.raw)} · Adjusted ${pct(a.adj)}<br/>Actual ${rupiah(a.rev_total)} / target ${rupiah(a.rev_total_target)}${owner ? `<br/>PIC: ${owner}` : ""}`, style };
        }
        if (layer.id === "desa") return { html: `<b>Village ${object.name}</b><br/>Raw ${pct(object.raw)} · Adjusted ${pct(object.adj)}<br/>${rupiah(object.rev)} (MTD)`, style };
        if (layer.id === "alert-dot") return { html: `<b>${object.a.title}</b><br/>${object.a.body}`, style };
        if (layer.id === "tasks") return { html: `<b>Approved task</b><br/>${object.text}`, style };
        return null;
      },
    });
  }, [geo, s.layer, s.desa, s.tasks, s.highlight, sel.level, sel.kode, provKode, regKode, color, activeAlerts, t, m, d]);

  return null;
}
