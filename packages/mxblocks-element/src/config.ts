import { DEFAULT_WRITE_KEY, RICH_KEY, RICH_KEY_NEW, type WriteKey, type ContentKeys, contentKeys, firstObject } from "./keys.ts";

/**
 * Element config.json keys holding this module's settings, read in this
 * order (the first one holding an object wins):
 * `{ "senders": ["@bot:example.org", ...], "write_key": "org.example.blocks", "read_keys": ["org.example.old"] }`.
 * Blocks render only under messages from these senders; anyone else's rich
 * key is ignored and the message renders normally. Missing or malformed
 * config means nothing renders anywhere (fail closed).
 */
export const RICH_CONFIG_KEYS = [RICH_KEY_NEW, RICH_KEY] as const;
/** The key named in log lines. */
export const RICH_CONFIG_KEY = RICH_KEY_NEW;

function section(config: unknown): Record<string, unknown> | null {
  return typeof config === "object" && config !== null
    ? firstObject(config as Record<string, unknown>, RICH_CONFIG_KEYS)
    : null;
}

/** The sender allow-list from Element's whole config object. */
export function readSenders(config: unknown): Set<string> {
  const senders = section(config)?.senders;
  if (!Array.isArray(senders)) return new Set();
  // Full MXIDs only: no wildcards, no server-wide entries.
  return new Set(
    senders.filter((s): s is string => typeof s === "string" && /^@[^:\s]+:[^\s]+$/.test(s)),
  );
}

/** The writer namespace; "legacy" and "new" remain convenient default selectors. */
export function readWriteKey(config: unknown): WriteKey {
  const key = section(config)?.write_key;
  return typeof key === "string" && key.trim() ? key.trim() : DEFAULT_WRITE_KEY;
}

/** Custom namespaces accept only explicitly configured compatibility aliases. */
export function readContentKeys(config: unknown): ContentKeys {
  const aliases = section(config)?.read_keys;
  const valid = Array.isArray(aliases)
    ? aliases.filter((key): key is string => typeof key === "string" && !!key.trim()).map((key) => key.trim())
    : undefined;
  return contentKeys(readWriteKey(config), valid);
}
