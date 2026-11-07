// Public compatibility namespaces. Applications can provide their own read and write keys.
export const RICH_KEY_NEW = "com.talaagent.mxblocks";
export const RICH_KEY = "com.ianm.mtrix";
export const RICH_KEYS = [RICH_KEY_NEW, RICH_KEY] as const;
export const USED_KEYS = RICH_KEYS.map((key) => `${key}.used`);
export const ALBUM_KEYS = RICH_KEYS.map((key) => `${key}.album`);

/** "legacy" and "new" select public defaults; any other string is a payload key. */
export type WriteKey = string;
export const DEFAULT_WRITE_KEY: WriteKey = "legacy";

export interface ContentKeys {
  readonly writeKey: WriteKey;
  readonly richKeys: readonly string[];
  readonly usedKeys: readonly string[];
  readonly albumKeys: readonly string[];
}

export function richKey(key: WriteKey): string {
  return key === "new" ? RICH_KEY_NEW : key === "legacy" ? RICH_KEY : key;
}

export function usedKey(key: WriteKey): string {
  return `${richKey(key)}.used`;
}

/** Explicit aliases follow the writer namespace; defaults retain public compatibility order. */
export function contentKeys(writeKey: WriteKey = DEFAULT_WRITE_KEY, aliases?: readonly string[]): ContentKeys {
  const primary = richKey(writeKey);
  const richKeys = aliases === undefined
    ? (writeKey === "legacy" || writeKey === "new" ? [...RICH_KEYS] : [primary])
    : [...new Set([primary, ...aliases])];
  return { writeKey, richKeys, usedKeys: richKeys.map((key) => `${key}.used`), albumKeys: richKeys.map((key) => `${key}.album`) };
}

export function usedEntry(key: WriteKey, used: Record<string, unknown>): Record<string, unknown> {
  return { [usedKey(key)]: used };
}

/** First configured key holding an object. */
export function firstObject(content: Record<string, unknown> | undefined, keys: readonly string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = content?.[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return null;
}
