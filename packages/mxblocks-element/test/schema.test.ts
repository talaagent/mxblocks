import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BLOCK_TYPES,
  RICH_KEY_NEW,
  LIMITS,
  RICH_KEY,
  hasRichKey,
  parseBlock,
  parseRich,
} from "../src/schema/index.ts";
import { readSenders } from "../src/config.ts";

const T0 = Date.parse("2026-10-15T10:00:00Z");
const wrap = (...blocks: unknown[]) => ({ [RICH_KEY_NEW]: { v: 1, blocks } });
const one = (block: unknown) => parseBlock(block);

test("envelope: version, keys, legacy fallback, unknown blocks", () => {
  const btn = { type: "buttons", buttons: [{ label: "Ok", action: { type: "react", key: "👍" } }] };
  assert.equal(parseRich(wrap(btn))?.blocks.length, 1);
  assert.equal(parseRich({ [RICH_KEY]: { v: 2, blocks: [btn] } }), null);
  assert.equal(parseRich({ [RICH_KEY]: { v: 1.5, blocks: [btn] } }), null);
  assert.equal(parseRich({ [RICH_KEY]: { v: 1 } }), null);
  assert.equal(parseRich(wrap({ type: "hologram" })), null, "nothing renderable");
  assert.deepEqual(
    parseRich(wrap({ type: "hologram" }, btn))?.blocks.map((b) => b.type),
    ["buttons"],
    "unknown types are skipped",
  );
  // legacy key read only when the new one is absent
  assert.ok(hasRichKey({ [RICH_KEY]: { v: 1, blocks: [btn] } }));
  assert.equal(parseRich({ [RICH_KEY]: { v: 1, blocks: [btn] } })?.blocks.length, 1);
  assert.equal(
    parseRich({ [RICH_KEY_NEW]: { v: 1, blocks: [] }, [RICH_KEY]: { v: 1, blocks: [btn] } }),
    null,
  );
  assert.equal(hasRichKey({ body: "x" }), false);
  assert.equal(hasRichKey({ [RICH_KEY]: "nope" }), false);
  // block cap
  const many = Array.from({ length: 20 }, () => btn);
  assert.equal(parseRich(wrap(...many))?.blocks.length, LIMITS.blocks);
  // a throwing getter doesn't escape
  const evil = { [RICH_KEY]: { v: 1, get blocks() { throw new Error("x"); } } };
  assert.equal(parseRich(evil), null);
  assert.equal(parseBlock({ type: "__proto__" }), null);
  assert.equal(parseBlock({ type: "toString" }), null);
});

test("buttons and chips", () => {
  const b = one({
    type: "buttons",
    buttons: [
      { label: "  Send\n now ", style: "primary", action: { type: "react", key: "✅" } },
      { label: "Weird", style: "loud", action: { type: "send", body: "!approve 1" } },
      { label: "", action: { type: "react", key: "x" } },
      { label: "Bad", action: { type: "open_url", url: "https://x" } },
      { label: "Long body", action: { type: "send", body: "x".repeat(1001) } },
      { label: "Empty key", action: { type: "react", key: " " } },
    ],
  });
  assert.equal(b?.type, "buttons");
  if (b?.type !== "buttons") return;
  assert.equal(b.buttons.length, 2);
  assert.equal(b.buttons[0].label, "Send now");
  assert.equal(b.buttons[1].style, "default");
  const sentence = "ProductKind watch, watch Skus raw, rename later, then split graded and ungraded";
  const whole = one({ type: "buttons", buttons: [{ label: sentence, action: { type: "react", key: "a" } }] });
  assert.equal(whole?.type === "buttons" && whole.buttons[0].label, sentence);
  const long = one({ type: "buttons", buttons: [{ label: "x".repeat(200), action: { type: "react", key: "a" } }] });
  assert.equal(long?.type === "buttons" && Array.from(long.buttons[0].label).length, LIMITS.buttonLabelChars);

  const c = one({ type: "chips", chips: Array.from({ length: 20 }, (_, i) => ({ label: `c${i}`, action: { type: "send", body: `c${i}` } })) });
  assert.equal(c?.type === "chips" && c.chips.length, LIMITS.chipsPerBlock);
  assert.equal(one({ type: "chips", chips: [] }), null);
});

