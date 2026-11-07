import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALBUM_KEY,
  LIMITS,
  RICH_KEY,
  contentMxc,
  hasAlbumKey,
  isDate,
  parseAlbum,
  parseBlock,
  parseRich,
} from "../src/schema/index.ts";
import type { FileBlock, FormBlock, GalleryBlock } from "../src/schema/index.ts";
import {
  formErrors,
  formReplyBody,
  formValues,
  initialValues,
} from "../src/lib/form.ts";
import {
  b64decode,
  decryptAttachment,
  SharedCache,
  fileBadge,
  fmtBytes,
  safeBlobType,
  thumbSide,
} from "../src/lib/media.ts";

const enc = (url: string) => ({
  url,
  v: "v2",
  iv: "AAAAAAAAAAAAAAAAAAAAAA",
  key: { kty: "oct", alg: "A256CTR", ext: true, key_ops: ["encrypt", "decrypt"], k: "abc_-1" },
  hashes: { sha256: "c2hh" },
});

test("gallery", () => {
  const g = parseBlock({
    type: "gallery",
    title: "Cats",
    images: [
      { url: "mxc://s/a", caption: " A\ncat ", alt: "a cat", w: 800, h: 600, mimetype: "image/jpeg" },
      { file: enc("mxc://s/b"), size: 10, mimetype: "text/html", w: -1 },
      { url: "https://evil/x.png" },
      { url: "mxc://s/c", file: enc("mxc://s/c") },
      { file: { url: "mxc://s/d" } },
      "mxc://s/e",
    ],
  }) as GalleryBlock;
  assert.equal(g.type, "gallery");
  assert.equal(g.images.length, 2, "bad sources dropped");
  assert.deepEqual(g.images[0].src, { kind: "plain", mxc: "mxc://s/a" });
  assert.equal(g.images[0].caption, "A cat");
  assert.equal(g.images[1].src.kind, "encrypted");
  assert.equal(g.images[1].src.mxc, "mxc://s/b");
  assert.equal(g.images[1].mimetype, null, "non-image mimetype dropped");
  assert.equal(g.images[1].w, null);
  const many = Array.from({ length: 30 }, () => ({ url: "mxc://s/a" }));
  assert.equal((parseBlock({ type: "gallery", images: many }) as GalleryBlock).images.length, 20);
  assert.equal(parseBlock({ type: "gallery", images: [] }), null);
  assert.equal(parseBlock({ type: "gallery", images: [{ url: "x" }], fallback: "pics" })?.type, "fallback");
});

test("file", () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  const f = parseBlock({
    type: "file",
    name: "build.log",
    size: 99999,
    mimetype: "text/plain",
    url: "mxc://s/log",
    preview: lines,
    thumbnail_url: "mxc://s/t",
  }) as FileBlock;
  assert.equal(f.type, "file");
  assert.equal(f.preview?.split("\n").length, LIMITS.previewLines);
  assert.equal(f.previewCut, true);
  assert.deepEqual(f.thumbnail, { kind: "plain", mxc: "mxc://s/t" });
  const small = parseBlock({ type: "file", name: "a.txt", size: 3, file: enc("mxc://s/a"), preview: "abc" }) as FileBlock;
  assert.equal(small.previewCut, false);
  assert.equal(small.src.kind, "encrypted");
  assert.equal(small.thumbnail, null);
  assert.equal(parseBlock({ type: "file", name: "a" }), null, "needs a source");
  assert.equal(parseBlock({ type: "file", url: "mxc://s/a" }), null, "needs a name");
});

