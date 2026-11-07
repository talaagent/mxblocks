// matrix-js-sdk access through the logged-in client Element exposes as
// window.mxMatrixClientPeg (MatrixClientPeg.ts sets it unconditionally). The
// module API's MatrixEvent is a plain snapshot without relations and its
// ClientApi can't send events, so reactions are read from the room's
// RelationsContainer (the one Element's reaction row uses) and clicks send
// through the client. Only the js-sdk methods below are used; typed locally.

import { DEFAULT_WRITE_KEY, USED_KEYS, type WriteKey, type ContentKeys, firstObject, usedEntry } from "./keys.ts";
import { React } from "./react";
import type { MediaSource } from "./schema/index.ts";
import { SharedCache, decryptAttachment, safeBlobType, thumbSide } from "./lib/media.ts";

interface SdkRelEvent {
  getId(): string | undefined;
  getType(): string;
  getSender(): string | undefined;
  getContent(): Record<string, unknown>;
  isRedacted(): boolean;
}

interface SdkRelations {
  getSortedAnnotationsByKey(): [string, Set<SdkRelEvent>][] | null;
}

interface SdkRelationsContainer {
  getChildEventsForEvent(
    eventId: string,
    relType: string,
    eventType: string,
  ): SdkRelations | undefined;
}

interface SdkRoom {
  roomId: string;
  relations?: SdkRelationsContainer;
  getUnfilteredTimelineSet(): { relations?: SdkRelationsContainer };
  getLiveTimeline(): { getEvents(): SdkRelEvent[] };
  getPendingEvents?(): SdkRelEvent[];
  findEventById?(eventId: string): SdkRelEvent | undefined;
}

