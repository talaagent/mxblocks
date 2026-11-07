// RFC 4180 CSV for the table block's "Download CSV" (built client-side, no network).

import type { Cell } from "../schema/index.ts";

/**
 * One CSV field. Cells starting with = + - @ (or tab/CR) are prefixed with
 * an apostrophe so a spreadsheet won't evaluate them as formulas (CSV
 * injection); plain negative numbers are left alone.
 */
export function csvField(v: Cell): string {
  if (v === null) return "";
  let s = String(v);
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** A safe download file name from a caption/title. */
export function fileName(base: string | null, ext: string, fallback = "table"): string {
  const s = (base ?? "")
    .replace(/[^\p{L}\p{N} _.-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${s || fallback}.${ext}`;
}
