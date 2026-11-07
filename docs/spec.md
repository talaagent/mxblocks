# mxblocks: rich messages for Matrix

This is the normative spec for mxblocks v1: interactive and structured bot
messages (buttons, chips, tables, charts, cards, forms, math, live
progress, ...) carried as one extra content key on an ordinary Matrix
`m.room.message`. An Element Web module renders them. Every other client
(mobile Element, Element X, bridges) shows the plain-text/HTML fallback.

- **Renderer:** the Element module (`mxblocks-element`, `element/` in this
  repo), an Element Web runtime module built as `nix build .#element-module`
  (output file `mxblocks-rich.js`). See
  [Deploying the renderer](#deploying-the-renderer).
- **Reference crate:** the Rust crate in this repo (`src/lib.rs`): payload
  types, the content keys, and the validation a sender runs before sending
  ([Sending](#sending)).
- **Senders:** any bot or client that writes the payload. A validating
  sender (such as the reference crate) refuses payloads that break the
  rules below.

Keywords: **must**, **should** and **may** are used in the RFC 2119 sense.

## Options considered

| Option | Web | Mobile/other clients | Verdict |
|---|---|---|---|
| **Extra content key on a normal `m.room.message`** (`com.ianm.mtrix`) | module renders the original tile plus blocks | normal text/HTML message. The bot pre-seeds ✅/❌ reactions for one-tap. | **Chosen.** Degrades cleanly. Edits, replies and push notifications work as for any message. |
| Custom event type (e.g. `com.ianm.mtrix.card`) | module could render it | **invisible** in other clients, no push notification | Rejected. The fallback is the whole point. |
| MSC3381 polls (`m.poll.start`) | native UI | Element X/Android/iOS show polls natively | Rejected for approvals. Answers are `m.poll.response` (a new trust channel for the bot), single-shot per poll, poll styling is wrong for "Send/Drop", and polls can't carry charts or tables. Still fine for real multi-choice questions. |
| Widgets (room or per-message iframes) | full HTML | room-level only, poor mobile support | Rejected. Not per-message, heavy, needs a widget host and auth. |
| MSC1767 extensible events (`m.message` with mixins) | not rendered as such by Element 1.12 | not supported | Rejected for now. A key on `m.room.message` is close to the extensible-events "mixin" idea, so migrating later is straightforward. |
| HTML only (`formatted_body` with `<button>` / `data-*`) | Element's sanitizer strips `<button>`, forms, scripts and every `data-*` except its own `data-mx-*` | same | Impossible, and unsafe by design. |
| Element's own "interactive message" proposals | no shipped spec or Element feature for per-message buttons (as of 2026-10) | — | Nothing to adopt. Revisit if an MSC lands and map `buttons` onto it. |

## Prior art and what we borrow

ChatGPT's UI rules win when sources disagree.

| Source | What we take |
|---|---|
| [MSC4139](https://github.com/matrix-org/matrix-spec-proposals/pull/4139) bot buttons (`m.prompts`) | Buttons and chips are **preset prompts**: a stable `id` per button, an optional `scope` (who may answer), and the answer stays a visible reply that names the prompt (`com.ianm.mtrix.used`, mirroring `m.used_prompt`). The `form` block covers **input prompts**. If MSC4139 lands, we can map each field across one-to-one ([below](#prompts-and-responses-msc4139)). |
| Google [A2UI](https://github.com/google/A2UI) | A **fixed catalogue** of trusted components, data only, never HTML or iframes ([catalogue](#block-catalogue)). We keep a flat list of blocks instead of A2UI's component tree. |
| [Adaptive Cards](https://adaptivecards.io/explorer) | **Per-block `v` and `fallback`** next to the message-level fallback (`body`, like AC `fallbackText`). Like `Action.Execute`, the bot answers a click by refreshing the card, i.e. editing the message ([outcome edits](#outcome-edits)). |
| ChatGPT Apps SDK UI guidelines | UX limits: an inline card has **at most 2 actions**; a carousel has **3–8 items, each with an image and at most 1 action**. Metadata stays short and system colours are used. |
| ChatGPT search answers | The look of `sources` (citation pills), `weather`, `ticker`, product `card`s and `chips`. OpenAI publishes no schema for these; our field lists are our own. |
| Beeper [ai-bridge](https://github.com/beeper/ai-bridge) `com.beeper.ai.approval.v1` | The approval choices approve / always_approve / deny ([approvals](#approvals)). Streaming over to-device messages, which became MSC4471 ([streaming](#streaming)). |
| Telegram inline keyboards | Edit-in-place after a click ([outcome edits](#outcome-edits)). |

We don't copy the HTML-widget/iframe model (Apps SDK, MSC2192/MSC4214). It
needs CSP and sandboxing, and per-message widget proposals stalled on
exactly that.

## What Element's module API allows

Element Web 1.12.30, module API 2.2.0:
`api.customComponents.registerMessageRenderer(filter, renderer)` (marked
@alpha).

- It is called for every tile with a factory, `m.room.message` included. The
  **first matching renderer wins**, so only one module may register a
  renderer for these events. If the renderer throws synchronously, Element
  falls back to the original tile.
- `props.mxEvent` is a plain snapshot (`eventId, roomId, sender, type,
  content, ...`) with no relations. `content` comes from `getContent()`, so
  for an edited event it is already the `m.new_content`.
- `originalComponent()` renders Element's own body. The module draws the
  original tile first and its blocks below it, above Element's reactions
  row. The exceptions are a gallery album's leader (`m.image`) and a file
  card (`m.file`), where the block replaces Element's media tile.
- The same renderer runs in reply quotes, the thread panel, notifications,
  pinned messages and exports. The module hides itself inside reply
  containers (a DOM `closest()` check).
- The API can't read relations or send events. The module uses the
  js-sdk client that Element exposes as `window.mxMatrixClientPeg` for
  reactions, replies, mxc media URLs and the access token for fetching
  them.

## Wire format

A normal `m.room.message` with msgtype `m.text` or `m.notice` (or
`m.image` for a [math-only message](#math) or a [gallery](#gallery) album's
leader, `m.file` for a [file](#file) card), plus one extra key:

```json
{
  "msgtype": "m.notice",
  "body": "Draft to Bob: \"See you at 7\"\nReact ✅ to send or ❌ to drop.",
  "format": "org.matrix.custom.html",
  "formatted_body": "<p>Draft to Bob: <q>See you at 7</q></p><p>React ✅ to send or ❌ to drop.</p>",
  "com.ianm.mtrix": {
    "v": 1,
    "blocks": [
      { "type": "buttons", "buttons": [
        { "label": "Send", "style": "primary", "action": { "type": "react", "key": "✅" } },
        { "label": "Drop", "style": "danger",  "action": { "type": "react", "key": "❌" } }
      ] }
    ]
  }
}
```

- `body` (and, when present, `formatted_body`) **must** be the complete
  fallback: a reader who never sees the blocks must still get the message.
  Each block below lists the fallback it needs.
- `v` is `1`. A renderer **must** ignore the whole key when `v` is missing,
  not an integer, or greater than the version it knows.
- `blocks` is an ordered list of objects tagged by `type`. Every rich type
  lives in this one list under this one key. There are no per-type content
  keys.
- **Evolution:** new block types and new optional fields are additive and
  don't bump `v`. A renderer **must** skip block types it doesn't know and
  ignore fields it doesn't know. The message-level `v` only changes for an
  incompatible change to the envelope. An incompatible change to one block
  type bumps that block's own `v` instead (below).
- A renderer **must** drop malformed items (a button without a label, a
  source with a non-https URL) and blocks with nothing valid left. If no
  block is left, it renders the tile exactly as Element would.
- **Numbers.** Event content is canonical JSON (room versions 6 and up),
  which has **no floats**: Synapse refuses an event containing one with
  `400 M_BAD_JSON "Bad JSON value: float"`. So every numeric field (chart
  values, ticker prices, temperatures, coordinates, ratings, amounts,
  timestamps, ...) is either a **JSON integer** within ±(2^53 − 1) or a
  **decimal string** matching `^-?\d+(\.\d+)?([eE][-+]?\d+)?$`, e.g.
  `"62.99"`. "A number" below means exactly this.
  - Senders (edits included) **must** rewrite any float in the payload
    before validating: a float without a fraction becomes an integer
    (`33.0` → `33`), any other float its shortest decimal string
    (`62.99` → `"62.99"`). NaN, infinities and integers outside the range
    are refused. The reference crate does this (`canonicalize_value`).
  - Renderers read a number from an integer, a decimal string, or a raw
    JSON number (older events, other homeservers); any other string is not
    a number.
- Unless stated otherwise, timestamps are **ms since the Unix epoch**
  (integers). Timestamp fields also accept an ISO 8601 string with a date
  (`"2026-10-15T18:00:00+02:00"`). Values outside the years 2000 to 2200 are
  rejected, which catches seconds passed instead of ms.
- Text fields are plain text. Markdown and HTML are shown literally.
  One-line fields have whitespace and control characters collapsed.

### Fields every block may carry

| Field | Meaning |
|---|---|
| `type` | required: the block type ([catalogue](#block-catalogue)) |
| `v` | optional block version, default 1. Every block type is at 1 today. A renderer **must** treat a block whose `v` is higher than it knows (or not a positive integer) as an unknown type. |
| `fallback` | optional plain text (up to 500 characters) for renderers that can't draw this block |
| `scope` | on blocks with actions (`buttons`, `chips`, `card`, `cards`, `form`): the MXIDs who may click ([prompts](#prompts-and-responses-msc4139)) |

A renderer that can't draw a block (unknown type, higher `v`, or
malformed) shows its `fallback` as muted plain text in place of the block,
or nothing if there is none. A validating sender refuses unknown types and
higher versions unless the block has a `fallback`, so a newer renderer can
get a block that the sender's library doesn't know yet, and older renderers
still show the fallback.

### Message fallback vs block fallbacks

There are two fallback levels, as in Adaptive Cards (`fallbackText` for the
whole card, `fallback` per element):

- **`body` / `formatted_body`** is for clients **without the module**
  (mobile Element, Element X, bridges, notifications). It **must** carry the
  whole message, including what every block says. The renderer always draws
  it above the blocks, so it doubles as the lead text. Keep it short when
  the blocks repeat it (say "3 keyboards under €60:" and list them,
  rather than duplicating a 50-row table).
- **A block's `fallback`** is for a client **with the module that can't
  draw that block** (an older renderer, or a newer block version). It
  replaces only that block, and only in that client. It never replaces
  `body`. Clients without the module never see it.

So a sender writes `body` for everyone, and adds a `fallback` to blocks
that are new or that matter (a summary of a new chart type, "Reply 👍 to
confirm" on a new kind of prompt).

### Edits (`m.replace`)

Put the full rich key inside `m.new_content`. The renderer uses the latest
content, so an edit replaces the whole payload, and an edit without the key
removes the blocks. Element only applies an edit from the original sender,
so nobody else can add blocks to a bot's message.

- Outcome edits and live blocks use this (next two sections).

### Outcome edits

**General rule: once a bot has acted on a click, it edits the original
message to show the outcome and drop the actions that no longer apply.**
This is Telegram's edit-in-place and Adaptive Cards' `Action.Execute`
refresh, as in the [approval](#approvals) pattern ("Sent ✅", buttons
gone). It keeps a stale prompt from being answered twice, and every
client (with or without the module) sees the result in place. The edit
replaces `body` too, so write the outcome there as well. A bot **should**
also redact the reactions it pre-seeded once they are no longer useful.

### Streaming

Live blocks (`progress`, `tracker`, and `table`/`chart` that grow) update by
**throttled `m.replace` edits** of the same event today:

- Each edit carries the **complete** current payload (and current `body`) in
  `m.new_content`; there are no partial patches. The renderer always draws
  the latest content.
- Senders **should** send at most one edit every 2 seconds per message, and
  **must** always send the final state as the last edit. Each edit is a new
  event that every client stores. Push rules usually don't notify for edits.
- Blocks keep stable keys across edits (`progress.steps[].id`), so a
  renderer can keep its own UI state (scroll, expanded rows).
- Clients without the module see the latest `body`, so keep the text
  checklist in it current.

This is designed to move to
[MSC4471](https://github.com/matrix-org/matrix-spec-proposals/pull/4471)
event streams (Beeper's to-device "beeperstream", in mautrix-go) later:

- The event would carry `m.stream`.
- Viewers would subscribe by to-device message and receive replace updates
  holding the same full payload.
- A final `m.replace` edit would still commit the end state, so clients that
  never streamed converge on it.

The payload shape doesn't change, only the transport. This spec only fixes
the contract: full payload per update, stable ids, and a final edit. For a
reply whose *text* is still being written, see the [`stream`](#stream)
block.

### Global limits

| Limit | Value |
|---|---|
| Blocks per message | 8 (extra blocks dropped) |
| Payload JSON (sender check) | 40,000 bytes; one display block at most 24,000 bytes |
| One-line label | 64 characters (renderer) |
| Button, chip and form label | 120 characters, wrapped |
| Longer one-line text | 200 characters |
| Multi-line plain text | 4,000 characters |
| URL | 2,048 characters, `https:` only, no userinfo |
| Image | `mxc://server/mediaId` only |
| Block `fallback` | 500 characters |
| `math` blocks | 1 per message (sender check) |
| `math.tex` | 4,000 characters (longer: block dropped, not cut) |
| `stream.id` | 1 to 64 of `A-Z a-z 0-9 _ -` |
| Button `id` | 1 to 64 of `A-Z a-z 0-9 _ . : -`, unique per message (sender check) |
| `scope` | 50 MXIDs |
| Card actions | 2 per `card`, 1 per `cards` item |
| Carousel (`cards`) | 3 to 8 items with images; fewer, or any without an image, render as single cards; more than 8 are dropped (a validating sender refuses them) |
| Gallery | 2 to 20 images (renderer: 1 to 20); captions and alt 200 characters |
| Form | 8 fields, 10 options per field, text inputs 200 characters, labels 120 |
| File preview | 40 lines and 4,096 bytes |

The renderer truncates or drops past every limit; it never renders an
oversized value as-is. A validating sender refuses to send a payload over
its limits.
The whole event must still fit Matrix's 65,536-byte cap together with
`body` and `formatted_body`.

## Namespace and compatibility

Applications choose a payload key and derive `<key>.used` for click echoes and
`<key>.album` for gallery markers. Use a namespace controlled by the application.

The reference implementations retain two public compatibility defaults:

| Payload key | `.used` key | `.album` key |
|---|---|---|
| `com.talaagent.mxblocks` | `com.talaagent.mxblocks.used` | `com.talaagent.mxblocks.album` |
| `com.ianm.mtrix` | `com.ianm.mtrix.used` | `com.ianm.mtrix.album` |

- Default readers try those keys in that order. Rust `read_rich` tries the first
  deserializable payload; the Element parser takes the first object and validates
  it. Both behavior contracts remain explicit in their API documentation.
- Rust callers use `ContentKeys::new("org.example.blocks")` and add read aliases
  explicitly with `with_read_aliases`. Writers remove stale configured aliases
  on edit, including `.used` and `.album` aliases. `WriteKey::Custom` selects a
  writer key alone; the `Legacy` and `New` selectors retain the public defaults.
- The Element module reads settings under `com.talaagent.mxblocks`, then
  `com.ianm.mtrix`. `senders` is required; `write_key` accepts a custom namespace,
  while `read_keys` adds explicit compatibility aliases. The writer key is read
  first. A custom namespace has no implicit aliases.

```json
{
  "com.talaagent.mxblocks": {
    "senders": ["@bot:example.org"],
    "write_key": "org.example.blocks",
    "read_keys": ["org.example.previous"]
  }
}
```

Examples elsewhere in this spec use `com.ianm.mtrix`; the same payload shapes
apply unchanged under an application-selected key. Key selection never bypasses
the sender allow-list or payload validation.

## Safety rules

These are normative for the renderer.

1. **Allow-listed senders only.** Blocks render only under messages whose
   sender is listed in Element's config.json under
   `"com.talaagent.mxblocks": {"senders": [...]}` (full MXIDs; read first)
   or `"com.ianm.mtrix": {"senders": [...]}`. If neither key is present and
   well-formed, nothing renders anywhere (fail closed). A rich key from
   anyone else, the user included, is ignored, and the message renders
   normally.
2. **Never render payload HTML.** All payload text goes into React text
   nodes. Charts are SVG built by the module from numbers. The HTML fallback
   is sanitized by Element as usual. The one innerHTML is KaTeX's own output
   for a `math` block's TeX, with `trust: false` (no `\href`, `\url`,
   `\includegraphics`, `\htmlClass`/`\htmlData`/...), so no payload link,
   URL, class or attribute reaches the DOM.
3. **No network requests**, except mxc media on the user's own homeserver, at
   URLs built by Element's client (authenticated media, fetched with the
   access token as a Bearer header into Blob URLs, since `<img>` can't send
   it and Element's service worker can't be relied on): scale thumbnails,
   and for `gallery`/`file` the full file (encrypted attachments are
   decrypted in the browser after their SHA-256 is checked); and KaTeX's
   fonts from the module's own `fonts/` directory (same origin); and, in a
   renderer that implements it, a live [`stream`](#stream) block's https
   `url` from an allow-listed sender. There are
   no favicons, no external images and no map tiles. Blob URLs made from
   media keep
   their type only for PNG/JPEG/GIF/WebP; anything else (SVG, HTML, ...)
   becomes `application/octet-stream`, so it never runs on Element's origin.
4. **Links are https only**, validated by the URL parser. They open in a
   new tab with `rel="noopener noreferrer nofollow"`.
5. **Clicks only send the user's own reaction or message** (respecting `scope`; a
   form's submit is one such message), in the same room and
   related to the same event, or do something local (download a generated
   file, copy to the clipboard, sort, expand). A bot gains no capability it
   didn't already have through reactions or commands. Every click is visible
   in the timeline.
6. **No auto-actions.** Nothing is sent without a click: no timers that
   send, no sending on render, no state events, no redactions. Clocks
   (`countdown`, running steps) only update the display.
7. **Caps on everything** (above and per block).
8. **Isolation.** Each block has its own error boundary, and the original
   tile always renders. A failing block disappears without affecting the
   others.
9. **Compact contexts.** Blocks are hidden in reply quotes and the composer's
   reply preview.

## Block catalogue

As in A2UI, the renderer has a **fixed catalogue** of block types it trusts.
A message only supplies data: no HTML, no scripts, no iframes, no styles,
no URLs to load. Anything outside the catalogue is skipped (or shown as its
`fallback`). New types are added by changing the renderer and this spec, not
by senders.

| mxblocks | A2UI (basic catalogue) | ChatGPT surface |
|---|---|---|
| `card` | Card (+ Text, Image, Button) | inline card |
| `cards` | List/Row of Cards ("carousel") | inline carousel |
| `table` | none (List of Rows) | data table |
| `chart` | none | stock and finance charts |
| `progress` | List of CheckBox ("checklist") | task/progress list |
| `form` | TextField, ChoicePicker, CheckBox, DateTimeInput + Button | Apps SDK inputs |
| `sources` | none (List of Text links) | citation pills / Sources panel |
| `place` | none ("map" component) | maps answer, as a link out |
| `buttons` | Button (`action.event`) | card actions |
| `chips` | Button | follow-up suggestions |
| `gallery` | List of Image | image carousel |
| `file` | none | file artifact / download card |
| `details` | Modal/Tabs-like disclosure | collapsible |
| `code`, `diff` | Text | code blocks |
| `countdown`, `event`, `ticker`, `weather` | none | ChatGPT search answers (weather, stocks) |
| `math` | none | LaTeX in answers |
| `tracker` | none | delivery and ride apps' live order cards |
| `stream` | none | a reply being typed out |

## Blocks

| Type | Status | Purpose |
|---|---|---|
| [`buttons`](#buttons) | implemented | inline action buttons (approve/reject) |
| [`chips`](#chips) | implemented | quick-reply suggestion chips |
| [`table`](#table) | implemented | sortable table with CSV download |
| [`chart`](#chart) | implemented | line/bar/area/sparkline charts |
| [`sources`](#sources) | implemented | citation chips |
| [`card`](#card) / [`cards`](#cards) | implemented | link/product card, carousel |
| [`progress`](#progress) | implemented | checklist and live progress |
| [`details`](#details) | implemented | collapsible plain text |
| [`code`](#code) / [`diff`](#diff) | implemented | code with Copy, unified diff |
| [`countdown`](#countdown) | implemented | ticking countdown |
| [`event`](#event) | implemented | calendar event with .ics download |
| [`place`](#place) | implemented | place card with a Google Maps link |
| [`ticker`](#ticker) | implemented | price ticker with sparkline |
| [`weather`](#weather) | implemented | current weather and forecast |
| [`tracker`](#tracker) | implemented | live order, delivery, ride or parcel status |
| [`gallery`](#gallery) | implemented | image carousel, sent as an album |
| [`form`](#form) | implemented | inputs that send one reply (MSC4139 input prompts) |
| [`file`](#file) | implemented | file artifact card with preview and download |
| [`math`](#math) | implemented | LaTeX formula (KaTeX; PNG fallback) |
| [`stream`](#stream) | specified (sender side) | marks a reply still being written; live text by URL |

### Prompts and responses (MSC4139)

Buttons, chips and card actions are shaped after MSC4139's `m.prompts`, so
we can switch if it lands:

| MSC4139 | mxblocks |
|---|---|
| `m.prompts.prompts[]` of type `preset` | items of `buttons` / `chips` / `card.actions` |
| prompt `id` | button `id` (optional but recommended; stable per message, unique across the message's blocks) |
| prompt `label` | button `label` |
| prompts of type `input` (+ `validator`) | the [`form`](#form) block's fields (no `validator`) |
| `scope` (user ids allowed to answer) | block-level `scope` |
| reply in a thread/visible reply with `m.used_prompt: {id}` | a `send` click: a visible reply with `com.ianm.mtrix.used: {event_id, id}` |
| `m.conversation.reply` text fallback | the unchanged `body` |
| answering input prompts | a form submit: a visible reply with `com.ianm.mtrix.used: {event_id, id, values}` ([form](#form)) |

**Scope.** `scope` lists the MXIDs who may answer. If it is absent or
empty, anyone who can see the message may click. For anyone else the
renderer shows the actions **disabled**, with "Only … can answer" as the
tooltip. This is a UI hint, not access control: bots **must** still check
who reacted or replied (e.g. accept only the owner).

**What a click sends.** It is exactly what bots already understand, never a
new event type:

- `{"type": "react", "key": "✅"}`: an `m.reaction` (`m.annotation` on this
  event) with `key`. This is what tapping the reaction pill does. `key` is
  an exact string (not normalised): 1 to 64 characters in the renderer, 1
  to 32 without whitespace in a validating sender. Bots read approvals
  from these reactions.
- `{"type": "send", "body": "!approve abc"}`: an `m.text` from the user
  whose `body` is exactly `body` (bots may match it exactly; nothing is
  prefixed or quoted), up to 1,000 UTF-16 code units. It is sent as a
  **visible reply** to this event (`m.relates_to.m.in_reply_to`, with no
  reply fallback in `body`, per Matrix 1.13), and carries metadata naming
  the prompt:

  ```json
  { "msgtype": "m.text", "body": "show me cheaper options",
    "m.relates_to": { "m.in_reply_to": { "event_id": "$bot_message" } },
    "com.ianm.mtrix.used": { "event_id": "$bot_message", "id": "cheaper" } }
  ```

  `id` is omitted when the button has none. The `.used` key is written
  under one of the [namespace](#namespace-and-compatibility) keys and read
  under any of them. Bots may use `used` to disambiguate but **must not
  require it**: the same text typed by hand (without the key) must still
  work.

The reply relation is safe for command-reading bots: they read the
command from `body` (stripping any legacy reply fallback), may use
`m.in_reply_to` to find what a bare command refers to, and ignore extra
content keys. So it is always on, not opt-in.

Unknown action types make the item invalid (dropped).

### `buttons`

**Implemented.**

```json
{ "type": "buttons", "scope": ["@alice:example.org"], "buttons": [
  { "id": "approve", "label": "Send", "style": "primary", "action": { "type": "react", "key": "✅" } },
  { "id": "deny", "label": "Drop", "style": "danger", "action": { "type": "react", "key": "❌" } },
  { "id": "cmd", "label": "Approve via cmd", "action": { "type": "send", "body": "!approve abc123" } }
] }
```

- `id`, `scope`: see [prompts](#prompts-and-responses-msc4139).
- `style`: `default` (default), `primary` or `danger`. Unknown styles render
  as `default` (a validating sender refuses them).
- **Limits:** 10 buttons in the renderer (sender check: 8), labels 120
  characters.
- **Render:** a row of pill buttons in Element's style; a long label wraps
  inside its button.
  - A react button is selected (✓, `aria-pressed`) when the user has a
    non-redacted reaction with that key. Local echoes count.
  - A count badge shows how many users *other than the event's sender*
    reacted with the key. The bot's own pre-seeded reactions are ignored.
  - A send button is selected when the user's live timeline (plus pending
    events) has an `m.text` reply to this event with exactly that body.
  - State updates on `Room.timeline`, `Room.redaction` and
    `Room.localEchoUpdated`.
  - **Clicking a selected button is a no-op, not a toggle.** Redacting an
    approval reaction would look like it undid something the bot may already
    have acted on. Element's reaction pill below still allows an explicit
    removal. Other buttons stay clickable, so clicking ❌ after ✅ sends both.
    The bot decides (typically first wins) and edits the message to remove
    the buttons once it has acted.
  - The tooltip shows the exact reaction key or message body.
- **Fallback:** the text must say how to answer without buttons, and the
  sender **should** pre-seed the reactions (react to its own message) so
  mobile users can one-tap: "React ✅ to send it or ❌ to drop it (or reply
  `!approve <id>`)".

### `chips`

**Implemented.** Quick-reply suggestions, like the follow-up chips under a
ChatGPT answer.

```json
{ "type": "chips", "chips": [
  { "label": "Cheaper options", "action": { "type": "send", "body": "show me cheaper options" } },
  { "label": "Compare top 3", "action": { "type": "send", "body": "compare the top 3" } },
  { "label": "👍", "action": { "type": "react", "key": "👍" } }
] }
```

- Items have the same shape as buttons. `style` is ignored.
- **Limits:** 12 chips, labels 120 characters.
- **Render:** compact, borderless pills on a subtle background. State,
  no-op-when-selected and tooltips are the same as for `buttons`.
- **Fallback:** list the suggestions in the text ("Reply with: cheaper
  options · compare the top 3") or leave them out. Chips are a convenience
  and the conversation must work without them.

### `table`

**Implemented.**

```json
{ "type": "table", "caption": "Keyboards under €60",
  "columns": [
    { "key": "name", "label": "Name" },
    { "key": "price", "label": "Price", "align": "right" },
    "store"
  ],
  "rows": [
    { "name": "Royal Kludge RK84", "price": "€49", "store": "Shop A" },
    ["Aula F75", 56, "Shop B"]
  ] }
```

- `columns`: `{key, label?, align?: "left"|"right"|"center"}` or a plain
  string (key and label). Duplicate keys are dropped. `label` defaults to
  `key`.
- `rows`: objects keyed by column key, or arrays in column order. Cells are
  strings, integers, booleans (shown as text) or null/missing (empty). A
  decimal goes in as a string (`"12.5"`); numeric strings still sort and
  align as numbers.
- `caption`: optional, one line.
- **Limits:** 12 columns, 200 rows (the rest dropped and "(truncated)"
  shown), 200 characters per cell.
- **Render:** a compact table in a horizontally and vertically scrolling box
  (max 360px tall, sticky header). Columns that are mostly numeric are
  right-aligned unless `align` says otherwise. Numbers are shown with
  locale grouping.
  - Clicking a header sorts by that column: ascending, then descending,
    then the original order. Sorting is numeric when both cells read as
    numbers (`1,234`, `€1,200`, `12.5%`, `EUR 99`), otherwise natural
    string order (`item 9` before `item 10`). Empty cells always sort last.
  - **Download CSV** builds an RFC 4180 CSV of the current order
    client-side (a Blob, no network) named after the caption. Text cells
    starting with `=`, `+`, `-` or `@` get a leading `'` so spreadsheets
    don't evaluate them as formulas.
- **Fallback:** the same table as an HTML `<table>` in `formatted_body`,
  and as aligned text or a list in `body`.

### `chart`

**Implemented.**

```json
{ "type": "chart", "kind": "line", "title": "Spend by week", "unit": "€",
  "labels": ["W1", "W2", "W3", "W4"],
  "series": [
    { "name": "Food", "values": [1200, 900, "1500.50", null] },
    { "name": "Transport", "values": [400, "452.75", 380, 500] }
  ] }
```

- `kind`: `line`, `bar`, `area` or `sparkline`. Other kinds drop the block
  (a validating sender refuses them).
- `series`: `[{name?, values}]`. `values` are numbers (integers or
  decimal strings, see [Numbers](#wire-format)) or `null` (a gap). A bare
  number array is one unnamed series. A series with no numbers
  is dropped.
- `labels`: x labels (strings or integers), padded or trimmed to the longest
  series.
- `title` and `unit` (up to 12 characters) are optional. `unit` is appended
  to values in the readout.
- **Limits:** 6 series (`sparkline`: 1), 200 points per series, labels 24
  characters.
- **Render:** inline SVG built by the module, with no chart library.
  - `line`: 2px lines; gaps break the line. `area`: the same with a light
    fill down to 0. `bar`: grouped bars, always including 0. The y axis gets
    "nice" ticks with compact labels (1.2k) and recessive gridlines. At most
    about 8 x labels are shown.
  - Hovering shows a crosshair (line/area) or highlights the bar group, and
    a readout above the plot with the label and each series' value.
  - Two or more series get a legend (identity is never colour alone).
  - Colours are a fixed categorical order (slots 1 to 6 of the dataviz
    reference palette), with separate light and dark steps chosen by
    Element's `cpd-theme-*` class. Text, grid and axes use Compound tokens.
  - `sparkline`: a small inline line with the title and the last value.
  - The SVG has `role="img"`, an `aria-label` and a `<title>` from `title`.
- **Fallback:** the data as an HTML `<table>` in `formatted_body` and a
  short text summary in `body` ("Food peaked at €1,500 in W3"). Optionally
  the sender also posts a PNG render as a separate `m.image` for mobile.

### `sources`

**Implemented.** Citation chips.

```json
{ "type": "sources", "sources": [
  { "title": "Element Web module API", "url": "https://github.com/element-hq/element-modules" },
  { "url": "https://spec.matrix.org/v1.13/client-server-api/" }
] }
```

- `url`: `https:` only (others drop the item). `title` defaults to the host
  name.
- **Limits:** 12 sources, titles 200 characters.
- **Render:** pills with a letter badge (the first letter of the domain),
  the title (ellipsized) and the domain without `www.`. The tooltip shows
  the title and full URL. **No favicons are fetched:** a favicon request
  would tell a third party what the user is reading.
- **Fallback:** a numbered list of links in `formatted_body`, URLs in
  `body`.

### `card`

**Implemented.** A link or product card.

```json
{ "type": "card", "title": "Royal Kludge RK84", "subtitle": "75% hot-swap, tri-mode",
  "url": "https://shop.example.org/product/123", "image": "mxc://example.org/AbCdEf",
  "price": "€49", "store": "Shop A",
  "fields": [ { "label": "Switches", "value": "RK Red" }, { "label": "Battery", "value": "3750 mAh" } ],
  "actions": [
    { "id": "track", "label": "Track price", "style": "primary", "action": { "type": "send", "body": "track RK84" } },
    { "id": "more", "label": "Similar", "action": { "type": "send", "body": "show similar to RK84" } } ] }
```

- `actions`: buttons (same shape and click behaviour as
  [`buttons`](#buttons)), **at most 2** (ChatGPT inline card rule: one
  primary, one optional secondary). The renderer drops extras; a
  validating sender refuses them. Optional `scope` on the block.
- `title` is required. `url` is https only (dropped otherwise). `image` is
  `mxc://` only (dropped otherwise): the sender uploads the image to the
  homeserver first. `price` is a string or number. `fields` are
  `[{label, value}]`, up to 8.
- **Render:** a compact horizontal card: a 72px thumbnail, the title (a
  link when `url` is set), the subtitle, the price in bold with the store
  (or the URL's domain), the fields as a two-column list, and the action
  buttons. The image is
  a scale thumbnail of the mxc (authenticated media, fetched with the
  access token), cropped to the box with `object-fit: cover`. It is
  omitted if loading fails.
- **Fallback:** a heading, the fields as a list, and the link in
  `formatted_body`; the same as lines in `body`.

### `cards`

**Implemented.**

```json
{ "type": "cards", "cards": [
  { "title": "RK84", "image": "mxc://example.org/a", "price": "€49",
    "actions": [ { "id": "rk84", "label": "Details", "action": { "type": "send", "body": "details RK84" } } ] },
  { "title": "Aula F75", "image": "mxc://example.org/b", "price": "€56" },
  { "title": "AK820", "image": "mxc://example.org/c", "price": "€38" } ] }
```

- `cards`: a list of `card` objects (without `type`). Optional `scope` on
  the block.
- **ChatGPT inline carousel rules:** 3 to 8 items, **every item with an
  image**, short metadata, and **at most 1 action per item**.
  - With 3 to 8 items that all have images, the renderer draws a carousel.
  - With fewer than 3 items, or if any lacks an image, it draws them as
    single cards, stacked.
  - Items past 8 are dropped (a validating sender refuses more than 8).
  - Item actions past 1 are dropped (a validating sender refuses them).
- **Render:** a horizontal carousel of 200px-wide vertical cards (a 200×120
  image on top), scrolling with scroll-snap.
- **Fallback:** a list of the cards as for `card`.

### `progress`

**Implemented.** A checklist or live progress, e.g. a bot's subtasks.

```json
{ "type": "progress", "title": "Release v0.3",
  "steps": [
    { "id": "lint", "label": "Lint", "status": "done", "started_at": "2026-10-15T10:00:00Z", "ended_at": "2026-10-15T10:00:12Z" },
    { "id": "test", "label": "Tests", "status": "running", "detail": "412/980", "started_at": "2026-10-15T10:00:12Z" },
    { "id": "build", "label": "Build", "status": "pending" },
    { "id": "docs", "label": "Docs", "status": "skipped" }
  ],
  "summary": "Waiting on tests." }
```

- `steps[]`: `{id, label, status, detail?, started_at?, ended_at?}`.
  - `status`: `pending`, `running`, `done`, `failed` or `skipped`. A step
    with another status is dropped.
  - `id` is a stable key across edits (defaults to `label`).
  - `detail`: optional multi-line plain text, up to 1,000 characters.
  - `started_at` / `ended_at`: timestamps (integer ms, or ISO 8601).
  - Extra fields are allowed and ignored. This shape is a contract with
    senders: don't rename or remove fields.
- `title` and `summary` (multi-line, up to 1,000 characters) are optional.
- **Limits:** 50 steps.
- **Render:** a header with the title and "n/m done" (plus ", k failed").
  Each step shows an icon (○ pending, a spinner for running, ✓ done, ✕
  failed, – skipped and struck through), the label, the detail, and the
  elapsed time: `ended_at − started_at` when finished, and a live clock
  (`now − started_at`, ticking each second) while running. The summary is
  shown below.
- **Live:** the sender edits the message (`m.replace`) as steps change,
  throttled (see [Edits](#edits-mreplace)).
- **Fallback:** a checklist in the text, e.g. `✅ Lint (12s)`, `⏳ Tests`,
  `⬜ Build`, kept current in each edit's `m.new_content` body.

### `details`

**Implemented.**

```json
{ "type": "details", "summary": "Build log (42 lines)", "body": "…plain text…", "open": false }
```

- `summary` (one line) and `body` (plain text, newlines kept, up to 4,000
  characters) are required. `open` defaults to false.
- **Render:** a native `<details>`; the body is preformatted and wraps.
- **Fallback:** the summary, and the body (or its start) in a `<pre>` /
  `<details>` in `formatted_body`.

### `code`

**Implemented.**

```json
{ "type": "code", "language": "rust", "filename": "src/main.rs", "code": "fn main() {\n    println!(\"hi\");\n}" }
```

- `code` is required and kept verbatim (CRLF becomes LF and NULs are
  removed). `language` (up to 32 characters) and `filename` are optional
  labels.
- **Limits:** 20,000 characters and 500 lines; past that the code is cut and
  "(truncated)" is shown.
- **Render:** a header with filename · language and a **Copy** button
  (clipboard, local), then a monospace `<pre>` that scrolls (max 360px). No
  syntax highlighting. `language: "diff"` renders as a `diff` block.
- **Fallback:** a `<pre><code class="language-…">` in `formatted_body` and
  a fenced block in `body`.

### `diff`

**Implemented.**

```json
{ "type": "diff", "filename": "src/lib.rs", "diff": "--- a/src/lib.rs\n+++ b/src/lib.rs\n@@ -1,3 +1,3 @@\n-old\n+new\n context" }
```

- `diff`: unified diff text, with the same limits as `code`. `filename` is
  optional.
- **Render:** like `code`, with a header showing `+added −removed` counts,
  and line colouring: `+` lines green, `-` lines red, `@@` hunk headers
  muted, and `---`/`+++` file headers bold. Copy copies the raw diff.
- **Fallback:** as for `code`, with `language-diff`.

### `countdown`

**Implemented.**

```json
{ "type": "countdown", "until": "2026-10-15T18:00:00+02:00", "label": "Flash sale ends" }
```

- `until` (a timestamp) is required; `label` is optional.
- **Render:** a pill showing ⏱, the label, and the time left (`2d 03:04:05`,
  `03:04:05` or `04:05`), ticking each second on the client. After `until`
  it shows "ended". The tooltip shows the absolute time. The clock only
  updates the display and never triggers an action.
- **Fallback:** the absolute time in the text ("ends 18:00 CEST, Oct 15").

### `event`

**Implemented.** A calendar event card.

```json
{ "type": "event", "title": "Dinner with Alice", "start": "2026-10-17T19:00:00+02:00",
  "end": "2026-10-17T21:00:00+02:00", "location": "Noodle Bar, Downtown", "description": "Reservation under Bob" }
```

- `title` and `start` are required. `end` is optional and dropped if before
  `start`. `all_day` (boolean) treats start and end as dates. `location`
  (one line) and `description` (up to 2,000 characters) are optional.
- **Render:** a date tile (month and day), the title, the time range in
  the user's locale and time zone, the location and the description, and an
  **Add to calendar** button. The button downloads a client-generated
  RFC 5545 `.ics` (Blob, no network) with a stable `UID` derived from the
  event ID, so importing it again updates the event instead of duplicating
  it. A missing `end` is one hour after `start`.
- **Fallback:** title, time with zone, and location in the text.

### `place`

**Implemented.**

```json
{ "type": "place", "name": "Example Tower", "address": "1 Main St, Downtown, Example City", "lat": "51.5007", "lng": "-0.1246" }
```

- `name` is required. `lat`/`lng` are numbers, in practice decimal strings
  (`"51.5007"`); they are used only when both are valid (|lat| ≤ 90,
  |lng| ≤ 180).
- **Render:** a 📍 card with the name, address and coordinates, and an
  **Open in Google Maps** link to
  `https://www.google.com/maps/search/?api=1&query=<lat,lng or name, address>`.
  There are no embedded map tiles or static map images (both would be
  third-party requests).
- **Fallback:** the name, the address, and the same maps link in the text.

### `ticker`

**Implemented.**

```json
{ "type": "ticker", "symbol": "BTC", "name": "Bitcoin", "price": "64250.12", "change": "-812.4",
  "change_pct": "-1.25", "currency": "USD", "series": [65100, 64900, "65020.5", 64400, "64250.12"] }
```

- `symbol` (up to 16 characters) and `price` (a number: an integer or a
  decimal string like `"64250.12"`) are required. `change` and
  `change_pct` are numbers too. `currency` is an ISO 4217 code
  when possible (formatted as money); otherwise it is shown after the
  number. `series`: up to 200 numbers (integers or decimal strings).
- **Render:** the symbol and name, the price, and the change as `▲ +1.20
  (+0.5%)` in green or `▼ −812.40 (−1.25%)` in red, with a sparkline of
  `series` in the same tone.
- **Fallback:** `BTC 64,250.12 USD ▼ −1.25%` in the text.

### `weather`

**Implemented.**

```json
{ "type": "weather", "location": "Example City", "temp": "31.4", "unit": "C", "condition": "Thunderstorms",
  "icon": "thunder", "high": 33, "low": "26.5",
  "forecast": [ { "label": "Fri", "high": 32, "low": 26, "icon": "rain" },
                { "label": "Sat", "high": 33, "low": 27, "icon": "partly_cloudy" } ] }
```

- `location` and `temp` (a number: an integer or a decimal string like
  `"31.4"`) are required. `high`/`low` and the forecast's are numbers too. `unit`: `C` (default) or
  `F`. `icon` is an enum mapped to emoji by the renderer (unknown values are
  ignored): `clear` ☀️, `mostly_clear` 🌤️, `partly_cloudy` ⛅, `cloudy` ☁️,
  `fog` 🌫️, `drizzle` 🌦️, `rain` 🌧️, `heavy_rain` 🌧️, `thunder` ⛈️,
  `snow` 🌨️, `sleet` 🌨️, `wind` 💨, `hot` 🔥, `night` 🌙.
- `forecast[]`: `{label, high?, low?, icon?}`, up to 10.
- **Render:** the icon, the temperature, the location, the condition and
  H/L, then a row of forecast tiles.
- **Fallback:** "Example City 31°C, thunderstorms (H 33° L 26°). Fri 32/26 rain,
  Sat …".

### `tracker`

**Implemented.** A live order, delivery, ride or parcel status card
(food delivery, ride hailing, couriers, ...). The bot posts it once and
updates it in place with edits until the order is done.

```json
{ "type": "tracker", "title": "Noodle Bar", "provider": "Example Delivery", "kind": "food",
  "status": "Picking up", "state": "live",
  "stages": [
    { "id": "placed", "label": "Placed", "status": "done", "at": "2026-10-15T21:20:00+02:00" },
    { "id": "confirmed", "label": "Confirmed", "status": "done" },
    { "id": "pickup", "label": "Picking up", "status": "running" },
    { "id": "deliver", "label": "On the way", "status": "pending" },
    { "id": "arrived", "label": "Delivered", "status": "pending" } ],
  "eta": "2026-10-15T21:50:00+02:00",
  "map": { "url": "mxc://example.org/AbCdEf", "w": 600, "h": 400, "alt": "Rider 1.2 km away" },
  "driver": { "name": "Sam", "vehicle": "Scooter", "plate": "ABC 1234", "rating": "4.9" },
  "items": ["2× Tonkotsu ramen", "1× Gyoza"],
  "total": { "amount": 24, "currency": "EUR" },
  "link": "https://delivery.example.org/order/A-123",
  "updated_at": "2026-10-15T21:34:10+02:00" }
```

- Required: `title` (what: the merchant, "Ride to the airport", "Courier
  to Downtown", the parcel), `provider` (free text: "Example Delivery",
  "Example Courier") and `status` (short text: "Picking up", "Driver
  arriving", "In transit").
- `kind`: `food`, `ride`, `delivery` or `parcel`; it only picks the icon
  (🛵 🚗 🚚 📦). Unknown kinds are ignored (a validating sender refuses
  them).
- `state`: `live` (default), `done` or `cancelled`. Unknown states read as
  `live` (a validating sender refuses them).
- `stages[]`: `{id, label, status, at?}`, the same statuses as
  [`progress`](#progress) steps (`pending`, `running`, `done`, `failed`,
  `skipped`); `id` defaults to `label` and stays stable across edits; `at` is
  a timestamp. Up to 12 (extras dropped; a validating sender refuses
  them).
- `eta`, `updated_at`: timestamps (ms or RFC 3339).
- `map`: `{url, w?, h?, alt?}`. A **static map image the sender rendered**,
  pins and route already drawn, uploaded to the homeserver: `url` is
  `mxc://` only (anything else drops the map; a validating sender refuses
  it). `w`/`h` are
  its pixel size, used only for the aspect ratio. Element never fetches map
  tiles or third-party images (safety rule 3).
- `driver`: `{name, vehicle?, plate?, rating?}` (rating 0 to 5, a number:
  `"4.9"`). Dropped
  without a `name`.
- `items`: up to 20 short strings. `total`: `{amount, currency}`, amount a
  number (`24` or `"24.50"`), currency an ISO 4217 code when possible. `link`: https only, the provider's order
  page.
- **Render:** a compact card:
  - a header with the kind icon, the provider (muted) and title, the status,
    and, while `live` with an `eta`, a [`countdown`](#countdown) pill
    "ETA 21:50 · 15:59" (it shows "any minute" once past the ETA);
  - a one-line stage strip (`✓ Placed › ✓ Confirmed › ◌ Picking up › ○ On
    the way`), with `at` in the tooltip;
  - the map thumbnail (at most 280×200, an mxc scale thumbnail as for
    cards, omitted if loading fails);
  - a driver row (name, ★ rating, vehicle · plate), the items, and a footer
    with the total, "Updated 21:34" and an **Open in &lt;provider&gt;** link
    button.
  - `done` shows the status with ✓ in green and stops the clocks;
    `cancelled` shows ✕ and the status in red.
  - Element's "(edited)" marker is hidden on tracker messages (CSS
    `:has()`); the updates are the point, not a correction.
- **Fallback:** one compact line that reads well in a notification and on
  Element X, optionally followed by a few short lines:

  ```text
  🛵 Noodle Bar · Picking up · ETA 21:50
  Sam · Scooter ABC 1234
  €24 · https://delivery.example.org/order/A-123
  ```

  The first line is `<kind icon> <title> · <status> · ETA <HH:MM>` (local
  time, no countdown: other clients can't tick). The final edit swaps the
  icon for ✅ or ❌ and the ETA for the end time: `✅ Noodle Bar ·
  Delivered 21:48`. Keep the extra lines to the driver, the total and the link.

**Update contract.** Trackers follow [Streaming](#streaming) with these
specifics:

- Post once (a normal `m.room.message` with the block). Every update is an
  **`m.replace` edit of that first event** whose `m.new_content` holds the
  **full** new content: the current fallback `body` and the whole tracker
  block, with stable stage `id`s. Never a patch, never a new message per
  update.
- Both the edit and its `m.new_content` carry **`"m.mentions": {}`**, so an
  update never pings anyone.
- **At most one edit every 2 to 3 seconds**; typically one every 30 to 60
  seconds, or when the status, a stage, the ETA or the driver changes. Skip
  edits that change nothing but `updated_at`.
- The **final edit** sets `state: "done"` (or `"cancelled"`) and the final
  status, and must always be sent, so every client converges on the end
  state. No edits after it.

### `gallery`

**Implemented.** An image carousel.

```json
{ "type": "gallery", "title": "Listing photos",
  "images": [
    { "url": "mxc://example.org/AbC", "caption": "Living room", "alt": "Sofa by the window",
      "w": 1600, "h": 1200, "mimetype": "image/jpeg", "size": 284113 },
    { "file": { "url": "mxc://example.org/DeF", "v": "v2", "iv": "…",
                "key": { "kty": "oct", "alg": "A256CTR", "ext": true, "key_ops": ["encrypt", "decrypt"], "k": "…" },
                "hashes": { "sha256": "…" } },
      "caption": "Bedroom", "w": 1200, "h": 1600, "mimetype": "image/jpeg" }
  ] }
```

- `images[]`: `{url | file, caption?, alt?, w?, h?, mimetype?, size?}`.
  - The source is exactly as in Matrix's `m.image`: `url` (`mxc://`) in
    unencrypted rooms, or `file` (an `EncryptedFile`, attachment encryption
    v2) in E2EE rooms. One of the two, not both. An item with neither, a
    non-mxc URL, or a malformed `file` is dropped (a validating sender
    refuses it).
  - `caption` and `alt` are one line, up to 200 characters. `w`/`h` are
    positive integers (they set the tile's aspect ratio). `mimetype` must be
    `image/*`. `size` is in bytes.
- `title` is optional (200 characters).
- **Limits:** a sender sends 2 to 20 images (one image is just an
  `m.image`).
  The renderer draws 1 to 20 and drops the rest.
- **Render:** a horizontal scroll-snap row of 160px-high tiles (width from
  `w`/`h`, 100 to 280px), each with its caption (2 lines) below. Plain
  images are scale thumbnails (authenticated media fetched with the access
  token into Blob URLs, at the tile's longer side × the device pixel ratio
  up to 2×, at most 800px), cropped to the tile with `object-fit: cover`
  (Synapse only stores crop thumbnails up to 96×96, which came out
  blurry). Tiles load once they're within a screen of the viewport.
  Encrypted images are downloaded from the homeserver and decrypted in the
  browser (WebCrypto, SHA-256 checked first) into Blob URLs. Clicking a
  tile opens a lightbox (a modal `<dialog>`): the full image, "n/N ·
  caption", previous/next buttons and arrow keys, Download (a local Blob)
  and close (✕, Esc or a click on the backdrop).
- **Fallback (album).** A sender **should** send a gallery as an
  **album**: every image is its own `m.image` event.
  1. The **leader** is an `m.image` of the first image. Its `body` is the
     message text (an MSC2530 caption; `filename` is the file name), with
     the first image's caption appended. It carries the `gallery` block
     listing **all** the images (the same `url`/`file` sources).
  2. Each other image follows as its own `m.image` (`body` = its caption,
     or the file name), with
     `"com.ianm.mtrix.album": {"event_id": "<leader>", "index": i, "count": n}`
     and no `m.relates_to` (the `.album` key follows the
     [namespace](#namespace-and-compatibility) rules).

  **Why an album:** Element X (iOS/Android) and the other mobile clients
  render `m.image` natively: full width, with the caption under it, tap
  for full screen, saved to the media gallery. They drop `<img>` in
  `formatted_body`, and `mxc://` or authenticated-media links aren't
  clickable or viewable outside a logged-in client. So the alternative (one
  `m.image` of the first picture with the other captions and links listed
  in its body) would leave mobile users with one picture and dead links.
  The album shows every image, each with its own caption. The follow-ups
  carry no relation on purpose: a thread relation would hide them from the
  mobile main timeline, and `m.reference` gains nothing.

  **The module folds the album.** The leader's gallery replaces Element's
  image tile (the caption, when there is one, is shown above the gallery as
  plain text). A follow-up image's whole tile (`.mx_EventTile`) is hidden
  (`display: none`) when all of these hold: its sender is allow-listed, its
  leader is loaded in the room, the leader has the same sender, and the
  leader's gallery lists this image's mxc. Otherwise (leader not loaded,
  redacted, or edited to drop the gallery) Element's own image tile stays.
  It's only hidden in the main timeline, never in reply quotes, threads or
  search. Hiding works on Element's DOM from a layout effect (the module API
  can't hide a tile), so a future Element markup change would at worst show
  the follow-ups again.
- A `gallery` block under a text message (with mxc URIs the sender
  uploaded itself, as for `card` images) is a normal rich block; then
  mobile sees only the text, so senders **should** send an album instead.

### `form`

**Implemented.** MSC4139 **input prompts**: a few inputs and a submit
button that sends one visible reply.

```json
{ "type": "form", "id": "book", "title": "Book a table", "scope": ["@alice:example.org"],
  "fields": [
    { "id": "date", "kind": "date", "label": "Date", "required": true, "min": "2026-10-15" },
    { "id": "party", "kind": "select", "label": "Party size", "required": true, "default": "2",
      "options": [ { "value": "2", "label": "2 people" }, { "value": "4", "label": "4 people" } ] },
    { "id": "seat", "kind": "radio", "label": "Seating", "options": ["Indoor", "Outdoor"] },
    { "id": "notes", "kind": "text", "label": "Notes", "maxlength": 120, "placeholder": "Allergies…" },
    { "id": "chair", "kind": "checkbox", "label": "High chair" }
  ],
  "submit": { "label": "Book" } }
```

- `id` (required) is the form's prompt id: 1 to 64 of `A-Z a-z 0-9 _ . : -`,
  unique across the message's prompt ids (buttons, card actions, forms).
  `scope`: as for buttons. `title` is optional (200 characters).
- `submit: {label}`: required, 1 to 120 characters.
- `fields[]`: `{id, kind, label, required?, ...}`, 1 to 8.
  - `id`: a prompt id, unique within the form. `label`: 1 to 120
    characters. `required`: boolean, default false (a required checkbox
    must be ticked).
  - `kind` (A2UI's ChoicePicker, TextField, CheckBox, DateTimeInput):
    - `select` (a dropdown) and `radio`: `options`, 1 to 10, each
      `"Label"` (value = label) or `{value, label?}`. Values are 1 to 100
      characters and unique; labels 1 to 120. `default`: an option value.
      `options` is allowed only on these two kinds.
    - `text`: one line. `maxlength` 1 to 200 (default 200), `placeholder`
      up to 64 characters, `default` a string within `maxlength`.
    - `checkbox`: `default` true/false.
    - `date`: `min`, `max` and `default` as `YYYY-MM-DD` (min ≤ max).
  - Unknown kinds, duplicate ids and duplicate option values are dropped
    by the renderer; a validating sender refuses them, as it refuses
    fields over the caps.
  - MSC4139's `validator` (a regex) is **not** supported: a sender-supplied
    regex run in the browser is a ReDoS risk. Bots validate the reply and
    answer.
- **Render:** a bordered form with native inputs (a dropdown, a radio
  group, a text input, a checkbox, a date picker) in Element's tokens, and
  the submit button (primary). Required fields get `*`.
  - Nothing is sent on change or on Enter: **only the submit click sends**.
  - Before sending, the renderer checks required fields and date ranges and
    shows "Required" / "On or after …" next to the field.
  - Users outside `scope` see the form disabled with "Only … can answer".
  - **After submission the form is disabled**: when the user's live
    timeline (plus pending events) has a reply to this event whose
    `com.ianm.mtrix.used` names this form (`event_id` and `id`), the inputs
    show the submitted `values` read-only and the button reads
    "✓ Submitted". (Same mechanism as a selected `send` button.) The bot
    should still make an [outcome edit](#outcome-edits).
- **What submit sends** (normative): an `m.text` from the user, a visible
  reply to the form's event:

  ```json
  { "msgtype": "m.text",
    "body": "Form \"Book a table\": Date: 2026-10-17; Party size: 2 people; Seating: Outdoor; High chair: no",
    "m.relates_to": { "m.in_reply_to": { "event_id": "$form_message" } },
    "com.ianm.mtrix.used": { "event_id": "$form_message", "id": "book",
      "values": { "date": "2026-10-17", "party": "2", "seat": "Outdoor", "notes": "", "chair": false } } }
  ```

  - `body` is `Form "<title>": <label>: <value>; <label>: <value>…`.
    `<title>` is the form's `title`, or its `id` when it has none. Fields
    come in form order, each as `<label>: <value>` joined by `; `. The value
    shown is the chosen option's **label** for select/radio, the text with
    whitespace runs collapsed to one space for text, `YYYY-MM-DD` for a
    date, and `yes`/`no` for a checkbox. Fields left empty (no option, no
    date, blank text) are left out; checkboxes never are. If nothing is
    left: `Form "<title>": (no answers)`. The body is for people and logs;
    bots **should** read `values`.
  - `used.values` has **every** field, keyed by field id: text → a string
    (trimmed, cut to `maxlength`; `""` when empty); select/radio → the
    option's **value** or `null`; checkbox → `true`/`false`; date →
    `"YYYY-MM-DD"` or `null`.
  - As with buttons, bots must check the sender (scope is a UI hint) and
    must also accept a typed answer (below).
- **Fallback:** `body` lists each field numbered, with its options
  numbered, and how to answer by typing. The reference crate generates it
  (`Rich::form_fallback`), and a sender uses it when it has no text of its
  own:

  ```text
  Book a table
  1. Date (YYYY-MM-DD)
  2. Party size: 1) 2 people 2) 4 people
  3. Seating (optional): 1) Indoor 2) Outdoor
  4. Notes (optional, up to 120 characters)
  5. High chair (yes/no, optional)
  Reply with the numbers, e.g. "1: 2026-10-17; 2: 1".
  ```

  A typed answer is `<field number>: <value or option number>` items
  separated by `;` or newlines. It arrives without `used`; the bot parses
  it.

### `math`

**Implemented.** A LaTeX formula.

```json
{ "type": "math", "tex": "e^{i\\pi} + 1 = 0", "display": true,
  "alt": "Euler's identity", "caption": "Euler's identity" }
```

- `tex` is required: TeX math (no `$…$` delimiters), up to 4,000
  characters, no NULs. A longer `tex` drops the block (a cut formula would
  be wrong).
- `display`: `true` (default) for display math, `false` for inline (text
  style).
- `alt`: optional one line (up to 200 characters), the accessible label;
  defaults to the TeX.
- `caption`: optional one line (up to 200 characters) shown under the
  formula.
- **At most one `math` block per message** (a validating sender refuses
  more): a math-only message is one image of one formula.
- **Render:** KaTeX, bundled into the module (no CDN), as selectable HTML
  plus MathML for screen readers and copy. Options: `trust: false`,
  `throwOnError: true` (a formula KaTeX can't parse falls back, below; it
  is never drawn half-broken), `strict: "ignore"`, `maxSize: 20` (em),
  `maxExpand: 500`. Glyphs take the theme's text colour. Wide display math
  scrolls horizontally. KaTeX's CSS is injected on first use, with its
  fonts loaded from `fonts/` next to `mxblocks-rich.js` (woff2,
  [deploying](#deploying-the-renderer)).
- **In a reply quote** the module draws the normal tile (the image, for a
  math-only message).

#### Math-only messages: `m.image`

A message whose payload is exactly one `math` block, sent without separate
text, is an **`m.image` of the formula rendered to PNG**, so every client
shows the formula:

```json
{
  "msgtype": "m.image",
  "body": "e^{i\\pi} + 1 = 0",
  "url": "mxc://example.org/AbCdEf",
  "info": { "mimetype": "image/png", "w": 129, "h": 46, "size": 3330 },
  "format": "org.matrix.custom.html",
  "formatted_body": "<div data-mx-maths=\"e^{i\\pi} + 1 = 0\"><code>e^{i\\pi} + 1 = 0</code></div>",
  "com.ianm.mtrix": { "v": 1, "blocks": [
    { "type": "math", "tex": "e^{i\\pi} + 1 = 0", "display": true } ] }
}
```

- `body` is the raw TeX (no `filename`, so Element shows no caption).
- In encrypted rooms the PNG is uploaded encrypted and `file` replaces
  `url`.
- `info.w` / `info.h` are the display size at 1x; the PNG has twice the
  pixels, so it is sharp on phones.
- `formatted_body` is [MSC2191](https://github.com/matrix-org/matrix-spec-proposals/pull/2191)
  markup, HTML-escaped: `<div data-mx-maths="…"><code>…</code></div>` for
  display math, `<span data-mx-maths="…"><code>…</code></span>` for inline.
  Clients with LaTeX support (Element's `feature_latex_maths` labs flag)
  can use it; others show the code.
- **The Element module** replaces the image tile with the KaTeX rendering (with
  `caption`, if any). If KaTeX can't parse the TeX or anything throws, the
  normal image tile is drawn instead.

**With other blocks** (or with text), the message stays an `m.text` with
the sender's text as `body`, no image is rendered or uploaded, and the
module draws the formula as a block under the text. The text must then
carry the formula itself (e.g. the TeX in backticks); if KaTeX can't parse
it, the block shows the TeX source in `<code>`.

#### The PNG renderer: `mxblocks-math`

The PNG comes from the `mxblocks-math` npm package (`packages/mxblocks-math/` in this repo,
`nix build .#mxblocks-math`; the binary is named `mxblocks-math`): MathJax 3
(TeX input, SVG output with every glyph as a path) on node, rasterised by
resvg. No browser. A sender runs it locally (the reference tooling looks
for `$MXBLOCKS_MATH`, then `mxblocks-math` on `PATH`) and uploads the PNG.

```sh
mxblocks-math render [--inline] --out PATH.png LATEX   # LATEX may be - (stdin)
```

- Exit 0 prints one line of JSON:
  `{"mimetype":"image/png","w":<1x px>,"h":<1x px>,"size":<bytes>}`; the
  PNG is exactly `2w × 2h` pixels.
- TeX errors exit 1 with the message on stderr (`mxblocks-math: Undefined
  control sequence \foo`); usage errors exit 2.
- **Look:** dark glyphs (`#1b1d22`) on a white rounded card with a light
  grey border, readable on light and dark themes. Display math is set at
  22 px per em with 12 px padding, inline math at 20 px with 6 px padding
  (1x).
- **Limits:** 4,000 characters of TeX; at most 2048 × 1024 px at 1x (the
  PNG at most 4096 × 2048); MathJax's macro cap (1,000 substitutions) and
  buffer cap (5 kB); resvg gets 10 s and the whole run 20 s
  (`MXBLOCKS_MATH_TIMEOUT`, exit 124). Senders **should** refuse PNGs over
  4 MB or 4096 px a side at 1x.
- **No loading:** MathJax gets a fixed package list without `require` and
  `autoload` (nothing is read from disk or the network), without `html`
  (`\href`, `\class`, `\style`) and `unicode` (font names), and without
  `noerrors` / `noundefined`, so errors fail the render. resvg runs with
  system fonts skipped, a resources dir that doesn't exist, and DejaVu as
  the only fonts (for `\text` characters MathJax has no glyph for; CJK
  isn't covered and shows as boxes).

### `file`

**Implemented.** A file artifact card.

```json
{ "type": "file", "name": "build.log", "size": 18234, "mimetype": "text/plain",
  "url": "mxc://example.org/GhI",
  "preview": "Compiling demo v0.2.0\nFinished release in 41s\n…" }
```

- `name` (required, up to 255 characters), `size` (bytes), `mimetype`.
- The source: `url` (`mxc://`) or `file` (`EncryptedFile`), one of them,
  as in `m.file`. An optional thumbnail: `thumbnail_url` or
  `thumbnail_file` (an image).
- `preview`: the first lines of a text file, plain text, at most 40 lines
  and 4,096 bytes (the renderer cuts past that). It is shown as partial
  ("…") when it is shorter than `size`.
- **Render:** a bordered card: a type badge from the extension or MIME type
  ("PDF", "CSV", ...) or the thumbnail, the name, "18 KB · text/plain", a
  **Download** button, and the preview in a scrolling monospace `<pre>`.
  Download fetches the file from the homeserver (authenticated media;
  encrypted files decrypted locally after the hash check) and saves it
  under `name` as an `application/octet-stream` Blob, so it can never open
  as a document on Element's origin.
- **Fallback:** the event itself is a normal `m.file`: `msgtype: "m.file"`,
  `body` = the caption or the file name (MSC2530), `filename`, `url`/`file`,
  `info: {mimetype, size, thumbnail_*}`, plus the block. Element X and
  other clients show their usual file tile with download. On an `m.file`
  the module draws the card **instead of** Element's file tile (a caption
  is shown above it as plain text); in reply quotes, or if the card fails
  to render, Element's tile is shown.
- A sender **should** send every file that isn't an image, video or audio
  file this way: upload the file (encrypted in E2EE rooms), and set
  `preview` when the file is text (no NUL bytes, valid UTF-8 in the first
  4 kB; the reference crate: `text_preview`), optionally with a thumbnail.
  Images, video and audio go out as plain attachments.

### `stream`

**Specified (sender side).** Marks a reply the sender is still writing,
e.g. an LLM answer being generated.

```json
{ "type": "stream", "id": "r-7f3a", "url": "https://bot.example.org/stream/r-7f3a", "state": "live" }
```

- `id` (required): 1 to 64 of `A-Z a-z 0-9 _ -`, naming the stream.
- `state` (required): `live` (the `body` is a partial snapshot) or `done`
  (the `body` is the final text). A renderer **must** tolerate unknown
  states (treat them as not live); a validating sender refuses anything but
  `live` and `done`.
- `url` (optional): `https://` only (a validating sender refuses anything
  else), conventionally `https://…/stream/<id>`. While `state` is `live`, a
  renderer **may** follow it (server-sent events) to show the text as it
  is written, and **must** stop following it once the state is `done`.
  Without `url`, or in a renderer that doesn't follow it, the text updates
  only through edits.
- **Contract:** the sender posts the message with `state: "live"` and a
  partial `body`, keeps `body` current with throttled `m.replace` edits
  (as in [Streaming](#streaming)), and **must** send a final edit with
  the full text and `state: "done"`. The `body` is the fallback for
  everyone, so it alone must carry the reply.
- **Render:** the message's own text; a renderer **may** add a "writing…"
  indicator while `live`. Nothing extra once `done`.
- **Fallback:** the current `body`; nothing else is needed.

## Approvals

Approval prompts are an **approval pattern on top of `buttons`**, modelled
on Beeper ai-bridge's `com.beeper.ai.approval.v1` (choices `approve`,
`always_approve`, `deny`):

| Button `id` | Beeper choice | Meaning | Status |
|---|---|---|---|
| `approve` | `approve` | do it once | specified |
| `always` | `always_approve` | do it, and stop asking for this kind of action (scope decided by the bot) | **planned** |
| `deny` | `deny` | don't do it | specified |

Rules:

- The block is a `buttons` block with these ids, `scope` set to the
  approver, and react actions, so that the same choice works from mobile
  through the pre-seeded reactions.
- Also keep a typed-command path in `body` (`!approve <id>`).
- An expiry, when there is one, goes in `body` ("expires in 24 h").
  Beeper's `expiresAt` is planned as an optional block field.
- After a decision, the bot makes an [outcome edit](#outcome-edits): the
  result in `body`, no buttons.

Example: a bot that drafts messages for the owner to approve:

- **Send** is `{id: "approve", react ✅}`. **Drop** is `{id: "deny",
  react ❌}`.
- Both reactions are pre-seeded by the bot.
- The `body` says "React ✅ to send it or ❌ to drop it (or reply
  !approve <id> / !reject <id>) … expires in 24 h".
- On a decision (or expiry), the bot edits the post to "✅ Sent" /
  "❌ Dropped" / "⌛ Expired" / "⚠️ Failed" without the rich key, and
  redacts its seeds.
- `always_approve` needs a policy store on the bot's side ("always allow
  this bot to send to this chat").

## Sending

A sender writes the text first (`body`, optionally `formatted_body`), then
adds the payload under its [write key](#namespace-and-compatibility). One
payload carries every block type; there is nothing per block type outside
it. Example:

```json
{
  "msgtype": "m.text",
  "body": "Keyboards under €60:\n- RK84 €49 (Shop A)\n- Aula F75 €56 (Shop B)",
  "com.ianm.mtrix": {
    "v": 1,
    "blocks": [
      { "type": "table", "caption": "Keyboards under €60",
        "columns": ["Name", "Price", "Store"],
        "rows": [["RK84", "€49", "Shop A"], ["Aula F75", "€56", "Shop B"]] },
      { "type": "chips", "chips": [
        { "label": "Cheaper", "action": { "type": "send", "body": "show cheaper ones" } } ] }
    ]
  }
}
```

### Validation

A validating sender (the reference crate: `Rich::validate`) checks before
sending:

- `v` is 1, with 1 to 8 blocks of known types. Unknown types and higher
  block versions are refused unless the block has a `fallback`.
- `buttons` and `chips` are fully typed: 1 to 8 buttons or 1 to 12 chips,
  labels 1 to 120 characters, valid actions, valid `id`s (unique across the
  message, card actions and form ids included), and `scope` entries that
  are user ids (at most 50).
- `card.actions`: 1 to 2 valid buttons. `cards`: at most 8 items, each with
  at most 1 action.
- `gallery`, `form` and `file` are fully checked against the limits in
  their sections (sources, counts, ids, kinds, options, dates, preview
  size); a form's `id` joins the message's prompt ids.
- `fallback`: 1 to 500 characters when present.
- `math`: `tex` 1 to 4,000 characters without NULs, `display` a boolean,
  `alt` / `caption` one line of 1 to 200 characters; **at most one `math`
  block per message**.
- `stream`: `id` 1 to 64 of `A-Z a-z 0-9 _ -`, `state` `live` or `done`,
  `url` (if present) `https://`.
- No floats anywhere: integers within ±(2^53 − 1) or decimal strings
  ([Numbers](#wire-format)).
- Display blocks are passed through as JSON after a minimal check: their
  required fields are present with the right JSON kind, `chart.kind` is
  known, each block is at most 24,000 bytes, and the payload at most 40,000
  bytes. Everything else is the renderer's job.
- `tracker` gets a few more checks: `kind` and `state` from their lists,
  stages with a label and a known status (at most 12), `eta`/`updated_at`
  as timestamps, `map.url` an `mxc://` URI, a `driver.name`, at most 20
  string `items`, `total` as `{amount: number, currency}`, and an https
  `link`.

### Edits, text, media

- **Edits.** An `m.replace` edit of the sender's own message carries the
  full new content in `m.new_content` (text and payload), with empty
  `m.mentions` on both. An edit without the payload removes the blocks
  ([Edits](#edits-mreplace)).
- **Text.** Write `body` to stand on its own. A math-only message builds
  its `body`, `formatted_body` and image as in
  [math](#math-only-messages-mimage). A message with a `form` block and no
  text of its own uses the numbered text version of the form
  ([form](#form)).
- **Files and galleries** upload the media (encrypted in E2EE rooms) and
  build the block: a [`file`](#file) card on an `m.file`, a
  [`gallery`](#gallery) as an album. Further blocks may follow the
  generated one in the same payload.

## Deploying the renderer

The Element module (`mxblocks-element`): `nix build .#element-module`
produces a directory with `mxblocks-rich.js` (and
its source map) and `fonts/` (KaTeX's woff2 fonts for `math` blocks, about
300 kB, fetched on first use). To deploy it:

1. Serve the whole directory same-origin with Element, e.g. at `/modules/`
   (so the fonts are at `/modules/fonts/`; the module finds them relative
   to its own URL). A Content-Security-Policy must allow `font-src 'self'`.
2. Add it to Element's config.json together with the sender allow-list:

   ```json
   {
     "modules": ["/modules/mxblocks-rich.js"],
     "com.talaagent.mxblocks": { "senders": ["@bot:example.org", "@helper:example.org"] }
   }
   ```

3. No other module may register a message renderer for the same events
   (the first renderer wins).

The settings key may also be `com.ianm.mtrix` (configs written before the
rename); `com.talaagent.mxblocks` wins when both are present. Add
`"write_key": "new"` to it only once every client that matters runs a
renderer that reads the new key ([namespace](#namespace-and-compatibility)).

Bust caches on rebuild with a query string, e.g.
`/modules/mxblocks-rich.js?v=<store hash>`. The module requires module API
`^2.2.0` (Element Web 1.12.30).
