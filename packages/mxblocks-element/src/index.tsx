// Element Web runtime module rendering mxblocks rich blocks (buttons, chips,
// tables, charts, sources, cards, progress, ...) under messages from
// allow-listed bot senders. Spec: docs/spec.md.
//
// Load it from Element's config.json:
//   "modules": ["/modules/mxblocks-rich.js"],
//   "com.talaagent.mxblocks": { "senders": ["@bot:example.org", ...] }
// (`com.ianm.mtrix` is read too when the new key is absent).

import type { Api, Module, ModuleFactory } from "./module-api";

import { RICH_CONFIG_KEY, readSenders, readContentKeys } from "./config.ts";
import { setContentKeys } from "./matrix.ts";
import { React } from "./react";
import { hasAlbumKey, hasRichKey, parseAlbum, parseRich } from "./schema/index.ts";
import { injectStyles } from "./styles.ts";
import { AlbumMember } from "./ui/media";
import { MathImageTile, RichTile, mathOnlyBlock, mediaCaption, replacedBy } from "./ui/tile";

class MxblocksModule implements Module {
  // Engine 2.2.0 ships with nixpkgs' element-web 1.12.30. The engine checks
  // semver.satisfies(engine, this), so a major bump in Element breaks loading
  // until this is bumped.
  public static readonly moduleApiVersion = "^2.2.0";

  private readonly api: Api;

  public constructor(api: Api) {
    this.api = api;
  }

  public async load(): Promise<void> {
    const senders = readSenders(this.api.config.get());
    if (!senders.size) {
      console.warn(`[${RICH_CONFIG_KEY}] no senders in config.json; rich messages disabled`);
      return;
    }
    const keys = readContentKeys(this.api.config.get());
    setContentKeys(keys);
    injectStyles();
    // registerMessageRenderer is wired for every tile in element-web 1.12.30
    // (EventTileFactory renderTile/renderReplyTile → customComponents.
    // renderMessage); the first matching renderer wins, so no other module
    // may register one for the same events. The filter runs for every event,
    // so it only checks sender and key; parsing (and the fallback to the
    // untouched tile) is below. getContent() is the edited content, so
    // m.replace edits are followed (Element only applies an edit from the
    // original sender, so nobody can add blocks to a bot's message).
    // Album images (the m.image events after a gallery's leader) match too,
    // so they can fold into the leader's gallery.
    this.api.customComponents.registerMessageRenderer(
      (ev) =>
        ev.type === "m.room.message" &&
        senders.has(ev.sender) &&
        (hasRichKey(ev.content, keys.richKeys) || hasAlbumKey(ev.content, keys.richKeys)),
      (props, originalComponent) => {
        const ev = props.mxEvent;
        const original = originalComponent?.() ?? null;
        const payload = parseRich(ev.content, keys.richKeys);
        if (!payload) {
          const album = ev.content.msgtype === "m.image" ? parseAlbum(ev.content, keys.richKeys) : null;
          if (!album) return <>{original}</>;
          return (
            <AlbumMember
              roomId={ev.roomId}
              sender={ev.sender}
              content={ev.content}
              album={album}
              readKeys={keys.richKeys}
              original={original}
            />
          );
        }
        // A math-only message is an m.image of the PNG render: KaTeX replaces
        // the image (which comes back if KaTeX fails).
        const math = mathOnlyBlock(ev.content.msgtype, payload);
        if (math) return <MathImageTile block={math} original={original} />;
        const replaces = replacedBy(ev.content, payload);
        return (
          <RichTile
            roomId={ev.roomId}
            eventId={ev.eventId}
            sender={ev.sender}
            payload={payload}
            original={original}
            replaces={replaces}
            caption={replaces === null ? null : mediaCaption(ev.content)}
          />
        );
      },
    );
  }
}

export default MxblocksModule satisfies ModuleFactory;
