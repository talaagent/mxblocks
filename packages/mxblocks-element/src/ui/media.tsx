// `gallery` and `file` blocks, and the album images that follow a gallery.
// Media comes only from the user's homeserver, fetched with the access token
// (authenticated media) into Blob URLs: plain mxc as scale thumbnails,
// encrypted media decrypted locally (raster image types only; see
// lib/media.ts).

import { React } from "../react";
import type {
  AlbumRef,
  FileBlock,
  GalleryBlock,
  GalleryImage,
  MediaSource,
} from "../schema/index.ts";
import { contentMxc, parseRich, RICH_KEYS } from "../schema/index.ts";
import { fileBadge, fmtBytes } from "../lib/media.ts";
import { fetchMedia, useMediaUrl, useRoomEvent } from "../matrix";
import { cx, downloadBlob, useNearViewport } from "./util";

/**
 * An image from a media source, as a Blob URL fetched with the access token:
 * a scale thumbnail for a w×h box for plain mxc (`full`: the original), the
 * decrypted original for encrypted media.
 */
function MediaImg({
  src,
  mimetype,
  w,
  h,
  full = false,
  alt,
  className,
}: {
  src: MediaSource;
  mimetype: string | null;
  w: number;
  h: number;
  full?: boolean;
  alt: string;
  className?: string;
}): React.JSX.Element {
  const ref = React.useRef<HTMLSpanElement>(null);
  const near = useNearViewport(ref);
  const [failed, setFailed] = React.useState(false);
  const media = useMediaUrl(src, mimetype, full ? "full" : { w, h }, full || near);
  if (failed || media.failed)
    return (
      <span className={cx("mxblocks_imgMissing", className)} role="img" aria-label={alt}>
        🖼
      </span>
    );
  if (!media.url)
    return <span ref={ref} className={cx("mxblocks_imgLoading", className)} aria-busy="true" />;
  return (
    <img
      className={className}
      src={media.url}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

// ---------------------------------------------------------------- gallery

const TILE_H = 160;

function tileWidth(img: GalleryImage): number {
  if (!img.w || !img.h) return TILE_H;
  return Math.round(Math.min(280, Math.max(100, (TILE_H * img.w) / img.h)));
}

function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: GalleryImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}): React.JSX.Element {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const img = images[index];
  const n = images.length;
  React.useEffect(() => {
    // A modal <dialog> sits in the top layer, above Element's timeline
    // whatever its stacking contexts; Esc closes it natively.
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  const go = (d: number): void => onIndex((index + d + n) % n);
  const save = async (): Promise<void> => {
    setError(null);
    try {
      const blob = await fetchMedia(img.src, img.mimetype);
      const ext = img.mimetype?.split("/")[1]?.replace("jpeg", "jpg") ?? "img";
      downloadBlob(`image-${index + 1}.${ext}`, blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <dialog
      ref={ref}
      className="mxblocks_lightbox"
      aria-label={`Image ${index + 1} of ${n}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        else if (e.key === "ArrowRight") go(1);
      }}
    >
      <MediaImg
        key={index}
        src={img.src}
        mimetype={img.mimetype}
        w={0}
        h={0}
        full
        alt={img.alt ?? img.caption ?? `Image ${index + 1}`}
        className="mxblocks_lightboxImg"
      />
      <div className="mxblocks_lightboxBar">
        {n > 1 ? (
          <button
            type="button"
            className="mxblocks_btn"
            onClick={() => go(-1)}
            aria-label="Previous"
          >
            ‹
          </button>
        ) : null}
        <span className="mxblocks_lightboxCaption">
          <span className="mxblocks_num">
            {index + 1}/{n}
          </span>
          {img.caption ? ` · ${img.caption}` : ""}
        </span>
        {n > 1 ? (
          <button type="button" className="mxblocks_btn" onClick={() => go(1)} aria-label="Next">
            ›
          </button>
        ) : null}
        <button type="button" className="mxblocks_btn" onClick={() => void save()}>
          Download
        </button>
        <button type="button" className="mxblocks_btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {error ? <span className="mxblocks_error">{error}</span> : null}
      </div>
    </dialog>
  );
}

export function Gallery({ block }: { block: GalleryBlock }): React.JSX.Element {
  const [open, setOpen] = React.useState<number | null>(null);
  return (
    <div className="mxblocks_gallery">
      {block.title ? <span className="mxblocks_title">{block.title}</span> : null}
      <div className="mxblocks_galleryRow" role="list">
        {block.images.map((img, i) => {
          const w = tileWidth(img);
          const label = img.alt ?? img.caption ?? `Image ${i + 1} of ${block.images.length}`;
          return (
            <figure role="listitem" key={i} className="mxblocks_galleryItem" style={{ width: w }}>
              <button
                type="button"
                className="mxblocks_galleryBtn"
                style={{ width: w, height: TILE_H }}
                onClick={() => setOpen(i)}
                title={img.caption ?? "Open"}
                aria-label={`Open ${label}`}
              >
                <MediaImg
                  src={img.src}
                  mimetype={img.mimetype}
                  w={w}
                  h={TILE_H}
                  alt={label}
                  className="mxblocks_galleryImg"
                />
              </button>
              {img.caption ? (
                <figcaption className="mxblocks_muted">{img.caption}</figcaption>
              ) : null}
            </figure>
          );
        })}
      </div>
      {open !== null ? (
        <Lightbox
          images={block.images}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- file

export function FileCard({ block }: { block: FileBlock }): React.JSX.Element {
  const [state, setState] = React.useState<"idle" | "busy" | string>("idle");
  const meta = [fmtBytes(block.size), block.mimetype].filter(Boolean).join(" · ");
  const save = async (): Promise<void> => {
    if (state === "busy") return;
    setState("busy");
    try {
      downloadBlob(block.name, await fetchMedia(block.src, null));
      setState("idle");
    } catch (e) {
      setState(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="mxblocks_file">
      <div className="mxblocks_fileHead">
        {block.thumbnail ? (
          <MediaImg
            src={block.thumbnail}
            mimetype="image/jpeg"
            w={48}
            h={48}
            alt=""
            className="mxblocks_img mxblocks_fileThumb"
          />
        ) : (
          <span className="mxblocks_fileIcon" aria-hidden="true">
            {fileBadge(block.name, block.mimetype)}
          </span>
        )}
        <span className="mxblocks_cardBody">
          <span className="mxblocks_cardTitle" title={block.name}>
            {block.name}
          </span>
          {meta ? <span className="mxblocks_muted">{meta}</span> : null}
        </span>
        <button
          type="button"
          className="mxblocks_btn mxblocks_btn--small"
          onClick={() => void save()}
          disabled={state === "busy"}
        >
          {state === "busy" ? "Downloading…" : "Download"}
        </button>
      </div>
      {block.preview ? (
        <pre className="mxblocks_filePreview">
          {block.preview}
          {block.previewCut ? "\n…" : ""}
        </pre>
      ) : null}
      {state !== "idle" && state !== "busy" ? (
        <span className="mxblocks_error">{state}</span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- album images

/**
 * A follow-up image of an album. When its leader (same sender) is loaded
 * and the leader's gallery lists this image, the whole tile is hidden (the
 * gallery shows it); otherwise Element's own image tile stays. Hidden only
 * in the main timeline, not in reply quotes, threads or search.
 */
export function AlbumMember({
  roomId,
  sender,
  content,
  album,
  original,
  readKeys = RICH_KEYS,
}: {
  roomId: string;
  sender: string;
  content: Record<string, unknown>;
  album: AlbumRef;
  original: React.ReactNode;
  readKeys?: readonly string[];
}): React.JSX.Element {
  const ref = React.useRef<HTMLSpanElement>(null);
  const leader = useRoomEvent(roomId, album.event_id);
  const mxc = contentMxc(content);
  const folded = React.useMemo(() => {
    if (!leader || leader.sender !== sender || !mxc) return false;
    const payload = parseRich(leader.content, readKeys);
    return !!payload?.blocks.some(
      (b) => b.type === "gallery" && b.images.some((i) => i.src.mxc === mxc),
    );
  }, [leader, sender, mxc, readKeys]);
  React.useLayoutEffect(() => {
    const el = ref.current;
    const tile = el?.closest(".mx_EventTile");
    const inTimeline = !!el?.closest(".mx_RoomView_MessageList");
    const compact = !!el?.closest(".mx_ReplyChain, .mx_ReplyPreview, .mx_ThreadView");
    if (!tile || !inTimeline || compact) return;
    // Re-applied on every render: Element may rewrite the tile's className.
    tile.classList.toggle("mxblocks_albumHidden", folded);
    return () => tile.classList.remove("mxblocks_albumHidden");
  });
  return (
    <>
      <span ref={ref} hidden />
      {original}
    </>
  );
}
