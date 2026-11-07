// Small formatting helpers shared by the blocks.

/** "1:05", "12:03:09", "45s" style elapsed time. */
export function elapsed(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (m) return `${m}:${String(s).padStart(2, "0")}`;
  return `${s}s`;
}

/** Countdown text: "2d 03:04:05", "03:04:05", "04:05". */
export function countdown(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  const hms = h || d ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  return d ? `${d}d ${hms}` : hms;
}

/** Display host of an https URL, without a leading "www.". */
export function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Letter badge for a source/card: first letter or digit of the domain. */
export function badgeLetter(url: string): string {
  const m = domain(url).match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : "?";
}

/** A number with grouping and at most `digits` fraction digits. */
export function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** Compact axis labels: 1.2k, 3.4M. */
export function fmtCompact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    n,
  );
}

/** A price with an ISO currency code when valid, else the plain number + code. */
export function fmtMoney(n: number, currency: string | null): string {
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
    } catch {
      /* fall through */
    }
  }
  return currency ? `${fmtNum(n)} ${currency}` : fmtNum(n);
}

/** Signed number: "+1.25", "-0.5". */
export function signed(n: number, digits = 2): string {
  const s = fmtNum(Math.abs(n), digits);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

/** Google Maps search URL for a place (no tiles, no API key; just a link). */
export function mapsUrl(p: {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}): string {
  const query =
    p.lat !== null && p.lng !== null
      ? `${p.lat},${p.lng}`
      : [p.name, p.address].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
