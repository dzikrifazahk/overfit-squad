import { shortName } from "@/lib/format";
import type { Selection } from "@/lib/types";

type Named = { name: string };
type Master = { provinces: Record<string, Named>; regencies: Record<string, Named> };

/** Territory named in a chat message (longest whole-word match; regencies win over provinces), or null. */
export function placeInText(m: Master, text: string): Selection | null {
  const t = text.toLowerCase();
  let best: { len: number; sel: Selection } | null = null;
  const scan = (rec: Record<string, Named>, level: "province" | "regency") => {
    for (const [kode, v] of Object.entries(rec)) {
      const n = shortName(v.name).replace(/^(Daerah Khusus Ibukota |Daerah Istimewa |Provinsi )/, "").toLowerCase();
      if (n.length < 4) continue;
      const at = t.indexOf(n);
      if (at < 0) continue;
      const before = at === 0 || !/[a-z0-9]/.test(t[at - 1]);
      const end = at + n.length;
      const after = end >= t.length || !/[a-z0-9]/.test(t[end]);
      if (before && after && (!best || n.length > best.len)) best = { len: n.length, sel: { level, kode } };
    }
  };
  scan(m.provinces, "province");
  scan(m.regencies, "regency");
  return best ? (best as { sel: Selection }).sel : null;
}
