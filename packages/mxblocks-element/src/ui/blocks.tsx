// Display blocks: sources, card(s), progress, details, code, diff, countdown,
// event, place, ticker, weather, tracker. All payload text is rendered as React text
// nodes; links are parser-validated https URLs; images are mxc thumbnails
// fetched with the access token into Blob URLs.

import { React } from "../react";
import type {
  Card,
  CardsBlock,
  CodeBlock,
  CountdownBlock,
  DetailsBlock,
  DiffBlock,
  EventBlock,
  PlaceBlock,
  ProgressBlock,
  SourcesBlock,
  Step,
  TickerBlock,
  TrackerBlock,
  TrackerKind,
  WeatherBlock,
  WeatherIcon,
} from "../schema/index.ts";
import {
  badgeLetter,
  countdown,
  domain,
  elapsed,
  fmtMoney,
  fmtNum,
  mapsUrl,
  signed,
} from "../lib/format.ts";
import { fileName } from "../lib/csv.ts";
import { toIcs } from "../lib/ics.ts";
import { useMediaUrl } from "../matrix";
import { ActionRow, type Interactions } from "./buttons";
import { Sparkline } from "./chart";
import { CopyButton, ExtLink, cx, download, useNearViewport, useNow } from "./util";

// ---------------------------------------------------------------- sources