test("album marker", () => {
  const c = { msgtype: "m.image", url: "mxc://s/b", [ALBUM_KEY]: { event_id: "$lead", index: 1, count: 3 } };
  assert.ok(hasAlbumKey(c));
  assert.deepEqual(parseAlbum(c), { event_id: "$lead", index: 1 });
  assert.equal(parseAlbum({ [ALBUM_KEY]: { event_id: "lead", index: 1 } }), null);
  assert.equal(parseAlbum({ body: "x" }), null);
  assert.equal(contentMxc(c), "mxc://s/b");
  assert.equal(contentMxc({ file: enc("mxc://s/e") }), "mxc://s/e");
  // A message with both keys is a normal rich message.
  assert.ok(parseRich({ [RICH_KEY]: { v: 1, blocks: [{ type: "gallery", images: [{ url: "mxc://s/a" }] }] } }));
});

const FORM = {
  type: "form",
  id: "book",
  title: "Book a table",
  scope: ["@alice:example.org"],
  fields: [
    { id: "date", kind: "date", label: "Date", required: true, min: "2026-10-15" },
    {
      id: "party",
      kind: "select",
      label: "Party size",
      default: "2",
      options: [{ value: "2", label: "2 people" }, { value: "4", label: "4 people" }, { value: "2" }],
    },
    { id: "seat", kind: "radio", label: "Seating", options: ["Indoor", "Outdoor"] },
    { id: "notes", kind: "text", label: "Notes", maxlength: 10 },
    { id: "chair", kind: "checkbox", label: "High chair" },
    { id: "bad", kind: "color", label: "Nope" },
    { id: "date", kind: "text", label: "Duplicate id" },
  ],
  submit: { label: "Book" },
};

test("form parsing", () => {
  const f = parseBlock(FORM) as FormBlock;
  assert.equal(f.type, "form");
  assert.deepEqual(
    f.fields.map((x) => x.id),
    ["date", "party", "seat", "notes", "chair"],
    "unknown kinds and duplicate ids dropped",
  );
  assert.equal(f.fields[1].options.length, 2, "duplicate option values dropped");
  assert.deepEqual(f.scope, ["@alice:example.org"]);
  assert.equal(parseBlock({ ...FORM, submit: {} }), null);
  assert.equal(parseBlock({ ...FORM, id: "a b" }), null);
  assert.equal(parseBlock({ ...FORM, fields: [{ id: "x", kind: "select", label: "X", options: [] }] }), null);
  const nine = Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, kind: "text", label: "T" }));
  assert.equal((parseBlock({ ...FORM, fields: nine }) as FormBlock).fields.length, LIMITS.formFields);
  assert.ok(isDate("2028-02-29") && !isDate("2027-02-29") && !isDate("2026-1-1"));
});

test("form submit reply", () => {
  const f = parseBlock(FORM) as FormBlock;
  const init = initialValues(f);
  assert.deepEqual(init, { date: null, party: "2", seat: null, notes: "", chair: false });
  assert.deepEqual(formErrors(f, init), { date: "Required" });
  assert.deepEqual(formErrors(f, { ...init, date: "2026-10-01" }), { date: "On or after 2026-10-15" });
  assert.deepEqual(formErrors(f, { ...init, date: "garbage" }), { date: "Not a date" });

  const raw = { ...init, date: "2026-10-17", seat: "Outdoor", notes: "  window\nseat please ", chair: true };
  const values = formValues(f, raw);
  assert.deepEqual(values, {
    date: "2026-10-17",
    party: "2",
    seat: "Outdoor",
    notes: "window\nsea",
    chair: true,
  });
  assert.equal(
    formReplyBody(f, values),
    'Form "Book a table": Date: 2026-10-17; Party size: 2 people; Seating: Outdoor; Notes: window sea; High chair: yes',
  );
  // Empty optional fields are left out of the body; checkboxes never are.
  const sparse = formValues(f, { ...init, date: "2026-10-17", party: null });
  assert.equal(formReplyBody(f, sparse), 'Form "Book a table": Date: 2026-10-17; High chair: no');
  assert.equal(sparse.party, null);
  assert.equal(sparse.notes, "");
  // No title: the id; nothing to show: "(no answers)".
  const bare = parseBlock({
    type: "form",
    id: "q",
    fields: [{ id: "t", kind: "text", label: "T" }],
    submit: { label: "Go" },
  }) as FormBlock;
  assert.equal(formReplyBody(bare, formValues(bare, {})), 'Form "q": (no answers)');
  // Values that aren't options are dropped.
  assert.equal(formValues(f, { ...init, party: "99" }).party, null);
});

