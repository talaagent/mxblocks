import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { readSenders, readWriteKey, readContentKeys } from "../src/config.ts";
import {
  ALBUM_KEYS,
  DEFAULT_WRITE_KEY,
  RICH_KEY,
  RICH_KEY_NEW,
  RICH_KEYS,
  USED_KEYS,
  firstObject,
  richKey,
  usedEntry,
  usedKey,
} from "../src/keys.ts";
import { hasAlbumKey, hasRichKey, parseAlbum, parseRich } from "../src/schema/index.ts";

const btn = (label: string) => ({ type: "buttons", buttons: [{ label, action: { type: "react", key: "✅" } }] });

test("key order matches the crate", () => {
  assert.deepEqual(RICH_KEYS, ["com.talaagent.mxblocks", "com.ianm.mtrix"]);
  assert.equal(RICH_KEY_NEW, RICH_KEYS[0]);
  assert.equal(RICH_KEY, RICH_KEYS[1]);
  assert.deepEqual(USED_KEYS, RICH_KEYS.map((k) => `${k}.used`));
  assert.deepEqual(ALBUM_KEYS, RICH_KEYS.map((k) => `${k}.album`));
});

test("the renderer reads every key, newest first", () => {
  for (const k of RICH_KEYS) {
    const c = { [k]: { v: 1, blocks: [btn(k)] } };
    assert.ok(hasRichKey(c), k);
    const b = parseRich(c)?.blocks[0] as { buttons: { label: string }[] };
    assert.equal(b.buttons[0].label, k);
  }
  const all = Object.fromEntries(RICH_KEYS.map((k) => [k, { v: 1, blocks: [btn(k)] }]));
  const b = parseRich(all)?.blocks[0] as { buttons: { label: string }[] };
  assert.equal(b.buttons[0].label, RICH_KEY_NEW);
  // A non-object under a newer key doesn't hide an older one.
  assert.ok(parseRich({ [RICH_KEY_NEW]: "x", [RICH_KEY]: { v: 1, blocks: [btn("a")] } }));
  for (const k of ALBUM_KEYS) {
    const c = { [k]: { event_id: "$lead", index: 2 } };
    assert.ok(hasAlbumKey(c), k);
    assert.deepEqual(parseAlbum(c), { event_id: "$lead", index: 2 });
  }
  assert.equal(firstObject(undefined, RICH_KEYS), null);
});

test("writes go to the legacy key by default", () => {
  assert.equal(DEFAULT_WRITE_KEY, "legacy");
  assert.equal(richKey("legacy"), "com.ianm.mtrix");
  assert.equal(richKey("new"), "com.talaagent.mxblocks");
  assert.equal(usedKey("legacy"), "com.ianm.mtrix.used");
  assert.equal(usedKey("new"), "com.talaagent.mxblocks.used");
  assert.deepEqual(usedEntry(DEFAULT_WRITE_KEY, { event_id: "$e", id: "b" }), {
    "com.ianm.mtrix.used": { event_id: "$e", id: "b" },
  });
  assert.deepEqual(Object.keys(usedEntry("new", {})), ["com.talaagent.mxblocks.used"]);
});

test("config: the new key first, then the legacy one", () => {
  const legacy = { "com.ianm.mtrix": { senders: ["@bot:example.org"] } };
  assert.deepEqual([...readSenders(legacy)], ["@bot:example.org"]);
  const both = { ...legacy, "com.talaagent.mxblocks": { senders: ["@new:example.org"], write_key: "new" } };
  assert.deepEqual([...readSenders(both)], ["@new:example.org"]);
  assert.equal(readWriteKey(both), "new");
  assert.equal(readWriteKey(legacy), "legacy");
  assert.equal(readWriteKey({ "com.ianm.mtrix": { write_key: 42 } }), "legacy");
  assert.equal(readWriteKey(null), "legacy");
});

// The block fixtures the crate's catalogue test validates: every block in them
// must survive the renderer's parser (nothing silently dropped).
test("every fixture block parses", () => {
  const dir = new URL("../../../crates/mxblocks/tests/fixtures/rich/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 9);
  for (const f of files) {
    const payload = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    for (const k of RICH_KEYS) {
      const parsed = parseRich({ [k]: payload });
      assert.ok(parsed, `${f} under ${k}`);
      assert.deepEqual(
        parsed.blocks.map((b) => b.type),
        payload.blocks.map((b: { type: string }) => b.type),
        f,
      );
    }
  }
});


test("custom namespaces cover payloads, replies, and albums without implicit aliases", () => {
  const settings = readContentKeys({ [RICH_KEY_NEW]: {
    senders: ["@bot:example.org"], write_key: "org.example.blocks",
    read_keys: ["org.example.previous", "org.example.previous"],
  } });
  assert.deepEqual(settings.richKeys, ["org.example.blocks", "org.example.previous"]);
  assert.deepEqual(settings.usedKeys, ["org.example.blocks.used", "org.example.previous.used"]);
  const value = { v: 1, blocks: [btn("custom")] };
  assert.equal(parseRich({ "org.example.blocks": value }), null);
  assert.ok(parseRich({ "org.example.blocks": value }, settings.richKeys));
  assert.ok(parseRich({ "org.example.previous": value }, settings.richKeys));
  assert.equal(parseRich({ [RICH_KEY]: value }, settings.richKeys), null);
  assert.deepEqual(usedEntry(settings.writeKey, { id: "button" }), { "org.example.blocks.used": { id: "button" } });
  assert.deepEqual(parseAlbum({ "org.example.previous.album": { event_id: "$leader", index: 1 } }, settings.richKeys), { event_id: "$leader", index: 1 });
  assert.deepEqual(readContentKeys({ [RICH_KEY_NEW]: { write_key: "org.example.blocks" } }).richKeys, ["org.example.blocks"]);
});
