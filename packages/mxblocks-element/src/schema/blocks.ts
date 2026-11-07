// Block types and their parsers. One parser per `type`; each returns a fully
// normalised block or null (block skipped). Shapes, limits and render rules
// are specified in docs/rich-messages.md; keep the two in sync.

import {
  LIMITS,
  httpsUrl,
  isObj,
  line,
  list,
  mxcUri,
  num,
  oneOf,
  scalar,
  text,
  timestamp,
} from "./common.ts";
import { type FormBlock, parseForm } from "./form.ts";
import { type FileBlock, type GalleryBlock, parseFile, parseGallery } from "./media.ts";

// ---------------------------------------------------------------- actions

export type Action =
  /** Send an m.reaction (m.annotation on this event) with `key`. */
  | { type: "react"; key: string }
  /** Send `body` as an m.text from the user, as a reply to this event. */
  | { type: "send"; body: string };

export function parseAction(v: unknown): Action | null {
  if (!isObj(v)) return null;
  if (v.type === "react") {
    // Reaction keys are exact strings (emoji); reject rather than mangle.
    const key = v.key;
    if (typeof key !== "string" || !key.trim() || key.length > LIMITS.reactionKeyChars) return null;
    return { type: "react", key };
  }
  if (v.type === "send") {
    const body = v.body;
    if (typeof body !== "string" || !body.trim() || body.length > LIMITS.sendBodyChars) return null;
    return { type: "send", body };
  }
  return null;
}

// ---------------------------------------------------------------- buttons / chips

export const BUTTON_STYLES = ["default", "primary", "danger"] as const;
export type ButtonStyle = (typeof BUTTON_STYLES)[number];

/** A preset prompt (MSC4139 `m.prompts` type `preset`). */
export interface Button {
  /** stable per message (MSC4139 prompt `id`); echoed in com.ianm.mtrix.used */
  id: string | null;
  label: string;
  style: ButtonStyle;
  action: Action;
}

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A prompt/button id: 1..64 of [A-Za-z0-9_.:-]. */
export function parseId(v: unknown): string | null {
  return typeof v === "string" && ID_RE.test(v) ? v : null;
}

export function parseButton(v: unknown): Button | null {
  if (!isObj(v)) return null;
  const label = line(v.label, LIMITS.buttonLabelChars);
  const action = parseAction(v.action);
  if (!label || !action) return null;
  return { id: parseId(v.id), label, style: oneOf(v.style, BUTTON_STYLES, "default"), action };
}

/**
 * Who may click (MSC4139 `scope`): full MXIDs, or null for anyone who can
 * see the message. Others see the actions disabled.
 */
export function parseScope(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const ids = v
    .slice(0, 50)
    .filter((s): s is string => typeof s === "string" && /^@[^:\s]+:\S+$/.test(s));
  return ids.length ? ids : null;
}

export interface ButtonsBlock {
  type: "buttons";
  buttons: Button[];
  scope: string[] | null;
}
export interface ChipsBlock {
  type: "chips";
  chips: Button[];
  scope: string[] | null;
}

// ---------------------------------------------------------------- table

export type Align = "left" | "right" | "center";
export type Cell = string | number | null;

export interface TableColumn {
  key: string;
  label: string;
  align: Align | null;
}
export interface TableBlock {
  type: "table";
  caption: string | null;
  columns: TableColumn[];
  /** rows[r][c] for columns[c] */
  rows: Cell[][];
  /** rows beyond LIMITS.tableRows were dropped */
  truncated: boolean;
}

