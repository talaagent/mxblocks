import { test } from "node:test";
import assert from "node:assert/strict";

import { csvField, fileName, toCsv } from "../src/lib/csv.ts";
import { cellNumber, compareCells, isNumericColumn, sortedIndices } from "../src/lib/sort.ts";
import { badgeLetter, countdown, domain, elapsed, mapsUrl } from "../src/lib/format.ts";
import { icsEscape, icsFold, toIcs } from "../src/lib/ics.ts";
import { rebaseKatexCss, renderTex } from "../src/lib/tex.ts";
import { areaPath, extent, labelIndices, linePath, linear, niceTicks } from "../src/lib/chart.ts";

test("csv", () => {
  assert.equal(csvField('a "b", c'), '"a ""b"", c"');
  assert.equal(csvField("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvField(-3), "-3");
  assert.equal(csvField(null), "");
  assert.equal(toCsv(["a", "b"], [[1, "x\ny"]]), 'a,b\r\n1,"x\ny"\r\n');
  assert.equal(fileName("Q3 prices / ₱", "csv"), "Q3-prices.csv");
  assert.equal(fileName(null, "csv"), "table.csv");
});

test("numeric-aware sort", () => {
  assert.equal(cellNumber("₱1,200"), 1200);
  assert.equal(cellNumber("12.5%"), 12.5);
  assert.equal(cellNumber("-3"), -3);
  assert.equal(cellNumber("PHP 2,499.50"), 2499.5);
  assert.equal(cellNumber("abc"), null);
  assert.equal(cellNumber("1.2.3"), null);
  const rows = [["₱1,200"], ["₱90"], [null], ["₱300"]];
  assert.deepEqual(sortedIndices(rows, 0, 1), [1, 3, 0, 2]);
  assert.deepEqual(sortedIndices(rows, 0, -1), [0, 3, 1, 2], "empty stays last");
  assert.ok(compareCells("item 10", "item 9", 1) > 0, "natural order");
  assert.ok(isNumericColumn(rows, 0));
  assert.ok(!isNumericColumn([["a"], ["1"]], 0));
});

test("format", () => {
  assert.equal(elapsed(65_000), "1:05");
  assert.equal(elapsed(3_723_000), "1:02:03");
  assert.equal(elapsed(4_000), "4s");
  assert.equal(countdown(90_061_000), "1d 01:01:01");
  assert.equal(countdown(61_000), "01:01");
  assert.equal(domain("https://www.example.com/x"), "example.com");
  assert.equal(badgeLetter("https://www.github.com"), "G");
  assert.equal(
    mapsUrl({ name: "Hotel Example", address: "Downtown, Example City", lat: null, lng: null }),
    "https://www.google.com/maps/search/?api=1&query=Hotel%20Example%2C%20Downtown%2C%20Example%20City",
  );
  assert.equal(mapsUrl({ name: "x", address: null, lat: 14.5, lng: 121 }), "https://www.google.com/maps/search/?api=1&query=14.5%2C121");
});

test("ics", () => {
  assert.equal(icsEscape("a;b,c\\d\ne"), "a\;b\\,c\\\\d\\ne");
  const folded = icsFold("X".repeat(200));
  assert.ok(folded.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
  assert.equal(folded.replace(/\r\n /g, ""), "X".repeat(200));
  const s = toIcs(
    { title: "Dinner, Downtown", start: Date.UTC(2026, 9, 15, 10), end: null, all_day: false, location: null, description: "a\nb" },
    "uid@x",
    Date.UTC(2026, 9, 1),
  );
  assert.match(s, /DTSTART:20261015T100000Z\r\nDTEND:20261015T110000Z/);
  assert.match(s, /SUMMARY:Dinner\\, Downtown/);
  assert.match(s, /DESCRIPTION:a\\nb/);
  assert.ok(s.startsWith("BEGIN:VCALENDAR\r\n") && s.endsWith("END:VCALENDAR\r\n"));
});

test("chart geometry", () => {
  assert.deepEqual(niceTicks(0, 95), [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(5, 5), [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(extent([[3, null, 7]], true), [0, 7]);
  assert.deepEqual(extent([[null]], false), [0, 1]);
  const x = linear(0, 2, 0, 100);
  const y = linear(0, 10, 100, 0);
  assert.equal(linePath([0, 5, 10], x, y), "M0.0,100.0L50.0,50.0L100.0,0.0");
  assert.equal(linePath([0, null, 10], x, y), "M0.0,100.0h0M100.0,0.0h0", "gaps break the line");
  assert.equal(areaPath([5, 5], linear(0, 1, 0, 10), y, 0), "M0.0,100.0L0.0,50.0L10.0,50.0L10.0,100.0Z");
  assert.deepEqual(labelIndices(5, 8), [0, 1, 2, 3, 4]);
  const li = labelIndices(100, 8);
  assert.ok(li.length <= 9 && li[0] === 0 && li[li.length - 1] === 99);
});

test("katex: render, untrusted commands, errors, limits", () => {
  const html = renderTex("\\frac{a}{b}", true);
  assert.ok(html?.includes("katex-display") && html.includes("<math"), html ?? "null");
  assert.ok(renderTex("e^{i\\pi}+1=0", false)?.startsWith('<span class="katex">'));
  // trust:false: no link, no URL, no class from the payload.
  for (const tex of ["\\href{https://evil.example}{x}", "\\url{https://evil.example}", "\\htmlClass{x}{y}", "\\includegraphics{https://evil.example/a.png}"]) {
    const out = renderTex(tex, true) ?? "";
    assert.ok(!/<a |<img /.test(out), `${tex}: ${out}`);
  }
  assert.equal(renderTex("\\frac{a}{b", true), null);
  assert.equal(renderTex("\\nosuchmacro", true), null);
  assert.equal(renderTex("\\def\\a{\\a}\\a", true), null);
  assert.equal(renderTex("\\def\\a{xx}" + "\\a".repeat(600), true), null);
});

test("katex css: fonts rebased, woff2 only", () => {
  const css =
    '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(fonts/KaTeX_Main-Regular.woff) format("woff"),url(fonts/KaTeX_Main-Regular.ttf) format("truetype")}';
  assert.equal(
    rebaseKatexCss(css, "https://e.x/modules/fonts/"),
    '@font-face{font-family:KaTeX_Main;src:url(https://e.x/modules/fonts/KaTeX_Main-Regular.woff2) format("woff2")}',
  );
});
