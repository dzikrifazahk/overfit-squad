import AppShell from "@/components/AppShell";

// Rendered per request so the Maps key/Map ID come from the runtime environment (Cloud Run env vars),
// not from values baked in at build time.
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AppShell
      mapsKey={process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""}
      mapId={process.env.GOOGLE_MAPS_MAP_ID ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID"}
    />
  );
}