interface SdkClient {
  getUserId(): string | null;
  getRoom(roomId: string): SdkRoom | null;
  sendEvent(roomId: string, type: string, content: Record<string, unknown>): Promise<unknown>;
  sendMessage(roomId: string, content: Record<string, unknown>): Promise<unknown>;
  mxcUrlToHttp(
    mxc: string,
    width?: number,
    height?: number,
    resizeMethod?: string,
    allowDirectLinks?: boolean,
    allowRedirects?: boolean,
    useAuthentication?: boolean,
  ): string | null;
  canSupport?: Map<string, number>;
  getAccessToken?(): string | null;
  on(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
}

function client(): SdkClient | null {
  const peg = (window as unknown as { mxMatrixClientPeg?: { get(): SdkClient | null } })
    .mxMatrixClientPeg;
  return peg?.get() ?? null;
}

export interface ReactionState {
  /** keys the logged-in user has reacted with (not redacted; includes local echoes) */
  mine: Set<string>;
  /** per key: how many users other than the event's sender reacted */
  counts: Map<string, number>;
}

/** m.text bodies the user already sent as replies to the event. */
export type SentBodies = Set<string>;

/**
 * The user's replies to the event that name a prompt
 * (`<key>.used.id`, any of USED_KEYS), by id: the reply's `used.values` (forms) or
 * null.
 */
export type UsedPrompts = Map<string, Record<string, unknown> | null>;

function readReactions(roomId: string, eventId: string, sender: string): ReactionState {
  const mine = new Set<string>();
  const counts = new Map<string, number>();
  const c = client();
  const room = c?.getRoom(roomId);
  if (!c || !room) return { mine, counts };
  const me = c.getUserId();
  const container = room.relations ?? room.getUnfilteredTimelineSet().relations;
  const rel = container?.getChildEventsForEvent(eventId, "m.annotation", "m.reaction");
  for (const [key, events] of rel?.getSortedAnnotationsByKey() ?? []) {
    const users = new Set<string>();
    for (const ev of events) {
      const who = ev.getSender();
      // The bot pre-seeds ✅/❌ for one-tap on mobile; those aren't choices.
      if (!who || who === sender || ev.isRedacted()) continue;
      users.add(who);
    }
    if (users.size) counts.set(key, users.size);
    if (me && users.has(me)) mine.add(key);
  }
  return { mine, counts };
}

function readSent(roomId: string, eventId: string): { sent: SentBodies; used: UsedPrompts } {
  const sent = new Set<string>();
  const used: UsedPrompts = new Map();
  const c = client();
  const room = c?.getRoom(roomId);
  const me = c?.getUserId();
  if (!room || !me) return { sent, used };
  const events = [...room.getLiveTimeline().getEvents(), ...(room.getPendingEvents?.() ?? [])];
  for (const ev of events) {
    if (ev.getSender() !== me || ev.getType() !== "m.room.message" || ev.isRedacted()) continue;
    const content = ev.getContent();
    const rel = content["m.relates_to"] as Record<string, any> | undefined;
    if (rel?.["m.in_reply_to"]?.event_id !== eventId) continue;
    if (typeof content.body === "string") sent.add(content.body);
    const u = firstObject(content, readUsedKeys);
    if (u && u.event_id === eventId && typeof u.id === "string") {
      const values = u.values;
      used.set(
        u.id,
        typeof values === "object" && values !== null && !Array.isArray(values)
          ? (values as Record<string, unknown>)
          : null,
      );
    }
  }
  return { sent, used };
}

/**
 * Reactions on and replies to one event, recomputed when the room's timeline
 * changes (new reaction, redaction, local echo sent/failed). Recomputing is
 * deferred a tick so the js-sdk has aggregated the relation first.
 */
export function useEventInteractions(
  roomId: string,
  eventId: string,
  sender: string,
  wantSent: boolean,
): { reactions: ReactionState; sent: SentBodies; used: UsedPrompts } {
  const read = React.useCallback(
    () => ({
      reactions: readReactions(roomId, eventId, sender),
      // Scans the live timeline, so only when a button or form can send a message.
      ...(wantSent ? readSent(roomId, eventId) : { sent: new Set<string>(), used: new Map() }),
    }),
    [roomId, eventId, sender, wantSent],
  );
  const [state, setState] = React.useState(read);
  React.useEffect(() => {
    setState(read());
    const c = client();
    if (!c) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (_ev: unknown, room?: { roomId?: string }): void => {
      if (room && room.roomId !== roomId) return;
      if (timer === undefined)
        timer = setTimeout(() => {
          timer = undefined;
          setState(read());
        }, 0);
    };
    const events = ["Room.timeline", "Room.redaction", "Room.localEchoUpdated"];
    for (const e of events) c.on(e, schedule);
    return () => {
      for (const e of events) c.removeListener(e, schedule);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [roomId, read]);
  return state;
}

/** React to `eventId` with `key`, exactly as tapping Element's reaction picker does. */
export async function sendReaction(roomId: string, eventId: string, key: string): Promise<void> {
  const c = client();
  if (!c) throw new Error("Not logged in");
  await c.sendEvent(roomId, "m.reaction", {
    "m.relates_to": { rel_type: "m.annotation", event_id: eventId, key },
  });
}

let writeKey: WriteKey = DEFAULT_WRITE_KEY;
let readUsedKeys: readonly string[] = USED_KEYS;

/** Configure reply reads and writes together for this loaded Element module. */
export function setContentKeys(keys: ContentKeys): void {
  writeKey = keys.writeKey;
  readUsedKeys = keys.usedKeys;
}

/** Choose the key `.used` replies are written under (config `write_key`). */
export function setWriteKey(wk: WriteKey): void {
  writeKey = wk;
}

/**
 * Send `body` (unchanged: bots match it exactly) as m.text, as a visible
 * reply to `eventId` (no reply fallback, per Matrix 1.13), with
 * `<key>.used: {event_id, id?}` (`usedKey`) naming the message and button.
 */
export async function sendReply(
  roomId: string,
  eventId: string,
  body: string,
  buttonId: string | null,
): Promise<void> {
  const c = client();
  if (!c) throw new Error("Not logged in");
  await c.sendMessage(roomId, {
    msgtype: "m.text",
    body,
    "m.relates_to": { "m.in_reply_to": { event_id: eventId } },
    ...usedEntry(writeKey, buttonId ? { event_id: eventId, id: buttonId } : { event_id: eventId }),
  });
}

/**
 * A form submission: `body` (lib/form.ts) as m.text, a visible reply to
 * `eventId`, with `<key>.used: {event_id, id: formId, values}`.
 */
export async function sendFormReply(
  roomId: string,
  eventId: string,
  body: string,
  formId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const c = client();
  if (!c) throw new Error("Not logged in");
  await c.sendMessage(roomId, {
    msgtype: "m.text",
    body,
    "m.relates_to": { "m.in_reply_to": { event_id: eventId } },
    ...usedEntry(writeKey, { event_id: eventId, id: formId, values }),
  });
}

/** The logged-in user's MXID. */
export function myUserId(): string | null {
  return client()?.getUserId() ?? null;
}

/**
 * HTTP URL of a `scale` thumbnail (`side`×`side` device pixels at most, see
 * lib/media.ts thumbSide) of an mxc on the user's own homeserver:
 * authenticated media (/_matrix/client/v1/media) unless the server lacks it.
 * It needs the access token, so it is fetched with mediaFetch, never put in
 * an <img> as is.
 */
export function thumbnailUrl(mxc: string, side: number): string | null {
  const c = client();
  if (!c) return null;
  return c.mxcUrlToHttp(mxc, side, side, "scale", false, true, useAuth(c));
}

// js-sdk Feature.AuthenticatedMedia; ServerSupport.Unsupported = 2.
function useAuth(c: SdkClient): boolean {
  const support = c.canSupport?.get("AuthenticatedMedia");
  return support === undefined ? true : support !== 2;
}

/** The full-size download URL of an mxc on the user's homeserver (see thumbnailUrl). */
export function downloadUrl(mxc: string): string | null {
  const c = client();
  if (!c) return null;
  return c.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, useAuth(c));
}

/**
 * GET a media URL from the user's homeserver with the access token as a
 * Bearer header, as Element's own media code does. Element's service worker
 * isn't relied on: it doesn't cover these requests in practice, and an
 * <img> fetching /_matrix/client/v1/media without the header gets 401.
 */
async function mediaFetch(c: SdkClient, url: string, signal?: AbortSignal): Promise<Response> {
  const token = c.getAccessToken?.();
  const res = await fetch(
    url,
    token ? { signal, headers: { Authorization: `Bearer ${token}` } } : { signal },
  );
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return res;
}

/**
 * The media as a local Blob, decrypted when encrypted. Fetched from the
 * user's own homeserver only (mxcUrlToHttp without direct links always
 * builds a homeserver URL). `side`: a scale thumbnail of plain media
 * instead of the original (encrypted media has no server thumbnails).
 */
export async function fetchMedia(
  src: MediaSource,
  mimetype: string | null,
  signal?: AbortSignal,
  side: number | null = null,
): Promise<Blob> {
  const c = client();
  const thumb = side !== null && src.kind === "plain";
  const url = thumb ? thumbnailUrl(src.mxc, side) : downloadUrl(src.mxc);
  if (!c || !url) throw new Error("Not logged in");
  const res = await mediaFetch(c, url, signal);
  let data = await res.arrayBuffer();
  if (src.kind === "encrypted") data = await decryptAttachment(data, src.file);
  // A thumbnail's type is the server's (often JPEG for a PNG original).
  const type = thumb ? res.headers.get("content-type") : mimetype;
  return new Blob([data], { type: safeBlobType(type) });
}

// Blob URLs of displayed media, shared by tiles, cards and the lightbox.
const mediaUrls = new SharedCache<string>((url) => URL.revokeObjectURL(url));

/**
 * A Blob URL of the media while mounted and `enabled`: a scale thumbnail
 * fitting a w×h box for plain media, the (decrypted) original for
 * encrypted media or with `full`. Shared and revoked with the last user.
 */
export function useMediaUrl(
  src: MediaSource,
  mimetype: string | null,
  box: { w: number; h: number } | "full",
  enabled = true,
): { url: string | null; failed: boolean } {
  const [state, setState] = React.useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  });
  const side =
    box === "full" || src.kind === "encrypted"
      ? null
      : thumbSide(box.w, box.h, window.devicePixelRatio);
  // src is identified by its mxc
  const key = `${src.mxc}|${side ?? "full"}`;
  React.useEffect(() => {
    if (!enabled) return;
    let live = true;
    const held = mediaUrls.acquire(key, async (signal) =>
      URL.createObjectURL(await fetchMedia(src, mimetype, signal, side)),
    );
    held.promise.then(
      (url) => {
        if (live) setState({ url, failed: false });
      },
      () => {
        if (live) setState({ url: null, failed: true });
      },
    );
    return () => {
      live = false;
      held.release();
      setState({ url: null, failed: false });
    };
  }, [key, enabled]);
  return state;
}

/**
 * Another event of the room (for an album image: its leader), re-read as
 * the timeline changes or events decrypt; null until it's loaded.
 */
export function useRoomEvent(
  roomId: string,
  eventId: string,
): { sender: string; content: Record<string, unknown> } | null {
  const read = React.useCallback(() => {
    const ev = client()?.getRoom(roomId)?.findEventById?.(eventId);
    const sender = ev?.getSender();
    if (!ev || !sender || ev.isRedacted()) return null;
    return { sender, content: ev.getContent() };
  }, [roomId, eventId]);
  const [state, setState] = React.useState(read);
  React.useEffect(() => {
    setState(read());
    const c = client();
    if (!c) return;
    // getContent() keeps its identity until the event changes.
    const update = (): void => {
      const next = read();
      setState((prev) =>
        prev?.content === next?.content && prev?.sender === next?.sender ? prev : next,
      );
    };
    const events = ["Room.timeline", "Event.decrypted", "Room.redaction"];
    for (const e of events) c.on(e, update);
    return () => {
      for (const e of events) c.removeListener(e, update);
    };
  }, [read]);
  return state;
}
