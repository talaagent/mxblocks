// Renderer tests: run the mxblocks-math program (MXBLOCKS_MATH_BIN, else the
// source with node) the way senders do, and check the contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/mxblocks-math.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "mxblocks-math-test-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function run(args, input) {
  const bin = process.env.MXBLOCKS_MATH_BIN;
  const [cmd, argv] = bin ? [bin, args] : [process.execPath, [SRC, ...args]];
  return spawnSync(cmd, argv, { input, encoding: "utf8", timeout: 60_000 });
}

function pngSize(path) {
  const png = readFileSync(path);
  assert.equal(png.toString("latin1", 0, 8), "\x89PNG\r\n\x1a\n");
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20), bytes: png.length };
}

for (const [name, tex, inline] of [
  ["frac", "\\frac{a}{b}", false],
  ["euler", "e^{i\\pi}+1=0", true],
]) {
  test(`renders ${name}`, () => {
    const out = join(dir, `${name}.png`);
    const r = run(["render", ...(inline ? ["--inline"] : []), "--out", out, tex]);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    const info = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(info), ["mimetype", "w", "h", "size"]);
    assert.equal(info.mimetype, "image/png");
    assert.ok(Number.isInteger(info.w) && info.w > 10 && info.w < 400, `w ${info.w}`);
    assert.ok(Number.isInteger(info.h) && info.h > 10 && info.h < 200, `h ${info.h}`);
    const png = pngSize(out);
    assert.equal(png.w, info.w * 2);
    assert.equal(png.h, info.h * 2);
    assert.equal(png.bytes, info.size);
  });
}

test("reads stdin with -", () => {
  const out = join(dir, "stdin.png");
  const r = run(["render", "--out", out, "-"], "\\sum_{k=1}^n k = \\frac{n(n+1)}{2}\n");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).mimetype, "image/png");
});

test("fails on TeX errors, loaders and limits", () => {
  for (const [tex, why] of [
    ["\\frac{a}{b", "Missing close brace"],
    ["\\undefinedthing{x}", "Undefined control sequence"],
    ["\\require{cancel}", "Undefined control sequence \\require"],
    ["\\href{https://example.com}{x}", "Undefined control sequence \\href"],
    ["\\def\\a{\\a}\\a", "macro substitution"],
    ["x+".repeat(1500) + "x", "at most"],
    ["x".repeat(4001), "longer than 4000"],
    ["  ", "empty"],
  ]) {
    const out = join(dir, "bad.png");
    const r = run(["render", "--out", out, tex]);
    assert.equal(r.status, 1, `${tex.slice(0, 40)}: ${r.stdout}`);
    assert.equal(r.stdout, "");
    assert.ok(r.stderr.includes(why), `${tex.slice(0, 40)}: ${r.stderr}`);
  }
});

test("usage errors exit 2", () => {
  assert.equal(run([]).status, 2);
  assert.equal(run(["render", "x"]).status, 2);
  assert.equal(run(["render", "--out", join(dir, "u.png"), "--bogus", "x"]).status, 2);
});
