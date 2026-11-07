#!/usr/bin/env node
// mxblocks-math (package mxblocks-math): LaTeX -> PNG for mxblocks math messages (docs/spec.md,
// "math"). MathJax (TeX input, SVG output with glyph paths, so no fonts are
// needed for math) builds an SVG, which is placed on a light rounded card and
// rasterised by resvg at 2x.
//
//   mxblocks-math render [--inline] --out PATH.png LATEX   (LATEX may be "-": stdin)
//
// Exit 0 prints one line of JSON:
//   {"mimetype":"image/png","w":<1x px>,"h":<1x px>,"size":<bytes>}
// and the PNG is exactly 2w x 2h pixels. TeX errors, oversized input or
// output, and timeouts exit non-zero with a message on stderr.
//
// Safety: input is capped (MAX_TEX), MathJax gets a fixed package list without
// require/autoload (nothing is ever loaded from disk or the network), no
// html/unicode extensions, and errors are fatal (no noerrors/noundefined).
// The SVG handed to resvg is MathJax's own output plus our card; resvg runs
// with system fonts skipped and a fixed font dir. The wrapper script adds a
// wall-clock timeout on top of the resvg timeout here.

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";

/** TeX source, in characters (the mxblocks crate's MAX_TEX). */
export const MAX_TEX = 4000;
/** 1x output caps, card included (so the PNG is at most 4096 x 2048). */
export const MAX_W = 2048;
export const MAX_H = 1024;
export const SCALE = 2;

const STYLE = {
  display: { fontPx: 22, pad: 12, radius: 10 },
  inline: { fontPx: 20, pad: 6, radius: 6 },
};
// Dark glyphs on a light card: readable on light and dark Element themes.
const INK = "#1b1d22";
const CARD = "#ffffff";
const BORDER = "#d5d9df";

// Everything MathJax 3 ships except packages that load things, render
// links/raw attributes, pick fonts, or swallow errors.
const PACKAGES = AllPackages.filter(
  (p) => !["require", "autoload", "html", "unicode", "noerrors", "noundefined"].includes(p),
);

const USAGE = "usage: mxblocks-math render [--inline] --out PATH.png LATEX   (LATEX may be - for stdin)";

class UsageError extends Error {}

function parseArgs(argv) {
  if (argv[0] !== "render") throw new UsageError(USAGE);
  let inline = false;
  let out = null;
  let tex = null;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--inline") inline = true;
    else if (a === "--out") {
      out = argv[++i] ?? null;
      if (!out) throw new UsageError("--out needs a path");
    } else if (a.startsWith("--out=")) out = a.slice(6);
    else if (a === "--") {
      if (tex !== null || i + 2 !== argv.length) throw new UsageError(USAGE);
      tex = argv[++i];
    } else if (a.startsWith("--")) throw new UsageError(`unknown flag ${a}\n${USAGE}`);
    else if (tex === null) tex = a;
    else throw new UsageError(`one LATEX argument only\n${USAGE}`);
  }
  if (!out || tex === null) throw new UsageError(USAGE);
  return { inline, out, tex };
}

let jax = null;
function converter() {
  if (jax) return jax;
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({
    packages: PACKAGES,
    maxMacros: 1000,
    maxBuffer: 5 * 1024,
    // Fail instead of drawing a red error box.
    formatError: (_jax, err) => {
      throw err;
    },
  });
  // fontCache "none": every glyph is an inline path (no <use> references).
  const svg = new SVG({ fontCache: "none" });
  const doc = mathjax.document("", { InputJax: tex, OutputJax: svg });
  jax = { adaptor, doc };
  return jax;
}

/**
 * LaTeX -> { svg, w, h }: the final card SVG at SCALE and its 1x size in
 * whole pixels. Throws on TeX errors and size limits.
 */