test("table", () => {
  const t = one({
    type: "table",
    caption: "Prices",
    columns: [{ key: "item", label: "Item" }, { key: "price", label: "Price", align: "right" }, "store", { key: "item" }],
    rows: [
      { item: "A", price: 10, store: "Example Shop" },
      ["B", "₱1,200", "Lazada"],
      { item: { html: "<b>" }, price: Infinity },
      "garbage",
    ],
  });
  assert.equal(t?.type, "table");
  if (t?.type !== "table") return;
  assert.deepEqual(t.columns.map((c) => c.key), ["item", "price", "store"], "duplicate key dropped");
  assert.equal(t.columns[2].label, "store");
  assert.deepEqual(t.rows, [
    ["A", 10, "Example Shop"],
    ["B", "₱1,200", "Lazada"],
    [null, null, null],
  ]);
  const big = one({ type: "table", columns: ["n"], rows: Array.from({ length: 500 }, (_, i) => [i]) });
  assert.ok(big?.type === "table" && big.rows.length === LIMITS.tableRows && big.truncated);
  assert.equal(one({ type: "table", columns: [], rows: [[1]] }), null);
  assert.equal(one({ type: "table", columns: ["a"], rows: [] }), null);
});

test("chart", () => {
  const c = one({
    type: "chart",
    kind: "line",
    title: "Spend",
    labels: ["W1", "W2", "W3"],
    series: [{ name: "₱", values: [1, null, "3", 4] }, { name: "bad", values: ["x"] }],
    unit: "₱",
  });
  assert.equal(c?.type, "chart");
  if (c?.type !== "chart") return;
  assert.equal(c.series.length, 1);
  assert.deepEqual(c.series[0].values, [1, null, 3, 4], "decimal strings are numbers");
  assert.deepEqual(c.labels, ["W1", "W2", "W3", ""], "labels padded to series length");
  const bare = one({ type: "chart", kind: "sparkline", series: [1, 2, 3] });
  assert.ok(bare?.type === "chart" && bare.series[0].name === null);
  assert.equal(one({ type: "chart", kind: "pie", series: [1, 2] }), null);
  const caps = one({
    type: "chart",
    kind: "bar",
    series: Array.from({ length: 10 }, () => ({ values: Array.from({ length: 999 }, (_, i) => i) })),
  });
  assert.ok(caps?.type === "chart" && caps.series.length === LIMITS.chartSeries);
  assert.ok(caps?.type === "chart" && caps.series[0].values.length === LIMITS.chartPoints);
});

test("sources: https only", () => {
  const s = one({
    type: "sources",
    sources: [
      { title: "Docs", url: "https://www.example.com/a?b=1" },
      { url: "https://news.example.org/x" },
      { title: "js", url: "javascript:alert(1)" },
      { title: "http", url: "http://example.com" },
      { title: "creds", url: "https://user:pw@example.com" },
      { title: "data", url: "data:text/html,hi" },
    ],
  });
  assert.equal(s?.type, "sources");
  if (s?.type !== "sources") return;
  assert.deepEqual(s.sources, [
    { title: "Docs", url: "https://www.example.com/a?b=1" },
    { title: "news.example.org", url: "https://news.example.org/x" },
  ]);
});

