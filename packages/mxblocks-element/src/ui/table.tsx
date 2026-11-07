// `table`: sortable headers (numeric-aware), client-side CSV, horizontal scroll.

import { React } from "../react";
import type { TableBlock } from "../schema/index.ts";
import { fileName, toCsv } from "../lib/csv.ts";
import { isNumericColumn, sortedIndices } from "../lib/sort.ts";
import { fmtNum } from "../lib/format.ts";
import { download } from "./util";

type Sort = { col: number; dir: 1 | -1 } | null;

export function Table({ block }: { block: TableBlock }): React.JSX.Element {
  const [sort, setSort] = React.useState<Sort>(null);
  const numeric = React.useMemo(
    () => block.columns.map((_, i) => isNumericColumn(block.rows, i)),
    [block],
  );
  const order = React.useMemo(
    () => (sort ? sortedIndices(block.rows, sort.col, sort.dir) : block.rows.map((_, i) => i)),
    [block, sort],
  );
  // Click cycles: ascending → descending → original order.
  const onSort = (col: number): void =>
    setSort((s) => (s?.col !== col ? { col, dir: 1 } : s.dir === 1 ? { col, dir: -1 } : null));
  const onCsv = (): void =>
    download(
      fileName(block.caption, "csv"),
      "text/csv;charset=utf-8",
      toCsv(
        block.columns.map((c) => c.label),
        order.map((i) => block.rows[i]),
      ),
    );

  return (
    <div className="mxblocks_table">
      <div className="mxblocks_head">
        <span className="mxblocks_title">{block.caption ?? ""}</span>
        <span className="mxblocks_muted">
          {block.rows.length} row{block.rows.length === 1 ? "" : "s"}
          {block.truncated ? " (truncated)" : ""}
        </span>
        <button type="button" className="mxblocks_btn mxblocks_btn--small" onClick={onCsv}>
          Download CSV
        </button>
      </div>
      <div className="mxblocks_scroll">
        <table>
          <thead>
            <tr>
              {block.columns.map((c, i) => {
                const active = sort?.col === i;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={{ textAlign: c.align ?? (numeric[i] ? "right" : "left") }}
                    aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                  >
                    <button type="button" onClick={() => onSort(i)} title={`Sort by ${c.label}`}>
                      {c.label}
                      <span className="mxblocks_sort">
                        {active ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {order.map((r) => (
              <tr key={r}>
                {block.rows[r].map((v, i) => (
                  <td
                    key={i}
                    style={{ textAlign: block.columns[i].align ?? (numeric[i] ? "right" : "left") }}
                  >
                    {typeof v === "number" ? fmtNum(v, 6) : (v ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