export function Sources({ block }: { block: SourcesBlock }): React.JSX.Element {
  return (
    <div className="mxblocks_sources">
      {block.sources.map((s, i) => (
        <ExtLink key={i} href={s.url} className="mxblocks_source" title={`${s.title}\n${s.url}`}>
          <span className="mxblocks_badge" aria-hidden="true">
            {badgeLetter(s.url)}
          </span>
          <span className="mxblocks_sourceTitle">{s.title}</span>
          <span className="mxblocks_muted">{domain(s.url)}</span>
        </ExtLink>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- card / cards

/** A plain mxc image cropped to w×h (scale thumbnail, object-fit: cover); omitted if it fails. */
function Thumb({
  mxc,
  w,
  h,
  alt = "",
}: {
  mxc: string;
  w: number;
  h: number;
  alt?: string;
}): React.JSX.Element | null {
  const ref = React.useRef<HTMLSpanElement>(null);
  const near = useNearViewport(ref);
  const [failed, setFailed] = React.useState(false);
  const src = React.useMemo(() => ({ kind: "plain" as const, mxc }), [mxc]);
  const media = useMediaUrl(src, null, { w, h }, near);
  if (failed || media.failed) return null;
  if (!media.url)
    return (
      <span
        ref={ref}
        className="mxblocks_img"
        style={{ display: "block", width: w, height: h }}
        aria-busy="true"
      />
    );
  return (
    <img
      className="mxblocks_img"
      src={media.url}
      alt={alt}
      width={w}
      height={h}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function CardView({
  card,
  wide,
  scope,
  ctx,
}: {
  card: Card;
  wide: boolean;
  scope: string[] | null;
  ctx: Interactions;
}): React.JSX.Element {
  const title = card.url ? (
    <ExtLink href={card.url} className="mxblocks_cardTitle">
      {card.title}
    </ExtLink>
  ) : (
    <span className="mxblocks_cardTitle">{card.title}</span>
  );
  return (
    <div className={cx("mxblocks_card", wide ? "mxblocks_card--wide" : "mxblocks_card--tall")}>
      {card.image ? <Thumb mxc={card.image} w={wide ? 72 : 200} h={wide ? 72 : 120} /> : null}
      <div className="mxblocks_cardBody">
        {title}
        {card.subtitle ? <span className="mxblocks_muted">{card.subtitle}</span> : null}
        {card.price || card.store || card.url ? (
          <span className="mxblocks_cardMeta">
            {card.price ? <b className="mxblocks_price">{card.price}</b> : null}
            {card.store ?? (card.url ? domain(card.url) : null)}
          </span>
        ) : null}
        {card.fields.length ? (
          <dl className="mxblocks_fields">
            {card.fields.map((f, i) => (
              <React.Fragment key={i}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        ) : null}
        {card.actions.length ? (
          <ActionRow items={card.actions} chips={false} scope={scope} ctx={ctx} />
        ) : null}
      </div>
    </div>
  );
}

export function Cards({ block, ctx }: { block: CardsBlock; ctx: Interactions }): React.JSX.Element {
  // Fewer than 3 items, or any without an image: single cards, stacked.
  if (block.layout === "list")
    return (
      <div className="mxblocks_cardList">
        {block.cards.map((c, i) => (
          <CardView key={i} card={c} wide scope={block.scope} ctx={ctx} />
        ))}
      </div>
    );
  return (
    <div className="mxblocks_carousel" role="list">
      {block.cards.map((c, i) => (
        <div role="listitem" key={i}>
          <CardView card={c} wide={false} scope={block.scope} ctx={ctx} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- progress

const STEP_ICON: Record<Step["status"], string> = {
  pending: "○",
  running: "",
  done: "✓",
  failed: "✕",
  skipped: "–",
};

export function Progress({ block }: { block: ProgressBlock }): React.JSX.Element {
  const running = block.steps.some((s) => s.status === "running" && s.started_at !== null);
  const now = useNow(1000, running);
  const done = block.steps.filter((s) => s.status === "done").length;
  const failed = block.steps.filter((s) => s.status === "failed").length;
  return (
    <div className="mxblocks_progress">
      <div className="mxblocks_head">
        <span className="mxblocks_title">{block.title ?? ""}</span>
        <span className="mxblocks_muted">
          {done}/{block.steps.length} done{failed ? `, ${failed} failed` : ""}
        </span>
      </div>
      <ol>
        {block.steps.map((s) => {
          const t =
            s.started_at === null
              ? null
              : s.ended_at !== null
                ? s.ended_at - s.started_at
                : s.status === "running"
                  ? now - s.started_at
                  : null;
          return (
            <li key={s.id} className={`mxblocks_step mxblocks_step--${s.status}`}>
              <span className="mxblocks_stepIcon" aria-label={s.status} title={s.status}>
                {s.status === "running" ? (
                  <span className="mxblocks_spinner" />
                ) : (
                  STEP_ICON[s.status]
                )}
              </span>
              <span className="mxblocks_stepText">
                <span>{s.label}</span>
                {s.detail ? <span className="mxblocks_stepDetail">{s.detail}</span> : null}
              </span>
              {t !== null && t >= 0 ? (
                <span className="mxblocks_muted mxblocks_num">{elapsed(t)}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {block.summary ? <div className="mxblocks_summary">{block.summary}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- details / code / diff

export function Details({ block }: { block: DetailsBlock }): React.JSX.Element {
  return (
    <details className="mxblocks_details" open={block.open}>
      <summary>{block.summary}</summary>
      <pre>{block.body}</pre>
    </details>
  );
}

function diffClass(l: string): string {
  if (l.startsWith("+++") || l.startsWith("---")) return "mxblocks_diffFile";
  if (l.startsWith("@@")) return "mxblocks_diffHunk";
  if (l.startsWith("+")) return "mxblocks_diffAdd";
  if (l.startsWith("-")) return "mxblocks_diffDel";
  return "";
}

function CodeFrame({
  label,
  copy,
  truncated,
  children,
}: {
  label: string;
  copy: string;
  truncated: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mxblocks_code">
      <div className="mxblocks_head">
        <span className="mxblocks_mono mxblocks_muted">{label}</span>
        {truncated ? <span className="mxblocks_muted">(truncated)</span> : null}
        <CopyButton text={copy} />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export function Code({ block }: { block: CodeBlock }): React.JSX.Element {
  const label = [block.filename, block.language].filter(Boolean).join(" · ") || "code";
  if (block.language === "diff")
    return (
      <Diff
        block={{
          type: "diff",
          filename: block.filename,
          diff: block.code,
          truncated: block.truncated,
        }}
      />
    );
  return (
    <CodeFrame label={label} copy={block.code} truncated={block.truncated}>
      <code>{block.code}</code>
    </CodeFrame>
  );
}

export function Diff({ block }: { block: DiffBlock }): React.JSX.Element {
  const lines = block.diff.split("\n");
  const add = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const del = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  return (
    <CodeFrame
      label={`${block.filename ?? "diff"}  +${add} −${del}`}
      copy={block.diff}
      truncated={block.truncated}
    >
      <code>
        {lines.map((l, i) => (
          <span key={i} className={cx("mxblocks_diffLine", diffClass(l))}>
            {l || " "}
          </span>
        ))}
      </code>
    </CodeFrame>
  );
}

// ---------------------------------------------------------------- countdown / event / place

const fmtWhen = (ms: number, allDay = false): string =>
  new Date(ms).toLocaleString(
    undefined,
    allDay
      ? { weekday: "short", month: "short", day: "numeric", year: "numeric" }
      : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );

export function Countdown({
  block,
  ended = "ended",
}: {
  block: CountdownBlock;
  ended?: string;
}): React.JSX.Element {
  const now = useNow(1000, Date.now() < block.until);
  const left = block.until - now;
  return (
    <div className="mxblocks_countdown" title={fmtWhen(block.until)}>
      <span className="mxblocks_countdownIcon" aria-hidden="true">
        ⏱
      </span>
      {block.label ? <span>{block.label}</span> : null}
      <b className="mxblocks_num">{left > 0 ? countdown(left) : ended}</b>
    </div>
  );
}

export function EventCard({
  block,
  eventId,
}: {
  block: EventBlock;
  eventId: string;
}): React.JSX.Element {
  const when =
    block.end === null
      ? fmtWhen(block.start, block.all_day)
      : `${fmtWhen(block.start, block.all_day)} – ${fmtWhen(block.end, block.all_day)}`;
  const onIcs = (): void =>
    download(
      fileName(block.title, "ics", "event"),
      "text/calendar;charset=utf-8",
      // Stable UID per message, so re-importing updates rather than duplicates.
      toIcs(block, `${eventId.replace(/[^A-Za-z0-9_-]/g, "")}@mxblocks`, Date.now()),
    );
  const d = new Date(block.start);
  return (
    <div className="mxblocks_event">
      <div className="mxblocks_date" aria-hidden="true">
        <span>{d.toLocaleString(undefined, { month: "short" })}</span>
        <b>{d.getDate()}</b>
      </div>
      <div className="mxblocks_cardBody">
        <span className="mxblocks_cardTitle">{block.title}</span>
        <span className="mxblocks_muted">{when}</span>
        {block.location ? <span className="mxblocks_muted">📍 {block.location}</span> : null}
        {block.description ? <span className="mxblocks_pre">{block.description}</span> : null}
        <span>
          <button type="button" className="mxblocks_btn mxblocks_btn--small" onClick={onIcs}>
            Add to calendar
          </button>
        </span>
      </div>
    </div>
  );
}

export function Place({ block }: { block: PlaceBlock }): React.JSX.Element {
  return (
    <div className="mxblocks_place">
      <span className="mxblocks_placeIcon" aria-hidden="true">
        📍
      </span>
      <div className="mxblocks_cardBody">
        <span className="mxblocks_cardTitle">{block.name}</span>
        {block.address ? <span className="mxblocks_muted">{block.address}</span> : null}
        {block.lat !== null && block.lng !== null ? (
          <span className="mxblocks_muted mxblocks_num">
            {block.lat.toFixed(5)}, {block.lng.toFixed(5)}
          </span>
        ) : null}
        <span>
          <ExtLink href={mapsUrl(block)} className="mxblocks_btn mxblocks_btn--small">
            Open in Google Maps
          </ExtLink>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ticker / weather

export function Ticker({ block }: { block: TickerBlock }): React.JSX.Element {
  const dir =
    (block.change ?? block.change_pct ?? 0) > 0
      ? "up"
      : (block.change ?? block.change_pct ?? 0) < 0
        ? "down"
        : undefined;
  return (
    <div className="mxblocks_ticker">
      <div className="mxblocks_cardBody">
        <span>
          <b className="mxblocks_mono">{block.symbol}</b>
          {block.name ? <span className="mxblocks_muted"> {block.name}</span> : null}
        </span>
        <span className="mxblocks_tickerPrice">
          <b className="mxblocks_num">{fmtMoney(block.price, block.currency)}</b>
          {block.change !== null || block.change_pct !== null ? (
            <span className={cx("mxblocks_num", dir && `mxblocks_${dir}`)}>
              {dir === "up" ? "▲ " : dir === "down" ? "▼ " : ""}
              {block.change !== null ? signed(block.change) : ""}
              {block.change_pct !== null ? ` (${signed(block.change_pct)}%)` : ""}
            </span>
          ) : null}
        </span>
      </div>
      <Sparkline values={block.series} tone={dir} label={`${block.symbol} trend`} />
    </div>
  );
}

export const WEATHER_EMOJI: Record<WeatherIcon, string> = {
  clear: "☀️",
  mostly_clear: "🌤️",
  partly_cloudy: "⛅",
  cloudy: "☁️",
  fog: "🌫️",
  drizzle: "🌦️",
  rain: "🌧️",
  heavy_rain: "🌧️",
  thunder: "⛈️",
  snow: "🌨️",
  sleet: "🌨️",
  wind: "💨",
  hot: "🔥",
  night: "🌙",
};

const deg = (n: number | null): string => (n === null ? "–" : `${fmtNum(n, 0)}°`);

export function Weather({ block }: { block: WeatherBlock }): React.JSX.Element {
  return (
    <div className="mxblocks_weather">
      <div className="mxblocks_weatherNow">
        <span className="mxblocks_weatherIcon" aria-hidden="true">
          {block.icon ? WEATHER_EMOJI[block.icon] : "🌡️"}
        </span>
        <b className="mxblocks_weatherTemp">
          {fmtNum(block.temp, 0)}°{block.unit}
        </b>
        <div className="mxblocks_cardBody">
          <span className="mxblocks_cardTitle">{block.location}</span>
          <span className="mxblocks_muted">
            {[
              block.condition,
              block.high !== null || block.low !== null
                ? `H ${deg(block.high)} L ${deg(block.low)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </div>
      {block.forecast.length ? (
        <div className="mxblocks_forecast">
          {block.forecast.map((f, i) => (
            <div key={i}>
              <span className="mxblocks_muted">{f.label}</span>
              <span aria-label={f.icon ?? undefined}>{f.icon ? WEATHER_EMOJI[f.icon] : ""}</span>
              <span className="mxblocks_num">
                {deg(f.high)} <span className="mxblocks_muted">{deg(f.low)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- tracker

export const TRACKER_EMOJI: Record<TrackerKind, string> = {
  food: "🛵",
  ride: "🚗",
  delivery: "🚚",
  parcel: "📦",
};

const hhmm = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Map thumbnail box: the sender's aspect ratio, at most 280×200. */
function mapBox(w: number | null, h: number | null): { w: number; h: number } {
  if (!w || !h) return { w: 280, h: 160 };
  const k = Math.min(280 / w, 200 / h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

export function Tracker({ block }: { block: TrackerBlock }): React.JSX.Element {
  const live = block.state === "live";
  const icon = block.state === "cancelled" ? "✕" : block.kind ? TRACKER_EMOJI[block.kind] : "📍";
  const box = block.map ? mapBox(block.map.w, block.map.h) : null;
  const d = block.driver;
  return (
    <div className={`mxblocks_tracker mxblocks_tracker--${block.state}`}>
      <div className="mxblocks_trackerHead">
        <span className="mxblocks_trackerIcon" aria-hidden="true">
          {icon}
        </span>
        <div className="mxblocks_cardBody">
          <span className="mxblocks_trackerTitle">
            <span className="mxblocks_muted">{block.provider}</span> {block.title}
          </span>
          <span className="mxblocks_trackerStatus">
            {block.state === "done" ? "✓ " : ""}
            {block.status}
          </span>
        </div>
        {live && block.eta !== null ? (
          <Countdown
            block={{ type: "countdown", until: block.eta, label: `ETA ${hhmm(block.eta)}` }}
            ended="any minute"
          />
        ) : null}
      </div>
      {block.stages.length ? (
        <ol className="mxblocks_stages">
          {block.stages.map((s) => (
            <li
              key={s.id}
              className={`mxblocks_stage mxblocks_step--${s.status}`}
              title={s.at !== null ? `${s.label} · ${hhmm(s.at)}` : s.label}
            >
              <span className="mxblocks_stepIcon" aria-label={s.status}>
                {s.status === "running" && live ? (
                  <span className="mxblocks_spinner" />
                ) : (
                  STEP_ICON[s.status] || "●"
                )}
              </span>
              <span className="mxblocks_stageLabel">{s.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {block.map && box ? (
        <Thumb mxc={block.map.url} w={box.w} h={box.h} alt={block.map.alt ?? "Map"} />
      ) : null}
      {d ? (
        <div className="mxblocks_trackerRow">
          <span aria-hidden="true">{block.kind === "ride" ? "🧑‍✈️" : "🧑"}</span>
          <b>{d.name}</b>
          {d.rating !== null ? (
            <span className="mxblocks_muted">★ {fmtNum(d.rating, 1)}</span>
          ) : null}
          {d.vehicle || d.plate ? (
            <span className="mxblocks_muted">
              {[d.vehicle, d.plate].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </div>
      ) : null}
      {block.items.length ? (
        <div className="mxblocks_muted mxblocks_trackerItems">{block.items.join(" · ")}</div>
      ) : null}
      {block.total || block.link || block.updated_at !== null ? (
        <div className="mxblocks_trackerRow">
          {block.total ? (
            <b className="mxblocks_price">{fmtMoney(block.total.amount, block.total.currency)}</b>
          ) : null}
          {block.updated_at !== null ? (
            <span className="mxblocks_muted">Updated {hhmm(block.updated_at)}</span>
          ) : null}
          {block.link ? (
            <ExtLink href={block.link} className="mxblocks_btn mxblocks_btn--small">
              Open in {block.provider}
            </ExtLink>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