test("card and cards: mxc images, https urls", () => {
  const c = one({
    type: "card",
    title: "Keyboard",
    url: "https://shop.example.org/item",
    image: "mxc://example.org/AbC_123-x",
    price: "₱2,499",
    store: "Example Shop",
    fields: [{ label: "Switch", value: "Red" }, { label: "Bad" }, { label: "Weight", value: 900 }],
  });
  assert.equal(c?.type, "card");
  if (c?.type !== "card") return;
  assert.equal(c.image, "mxc://example.org/AbC_123-x");
  assert.deepEqual(c.fields, [{ label: "Switch", value: "Red" }, { label: "Weight", value: "900" }]);
  const bad = one({ type: "card", title: "x", image: "https://evil/x.png", url: "http://x" });
  assert.ok(bad?.type === "card" && bad.image === null && bad.url === null);
  assert.equal(one({ type: "card", subtitle: "no title" }), null);
  const cs = one({ type: "cards", cards: [...Array.from({ length: 15 }, (_, i) => ({ title: `c${i}` })), { nope: 1 }] });
  assert.ok(cs?.type === "cards" && cs.cards.length === LIMITS.cards);
});

test("progress keeps the subagent shape", () => {
  const p = one({
    type: "progress",
    title: "Subagents",
    steps: [
      { id: "a", label: "Explore", status: "done", started_at: T0, ended_at: T0 + 65_000, extra: 1 },
      { id: "b", label: "Build", status: "running", detail: "npm run build", started_at: "2026-10-15T10:01:05Z" },
      { id: "c", label: "Test", status: "pending" },
      { label: "No id", status: "skipped" },
      { id: "d", label: "Bad", status: "exploded" },
      { id: "e", label: "Secs", status: "done", started_at: 1_760_000_000 },
    ],
    summary: "2 left",
  });
  assert.equal(p?.type, "progress");
  if (p?.type !== "progress") return;
  assert.deepEqual(p.steps.map((s) => s.status), ["done", "running", "pending", "skipped", "done"]);
  assert.equal(p.steps[1].started_at, T0 + 65_000);
  assert.equal(p.steps[3].id, "No id");
  assert.equal(p.steps[4].started_at, null, "seconds instead of ms are rejected");
  assert.equal(p.summary, "2 left");
});

test("details, code, diff", () => {
  const d = one({ type: "details", summary: "Logs", body: "line1\n\tline2\u0007", open: true });
  assert.deepEqual(d, { type: "details", summary: "Logs", body: "line1\n\tline2", open: true });
  assert.equal(one({ type: "details", summary: "x", body: "  " }), null);
  const c = one({ type: "code", language: "rust", filename: "main.rs", code: "fn main() {}\r\n" });
  assert.deepEqual(c, { type: "code", language: "rust", filename: "main.rs", code: "fn main() {}", truncated: false });
  const big = one({ type: "code", code: "x\n".repeat(1000) });
  assert.ok(big?.type === "code" && big.truncated && big.code.split("\n").length === LIMITS.codeLines);
  const diff = one({ type: "diff", diff: "--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b" });
  assert.ok(diff?.type === "diff" && !diff.truncated);
});

test("countdown, event, place", () => {
  assert.deepEqual(one({ type: "countdown", until: T0, label: "Launch" }), { type: "countdown", until: T0, label: "Launch" });
  assert.equal(one({ type: "countdown", until: "soon" }), null);
  const e = one({ type: "event", title: "Dinner", start: "2026-10-15T18:00:00+08:00", end: T0 - 1e9, location: "Downtown" });
  assert.ok(e?.type === "event" && e.start === Date.parse("2026-10-15T10:00:00Z") && e.end === null, "end before start dropped");
  assert.equal(one({ type: "event", title: "x" }), null);
  const p = one({ type: "place", name: "Hotel Example", lat: "14.55", lng: "121.05" });
  assert.ok(p?.type === "place" && p.lat === 14.55);
  const q = one({ type: "place", name: "Nowhere", lat: 200, lng: 0 });
  assert.ok(q?.type === "place" && q.lat === null && q.lng === null);
});

