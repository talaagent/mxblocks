// Geometry for the module-built SVG charts (no chart library).

/** "Nice" axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/** Extent of all finite values; bar/area charts always include 0. */
export function extent(series: (number | null)[][], includeZero: boolean): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series)
    for (const v of s)
      if (v !== null) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
  if (!Number.isFinite(lo)) return [0, 1];
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  return [lo, hi];
}

export type Scale = (v: number) => number;

export function linear(d0: number, d1: number, r0: number, r1: number): Scale {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/**
 * SVG path for a line through the points; null values break the line into
 * separate segments. Single isolated points become zero-length segments
 * (drawn as dots by round line caps).
 */
export function linePath(values: (number | null)[], x: Scale, y: Scale): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const px = x(i).toFixed(1);
    const py = y(v).toFixed(1);
    d += pen ? `L${px},${py}` : `M${px},${py}`;
    pen = true;
  });
  return d.replace(/M([\d.-]+),([\d.-]+)(?=M|$)/g, "M$1,$2h0");
}

/** Closed area paths down to `base` for each unbroken run of values. */
export function areaPath(values: (number | null)[], x: Scale, y: Scale, base: number): string {
  const runs: number[][] = [];
  let cur: number[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(i);
  });
  if (cur.length) runs.push(cur);
  const by = y(base).toFixed(1);
  return runs
    .map((run) => {
      const top = run.map((i) => `${x(i).toFixed(1)},${y(values[i] as number).toFixed(1)}`);
      return `M${x(run[0]).toFixed(1)},${by}L${top.join("L")}L${x(run[run.length - 1]).toFixed(1)},${by}Z`;
    })
    .join("");
}

/** Indices of x labels to show so they don't collide (about `max` of them, always the last). */
export function labelIndices(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil(n / max);
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  if (out[out.length - 1] !== n - 1) {
    if (n - 1 - out[out.length - 1] < step / 2) out.pop();
    out.push(n - 1);
  }
  return out;
}