export function renderSvg(tex, { inline = false } = {}) {
  if (typeof tex !== "string" || !tex.trim()) throw new Error("empty LaTeX");
  if ([...tex].length > MAX_TEX) throw new Error(`LaTeX is longer than ${MAX_TEX} characters`);
  const { adaptor, doc } = converter();
  const node = doc.convert(tex, { display: !inline, em: 16, ex: 8, containerWidth: 80 * 16 });
  const inner = adaptor.firstChild(node);
  if (!inner || adaptor.kind(inner) !== "svg") throw new Error("MathJax produced no SVG");
  // MathJax still emits error nodes for some problems (e.g. merror from
  // \require-less input); refuse them too.
  const html = adaptor.outerHTML(inner);
  if (html.includes('data-mml-node="merror"')) {
    const title = /<title>([^<]*)<\/title>/.exec(html);
    throw new Error(title ? title[1] : "TeX error");
  }
  const vb = (adaptor.getAttribute(inner, "viewBox") || "").split(/\s+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) throw new Error("bad MathJax viewBox");
  const style = inline ? STYLE.inline : STYLE.display;
  // viewBox units are 1/1000 em.
  const mathW = (vb[2] / 1000) * style.fontPx;
  const mathH = (vb[3] / 1000) * style.fontPx;
  const w = Math.ceil(mathW + 2 * style.pad);
  const h = Math.ceil(mathH + 2 * style.pad);
  if (w > MAX_W || h > MAX_H) {
    throw new Error(`rendered formula is ${w}x${h} px, at most ${MAX_W}x${MAX_H}`);
  }
  adaptor.setAttribute(inner, "width", String(mathW * SCALE));
  adaptor.setAttribute(inner, "height", String(mathH * SCALE));
  adaptor.setAttribute(inner, "x", String((w - mathW) / 2 * SCALE));
  adaptor.setAttribute(inner, "y", String((h - mathH) / 2 * SCALE));
  adaptor.removeAttribute(inner, "style");
  adaptor.removeAttribute(inner, "role");
  adaptor.removeAttribute(inner, "focusable");
  const math = adaptor.outerHTML(inner).replaceAll("currentColor", INK);
  const W = w * SCALE;
  const H = h * SCALE;
  const r = style.radius * SCALE;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${r}" ry="${r}" ` +
    `fill="${CARD}" stroke="${BORDER}" stroke-width="2"/>` +
    `<g fill="${INK}" stroke="${INK}" color="${INK}">${math}</g></svg>`;
  return { svg, w, h };
}

function resvg(svg, out) {
  const bin = process.env.MXBLOCKS_MATH_RESVG || "resvg";
  const fontDir = process.env.MXBLOCKS_MATH_FONT_DIR;
  const args = ["--skip-system-fonts", "--resources-dir", "/nonexistent"];
  if (fontDir) {
    args.push(
      "--use-fonts-dir",
      fontDir,
      "--serif-family",
      "DejaVu Serif",
      "--sans-serif-family",
      "DejaVu Sans",
      "--monospace-family",
      "DejaVu Sans Mono",
    );
  }
  args.push("-", out);
  const r = spawnSync(bin, args, { input: svg, timeout: 10_000, encoding: "utf8" });
  if (r.error) throw new Error(`running resvg: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`resvg failed: ${(r.stderr || "").trim() || `exit ${r.status}`}`);
}

/** Renders `tex` to a PNG at `out`; returns the JSON line's object. */
export function renderPng(tex, out, { inline = false } = {}) {
  const { svg, w, h } = renderSvg(tex, { inline });
  // Write next to the destination, then rename: no half-written PNG at `out`.
  const tmp = join(dirname(out), `.mxblocks-math-${process.pid}-${Date.now()}.png`);
  try {
    resvg(svg, tmp);
    const png = readFileSync(tmp);
    if (png.length < 24 || png.toString("latin1", 1, 4) !== "PNG") throw new Error("resvg wrote no PNG");
    const pw = png.readUInt32BE(16);
    const ph = png.readUInt32BE(20);
    if (pw !== w * SCALE || ph !== h * SCALE) {
      throw new Error(`resvg wrote ${pw}x${ph}, expected ${w * SCALE}x${h * SCALE}`);
    }
    renameSync(tmp, out);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { mimetype: "image/png", w, h, size: statSync(out).size };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
  try {
    let tex = args.tex;
    if (tex === "-") {
      tex = readFileSync(0, "utf8");
      if (tex.length > MAX_TEX * 4) throw new Error(`LaTeX is longer than ${MAX_TEX} characters`);
    }
    const info = renderPng(tex.trim(), args.out, { inline: args.inline });
    process.stdout.write(`${JSON.stringify(info)}\n`);
  } catch (e) {
    process.stderr.write(`mxblocks-math: ${e?.message ?? e}\n`);
    process.exit(1);
  }
}

// Run as a program (not when imported by the tests).
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