test("ticker, weather", () => {
  const t = one({ type: "ticker", symbol: "BTC", price: "65000.5", change: -120, change_pct: "-0.18", currency: "USD", series: [1, "x", 3] });
  assert.ok(t?.type === "ticker" && t.series.length === 2 && t.change === -120);
  assert.equal(one({ type: "ticker", symbol: "X", price: "one" }), null);
  const w = one({
    type: "weather",
    location: "Example City",
    temp: 31,
    unit: "K",
    condition: "Thunderstorms",
    icon: "thunder",
    forecast: [{ label: "Fri", high: 32, low: 26, icon: "rain" }, { label: "Sat", icon: "tornado" }, {}],
  });
  assert.ok(w?.type === "weather" && w.unit === "C" && w.icon === "thunder");
  assert.ok(w?.type === "weather" && w.forecast.length === 2 && w.forecast[1].icon === null);
});

test("math", () => {
  assert.deepEqual(one({ type: "math", tex: "\\frac{a}{b}", alt: "a over b", caption: " Euler\n " }), {
    type: "math",
    tex: "\\frac{a}{b}",
    display: true,
    alt: "a over b",
    caption: "Euler",
  });
  assert.equal((one({ type: "math", tex: "x", display: false }) as { display: boolean }).display, false);
  assert.equal(one({ type: "math", tex: "  " }), null);
  assert.equal(one({ type: "math", tex: 3 }), null);
  assert.equal(one({ type: "math", tex: "x".repeat(LIMITS.texChars + 1) }), null);
  assert.deepEqual(one({ type: "math", tex: "x".repeat(LIMITS.texChars + 1), fallback: "big" }), {
    type: "fallback",
    text: "big",
  });
});

test("tracker: live order/ride/parcel status", () => {
  const t = one({
    type: "tracker",
    title: "Noodle Bar",
    provider: "Example Delivery",
    kind: "food",
    status: "Picking up",
    stages: [
      { id: "placed", label: "Placed", status: "done", at: "2026-10-15T21:20:00+08:00" },
      { id: "pickup", label: "Picking up", status: "running" },
      { label: "On the way", status: "pending" },
      { label: "Teleport", status: "beaming" },
      { status: "done" },
    ],
    eta: "2026-10-15T21:50:00+08:00",
    map: { url: "mxc://example.org/AbC", w: 600, h: 400, alt: "Rider near Uptown" },
    driver: { name: "Sam D.", vehicle: "Scooter", plate: "ABC 1234", rating: 9 },
    items: ["2× Tonkotsu", 3, "1× Gyoza"],
    total: { amount: "1240.5", currency: "PHP" },
    link: "https://delivery.example.org/order/A-123",
    updated_at: T0,
  });
  assert.ok(t?.type === "tracker");
  if (t?.type !== "tracker") return;
  assert.equal(t.state, "live", "state defaults to live");
  assert.deepEqual(
    t.stages.map((s) => [s.id, s.status]),
    [["placed", "done"], ["pickup", "running"], ["On the way", "pending"]],
  );
  assert.equal(t.stages[0].at, Date.parse("2026-10-15T13:20:00Z"));
  assert.equal(t.eta, Date.parse("2026-10-15T13:50:00Z"));
  assert.deepEqual(t.map, { url: "mxc://example.org/AbC", w: 600, h: 400, alt: "Rider near Uptown" });
  assert.equal(t.driver?.rating, null, "rating outside 0..5 dropped");
  assert.deepEqual(t.items, ["2× Tonkotsu", "1× Gyoza"]);
  assert.deepEqual(t.total, { amount: 1240.5, currency: "PHP" });
  assert.equal(t.updated_at, T0);

  // Safety: no external map images, https links only, unknown enums ignored.
  const bad = one({
    type: "tracker", title: "x", provider: "Lalamove", status: "s", kind: "boat", state: "finished",
    map: { url: "https://maps.googleapis.com/staticmap?x" }, link: "javascript:alert(1)",
    driver: { plate: "X" }, total: { amount: "1,000" },
  });
  assert.ok(bad?.type === "tracker");
  if (bad?.type !== "tracker") return;
  assert.equal(bad.kind, null);
  assert.equal(bad.state, "live");
  assert.equal(bad.map, null);
  assert.equal(bad.link, null);
  assert.equal(bad.driver, null);
  assert.equal(bad.total, null);
  assert.equal(one({ type: "tracker", title: "x", provider: "Example Delivery", state: "done" }), null, "status required");
  assert.equal(one({ type: "tracker", title: "x", provider: "Example Delivery", status: "Arrived", state: "done" })?.type, "tracker");
});