test("attachment decryption", async () => {
  const key = await crypto.subtle.generateKey({ name: "AES-CTR", length: 256 }, true, ["encrypt", "decrypt"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv.subarray(0, 8));
  const plain = new TextEncoder().encode("hello, encrypted world");
  const cipher = await crypto.subtle.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, plain);
  const sha = new Uint8Array(await crypto.subtle.digest("SHA-256", cipher));
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/=+$/, "");
  const file = { url: "mxc://s/a", k: jwk.k!, iv: b64(iv), sha256: b64(sha) };
  const out = await decryptAttachment(cipher, file);
  assert.equal(new TextDecoder().decode(out), "hello, encrypted world");
  await assert.rejects(decryptAttachment(cipher, { ...file, sha256: b64(new Uint8Array(32)) }), /hash/);
  assert.deepEqual([...b64decode("_-8")], [255, 239]);
});

test("file helpers", () => {
  assert.equal(fmtBytes(null), null);
  assert.equal(fmtBytes(512), "512 B");
  assert.equal(fmtBytes(1536), "1.5 KB");
  assert.equal(fmtBytes(50 * 1024 * 1024), "50 MB");
  assert.equal(safeBlobType("image/png"), "image/png");
  assert.equal(safeBlobType("image/svg+xml"), "application/octet-stream");
  assert.equal(safeBlobType("text/html"), "application/octet-stream");
  assert.equal(safeBlobType(null), "application/octet-stream");
  assert.equal(fileBadge("report.pdf", null), "PDF");
  assert.equal(fileBadge("Makefile", "text/x-makefile"), "X");
  assert.equal(fileBadge("noext", null), "FILE");
});

test("thumbnail side", () => {
  // longer side at the device pixel ratio, at most 2×, at most 800
  assert.equal(thumbSide(280, 160, 1), 280);
  assert.equal(thumbSide(280, 160, 2), 560);
  assert.equal(thumbSide(200, 120, 3), 400);
  assert.equal(thumbSide(72, 72, 1.25), 144);
  assert.equal(thumbSide(500, 400, 2), 800);
  assert.equal(thumbSide(48, 48, 0), 48);
});

test("shared cache", async () => {
  const disposed: string[] = [];
  const cache = new SharedCache<string>((v) => disposed.push(v));
  let loads = 0;
  const load = async (): Promise<string> => `blob:${++loads}`;

  // two holders share one load; the value lives until the last release
  const a = cache.acquire("k", load);
  const b = cache.acquire("k", load);
  assert.equal(await a.promise, "blob:1");
  assert.equal(await b.promise, "blob:1");
  assert.equal(loads, 1);
  a.release();
  a.release(); // idempotent
  assert.deepEqual(disposed, []);
  b.release();
  assert.deepEqual(disposed, ["blob:1"]);
  assert.equal(cache.size, 0);

  // released mid-load: aborted, and a late value is disposed
  let signal: AbortSignal | undefined;
  let resolve!: (v: string) => void;
  const c = cache.acquire("k", (s) => {
    signal = s;
    return new Promise((r) => (resolve = r));
  });
  c.release();
  assert.equal(signal?.aborted, true);
  resolve("blob:late");
  await c.promise;
  assert.deepEqual(disposed, ["blob:1", "blob:late"]);

  // a failed load is forgotten, so the next acquire retries
  const d = cache.acquire("k", async () => {
    throw new Error("401");
  });
  await assert.rejects(d.promise, /401/);
  assert.equal(cache.size, 0);
  const e = cache.acquire("k", load);
  assert.equal(await e.promise, "blob:2");
  d.release(); // stale holder doesn't drop the new entry
  assert.equal(cache.size, 1);
  e.release();
  assert.equal(cache.size, 0);
});