function parseTable(v: Record<string, unknown>): TableBlock | null {
  const seen = new Set<string>();
  const columns = list(v.columns, LIMITS.tableColumns, (c): TableColumn | null => {
    // A column is `{key, label?, align?}` or just a string (key = label).
    const o = typeof c === "string" ? { key: c } : c;
    if (!isObj(o)) return null;
    const key = line(o.key, LIMITS.labelChars);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    return {
      key,
      label: line(o.label) ?? key,
      align: oneOf(o.align, ["left", "right", "center"] as const),
    };
  });
  if (!columns.length || !Array.isArray(v.rows)) return null;
  const rows = list(v.rows, LIMITS.tableRows, (r): Cell[] | null => {
    // A row is an object keyed by column key, or an array in column order.
    if (Array.isArray(r)) return columns.map((_, i) => scalar(r[i]));
    if (isObj(r)) return columns.map((c) => scalar(r[c.key]));
    return null;
  });
  if (!rows.length) return null;
  return {
    type: "table",
    caption: line(v.caption, LIMITS.lineChars),
    columns,
    rows,
    truncated: v.rows.length > LIMITS.tableRows,
  };
}

// ---------------------------------------------------------------- chart

export const CHART_KINDS = ["line", "bar", "area", "sparkline"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export interface ChartSeries {
  name: string | null;
  /** null = gap */
  values: (number | null)[];
}
export interface ChartBlock {
  type: "chart";
  kind: ChartKind;
  title: string | null;
  /** x labels; padded/trimmed to the longest series */
  labels: string[];
  series: ChartSeries[];
  unit: string | null;
}

function parseSeriesValues(v: unknown): (number | null)[] | null {
  if (!Array.isArray(v)) return null;
  const values = v.slice(0, LIMITS.chartPoints).map((x) => num(x));
  return values.some((x) => x !== null) ? values : null;
}

function parseChart(v: Record<string, unknown>): ChartBlock | null {
  const kind = oneOf(v.kind, CHART_KINDS);
  if (!kind) return null;
  // `series` is `[{name?, values}]`; a bare number array is one unnamed series.
  let series: ChartSeries[];
  if (Array.isArray(v.series) && v.series.every((x) => x === null || num(x) !== null)) {
    const values = parseSeriesValues(v.series);
    series = values ? [{ name: null, values }] : [];
  } else {
    series = list(v.series, LIMITS.chartSeries, (s): ChartSeries | null => {
      if (!isObj(s)) return null;
      const values = parseSeriesValues(s.values);
      return values ? { name: line(s.name), values } : null;
    });
  }
  if (!series.length) return null;
  if (kind === "sparkline") series = series.slice(0, 1);
  const n = Math.max(...series.map((s) => s.values.length));
  const raw = Array.isArray(v.labels) ? v.labels.slice(0, n) : [];
  const labels = Array.from({ length: n }, (_, i) => {
    const l = scalar(raw[i], 24);
    return l === null ? "" : String(l);
  });
  return {
    type: "chart",
    kind,
    title: line(v.title, LIMITS.lineChars),
    labels,
    series,
    unit: line(v.unit, 12),
  };
}

// ---------------------------------------------------------------- sources

export interface Source {
  title: string;
  url: string;
}
export interface SourcesBlock {
  type: "sources";
  sources: Source[];
}

function parseSources(v: Record<string, unknown>): SourcesBlock | null {
  const sources = list(v.sources, LIMITS.sources, (s): Source | null => {
    if (!isObj(s)) return null;
    const url = httpsUrl(s.url);
    if (!url) return null;
    return { url, title: line(s.title, LIMITS.lineChars) ?? new URL(url).hostname };
  });
  return sources.length ? { type: "sources", sources } : null;
}

// ---------------------------------------------------------------- card / cards

export interface Field {
  label: string;
  value: string;
}
export interface Card {
  title: string;
  subtitle: string | null;
  url: string | null;
  image: string | null;
  price: string | null;
  store: string | null;
  fields: Field[];
  /** ChatGPT Apps SDK rule: at most 2 on an inline card, 1 per carousel item */
  actions: Button[];
}
export interface CardBlock extends Card {
  type: "card";
  scope: string[] | null;
}
export interface CardsBlock {
  type: "cards";
  cards: Card[];
  /**
   * "carousel" when there are 3..8 items and every one has an image
   * (ChatGPT's inline carousel rule); otherwise the items stack as single
   * cards ("list").
   */
  layout: "carousel" | "list";
  scope: string[] | null;
}

function parseFields(v: unknown): Field[] {
  return list(v, LIMITS.cardFields, (f): Field | null => {
    if (!isObj(f)) return null;
    const label = line(f.label);
    const value = scalar(f.value, LIMITS.lineChars);
    return label && value !== null ? { label, value: String(value) } : null;
  });
}

function parseCard(v: unknown, maxActions: number): Card | null {
  if (!isObj(v)) return null;
  const title = line(v.title, LIMITS.lineChars);
  if (!title) return null;
  const price = scalar(v.price, LIMITS.labelChars);
  return {
    title,
    subtitle: line(v.subtitle, LIMITS.lineChars),
    url: httpsUrl(v.url),
    image: mxcUri(v.image),
    price: price === null ? null : String(price),
    store: line(v.store),
    fields: parseFields(v.fields),
    actions: list(v.actions, maxActions, parseButton),
  };
}

// ---------------------------------------------------------------- progress

export const STEP_STATUSES = ["pending", "running", "done", "failed", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export interface Step {
  id: string;
  label: string;
  status: StepStatus;
  detail: string | null;
  started_at: number | null;
  ended_at: number | null;
}
export interface ProgressBlock {
  type: "progress";
  title: string | null;
  steps: Step[];
  summary: string | null;
}

function parseProgress(v: Record<string, unknown>): ProgressBlock | null {
  const steps = list(v.steps, LIMITS.progressSteps, (s): Step | null => {
    if (!isObj(s)) return null;
    const label = line(s.label, LIMITS.lineChars);
    const status = oneOf(s.status, STEP_STATUSES);
    if (!label || !status) return null;
    const id = line(s.id, LIMITS.labelChars) ?? label;
    return {
      id,
      label,
      status,
      detail: text(s.detail, 1000),
      started_at: timestamp(s.started_at),
      ended_at: timestamp(s.ended_at),
    };
  });
  if (!steps.length) return null;
  return {
    type: "progress",
    title: line(v.title, LIMITS.lineChars),
    steps,
    summary: text(v.summary, 1000),
  };
}

// ---------------------------------------------------------------- details / code / diff

export interface DetailsBlock {
  type: "details";
  summary: string;
  body: string;
  open: boolean;
}

export interface CodeBlock {
  type: "code";
  language: string | null;
  filename: string | null;
  code: string;
  truncated: boolean;
}
export interface DiffBlock {
  type: "diff";
  filename: string | null;
  diff: string;
  truncated: boolean;
}

/** Code-ish text: kept verbatim apart from CRLF, NULs, and the char/line caps. */
function codeText(v: unknown): { text: string; truncated: boolean } | null {
  if (typeof v !== "string" || !v.trim()) return null;
  let s = v.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  let truncated = false;
  if (s.length > LIMITS.codeChars) {
    s = s.slice(0, LIMITS.codeChars);
    truncated = true;
  }
  const lines = s.split("\n");
  if (lines.length > LIMITS.codeLines) {
    s = lines.slice(0, LIMITS.codeLines).join("\n");
    truncated = true;
  }
  return { text: s.replace(/\n$/, ""), truncated };
}

// ---------------------------------------------------------------- countdown / event / place

export interface CountdownBlock {
  type: "countdown";
  until: number;
  label: string | null;
}

export interface EventBlock {
  type: "event";
  title: string;
  start: number;
  end: number | null;
  all_day: boolean;
  location: string | null;
  description: string | null;
}

export interface PlaceBlock {
  type: "place";
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

// ---------------------------------------------------------------- ticker / weather

export interface TickerBlock {
  type: "ticker";
  symbol: string;
  name: string | null;
  price: number;
  change: number | null;
  change_pct: number | null;
  currency: string | null;
  series: number[];
}

export const WEATHER_ICONS = [
  "clear",
  "mostly_clear",
  "partly_cloudy",
  "cloudy",
  "fog",
  "drizzle",
  "rain",
  "heavy_rain",
  "thunder",
  "snow",
  "sleet",
  "wind",
  "hot",
  "night",
] as const;
export type WeatherIcon = (typeof WEATHER_ICONS)[number];

export interface Forecast {
  label: string;
  high: number | null;
  low: number | null;
  icon: WeatherIcon | null;
}
export interface WeatherBlock {
  type: "weather";
  location: string;
  temp: number;
  unit: "C" | "F";
  condition: string | null;
  icon: WeatherIcon | null;
  high: number | null;
  low: number | null;
  forecast: Forecast[];
}

// ---------------------------------------------------------------- math

export interface MathBlock {
  type: "math";
  /** TeX source, verbatim apart from NULs (KaTeX renders it, trust off) */
  tex: string;
  /** display (block) math, the default; false: inline */
  display: boolean;
  /** accessible description (aria-label); defaults to the TeX */
  alt: string | null;
  /** one line shown under the formula */
  caption: string | null;
}

function parseMath(v: Record<string, unknown>): MathBlock | null {
  const tex = v.tex;
  // Over-long TeX is dropped rather than cut (a cut formula is wrong).
  if (typeof tex !== "string" || !tex.trim() || Array.from(tex).length > LIMITS.texChars) {
    return null;
  }
  return {
    type: "math",
    tex: tex.replace(/\u0000/g, ""),
    display: v.display !== false,
    alt: line(v.alt, LIMITS.lineChars),
    caption: line(v.caption, LIMITS.lineChars),
  };
}

// ---------------------------------------------------------------- tracker

export const TRACKER_KINDS = ["food", "ride", "delivery", "parcel"] as const;
export type TrackerKind = (typeof TRACKER_KINDS)[number];
export const TRACKER_STATES = ["live", "done", "cancelled"] as const;
export type TrackerState = (typeof TRACKER_STATES)[number];

/** A tracker stage: a progress step with an optional `at` time. */
export interface Stage {
  id: string;
  label: string;
  status: StepStatus;
  at: number | null;
}
/** A static map image the sender rendered (pins drawn); never tiles. */
export interface TrackerMap {
  url: string;
  w: number | null;
  h: number | null;
  alt: string | null;
}
export interface Driver {
  name: string;
  vehicle: string | null;
  plate: string | null;
  rating: number | null;
}
/** Live order / delivery / ride / parcel status, updated by m.replace edits. */
export interface TrackerBlock {
  type: "tracker";
  title: string;
  provider: string;
  kind: TrackerKind | null;
  status: string;
  state: TrackerState;
  stages: Stage[];
  eta: number | null;
  map: TrackerMap | null;
  driver: Driver | null;
  items: string[];
  total: { amount: number; currency: string | null } | null;
  link: string | null;
  updated_at: number | null;
}

/** A positive pixel dimension up to 4096, else null. */
const dim = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n > 0 && n <= 4096 ? Math.round(n) : null;
};

function parseTracker(v: Record<string, unknown>): TrackerBlock | null {
  const title = line(v.title, LIMITS.lineChars);
  const provider = line(v.provider);
  const status = line(v.status, LIMITS.lineChars);
  if (!title || !provider || !status) return null;
  const stages = list(v.stages, LIMITS.trackerStages, (s): Stage | null => {
    if (!isObj(s)) return null;
    const label = line(s.label);
    const st = oneOf(s.status, STEP_STATUSES);
    if (!label || !st) return null;
    return { id: line(s.id, LIMITS.labelChars) ?? label, label, status: st, at: timestamp(s.at) };
  });
  let map: TrackerMap | null = null;
  if (isObj(v.map)) {
    const url = mxcUri(v.map.url);
    if (url)
      map = { url, w: dim(v.map.w), h: dim(v.map.h), alt: line(v.map.alt, LIMITS.lineChars) };
  }
  let driver: Driver | null = null;
  if (isObj(v.driver)) {
    const name = line(v.driver.name);
    const rating = num(v.driver.rating);
    if (name)
      driver = {
        name,
        vehicle: line(v.driver.vehicle),
        plate: line(v.driver.plate, 16),
        rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
      };
  }
  let total: TrackerBlock["total"] = null;
  if (isObj(v.total)) {
    const amount = num(v.total.amount);
    if (amount !== null) total = { amount, currency: line(v.total.currency, 8) };
  }
  return {
    type: "tracker",
    title,
    provider,
    kind: oneOf(v.kind, TRACKER_KINDS),
    status,
    state: oneOf(v.state, TRACKER_STATES, "live"),
    stages,
    eta: timestamp(v.eta),
    map,
    driver,
    items: list(v.items, LIMITS.trackerItems, (x) => line(x, LIMITS.lineChars)),
    total,
    link: httpsUrl(v.link),
    updated_at: timestamp(v.updated_at),
  };
}

// ---------------------------------------------------------------- union + dispatch

export type Block =
  | ButtonsBlock
  | ChipsBlock
  | TableBlock
  | ChartBlock
  | SourcesBlock
  | CardBlock
  | CardsBlock
  | ProgressBlock
  | DetailsBlock
  | CodeBlock
  | DiffBlock
  | CountdownBlock
  | EventBlock
  | PlaceBlock
  | TickerBlock
  | WeatherBlock
  | MathBlock
  | TrackerBlock
  | GalleryBlock
  | FormBlock
  | FileBlock;

export type BlockType = Block["type"];

/**
 * A block this renderer can't draw (unknown type, higher block `v`, or
 * malformed) that carries its own `fallback` text: shown as plain text.
 */
export interface FallbackBlock {
  type: "fallback";
  text: string;
}

/** Every block type is at version 1; a block with a higher `v` falls back. */
export const BLOCK_VERSION = 1;

type Parser = (v: Record<string, unknown>) => Block | null;

const PARSERS: Record<BlockType, Parser> = {
  buttons: (v) => {
    const buttons = list(v.buttons, LIMITS.buttonsPerBlock, parseButton);
    return buttons.length ? { type: "buttons", buttons, scope: parseScope(v.scope) } : null;
  },
  chips: (v) => {
    const chips = list(v.chips, LIMITS.chipsPerBlock, parseButton);
    return chips.length ? { type: "chips", chips, scope: parseScope(v.scope) } : null;
  },
  table: parseTable,
  chart: parseChart,
  sources: parseSources,
  card: (v) => {
    const c = parseCard(v, LIMITS.cardActions);
    return c ? { type: "card", ...c, scope: parseScope(v.scope) } : null;
  },
  cards: (v) => {
    const cards = list(v.cards, LIMITS.cards, (c) => parseCard(c, LIMITS.carouselItemActions));
    if (!cards.length) return null;
    const carousel = cards.length >= LIMITS.carouselMin && cards.every((c) => c.image !== null);
    return {
      type: "cards",
      cards,
      layout: carousel ? "carousel" : "list",
      scope: parseScope(v.scope),
    };
  },
  progress: parseProgress,
  tracker: parseTracker,
  details: (v) => {
    const summary = line(v.summary, LIMITS.lineChars);
    const body = text(v.body);
    return summary && body ? { type: "details", summary, body, open: v.open === true } : null;
  },
  code: (v) => {
    const c = codeText(v.code);
    if (!c) return null;
    return {
      type: "code",
      language: line(v.language, 32),
      filename: line(v.filename, LIMITS.lineChars),
      code: c.text,
      truncated: c.truncated,
    };
  },
  diff: (v) => {
    const c = codeText(v.diff);
    if (!c) return null;
    return {
      type: "diff",
      filename: line(v.filename, LIMITS.lineChars),
      diff: c.text,
      truncated: c.truncated,
    };
  },
  countdown: (v) => {
    const until = timestamp(v.until);
    return until === null
      ? null
      : { type: "countdown", until, label: line(v.label, LIMITS.lineChars) };
  },
  event: (v) => {
    const title = line(v.title, LIMITS.lineChars);
    const start = timestamp(v.start);
    if (!title || start === null) return null;
    const end = timestamp(v.end);
    return {
      type: "event",
      title,
      start,
      end: end !== null && end >= start ? end : null,
      all_day: v.all_day === true,
      location: line(v.location, LIMITS.lineChars),
      description: text(v.description, 2000),
    };
  },
  place: (v) => {
    const name = line(v.name, LIMITS.lineChars);
    if (!name) return null;
    const lat = num(v.lat);
    const lng = num(v.lng);
    const coords = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    return {
      type: "place",
      name,
      address: line(v.address, LIMITS.lineChars),
      lat: coords ? lat : null,
      lng: coords ? lng : null,
    };
  },
  ticker: (v) => {
    const symbol = line(v.symbol, 16);
    const price = num(v.price);
    if (!symbol || price === null) return null;
    return {
      type: "ticker",
      symbol,
      name: line(v.name, LIMITS.labelChars),
      price,
      change: num(v.change),
      change_pct: num(v.change_pct),
      currency: line(v.currency, 8),
      series: Array.isArray(v.series)
        ? v.series
            .slice(0, LIMITS.tickerSeries)
            .map(num)
            .filter((x): x is number => x !== null)
        : [],
    };
  },
  weather: (v) => {
    const location = line(v.location, LIMITS.lineChars);
    const temp = num(v.temp);
    if (!location || temp === null) return null;
    return {
      type: "weather",
      location,
      temp,
      unit: oneOf(v.unit, ["C", "F"] as const, "C"),
      condition: line(v.condition),
      icon: oneOf(v.icon, WEATHER_ICONS),
      high: num(v.high),
      low: num(v.low),
      forecast: list(v.forecast, LIMITS.forecast, (f): Forecast | null => {
        if (!isObj(f)) return null;
        const label = line(f.label, 16);
        return label
          ? { label, high: num(f.high), low: num(f.low), icon: oneOf(f.icon, WEATHER_ICONS) }
          : null;
      }),
    };
  },
  math: parseMath,
  gallery: parseGallery,
  form: parseForm,
  file: parseFile,
};

/** Every block type this renderer implements. */
export const BLOCK_TYPES = Object.keys(PARSERS) as BlockType[];

/**
 * One block; its `fallback` text when it can't be drawn (unknown type,
 * block `v` above BLOCK_VERSION, malformed); or null.
 */
export function parseBlock(v: unknown): Block | FallbackBlock | null {
  if (!isObj(v)) return null;
  const fb = text(v.fallback, LIMITS.fallbackChars);
  const fallback: FallbackBlock | null = fb ? { type: "fallback", text: fb } : null;
  const ver = v.v === undefined ? 1 : v.v;
  if (
    typeof v.type !== "string" ||
    !Object.hasOwn(PARSERS, v.type) ||
    typeof ver !== "number" ||
    !Number.isInteger(ver) ||
    ver < 1 ||
    ver > BLOCK_VERSION
  )
    return fallback;
  try {
    return PARSERS[v.type as BlockType](v) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Every clickable action in a block (buttons, chips, card actions). */
export function blockActions(b: Block | FallbackBlock): Button[] {
  switch (b.type) {
    case "buttons":
      return b.buttons;
    case "chips":
      return b.chips;
    case "card":
      return b.actions;
    case "cards":
      return b.cards.flatMap((c) => c.actions);
    default:
      return [];
  }
}
