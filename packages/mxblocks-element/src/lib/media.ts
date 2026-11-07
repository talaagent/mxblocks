// Attachment helpers with no Element dependency: decryption of Matrix
// encrypted attachments (v2: AES-CTR with a 256-bit key, SHA-256 of the
// ciphertext checked first) with WebCrypto, byte formatting and file icons.

import type { EncryptedFile } from "../schema/index.ts";

/** base64 or base64url, padded or not. */
export function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const std = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The plaintext of an encrypted attachment; throws on a hash mismatch. */
export async function decryptAttachment(
  data: ArrayBuffer,
  file: EncryptedFile,
): Promise<ArrayBuffer> {
  const want = b64decode(file.sha256);
  const got = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  if (want.length !== got.length || want.some((b, i) => b !== got[i]))
    throw new Error("attachment hash mismatch");
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "oct", k: file.k, alg: "A256CTR", ext: true, key_ops: ["encrypt", "decrypt"] },
    { name: "AES-CTR" },
    false,
    ["decrypt"],
  );
  // The spec's counter: the 16-byte IV, low 64 bits counting.
  const iv = b64decode(file.iv);
  return crypto.subtle.decrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, data);
}

/**
 * The type a local Blob gets. Only raster images keep theirs (so <img> can
 * show them); everything else, SVG and HTML included, is
 * application/octet-stream, so a Blob URL opened in a tab downloads instead
 * of running as a document on Element's origin.
 */
export function safeBlobType(mimetype: string | null): string {
  const m = (mimetype ?? "").toLowerCase().split(";")[0].trim();
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(m)
    ? m
    : "application/octet-stream";
}

/** 1536 → "1.5 KB" (1024-based, as Element shows sizes). */
export function fmtBytes(n: number | null): string | null {
  if (n === null) return null;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/** A short type label for the file card's icon: "PDF", "CSV", "ZIP", ... */
export function fileBadge(name: string, mimetype: string | null): string {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1];
  if (ext) return ext.toUpperCase();
  const sub = mimetype?.split("/")[1]?.split(/[;+.-]/)[0];
  return sub ? sub.slice(0, 5).toUpperCase() : "FILE";
}

/**
 * The side (device pixels) of the `scale` thumbnail to request for a w×h
 * CSS-pixel box: the longer side at the device pixel ratio (at most 2×),
 * capped at 800. A scale thumbnail fits inside side×side keeping its aspect
 * ratio, and object-fit: cover crops it to the box. Synapse only stores
 * `crop` thumbnails up to 96×96 by default, so cropped tiles came out
 * upscaled and blurry; its scale sizes go up to 800×600.
 */
export function thumbSide(w: number, h: number, dpr: number): number {
  const d = Math.min(2, Math.max(1, Math.ceil(dpr || 1)));
  return Math.min(800, Math.max(1, Math.ceil(Math.max(w, h) * d)));
}

interface CacheEntry<T> {
  refs: number;
  ctl: AbortController;
  promise: Promise<T>;
  value?: T;
}

/**
 * Values (Blob URLs) shared by key while anyone holds them: the first
 * `acquire` starts `load`, later ones share it, and the last `release`
 * aborts the load or `dispose`s the value. A failed load is forgotten so
 * the next acquire retries.
 */
export class SharedCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  private dispose: (value: T) => void;

  public constructor(dispose: (value: T) => void) {
    this.dispose = dispose;
  }

  public acquire(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
  ): { promise: Promise<T>; release: () => void } {
    let e = this.entries.get(key);
    if (!e) {
      const ctl = new AbortController();
      const entry: CacheEntry<T> = { refs: 0, ctl, promise: Promise.resolve(undefined as T) };
      entry.promise = load(ctl.signal).then(
        (value) => {
          if (this.entries.get(key) === entry) entry.value = value;
          else this.dispose(value);
          return value;
        },
        (err: unknown) => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw err;
        },
      );
      // Rejections reach the holders through `promise`; don't flag this one.
      entry.promise.catch(() => {});
      this.entries.set(key, entry);
      e = entry;
    }
    const entry = e;
    entry.refs++;
    let held = true;
    const release = (): void => {
      if (!held) return;
      held = false;
      if (--entry.refs > 0 || this.entries.get(key) !== entry) return;
      this.entries.delete(key);
      entry.ctl.abort();
      if (entry.value !== undefined) this.dispose(entry.value);
    };
    return { promise: entry.promise, release };
  }

  /** Keys currently held (tests). */
  public get size(): number {
    return this.entries.size;
  }
}
