// `chart` (line/bar/area/sparkline) and the ticker's sparkline: inline SVG
// built here, no chart library. Series colours are the module's own
// categorical slots (--mxblocks-s1..s6, light/dark steps keyed off Element's
// cpd-theme-* class); text, grid and axes use Element's Compound tokens.

import { React } from "../react";
import type { ChartBlock } from "../schema/index.ts";
import { areaPath, extent, labelIndices, linePath, linear, niceTicks } from "../lib/chart.ts";
import { fmtCompact, fmtNum } from "../lib/format.ts";

const W = 480;
const H = 180;
const PAD = { top: 8, right: 8, bottom: 22, left: 40 };

const color = (i: number): string => `var(--mxblocks-s${(i % 6) + 1})`;

export function Sparkline({
  values,
  width = 120,
  height = 28,
  tone,
  label,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  tone?: "up" | "down";
  label?: string;
}): React.JSX.Element | null {
  if (values.filter((v) => v !== null).length < 2) return null;
  const [lo, hi] = extent([values], false);
  const x = linear(0, values.length - 1, 1, width - 1);
  const y = linear(lo, hi === lo ? lo + 1 : hi, height - 2, 2);
  const stroke =
    tone === "up" ? "var(--mxblocks-up)" : tone === "down" ? "var(--mxblocks-down)" : color(0);
  return (
    <svg
      className="mxblocks_spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? "trend"}
    >
      <path
        d={linePath(values, x, y)}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Chart({ block }: { block: ChartBlock }): React.JSX.Element {
  const [hover, setHover] = React.useState<number | null>(null);
  const unit = block.unit ? ` ${block.unit}` : "";

  if (block.kind === "sparkline") {
    const s = block.series[0];
    const last = [...s.values].reverse().find((v) => v !== null);
    return (
      <div className="mxblocks_sparkRow">
        {block.title ? <span className="mxblocks_title">{block.title}</span> : null}
        <Sparkline
          values={s.values}
          width={160}
          height={32}
          label={block.title ?? s.name ?? "trend"}
        />
        {last !== undefined && last !== null ? (
          <span className="mxblocks_num">
            {fmtNum(last)}
            {unit}
          </span>
        ) : null}
      </div>
    );
  }

  const n = block.labels.length;
  const values = block.series.map((s) => s.values);
  const bars = block.kind === "bar";
  const [lo, hi] = extent(values, bars || block.kind === "area");
  const ticks = niceTicks(lo, hi);
  const y = linear(ticks[0], ticks[ticks.length - 1], H - PAD.bottom, PAD.top);
  const plotW = W - PAD.left - PAD.right;
  // Bars sit in n bands; lines/areas run edge to edge.
  const band = plotW / Math.max(n, 1);
  const x = bars
    ? (i: number) => PAD.left + band * (i + 0.5)
    : linear(0, Math.max(n - 1, 1), PAD.left, W - PAD.right);
  const base = Math.max(ticks[0], Math.min(0, ticks[ticks.length - 1]));
  const shown = new Set(labelIndices(n, 8));
  const title = block.title ?? "Chart";

  const readout =
    hover !== null ? (
      <span className="mxblocks_readout">
        <b>{block.labels[hover] || `#${hover + 1}`}</b>
        {block.series.map((s, i) => {
          const v = s.values[hover];
          return (
            <span key={i}>
              <i className="mxblocks_swatch" style={{ background: color(i) }} />
              {s.name ? `${s.name} ` : ""}
              {v === null || v === undefined ? "–" : `${fmtNum(v)}${unit}`}
            </span>
          );
        })}
      </span>
    ) : null;

  const groupW = Math.min(band * 0.7, 48);
  const barW = Math.max(groupW / block.series.length - 2, 2);

  return (
    <figure className="mxblocks_chart">
      <div className="mxblocks_head">
        <span className="mxblocks_title">{block.title ?? ""}</span>
        {readout}
      </div>
      {block.series.length > 1 ? (
        <div className="mxblocks_legend">
          {block.series.map((s, i) => (
            <span key={i}>
              <i className="mxblocks_swatch" style={{ background: color(i) }} />
              {s.name ?? `Series ${i + 1}`}
            </span>
          ))}
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={title}
        onMouseLeave={() => setHover(null)}
      >
        <title>{title}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line className="mxblocks_grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="mxblocks_axis" x={PAD.left - 4} y={y(t)} dy="0.32em" textAnchor="end">
              {fmtCompact(t)}
            </text>
          </g>
        ))}
        {block.labels.map((l, i) =>
          shown.has(i) && l ? (
            <text
              key={i}
              className="mxblocks_axis"
              x={x(i)}
              y={H - 6}
              textAnchor={bars ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            >
              {l}
            </text>
          ) : null,
        )}
        {bars
          ? block.series.map((s, si) =>
              s.values.map((v, i) => {
                if (v === null) return null;
                const top = Math.min(y(v), y(base));
                const h = Math.max(Math.abs(y(v) - y(base)), 1);
                return (
                  <rect
                    key={`${si}-${i}`}
                    x={x(i) - groupW / 2 + si * (barW + 2) + 1}
                    y={top}
                    width={barW}
                    height={h}
                    rx={Math.min(2, barW / 2)}
                    fill={color(si)}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                );
              }),
            )
          : block.series.map((s, si) => (
              <g key={si}>
                {block.kind === "area" ? (
                  <path d={areaPath(s.values, x, y, base)} fill={color(si)} opacity={0.18} />
                ) : null}
                <path
                  d={linePath(s.values, x, y)}
                  fill="none"
                  stroke={color(si)}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            ))}
        {hover !== null && !bars ? (
          <g>
            <line
              className="mxblocks_cross"
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={H - PAD.bottom}
            />
            {block.series.map((s, si) => {
              const v = s.values[hover];
              return v === null || v === undefined ? null : (
                <circle
                  key={si}
                  cx={x(hover)}
                  cy={y(v)}
                  r={4}
                  fill={color(si)}
                  className="mxblocks_dot"
                />
              );
            })}
          </g>
        ) : null}
        {/* Hit targets: one full-height column per x, wider than the marks. */}
        {block.labels.map((_, i) => {
          const w = bars ? band : plotW / Math.max(n - 1, 1);
          return (
            <rect
              key={i}
              x={x(i) - w / 2}
              y={PAD.top}
              width={w}
              height={H - PAD.top - PAD.bottom}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          );
        })}
      </svg>
    </figure>
  );
}
