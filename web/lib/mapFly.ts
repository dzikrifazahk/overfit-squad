/** Smooth camera moves for the Google map ("fly to"): ease in/out, zooming out a little on long hops. */

export type Padding = { top: number; bottom: number; left: number; right: number };
export type Bounds = { west: number; south: number; east: number; north: number };
type Cam = { x: number; y: number; zoom: number }; // x/y: Web-Mercator unit square (0..1)

const TILE = 256;
const MIN_ZOOM = 4;
const MAX_ZOOM = 16;

const toUnit = (lat: number, lng: number) => ({
  x: (lng + 180) / 360,
  y: 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI),
});
const fromUnit = (x: number, y: number) => ({
  lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
  lng: x * 360 - 180,
});
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Camera that shows `b` centred inside the part of the viewport not covered by the floating panels. */
export function cameraForBounds(map: google.maps.Map, b: Bounds, pad: Padding): Cam {
  const div = map.getDiv();
  const w = div.clientWidth, h = div.clientHeight;
  const availW = Math.max(100, w - pad.left - pad.right), availH = Math.max(100, h - pad.top - pad.bottom);
  const nw = toUnit(b.north, b.west), se = toUnit(b.south, b.east);
  const dx = Math.max(1e-9, se.x - nw.x), dy = Math.max(1e-9, se.y - nw.y);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.log2(Math.min(availW / (dx * TILE), availH / (dy * TILE)))));
  return centred((nw.x + se.x) / 2, (nw.y + se.y) / 2, zoom, w, h, pad);
}

export function cameraForPoint(map: google.maps.Map, lat: number, lng: number, zoom: number, pad: Padding): Cam {
  const div = map.getDiv();
  const p = toUnit(lat, lng);
  return centred(p.x, p.y, zoom, div.clientWidth, div.clientHeight, pad);
}

function centred(bx: number, by: number, zoom: number, w: number, h: number, pad: Padding): Cam {
  const scale = TILE * Math.pow(2, zoom);
  const ox = pad.left + (w - pad.left - pad.right) / 2 - w / 2;
  const oy = pad.top + (h - pad.top - pad.bottom) / 2 - h / 2;
  return { x: bx - ox / scale, y: by - oy / scale, zoom };
}

const running = new WeakMap<google.maps.Map, number>();

export function cancelFly(map: google.maps.Map) {
  const id = running.get(map);
  if (id) cancelAnimationFrame(id);
  running.delete(map);
}

/** Animate to `to`. With `instant`, jump (used for the first placement). Cancels any move in progress. */
export function flyTo(map: google.maps.Map, to: Cam, instant = false) {
  cancelFly(map);
  const place = (c: Cam) => {
    const ll = fromUnit(c.x, c.y);
    map.moveCamera({ center: ll, zoom: c.zoom });
  };
  const c0 = map.getCenter(), z0 = map.getZoom();
  if (instant || !c0 || z0 == null) return place(to);

  const from = { ...toUnit(c0.lat(), c0.lng()), zoom: z0 };
  const div = map.getDiv();
  const view = Math.max(div.clientWidth, div.clientHeight);
  const lowZoom = Math.min(from.zoom, to.zoom);
  const dist = Math.hypot(to.x - from.x, to.y - from.y) * TILE * Math.pow(2, lowZoom); // px at the lower zoom
  const hops = dist / view;
  if (hops < 0.002 && Math.abs(to.zoom - from.zoom) < 0.01) return place(to);

  const bump = Math.min(2.5, Math.max(0, Math.log2(Math.max(hops, 1e-6)) * 0.8)); // zoom out on long hops
  const ms = Math.min(2200, Math.max(800, 700 + 350 * Math.log2(1 + hops) + 250 * Math.abs(to.zoom - from.zoom)));
  const t0 = performance.now();

  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    const e = ease(t);
    place({
      x: from.x + (to.x - from.x) * e,
      y: from.y + (to.y - from.y) * e,
      zoom: Math.max(MIN_ZOOM, from.zoom + (to.zoom - from.zoom) * e - bump * Math.sin(Math.PI * e)),
    });
    if (t < 1) running.set(map, requestAnimationFrame(step));
    else running.delete(map);
  };
  running.set(map, requestAnimationFrame(step));
}
