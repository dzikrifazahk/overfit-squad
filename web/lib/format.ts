export function rupiah(v: number, compact = true): string {
  if (!compact) return "Rp" + Math.round(v).toLocaleString("en-US");
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e12) return `${sign}Rp${(a / 1e12).toLocaleString("en-US", { maximumFractionDigits: 2 })}T`;
  if (a >= 1e9) return `${sign}Rp${(a / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
  if (a >= 1e6) return `${sign}Rp${(a / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  return `${sign}Rp${Math.round(a).toLocaleString("en-US")}`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return `${v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

export function num(v: number, digits = 0): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** Wall-clock time of the viewer, in their own timezone: "Sat 17 Oct, 6:55:42 AM". */
export function liveClock(d: Date): string {
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  return `${day}, ${time}`;
}

export function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Jakarta" });
}

export function shortName(name: string): string {
  return name.replace(/^(Kabupaten Administrasi |Kota Administrasi |Kabupaten |Kota |Cluster )/, "");
}

export function driverValue(unit: string, v: number): string {
  if (unit === "%") return pct(v);
  if (unit === "Rp") return rupiah(v);
  if (unit === "ratio") return num(v, 2);
  return num(v, 1);
}
