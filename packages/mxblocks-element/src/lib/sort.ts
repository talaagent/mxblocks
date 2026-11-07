// Numeric-aware sorting for table columns.

import type { Cell } from "../schema/index.ts";

/** A cell as a number if it reads as one ("1,234", "₱1,200", "12.5%", "-3"), else null. */
export function cellNumber(v: Cell): number | null {
  if (typeof v === "number") return v;
  if (v === null) return null;
  const s = v
    .trim()
    .replace(/^[^\d+\-.]{1,4}(?=[\d+\-.])/, "") // leading currency symbol/code
    .replace(/(?<=\d),(?=\d{3}\b)/g, "") // thousands separators
    .replace(/\s*(%|[A-Za-z]{1,4})$/, ""); // trailing % / unit
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Compare two cells: numbers numerically when both read as numbers, else
 * natural string order. Empty cells sort last in either direction.
 */
export function compareCells(a: Cell, b: Cell, dir: 1 | -1): number {
  const ea = a === null || a === "";
  const eb = b === null || b === "";
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const na = cellNumber(a);
  const nb = cellNumber(b);
  if (na !== null && nb !== null) return (na - nb) * dir;
  return collator.compare(String(a), String(b)) * dir;
}

/** Row indices sorted by column `col` (stable). */
export function sortedIndices(rows: Cell[][], col: number, dir: 1 | -1): number[] {
  return rows
    .map((_, i) => i)
    .sort((i, j) => compareCells(rows[i][col], rows[j][col], dir) || i - j);
}

/** Whether a column is mostly numeric (right-aligned by default). */
export function isNumericColumn(rows: Cell[][], col: number): boolean {
  let n = 0;
  let total = 0;
  for (const r of rows) {
    const v = r[col];
    if (v === null || v === "") continue;
    total++;
    if (cellNumber(v) !== null) n++;
  }
  return total > 0 && n / total >= 0.8;
}
