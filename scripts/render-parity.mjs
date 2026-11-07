#!/usr/bin/env node
// Render every block fixture through two builds of the Element module and
// compare the output: a regression check for refactors and renames.
//
//   node scripts/render-parity.mjs OLD/mxblocks-rich.js NEW/mxblocks-rich.js [FIXTURES_DIR]
//
// Each bundle is loaded the way Element loads it (window.React, a module API
// with config and registerMessageRenderer), then each fixture is rendered as
// a message from an allow-listed sender with a tiny static React stand-in
// (hooks return their initial state, effects don't run). The old bundle gets
// the payload under com.ianm.mtrix; the new one under every key it reads.
// Exits 1 on the first difference, printing both trees.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [oldPath, newPath, dir = new URL("../crates/mxblocks/tests/fixtures/rich/", import.meta.url).pathname] =
  process.argv.slice(2);
if (!oldPath || !newPath) {
  console.error("usage: render-parity.mjs OLD.js NEW.js [FIXTURES_DIR]");
  process.exit(2);
}

// ------------------------------------------------------------ static React
const Fragment = Symbol("Fragment");
class Component {
  constructor(props) {
    this.props = props;
  }
  setState() {}
}
Component.prototype.isReactComponent = {};
const React = {
  Fragment,
  Component,
  createElement: (type, props, ...children) => ({
    type,
    props: { ...props, children: children.length === 1 ? children[0] : children },
  }),
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: (f) => f,
  useMemo: (f) => f(),
  useRef: (v = null) => ({ current: v }),
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
function attr(k, v) {
  if (typeof v === "function") return `${k}=ƒ`;
  if (typeof v === "object" && v !== null) return `${k}=${JSON.stringify(v)}`;
  return `${k}=${JSON.stringify(v)}`;
}
function render(node) {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return esc(node);
  if (Array.isArray(node)) return node.map(render).join("");
  const { type, props } = node;
  if (type === Fragment) return render(props.children);
  if (typeof type === "function") {
    if (type.prototype?.isReactComponent) {
      const inst = new type(props);
      inst.state ??= {};
      return render(inst.render());
    }
    return render(type(props));
  }
  const { children, key: _k, ref: _r, ...rest } = props ?? {};
  const attrs = Object.keys(rest)
    .sort()
    .map((k) => attr(k, rest[k]))
    .join(" ");
  return `<${type}${attrs ? " " + attrs : ""}>${render(children)}</${type}>`;
}

// ---------------------------------------------------------------- browser
// KaTeX checks document.compatMode.
const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {}, remove() {} });
globalThis.window = globalThis;
globalThis.React = React;
globalThis.devicePixelRatio = 1;
globalThis.document = {
  compatMode: "CSS1Compat",
  getElementById: () => null,
  createElement: el,
  head: { appendChild() {} },
  body: { appendChild() {} },
};
const NOW = Date.UTC(2026, 9, 15, 12);
Date.now = () => NOW;

const SENDER = "@bot:example.org";
async function load(path, configKey, query = "") {
  const mod = await import(pathToFileURL(resolve(path)).href + query);
  let filter, renderer;
  const api = {
    config: { get: () => ({ [configKey]: { senders: [SENDER] } }) },
    customComponents: { registerMessageRenderer: (f, r) => ((filter = f), (renderer = r)) },
  };
  const origWarn = console.warn;
  console.warn = () => {};
  await new mod.default(api).load();
  console.warn = origWarn;
  if (!renderer) throw new Error(`${path}: no message renderer registered`);
  return (content, i) => {
    const ev = {
      type: "m.room.message",
      sender: SENDER,
      content,
      roomId: "!room:example.org",
      eventId: `$ev${i}`,
    };
    if (!filter(ev)) return "(not matched)";
    return render(renderer({ mxEvent: ev }, () => React.createElement("original", null)));
  };
}

const oldR = await load(oldPath, "com.ianm.mtrix");
const newLegacyConfig = await load(newPath, "com.ianm.mtrix", "?legacy");
const newR = await load(newPath, "com.talaagent.mxblocks", "?new");

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();
let failed = 0;
for (const [i, f] of files.entries()) {
  const payload = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const txt = f.replace(/\.json$/, ".txt");
  let body = "fallback";
  try {
    body = readFileSync(join(dir, txt), "utf8");
  } catch {}
  const base = { msgtype: "m.notice", body };
  const want = oldR({ ...base, "com.ianm.mtrix": payload }, i);
  const runs = [
    ["legacy config, com.ianm.mtrix", newLegacyConfig({ ...base, "com.ianm.mtrix": payload }, i)],
    ["new config, com.ianm.mtrix", newR({ ...base, "com.ianm.mtrix": payload }, i)],
    ["new config, com.talaagent.mxblocks", newR({ ...base, "com.talaagent.mxblocks": payload }, i)],
  ];
  for (const [what, got] of runs) {
    if (got !== want) {
      failed++;
      console.log(`✖ ${f} (${what})\n--- old\n${want}\n--- new\n${got}\n`);
    }
  }
  if (want.length < 200 || want === "(not matched)") {
    failed++;
    console.log(`✖ ${f}: suspiciously small render: ${want}`);
  }
  console.log(`${failed ? "…" : "✔"} ${f}: ${want.length} chars`);
  if (process.env.SHOW === f) console.log(want);
}
if (failed) {
  console.log(`render-parity: ${failed} difference(s)`);
  process.exit(1);
}
console.log(`render-parity: ${files.length} fixtures render identically`);
