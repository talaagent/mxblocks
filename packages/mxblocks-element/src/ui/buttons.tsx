// `buttons` and `chips`: clicks send the user's own reaction or reply.

import { React } from "../react";
import type { Button } from "../schema/index.ts";
import { myUserId, sendReaction, sendReply } from "../matrix";
import { cx } from "./util";

export interface Interactions {
  roomId: string;
  eventId: string;
  mine: Set<string>;
  counts: Map<string, number>;
  sent: Set<string>;
  /** the user's replies naming a prompt id (forms): `used.values` or null */
  used: Map<string, Record<string, unknown> | null>;
}

export function ActionRow({
  items,
  chips,
  scope,
  ctx,
}: {
  items: Button[];
  chips: boolean;
  /** MSC4139 scope: only these users may click; null = anyone */
  scope: string[] | null;
  ctx: Interactions;
}): React.JSX.Element {
  const [pending, setPending] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const me = myUserId();
  const allowed = scope === null || (me !== null && scope.includes(me));
  const scopeNote = allowed ? null : `Only ${scope?.join(", ")} can answer`;

  const isDone = (b: Button): boolean =>
    b.action.type === "react" ? ctx.mine.has(b.action.key) : ctx.sent.has(b.action.body);

  const onClick = async (b: Button, i: number): Promise<void> => {
    // Already chosen: a no-op, not a toggle. Undoing an approval by redacting
    // the reaction would look like it worked but the bot may have acted
    // already; the reaction pill below still allows removing it explicitly.
    if (!allowed || pending !== null || isDone(b)) return;
    setPending(i);
    setError(null);
    try {
      if (b.action.type === "react") await sendReaction(ctx.roomId, ctx.eventId, b.action.key);
      else await sendReply(ctx.roomId, ctx.eventId, b.action.body, b.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className={chips ? "mxblocks_chips" : "mxblocks_buttons"} role="group">
      {items.map((b, i) => {
        const done = isDone(b);
        const count = b.action.type === "react" ? (ctx.counts.get(b.action.key) ?? 0) : 0;
        const title =
          b.action.type === "react"
            ? `${done ? "You reacted" : "React"} ${b.action.key}`
            : `${done ? "Sent" : "Send"}: ${b.action.body}`;
        return (
          <button
            key={i}
            type="button"
            className={cx(
              "mxblocks_btn",
              chips && "mxblocks_btn--chip",
              !chips && b.style !== "default" && `mxblocks_btn--${b.style}`,
              done && "mxblocks_btn--done",
            )}
            aria-pressed={done}
            disabled={!allowed || (pending !== null && pending !== i)}
            title={scopeNote ?? title}
            onClick={() => void onClick(b, i)}
          >
            {done ? "✓ " : ""}
            {b.label}
            {pending === i ? "…" : ""}
            {count > 0 && (!done || count > 1) ? (
              <span className="mxblocks_count">{count}</span>
            ) : null}
          </button>
        );
      })}
      {error ? <span className="mxblocks_error">{error}</span> : null}
    </div>
  );
}
