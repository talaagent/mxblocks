// Total, defensive parsing helpers. Every helper returns null (or drops the
// item) instead of throwing, never passes a payload string through without a
// length cap, and never produces anything meant to be rendered as HTML.
// Normative limits: docs/rich-messages.md.

export const LIMITS = {
  blocks: 8,
  /** one-line labels: button/chip labels, column headers, card titles, ... */
  labelChars: 64,
  /** button, chip and form labels: up to a sentence, wrapped (crate MAX_LABEL) */
  buttonLabelChars: 120,
  /** longer one-line text: subtitles, step labels, descriptions in cards */
  lineChars: 200,
  /** multi-line plain text: details body, step detail, event description */
  textChars: 4000,
  reactionKeyChars: 64,
  sendBodyChars: 1000,
  urlChars: 2048,
  buttonsPerBlock: 10,
  chipsPerBlock: 12,
  tableColumns: 12,
  tableRows: 200,
  cellChars: 200,
  chartSeries: 6,
  chartPoints: 200,
  sources: 12,
  /** carousel: 3..8 items (ChatGPT inline carousel); more are dropped */
  cards: 8,
  carouselMin: 3,
  cardActions: 2,
  carouselItemActions: 1,
  fallbackChars: 500,
  cardFields: 8,
  progressSteps: 50,
  codeChars: 20_000,
  codeLines: 500,
  forecast: 10,
  tickerSeries: 200,
  /** math.tex (crate MAX_TEX); longer drops the block */
  texChars: 4000,
  trackerStages: 12,
  trackerItems: 20,
  /** gallery: renderers draw 1..20 images (validating senders send 2..20) */
  galleryImages: 20,
  captionChars: 200,
  formFields: 8,
  formOptions: 10,
  /** text field maxlength cap (and default) */
  formText: 200,
  previewLines: 40,
  previewChars: 4096,
} as const;

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function cap(s: string, max: number): string {
  // Count and cut by code points so emoji aren't split into lone surrogates.
  const cps = Array.from(s);
  return cps.length > max ? `${cps.slice(0, max - 1).join("")}…` : s;
}

/** One line: whitespace and control characters collapsed, trimmed, capped. */
export function line(v: unknown, max: number = LIMITS.labelChars): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, " ").trim();
  return s ? cap(s, max) : null;
}

/** Multi-line plain text: newlines and tabs kept, other control chars dropped, capped. */
export function text(v: unknown, max: number = LIMITS.textChars): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
  return s.trim() ? cap(s, max) : null;
}

/**
 * Event content is canonical JSON (integers only), so numeric fields carry
 * an integer or a decimal string matching this ("62.99", "-1.5e3").
 */
export const DECIMAL = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/**
 * A finite number: a JSON number (older events may carry floats) or a
 * decimal string ({@link DECIMAL}). Other strings are not numbers.
 */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.length > 40 || !DECIMAL.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A label for a number-or-string value: numbers kept as numbers, strings as one line. */
export function scalar(v: unknown, max: number = LIMITS.cellChars): string | number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "true" : "false";
  return line(v, max);
}

/** An absolute https URL, normalised by the URL parser; anything else is null. */
export function httpsUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > LIMITS.urlChars) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** `mxc://server/mediaId` (the only image source allowed). */
export function mxcUri(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 255) return null;
  return /^mxc:\/\/[A-Za-z0-9.:\-[\]]+\/[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

/**
 * A point in time as ms since the epoch. Numbers are ms; strings must be ISO
 * 8601 with a date (`2026-10-15`, `2026-10-15T18:00:00+08:00`). Years outside
 * 2000..2200 are rejected (catches seconds-vs-ms mistakes).
 */
export function timestamp(v: unknown): number | null {
  let ms: number | null = null;
  if (num(v) !== null) ms = num(v);
  else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && v.length <= 40) {
    const t = Date.parse(v);
    ms = Number.isNaN(t) ? null : t;
  }
  if (ms === null) return null;
  return ms >= 946_684_800_000 && ms < 7_258_118_400_000 ? Math.round(ms) : null;
}

/** `v` when it's one of `allowed`, else `fallback`. */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T;
export function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null;
export function oneOf<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T | null = null,
): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Map an array through a parser, capped at `max` input items, nulls dropped. */
export function list<T>(v: unknown, max: number, parse: (x: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v.slice(0, max)) {
    const p = parse(x);
    if (p !== null) out.push(p);
  }
  return out;
}
