// mxblocks v1: an extra content key (any of RICH_KEYS) on a normal
// m.room.message (m.text / m.notice) whose body + formatted_body are the full
// fallback for clients without this module. Spec: docs/spec.md.
//
// Parsing is total: anything malformed, unknown or over a limit is dropped,
// and a payload with nothing renderable yields null so the tile is left
// exactly as Element would draw it. Nothing here is ever rendered as HTML.

import { RICH_KEYS, firstObject } from "../keys.ts";
import { LIMITS, isObj } from "./common.ts";
import { type Block, type FallbackBlock, parseBlock } from "./blocks.ts";

export * from "./blocks.ts";
export * from "./form.ts";
export * from "./media.ts";
export { LIMITS } from "./common.ts";

export {
  ALBUM_KEYS,
  DEFAULT_WRITE_KEY,
  RICH_KEY,
  RICH_KEY_NEW,
  RICH_KEYS,
  USED_KEYS,
  richKey,
  usedKey,
  type WriteKey,
} from "../keys.ts";
export const RICH_VERSION = 1;

export interface RichPayload {
  v: number;
  blocks: (Block | FallbackBlock)[];
}

/** The raw rich object: the first of RICH_KEYS (newest first) holding an object. */
function richRaw(
  content: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> | null {
  return firstObject(content, keys);
}

/** Cheap check for the renderer filter (runs for every timeline event). */
export function hasRichKey(
  content: Record<string, unknown> | undefined,
  keys: readonly string[] = RICH_KEYS,
): boolean {
  return richRaw(content, keys) !== null;
}

/**
 * The rich payload of a message's (latest) content, or null when absent,
 * malformed, of a newer version, or with nothing renderable. Element's
 * getContent() already returns m.new_content for an edited event, so edits
 * replace the whole payload; an edit without the key removes it.
 */
export function parseRich(
  content: Record<string, unknown> | undefined,
  keys: readonly string[] = RICH_KEYS,
): RichPayload | null {
  try {
    const raw = richRaw(content, keys);
    if (!raw) return null;
    const v = raw.v;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > RICH_VERSION) return null;
    if (!Array.isArray(raw.blocks)) return null;
    const blocks = raw.blocks
      .slice(0, LIMITS.blocks)
      .map(parseBlock)
      .filter((b): b is Block | FallbackBlock => b !== null);
    return blocks.length ? { v, blocks } : null;
  } catch {
    return null;
  }
}
