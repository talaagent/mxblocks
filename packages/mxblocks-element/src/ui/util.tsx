// Shared UI bits: error boundary, clock and viewport hooks, local download/copy,
// safe links.

import { React } from "../react";

/**
 * Never let a bad block or a bug take the message tile (or other blocks)
 * down. A failed block renders `fallback` (e.g. Element's own tile when the
 * block replaced it), or nothing.
 */
export class Boundary extends React.Component<
  { name: string; children?: React.ReactNode; fallback?: React.ReactNode },
  { failed: boolean }
> {
  public state = { failed: false };
  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  public componentDidCatch(e: unknown): void {
    console.warn(`[mxblocks] ${this.props.name} block failed to render`, e);
  }
  public render(): React.ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

/** Date.now(), re-read every `ms` while `active` (display only, never triggers actions). */
export function useNow(ms: number, active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}

/**
 * True once the element has come within a screen of the viewport (then
 * stays true), so a long timeline doesn't fetch every gallery at once.
 */
export function useNearViewport(ref: React.RefObject<Element | null>): boolean {
  const [near, setNear] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  });
  return near;
}

/** Save `data` as a local file (Blob URL; no network). */
export function download(name: string, mime: string, data: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Save a Blob as a local file under `name`. */
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** A "Copy" button with a short "Copied" confirmation. */
export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}): React.JSX.Element {
  const [state, setState] = React.useState<"idle" | "ok" | "err">("idle");
  React.useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1500);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className="mxblocks_btn mxblocks_btn--small"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => setState("ok"),
          () => setState("err"),
        )
      }
    >
      {state === "ok" ? "Copied" : state === "err" ? "Copy failed" : label}
    </button>
  );
}

/** An external link. `href` is always a parser-validated https URL. */
export function ExtLink({
  href,
  className,
  title,
  children,
}: {
  href: string;
  className?: string;
  title?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <a
      href={href}
      className={className}
      title={title ?? href}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      {children}
    </a>
  );
}

export const cx = (...c: (string | false | null | undefined)[]): string =>
  c.filter(Boolean).join(" ");
