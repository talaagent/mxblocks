// `gallery` and `file` blocks, and the album marker on a gallery's follow-up
// images. Media is referenced the way Matrix's own m.image/m.file content
// does it: a plain `url` (mxc://) or, in E2EE rooms, an encrypted `file`
// (EncryptedFile v2). Spec: docs/rich-messages.md.

import { RICH_KEYS, firstObject } from "../keys.ts";
import { LIMITS, isObj, line, list, mxcUri, num, text } from "./common.ts";

/** Attachment encryption v2 (AES-CTR 256 + SHA-256 of the ciphertext). */
export interface EncryptedFile {
  url: string;
  /** JWK `k` (base64url) */
  k: string;
  /** base64 counter block */
  iv: string;
  /** base64 SHA-256 of the ciphertext */
  sha256: string;
}

export type MediaSource =
  { kind: "plain"; mxc: string } | { kind: "encrypted"; mxc: string; file: EncryptedFile };

const B64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

export function parseEncryptedFile(v: unknown): EncryptedFile | null {
  if (!isObj(v) || v.v !== "v2") return null;
  const url = mxcUri(v.url);
  const k = isObj(v.key) ? v.key.k : null;
  const sha256 = isObj(v.hashes) ? v.hashes.sha256 : null;
  const iv = v.iv;
  const ok = (s: unknown): s is string => typeof s === "string" && s.length <= 128 && B64.test(s);
  return url && ok(k) && ok(iv) && ok(sha256) ? { url, k, iv, sha256 } : null;
}

/** `urlKey` (plain mxc) or `fileKey` (EncryptedFile); both, neither or malformed: null. */
export function parseSource(
  o: Record<string, unknown>,
  urlKey = "url",
  fileKey = "file",
): MediaSource | null {
  const hasUrl = o[urlKey] !== undefined;
  const hasFile = o[fileKey] !== undefined;
  if (hasUrl === hasFile) return null;
  if (hasUrl) {
    const mxc = mxcUri(o[urlKey]);
    return mxc ? { kind: "plain", mxc } : null;
  }
  const file = parseEncryptedFile(o[fileKey]);
  return file ? { kind: "encrypted", mxc: file.url, file } : null;
}

const posInt = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
};
const size = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
};

// ---------------------------------------------------------------- gallery

export interface GalleryImage {
  src: MediaSource;
  caption: string | null;
  alt: string | null;
  w: number | null;
  h: number | null;
  mimetype: string | null;
  size: number | null;
}
export interface GalleryBlock {
  type: "gallery";
  title: string | null;
  images: GalleryImage[];
}

export function parseGallery(v: Record<string, unknown>): GalleryBlock | null {
  const images = list(v.images, LIMITS.galleryImages, (x): GalleryImage | null => {
    if (!isObj(x)) return null;
    const src = parseSource(x);
    if (!src) return null;
    const mt = line(x.mimetype, 100);
    return {
      src,
      caption: line(x.caption, LIMITS.captionChars),
      alt: line(x.alt, LIMITS.captionChars),
      w: posInt(x.w),
      h: posInt(x.h),
      mimetype: mt?.startsWith("image/") ? mt : null,
      size: size(x.size),
    };
  });
  return images.length
    ? { type: "gallery", title: line(v.title, LIMITS.captionChars), images }
    : null;
}

// ---------------------------------------------------------------- file

export interface FileBlock {
  type: "file";
  name: string;
  size: number | null;
  mimetype: string | null;
  src: MediaSource;
  preview: string | null;
  /** the preview is cut (by the sender's or our caps) */
  previewCut: boolean;
  thumbnail: MediaSource | null;
}

export function parseFile(v: Record<string, unknown>): FileBlock | null {
  const name = line(v.name, 255);
  const src = parseSource(v);
  if (!name || !src) return null;
  let preview = text(v.preview, LIMITS.previewChars);
  let previewCut = typeof v.preview === "string" && v.preview.length > LIMITS.previewChars;
  if (preview) {
    const lines = preview.split("\n");
    if (lines.length > LIMITS.previewLines) {
      preview = lines.slice(0, LIMITS.previewLines).join("\n");
      previewCut = true;
    }
  }
  const sz = size(v.size);
  // A preview shorter than the file is partial (the sender sends the start).
  if (preview && sz !== null && new TextEncoder().encode(preview).length < sz - 2)
    previewCut = true;
  return {
    type: "file",
    name,
    size: sz,
    mimetype: line(v.mimetype, 100),
    src,
    preview,
    previewCut,
    thumbnail: parseSource(v, "thumbnail_url", "thumbnail_file"),
  };
}

// ---------------------------------------------------------------- album

/** Content key a default (legacy) sender writes on a gallery's follow-up m.image events. */
export const ALBUM_KEY = "com.ianm.mtrix.album";

export interface AlbumRef {
  /** the leader event carrying the gallery block */
  event_id: string;
  index: number;
}

export function hasAlbumKey(
  content: Record<string, unknown> | undefined,
  keys: readonly string[] = RICH_KEYS,
): boolean {
  return (
    firstObject(
      content,
      keys.map((key) => `${key}.album`),
    ) !== null
  );
}

export function parseAlbum(
  content: Record<string, unknown> | undefined,
  keys: readonly string[] = RICH_KEYS,
): AlbumRef | null {
  const raw = firstObject(
    content,
    keys.map((key) => `${key}.album`),
  );
  if (!raw) return null;
  const id = raw.event_id;
  const index = num(raw.index);
  if (typeof id !== "string" || !/^\$\S{1,255}$/.test(id) || index === null) return null;
  return { event_id: id, index };
}

/** The mxc an m.image/m.file event's own content points at (plain or encrypted). */
export function contentMxc(content: Record<string, unknown> | undefined): string | null {
  if (!content) return null;
  return parseSource(content)?.mxc ?? null;
}
