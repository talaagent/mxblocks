// The rich part drawn under the original message tile. Element calls the
// registered renderer as a plain function from EventTile (a class
// component), so hooks live in <RichExtras>, never in the render function.

import { React } from "../react";
import {
  type Block,
  type FallbackBlock,
  type MathBlock,
  type RichPayload,
  blockActions,
} from "../schema/index.ts";
import { useEventInteractions } from "../matrix";
import { ActionRow, type Interactions } from "./buttons";
import { Chart } from "./chart";
import { Table } from "./table";
import {
  CardView,
  Cards,
  Code,
  Countdown,
  Details,
  Diff,
  EventCard,
  Place,
  Progress,
  Sources,
  Ticker,
  Tracker,
  Weather,
} from "./blocks";
import { MathView } from "./math";
import { Form } from "./form";
import { FileCard, Gallery } from "./media";
import { Boundary } from "./util";

export interface TileProps {
  roomId: string;
  eventId: string;
  sender: string;
  payload: RichPayload;
  /** Element's own body for this event */
  original: React.ReactNode;
  /**
   * The block that stands in for Element's own body (an album leader's
   * gallery, an m.file's file card), drawn instead of `original`; null
   * keeps `original` above the blocks.
   */
  replaces: number | null;
  /** MSC2530 caption of a replaced media body (body ≠ filename) */
  caption: string | null;
}

// Renderers also run for reply quotes, the composer's reply preview and
// similar compact places; blocks don't belong there.
const COMPACT_CONTAINERS = '[data-testid="reply-tile-body"], .mx_ReplyChain, .mx_ReplyPreview';

function renderBlock(block: Block | FallbackBlock, ctx: Interactions): React.ReactNode {
  switch (block.type) {
    case "fallback":
      return <div className="mxblocks_fallback">{block.text}</div>;
    case "buttons":
      return <ActionRow items={block.buttons} chips={false} scope={block.scope} ctx={ctx} />;
    case "chips":
      return <ActionRow items={block.chips} chips scope={block.scope} ctx={ctx} />;
    case "table":
      return <Table block={block} />;
    case "chart":
      return <Chart block={block} />;
    case "sources":
      return <Sources block={block} />;
    case "card":
      return <CardView card={block} wide scope={block.scope} ctx={ctx} />;
    case "cards":
      return <Cards block={block} ctx={ctx} />;
    case "progress":
      return <Progress block={block} />;
    case "details":
      return <Details block={block} />;
    case "code":
      return <Code block={block} />;
    case "diff":
      return <Diff block={block} />;
    case "countdown":
      return <Countdown block={block} />;
    case "event":
      return <EventCard block={block} eventId={ctx.eventId} />;
    case "place":
      return <Place block={block} />;
    case "ticker":
      return <Ticker block={block} />;
    case "weather":
      return <Weather block={block} />;
    case "math":
      return <MathView block={block} />;
    case "tracker":
      return <Tracker block={block} />;
    case "gallery":
      return <Gallery block={block} />;
    case "form":
      return <Form block={block} ctx={ctx} />;
    case "file":
      return <FileCard block={block} />;
  }
}

function RichExtras({
  roomId,
  eventId,
  sender,
  payload,
  original,
  replaces,
  caption,
}: TileProps): React.JSX.Element | null {
  const ref = React.useRef<HTMLDivElement>(null);
  const [compact, setCompact] = React.useState(false);
  React.useLayoutEffect(() => {
    if (ref.current?.closest(COMPACT_CONTAINERS)) setCompact(true);
  }, []);
  const actions = payload.blocks.flatMap(blockActions);
  const wantSent =
    actions.some((b) => b.action.type === "send") || payload.blocks.some((b) => b.type === "form");
  const { reactions, sent, used } = useEventInteractions(roomId, eventId, sender, wantSent);
  const ctx: Interactions = {
    roomId,
    eventId,
    mine: reactions.mine,
    counts: reactions.counts,
    sent,
    used,
  };

  // Compact places (reply quotes) get Element's own body, never blocks.
  if (compact)
    return (
      <>
        {original}
        <div ref={ref} hidden />
      </>
    );
  return (
    <>
      {replaces === null ? original : null}
      <div ref={ref} className="mxblocks">
        {replaces !== null && caption ? <div className="mxblocks_caption">{caption}</div> : null}
        {payload.blocks.map((block, i) => (
          <Boundary
            key={`${i}-${block.type}`}
            name={block.type}
            fallback={i === replaces ? original : null}
          >
            {renderBlock(block, ctx)}
          </Boundary>
        ))}
      </div>
    </>
  );
}

export function RichTile(props: TileProps): React.JSX.Element {
  return (
    <Boundary name="tile" fallback={props.original}>
      <RichExtras {...props} />
    </Boundary>
  );
}

/**
 * The math block of a math-only message: an m.image (the PNG render) whose
 * payload is exactly one `math` block. The KaTeX rendering replaces Element's
 * image tile; the image comes back when KaTeX can't render the TeX, if
 * anything throws, and in reply quotes / previews (Element's compact image
 * there is fine).
 */
export function mathOnlyBlock(msgtype: unknown, payload: RichPayload): MathBlock | null {
  const [only, ...rest] = payload.blocks;
  return msgtype === "m.image" && only?.type === "math" && !rest.length ? only : null;
}

class ImageFallback extends Boundary {
  declare public props: { name: string; children?: React.ReactNode; original: React.ReactNode };
  public render(): React.ReactNode {
    return this.state.failed ? this.props.original : this.props.children;
  }
}

function MathImage({
  block,
  original,
}: {
  block: MathBlock;
  original: React.ReactNode;
}): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  const [compact, setCompact] = React.useState(false);
  React.useLayoutEffect(() => {
    if (ref.current?.closest(COMPACT_CONTAINERS)) setCompact(true);
  }, []);
  if (compact) return <>{original}</>;
  return (
    <div ref={ref} className="mxblocks mxblocks--mathOnly">
      <MathView block={block} fallback={original} />
    </div>
  );
}

export function MathImageTile({
  block,
  original,
}: {
  block: MathBlock;
  original: React.ReactNode;
}): React.JSX.Element {
  return (
    <ImageFallback name="math" original={original}>
      <MathImage block={block} original={original} />
    </ImageFallback>
  );
}

/**
 * Which block stands in for Element's own body: a gallery on an m.image
 * (an album leader; the gallery shows that image too) or a file card on an
 * m.file. Plain-text messages keep their body.
 */
export function replacedBy(content: Record<string, unknown>, payload: RichPayload): number | null {
  const want =
    content.msgtype === "m.image" ? "gallery" : content.msgtype === "m.file" ? "file" : null;
  if (!want) return null;
  const i = payload.blocks.findIndex((b) => b.type === want);
  return i < 0 ? null : i;
}

/** An MSC2530 caption: a media event's body when it isn't just the file name. */
export function mediaCaption(content: Record<string, unknown>): string | null {
  const { body, filename } = content;
  return typeof body === "string" &&
    typeof filename === "string" &&
    body.trim() &&
    body !== filename
    ? body
    : null;
}