// gallery, form and file are tested in media-form.test.ts.
test("every implemented type has a test", () => {
  assert.deepEqual(
    [...BLOCK_TYPES].sort(),
    ["buttons", "card", "cards", "chart", "chips", "code", "countdown", "details", "diff", "event", "file", "form", "gallery", "math", "place", "progress", "sources", "table", "ticker", "tracker", "weather"],
  );
});

test("config: sender allow-list fails closed", () => {
  assert.deepEqual([...readSenders({ "com.ianm.mtrix": { senders: ["@claude:x.y", "nope", 3, "@a:b"] } })], ["@claude:x.y", "@a:b"]);
  assert.equal(readSenders({}).size, 0);
  assert.equal(readSenders({ "com.ianm.mtrix": { senders: "@a:b" } }).size, 0);
  assert.equal(readSenders(null).size, 0);
});

test("MSC4139-shaped prompts: ids and scope", () => {
  const b = one({
    type: "buttons",
    scope: ["@alice:example.org", "not-an-mxid"],
    buttons: [
      { id: "approve", label: "Send", action: { type: "react", key: "✅" } },
      { id: "bad id!", label: "Drop", action: { type: "react", key: "❌" } },
    ],
  });
  assert.ok(b?.type === "buttons");
  if (b?.type !== "buttons") return;
  assert.deepEqual(b.scope, ["@alice:example.org"]);
  assert.deepEqual(b.buttons.map((x) => x.id), ["approve", null]);
  const open = one({ type: "chips", scope: [], chips: [{ label: "x", action: { type: "send", body: "x" } }] });
  assert.ok(open?.type === "chips" && open.scope === null, "empty scope = anyone");
});

test("card actions and carousel rules (ChatGPT Apps SDK)", () => {
  const act = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `a${i}`, label: `A${i}`, action: { type: "send", body: `a${i}` } }));
  const c = one({ type: "card", title: "x", actions: act(5) });
  assert.ok(c?.type === "card" && c.actions.length === 2, "inline card: max 2 actions");
  const img = "mxc://hs/abc";
  const items = (n: number, withImage = true) =>
    Array.from({ length: n }, (_, i) => ({ title: `c${i}`, image: withImage ? img : undefined, actions: act(3) }));
  const car = one({ type: "cards", cards: items(5) });
  assert.ok(car?.type === "cards" && car.layout === "carousel");
  assert.ok(car?.type === "cards" && car.cards.every((x) => x.actions.length === 1), "1 action per item");
  const two = one({ type: "cards", cards: items(2) });
  assert.ok(two?.type === "cards" && two.layout === "list", "fewer than 3: single cards");
  const noImg = one({ type: "cards", cards: [...items(3), ...items(1, false)] });
  assert.ok(noImg?.type === "cards" && noImg.layout === "list", "an item without an image: single cards");
  const many = one({ type: "cards", cards: items(12) });
  assert.ok(many?.type === "cards" && many.cards.length === 8 && many.layout === "carousel", "more than 8 truncates");
});

test("per-block v and fallback (Adaptive Cards style)", () => {
  const btn = { type: "buttons", buttons: [{ label: "Ok", action: { type: "react", key: "👍" } }] };
  assert.equal(one({ ...btn, v: 1 })?.type, "buttons");
  assert.deepEqual(one({ ...btn, v: 2, fallback: "Reply 👍" }), { type: "fallback", text: "Reply 👍" });
  assert.equal(one({ ...btn, v: 2 }), null, "higher v without fallback: skipped");
  assert.equal(one({ ...btn, v: "1" }), null);
  assert.deepEqual(one({ type: "hologram", fallback: "A hologram of the chart" }), {
    type: "fallback",
    text: "A hologram of the chart",
  });
  assert.deepEqual(one({ type: "table", columns: [], fallback: "table unavailable" }), {
    type: "fallback",
    text: "table unavailable",
  }, "malformed known block: fallback");
  const p = parseRich(wrap({ type: "hologram", fallback: "x" }));
  assert.equal(p?.blocks[0].type, "fallback");
});

test("numbers: canonical JSON decimal strings and legacy floats", () => {
  // New events carry decimal strings (canonical JSON has no floats); old
  // events with raw floats still render.
  for (const [price, change] of [
    ["229.87", "-1.2"],
    [229.87, -1.2],
  ] as const) {
    const t = one({
      type: "ticker",
      symbol: "AAPL",
      price,
      change,
      change_pct: "-0.52",
      series: ["1.5", 2, null],
    });
    assert.ok(t?.type === "ticker");
    if (t?.type !== "ticker") continue;
    assert.equal(t.price, 229.87);
    assert.equal(t.change, -1.2);
    assert.equal(t.change_pct, -0.52);
  }
  assert.equal(
    one({ type: "ticker", symbol: "X", price: "62,99" }),
    null,
    "not a decimal string",
  );
  assert.equal(
    one({ type: "ticker", symbol: "X", price: "1e3" })?.type,
    "ticker",
  );
  assert.equal(one({ type: "ticker", symbol: "X", price: " 5" }), null);
  assert.equal(one({ type: "ticker", symbol: "X", price: "Infinity" }), null);

  const w = one({
    type: "weather",
    location: "Example City",
    temp: "31.5",
    high: "33",
    low: 26.4,
    forecast: [{ label: "Fri", high: "32.1" }],
  });
  assert.ok(
    w?.type === "weather" && w.temp === 31.5 && w.high === 33 && w.low === 26.4,
  );
  assert.ok(w?.type === "weather" && w.forecast[0].high === 32.1);

  const p = one({
    type: "place",
    name: "Downtown",
    lat: "51.5007",
    lng: "-0.1246",
  });
  assert.ok(p?.type === "place" && p.lat === 51.5007 && p.lng === -0.1246);

  const c = one({ type: "chart", kind: "line", series: ["1.5", 2, null] });
  if (c?.type === "chart") assert.deepEqual(c.series[0].values, [1.5, 2, null]);
  assert.ok(c?.type === "chart");
  const c2 = one({
    type: "chart",
    kind: "bar",
    series: [{ name: "a", values: ["0.25", "1", null] }],
  });
  assert.ok(c2?.type === "chart");
  if (c2?.type === "chart")
    assert.deepEqual(c2.series[0].values, [0.25, 1, null]);

  const tr = one({
    type: "tracker",
    title: "T",
    provider: "Example Delivery",
    status: "s",
    driver: { name: "J", rating: "4.9" },
    total: { amount: "1240.5", currency: "PHP" },
    eta: "1760536200000",
  });
  assert.ok(tr?.type === "tracker");
  if (tr?.type !== "tracker") return;
  assert.equal(tr.driver?.rating, 4.9);
  assert.equal(tr.total?.amount, 1240.5);
  assert.equal(tr.eta, 1760536200000);

  const pr = one({
    type: "progress",
    steps: [
      {
        label: "a",
        status: "done",
        started_at: String(T0),
        ended_at: T0 + 1000,
      },
    ],
  });
  assert.ok(
    pr?.type === "progress" &&
      pr.steps[0].started_at === T0 &&
      pr.steps[0].ended_at === T0 + 1000,
  );
});
