//! mxblocks: structured extras ("blocks") on an ordinary Matrix
//! `m.room.message` (buttons, chips, tables, charts, cards, progress, ...),
//! under the content key [`RICH_KEY`]. Clients that know the key (the
//! Element Web module in `packages/mxblocks-element/`) render it; everyone else sees
//! `body`/`formatted_body` and can use reactions, so the text must stand
//! alone. Normative spec: `docs/spec.md`.
//!
//! ```json
//! "com.ianm.mtrix": {
//!   "v": 1,
//!   "blocks": [
//!     { "type": "buttons", "buttons": [
//!       { "label": "Send", "style": "primary", "action": { "type": "react", "key": "✅" } },
//!       { "label": "Drop", "style": "danger",  "action": { "type": "react", "key": "❌" } }
//!     ] },
//!     { "type": "table", "columns": ["item", "price"], "rows": [["A", 10]] }
//!   ]
//! }
//! ```
//!
//! A `react` action makes the client send an `m.reaction` annotation with
//! `key` on the message; a `send` action sends `body` as a message from the
//! clicking user. Action blocks (`buttons`, `chips`) are typed. Display
//! blocks ([`DISPLAY_TYPES`]) are carried as JSON and only checked for their
//! required fields and size; the renderer parses them defensively anyway.
//! Unknown block types load as [`Block::Unknown`] (so newer payloads still
//! deserialize) but don't [`Rich::validate`].
//!
//! A `stream` block marks a reply the sender is still writing:
//! `{"type": "stream", "id": "<id>", "url": "https://…/stream/<id>",
//! "state": "live"}`, `"done"` in the final edit. The renderer may follow
//! `url` (SSE) while it is live; the body is the fallback, kept current by
//! edits.
//!
//! # Content keys
//!
//! Default readers accept [`RICH_KEYS`]. Writers use [`WriteKey`] (including
//! caller-selected keys), while [`ContentKeys`] configures both the write key
//! and the exact read aliases. Applications can choose their own namespace.

#![warn(missing_docs)]

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};

mod form;
mod media;
mod number;

pub use form::{
    FORM_KINDS, FORM_REPLY_FORMAT, MAX_FORM_FIELDS, MAX_FORM_OPTIONS, MAX_FORM_TEXT,
    MAX_OPTION_VALUE, form_fallback,
};
pub use media::{
    MAX_CAPTION, MAX_FILE_NAME, MAX_GALLERY, MAX_PREVIEW_BYTES, MAX_PREVIEW_LINES, MIN_GALLERY,
    image_size, is_mxc, text_preview,
};
pub use number::{
    MAX_SAFE_INT, canonicalize as canonicalize_value, is_decimal, is_num, non_canonical,
};

mod keys;
pub use keys::{
    ALBUM_KEYS, ContentKeys, RICH_KEY, RICH_KEY_NEW, RICH_KEYS, USED_KEYS, WriteKey, read_album,
    read_rich, read_used, rich_value, strip_rich,
};

/// The only payload version so far.
pub const RICH_VERSION: u32 = 1;

/// Blocks in one payload.
pub const MAX_BLOCKS: usize = 8;
/// Buttons in one `buttons` block.
pub const MAX_BUTTONS: usize = 8;
/// Chips in one `chips` block.
pub const MAX_CHIPS: usize = 12;
/// Button, chip and form labels, in characters: a whole sentence, which
/// the renderer wraps.
pub const MAX_LABEL: usize = 120;
/// A reaction key, in characters.
pub const MAX_KEY: usize = 32;
/// In UTF-16 code units, as the Element module (JS `length`) counts.
pub const MAX_SEND_BODY: usize = 1000;
/// Reaction seeds on one message.
pub const MAX_SEEDS: usize = 8;
/// Serialized size of one display block, in bytes.
pub const MAX_BLOCK_BYTES: usize = 24_000;
/// Serialized size of the whole payload, in bytes (Matrix caps the whole
/// event at 65536, and `body`/`formatted_body` need room too).
pub const MAX_PAYLOAD_BYTES: usize = 40_000;

/// JSON block types (display blocks, plus `form`), with the fields each must
/// have (`docs/spec.md`).
pub const DISPLAY_TYPES: &[(&str, &[(&str, Kind)])] = &[
    ("table", &[("columns", Kind::Array), ("rows", Kind::Array)]),
    ("chart", &[("kind", Kind::String), ("series", Kind::Array)]),
    ("sources", &[("sources", Kind::Array)]),
    ("card", &[("title", Kind::String)]),
    ("cards", &[("cards", Kind::Array)]),
    ("progress", &[("steps", Kind::Array)]),
    (
        "details",
        &[("summary", Kind::String), ("body", Kind::String)],
    ),
    ("code", &[("code", Kind::String)]),
    ("diff", &[("diff", Kind::String)]),
    ("countdown", &[("until", Kind::Time)]),
    ("event", &[("title", Kind::String), ("start", Kind::Time)]),
    ("place", &[("name", Kind::String)]),
    (
        "ticker",
        &[("symbol", Kind::String), ("price", Kind::Number)],
    ),
    (
        "weather",
        &[("location", Kind::String), ("temp", Kind::Number)],
    ),
    ("math", &[("tex", Kind::String)]),
    (
        "tracker",
        &[
            ("title", Kind::String),
            ("provider", Kind::String),
            ("status", Kind::String),
        ],
    ),
    ("gallery", &[("images", Kind::Array)]),
    (
        "form",
        &[
            ("id", Kind::String),
            ("fields", Kind::Array),
            ("submit", Kind::Object),
        ],
    ),
    ("file", &[("name", Kind::String)]),
    ("stream", &[("id", Kind::String), ("state", Kind::String)]),
];

/// A `stream` block's state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamState {
    /// Still being written: the body is a partial snapshot.
    Live,
    /// Finished: the body is the final text.
    Done,
    /// A state this version doesn't know.
    #[serde(other)]
    Unknown,
}

/// Longest `stream` block id.
pub const MAX_STREAM_ID: usize = 64;

/// `math.tex`, in characters (the reference math renderer refuses longer input too).
pub const MAX_TEX: usize = 4000;
/// `math.alt` / `math.caption`, in characters.
pub const MAX_MATH_LINE: usize = 200;

/// The JSON kind a required display-block field must have.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A non-blank string.
    String,
    /// A number: an integer in ±(2^53 - 1) or a decimal string ([`is_num`]).
    Number,
    /// A non-empty array.
    Array,
    /// ms since the epoch (number) or an ISO 8601 string
    Time,
    /// A JSON object.
    Object,
}

impl Kind {
    fn matches(self, v: &Value) -> bool {
        match self {
            Kind::String => v.as_str().is_some_and(|s| !s.trim().is_empty()),
            Kind::Number => is_num(v),
            Kind::Array => v.as_array().is_some_and(|a| !a.is_empty()),
            Kind::Time => is_num(v) || v.is_string(),
            Kind::Object => v.is_object(),
        }
    }
}

const CHART_KINDS: &[&str] = &["line", "bar", "area", "sparkline"];
/// `tracker.kind`.
pub const TRACKER_KINDS: &[&str] = &["food", "ride", "delivery", "parcel"];
/// `tracker.state`; the final edit sets `done` or `cancelled`.
pub const TRACKER_STATES: &[&str] = &["live", "done", "cancelled"];
/// `progress.steps[].status` and `tracker.stages[].status`.
pub const STEP_STATUSES: &[&str] = &["pending", "running", "done", "failed", "skipped"];
/// `tracker.stages`.
pub const MAX_TRACKER_STAGES: usize = 12;
/// `tracker.items`.
pub const MAX_TRACKER_ITEMS: usize = 20;

/// A rich payload: the object stored under the content key
/// (`{"v":1,"blocks":[...]}`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rich {
    /// Payload version ([`RICH_VERSION`]).
    pub v: u32,
    /// The blocks, drawn in order under the message.
    pub blocks: Vec<Block>,
}

/// One entry of `blocks`, tagged by its `type` field on the wire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Block {
    /// `{"type":"buttons","buttons":[...]}`
    Buttons(Prompts),
    /// `{"type":"chips","chips":[...]}`: quick-reply chips, same items as
    /// buttons (`style` ignored).
    Chips(Prompts),
    /// A display block of a type in [`DISPLAY_TYPES`] at block version 1,
    /// kept as the JSON object (including `type`).
    Display(Map<String, Value>),
    /// A block this version can't check (unknown type, or a block `v` above
    /// [`BLOCK_VERSION`]), kept as-is. Sendable only with a `fallback`.
    Unknown(Value),
}

/// The items of a `buttons`/`chips` block plus the fields every block may
/// carry. Shaped after MSC4139 `m.prompts`: the items are preset prompts with
/// stable ids, `scope` lists who may answer.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Prompts {
    /// The buttons or chips, in order.
    pub items: Vec<Button>,
    /// MXIDs allowed to click; `None` = anyone who can see the message.
    pub scope: Option<Vec<String>>,
    /// Block version (absent = 1).
    pub v: Option<u32>,
    /// Plain text shown by renderers that can't draw this block.
    pub fallback: Option<String>,
}

impl Prompts {
    /// These items, with no scope, version or fallback.
    pub fn new(items: Vec<Button>) -> Self {
        Self {
            items,
            ..Self::default()
        }
    }
}

#[derive(Serialize, Deserialize)]
struct PromptsWire {
    #[serde(rename = "type")]
    ty: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    buttons: Option<Vec<Button>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    chips: Option<Vec<Button>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scope: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    v: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fallback: Option<String>,
}

/// The block version every block type is at.
pub const BLOCK_VERSION: u64 = 1;
/// A block's `fallback` text, in characters.
pub const MAX_FALLBACK: usize = 500;
/// `card.actions` (ChatGPT Apps SDK: an inline card has at most 2 actions).
pub const MAX_CARD_ACTIONS: usize = 2;
/// Items in `cards` (ChatGPT inline carousel: 3 to 8; fewer render as single cards).
pub const MAX_CAROUSEL: usize = 8;
/// Actions per carousel item.
pub const MAX_CAROUSEL_ACTIONS: usize = 1;
/// `scope` entries.
pub const MAX_SCOPE: usize = 50;

impl Serialize for Block {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let prompts = |ty: &str, p: &Prompts, chips: bool| PromptsWire {
            ty: ty.to_owned(),
            buttons: (!chips).then(|| p.items.clone()),
            chips: chips.then(|| p.items.clone()),
            scope: p.scope.clone(),
            v: p.v,
            fallback: p.fallback.clone(),
        };
        match self {
            Block::Buttons(p) => prompts("buttons", p, false).serialize(s),
            Block::Chips(p) => prompts("chips", p, true).serialize(s),
            Block::Display(m) => m.serialize(s),
            Block::Unknown(v) => v.serialize(s),
        }
    }
}

impl<'de> Deserialize<'de> for Block {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = Value::deserialize(d)?;
        let ty = v.get("type").and_then(Value::as_str).unwrap_or_default();
        // A higher block version than we know: opaque, like an unknown type.
        let newer = v
            .get("v")
            .is_some_and(|x| x.as_u64().is_none_or(|n| n > BLOCK_VERSION));
        if newer {
            return Ok(Block::Unknown(v));
        }
        Ok(match ty {
            "buttons" | "chips" => {
                let w: PromptsWire = serde_json::from_value(v).map_err(serde::de::Error::custom)?;
                let chips = w.ty == "chips";
                let p = Prompts {
                    items: if chips { w.chips } else { w.buttons }.ok_or_else(|| {
                        serde::de::Error::custom(format!("a {} block needs {:?}", w.ty, w.ty))
                    })?,
                    scope: w.scope,
                    v: w.v,
                    fallback: w.fallback,
                };
                if chips {
                    Block::Chips(p)
                } else {
                    Block::Buttons(p)
                }
            }
            t if DISPLAY_TYPES.iter().any(|(name, _)| *name == t) => match v {
                Value::Object(m) => Block::Display(m),
                _ => unreachable!("a value with a type field is an object"),
            },
            _ => Block::Unknown(v),
        })
    }
}

impl Block {
    /// The wire `type`.
    pub fn kind(&self) -> &str {
        match self {
            Block::Buttons(_) => "buttons",
            Block::Chips(_) => "chips",
            Block::Display(m) => m.get("type").and_then(Value::as_str).unwrap_or_default(),
            Block::Unknown(v) => v.get("type").and_then(Value::as_str).unwrap_or("?"),
        }
    }

    /// Every clickable action: buttons, chips, and `card`/`cards` actions.
    pub fn actions(&self) -> Vec<Button> {
        match self {
            Block::Buttons(p) | Block::Chips(p) => p.items.clone(),
            Block::Display(m) => action_lists(m)
                .into_iter()
                .filter_map(|(_, a)| serde_json::from_value::<Vec<Button>>(a?.clone()).ok())
                .flatten()
                .collect(),
            Block::Unknown(_) => Vec::new(),
        }
    }

    /// The MSC4139 prompt ids in this block: button and card-action ids, and
    /// a form's id.
    pub fn prompt_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.actions().into_iter().filter_map(|b| b.id).collect();
        if let Block::Display(m) = self
            && self.kind() == "form"
            && let Some(id) = m.get("id").and_then(Value::as_str)
        {
            ids.push(id.to_owned());
        }
        ids
    }

    fn validate(&self) -> Result<(), String> {
        let floats = match self {
            Block::Display(m) => number::non_canonical_map(m, self.kind()),
            Block::Unknown(v) => non_canonical(v, self.kind()),
            _ => None,
        };
        if let Some(at) = floats {
            return Err(format!(
                "{at}: event content is canonical JSON, so no floats (use a decimal \
                 string like \"62.99\") and integers within ±{MAX_SAFE_INT}"
            ));
        }
        match self {
            Block::Buttons(p) => p.validate("buttons", MAX_BUTTONS),
            Block::Chips(p) => p.validate("chips", MAX_CHIPS),
            Block::Display(m) => validate_display(m),
            Block::Unknown(v) => {
                if v.get("fallback")
                    .and_then(Value::as_str)
                    .is_some_and(|f| !f.trim().is_empty())
                {
                    validate_common(v.as_object(), self.kind())?;
                    return check_size(v, self.kind());
                }
                let known: Vec<&str> = ["buttons", "chips"]
                    .into_iter()
                    .chain(DISPLAY_TYPES.iter().map(|(n, _)| *n))
                    .collect();
                Err(format!(
                    "unsupported block type {} or block version {} (known types: {}, \
                     version {BLOCK_VERSION}); add a \"fallback\" text to send it anyway",
                    v.get("type").map_or("(none)".to_owned(), Value::to_string),
                    v.get("v").map_or("1".to_owned(), Value::to_string),
                    known.join(", ")
                ))
            }
        }
    }
}

impl Prompts {
    fn validate(&self, ty: &str, max: usize) -> Result<(), String> {
        if self.items.is_empty() || self.items.len() > max {
            return Err(format!("a {ty} block has 1 to {max} {ty}"));
        }
        self.items.iter().try_for_each(Button::validate)?;
        validate_scope(self.scope.as_deref(), ty)?;
        if let Some(f) = &self.fallback {
            validate_fallback(f, ty)?;
        }
        Ok(())
    }
}

fn validate_scope(scope: Option<&[String]>, ty: &str) -> Result<(), String> {
    let Some(scope) = scope else { return Ok(()) };
    if scope.len() > MAX_SCOPE {
        return Err(format!("{ty} block: at most {MAX_SCOPE} users in scope"));
    }
    for id in scope {
        let ok = id
            .strip_prefix('@')
            .and_then(|r| r.split_once(':'))
            .is_some_and(|(l, s)| !l.is_empty() && !s.is_empty())
            && !id.chars().any(char::is_whitespace);
        if !ok {
            return Err(format!("{ty} block: scope entry {id:?} isn't a user id"));
        }
    }
    Ok(())
}

fn validate_fallback(f: &str, ty: &str) -> Result<(), String> {
    if f.trim().is_empty() || f.chars().count() > MAX_FALLBACK {
        return Err(format!(
            "{ty} block: fallback has 1 to {MAX_FALLBACK} characters"
        ));
    }
    Ok(())
}

/// `v`, `fallback` and `scope` when present on a JSON block.
fn validate_common(m: Option<&Map<String, Value>>, ty: &str) -> Result<(), String> {
    let Some(m) = m else {
        return Err("a block is a JSON object".into());
    };
    if let Some(f) = m.get("fallback") {
        validate_fallback(
            f.as_str().ok_or(format!("{ty} block: fallback is text"))?,
            ty,
        )?;
    }
    if let Some(sc) = m.get("scope") {
        let list: Vec<String> = serde_json::from_value(sc.clone())
            .map_err(|_| format!("{ty} block: scope is a list of user ids"))?;
        validate_scope(Some(&list), ty)?;
    }
    Ok(())
}

fn check_size(v: &impl Serialize, ty: &str) -> Result<(), String> {
    let n = serde_json::to_string(v).map_or(usize::MAX, |s| s.len());
    if n > MAX_BLOCK_BYTES {
        return Err(format!(
            "{ty} block: {n} bytes of JSON, at most {MAX_BLOCK_BYTES}"
        ));
    }
    Ok(())
}

/// The raw `actions` list of a `card`, or of each `cards` item, with the cap
/// that applies (ChatGPT Apps SDK: 2 on an inline card, 1 per carousel item).
fn action_lists(m: &Map<String, Value>) -> Vec<(usize, Option<&Value>)> {
    match m.get("type").and_then(Value::as_str) {
        Some("card") => vec![(MAX_CARD_ACTIONS, m.get("actions"))],
        Some("cards") => m
            .get("cards")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|c| (MAX_CAROUSEL_ACTIONS, c.get("actions")))
            .collect(),
        _ => Vec::new(),
    }
}

/// Required fields present with the right JSON kind, a known chart kind,
/// and at most [`MAX_BLOCK_BYTES`] serialized.
fn validate_display(m: &Map<String, Value>) -> Result<(), String> {
    let ty = m.get("type").and_then(Value::as_str).unwrap_or_default();
    let (_, fields) = DISPLAY_TYPES
        .iter()
        .find(|(n, _)| *n == ty)
        .ok_or_else(|| format!("unsupported block type {ty:?}"))?;
    for (field, kind) in *fields {
        if !m.get(*field).is_some_and(|v| kind.matches(v)) {
            let want = match kind {
                Kind::String => "a non-empty string",
                Kind::Number => "an integer or a decimal string (\"62.99\")",
                Kind::Array => "a non-empty array",
                Kind::Time => "ms since the epoch or an ISO 8601 string",
                Kind::Object => "an object",
            };
            return Err(format!("{ty} block: {field:?} must be {want}"));
        }
    }
    if ty == "chart" {
        let k = m.get("kind").and_then(Value::as_str).unwrap_or_default();
        if !CHART_KINDS.contains(&k) {
            return Err(format!(
                "chart block: kind {k:?} isn't one of {}",
                CHART_KINDS.join(", ")
            ));
        }
    }
    if ty == "math" {
        validate_math(m)?;
    }
    if ty == "stream" {
        validate_stream(m)?;
    }
    if ty == "cards" {
        let n = m.get("cards").and_then(Value::as_array).map_or(0, Vec::len);
        if n > MAX_CAROUSEL {
            return Err(format!(
                "cards block: at most {MAX_CAROUSEL} cards (a carousel shows 3 to 8)"
            ));
        }
    }
    match ty {
        "tracker" => validate_tracker(m)?,
        "gallery" => media::validate_gallery(m)?,
        "file" => media::validate_file(m)?,
        "form" => form::validate_form(m)?,
        _ => {}
    }
    for (max, raw) in action_lists(m) {
        let Some(raw) = raw else { continue };
        let acts: Vec<Button> = serde_json::from_value(raw.clone())
            .map_err(|e| format!("{ty} block: bad actions: {e}"))?;
        if acts.is_empty() || acts.len() > max {
            let what = if ty == "card" {
                "card"
            } else {
                "carousel item"
            };
            return Err(format!("{ty} block: 1 to {max} actions per {what}"));
        }
        acts.iter().try_for_each(Button::validate)?;
    }
    validate_common(Some(m), ty)?;
    check_size(m, ty)
}

/// A stream block: an id of 1..=[`MAX_STREAM_ID`] of `A-Z a-z 0-9 _ -`,
/// an `https:` url (if any) and a known state.
fn validate_stream(m: &Map<String, Value>) -> Result<(), String> {
    let id = m.get("id").and_then(Value::as_str).unwrap_or_default();
    if id.is_empty()
        || id.len() > MAX_STREAM_ID
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(format!(
            "stream id {id:?}: 1 to {MAX_STREAM_ID} of A-Z a-z 0-9 _ -"
        ));
    }
    if let Some(u) = m.get("url")
        && !u.as_str().is_some_and(|u| u.starts_with("https://"))
    {
        return Err(format!("stream url {u}: https only"));
    }
    if !matches!(
        m.get("state").and_then(Value::as_str),
        Some("live" | "done")
    ) {
        return Err("stream state: live or done".into());
    }
    Ok(())
}

/// `math`: `tex` up to [`MAX_TEX`] characters without NULs, `display` a
/// boolean, `alt` / `caption` one line of up to [`MAX_MATH_LINE`].
fn validate_math(m: &Map<String, Value>) -> Result<(), String> {
    let tex = m.get("tex").and_then(Value::as_str).unwrap_or_default();
    if tex.chars().count() > MAX_TEX {
        return Err(format!("math block: tex has at most {MAX_TEX} characters"));
    }
    if tex.contains('\0') {
        return Err("math block: tex contains a NUL".into());
    }
    if m.get("display").is_some_and(|d| !d.is_boolean()) {
        return Err("math block: display is true or false".into());
    }
    for field in ["alt", "caption"] {
        let Some(v) = m.get(field) else { continue };
        let ok = v.as_str().is_some_and(|s| {
            !s.trim().is_empty() && s.chars().count() <= MAX_MATH_LINE && !s.contains('\n')
        });
        if !ok {
            return Err(format!(
                "math block: {field} is one line of 1 to {MAX_MATH_LINE} characters"
            ));
        }
    }
    Ok(())
}

/// A math block's TeX and whether it is display math (the default).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Math {
    /// The TeX source, without delimiters.
    pub tex: String,
    /// Display (block) math when true, inline math when false.
    pub display: bool,
}

impl Math {
    /// MSC2191 fallback HTML: `<div data-mx-maths="…"><code>…</code></div>`
    /// for display math, `<span …>` for inline. Clients with LaTeX support
    /// (Element's labs flag) render the attribute; others show the code.
    pub fn html(&self) -> String {
        let t = html_escape(&self.tex);
        if self.display {
            format!("<div data-mx-maths=\"{t}\"><code>{t}</code></div>")
        } else {
            format!("<span data-mx-maths=\"{t}\"><code>{t}</code></span>")
        }
    }
}

/// Escapes text for an HTML text node or a double-quoted attribute.
pub fn html_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

/// `tracker` beyond its required fields: the enums, stage shape, the
/// `mxc://` map image, an https link and the list caps.
fn validate_tracker(m: &Map<String, Value>) -> Result<(), String> {
    let err = |what: &str| Err(format!("tracker block: {what}"));
    let one_of = |field: &str, allowed: &[&str]| -> Result<(), String> {
        match m.get(field) {
            None => Ok(()),
            Some(v) if v.as_str().is_some_and(|s| allowed.contains(&s)) => Ok(()),
            Some(v) => Err(format!(
                "tracker block: {field} {v} isn't one of {}",
                allowed.join(", ")
            )),
        }
    };
    one_of("kind", TRACKER_KINDS)?;
    one_of("state", TRACKER_STATES)?;
    for f in ["eta", "updated_at"] {
        if m.get(f).is_some_and(|v| !Kind::Time.matches(v)) {
            return err(&format!(
                "{f:?} must be ms since the epoch or an RFC 3339 string"
            ));
        }
    }
    if let Some(stages) = m.get("stages") {
        let Some(stages) = stages.as_array().filter(|a| a.len() <= MAX_TRACKER_STAGES) else {
            return err(&format!("stages is a list of at most {MAX_TRACKER_STAGES}"));
        };
        for s in stages {
            let label = s.get("label").and_then(Value::as_str).unwrap_or_default();
            let status = s.get("status").and_then(Value::as_str).unwrap_or_default();
            if label.trim().is_empty() || !STEP_STATUSES.contains(&status) {
                return err(&format!(
                    "each stage needs a label and a status ({})",
                    STEP_STATUSES.join(", ")
                ));
            }
        }
    }
    if let Some(map) = m.get("map") {
        let url = map.get("url").and_then(Value::as_str).unwrap_or_default();
        let ok = url
            .strip_prefix("mxc://")
            .and_then(|r| r.split_once('/'))
            .is_some_and(|(server, id)| {
                !server.is_empty()
                    && !id.is_empty()
                    && id
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "_-".contains(c))
            });
        if !ok {
            return err("map.url must be an mxc:// URI (upload the static map first)");
        }
    }
    if let Some(d) = m.get("driver")
        && !d
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|n| !n.trim().is_empty())
    {
        return err("driver needs a name");
    }
    if let Some(items) = m.get("items")
        && !items
            .as_array()
            .is_some_and(|a| a.len() <= MAX_TRACKER_ITEMS && a.iter().all(Value::is_string))
    {
        return err(&format!(
            "items is a list of at most {MAX_TRACKER_ITEMS} strings"
        ));
    }
    if let Some(t) = m.get("total")
        && !(t.get("amount").is_some_and(is_num)
            && t.get("currency").and_then(Value::as_str).is_some())
    {
        return err("total is {amount: integer or decimal string, currency: string}");
    }
    if let Some(l) = m.get("link")
        && !l.as_str().is_some_and(|u| u.starts_with("https://"))
    {
        return err("link must be an https URL");
    }
    Ok(())
}

impl Rich {
    /// One math block (`display` false: inline math).
    pub fn math(tex: &str, display: bool) -> Self {
        let mut m = Map::new();
        m.insert("type".into(), "math".into());
        m.insert("tex".into(), tex.into());
        m.insert("display".into(), display.into());
        Self {
            v: RICH_VERSION,
            blocks: vec![Block::Display(m)],
        }
    }

    /// The math of a payload whose only block is a `math` block: such a
    /// message is sent as an `m.image` (the PNG render) when it has no
    /// separate text. `None` for anything else.
    pub fn math_only(&self) -> Option<Math> {
        let [Block::Display(m)] = self.blocks.as_slice() else {
            return None;
        };
        if m.get("type").and_then(Value::as_str) != Some("math") {
            return None;
        }
        Some(Math {
            tex: m.get("tex")?.as_str()?.to_owned(),
            display: m.get("display").and_then(Value::as_bool).unwrap_or(true),
        })
    }

    /// The first math block's TeX and whether it is display math (the
    /// default), in any payload (unlike [`Rich::math_only`]).
    pub fn find_math(&self) -> Option<(&str, bool)> {
        self.blocks.iter().find_map(|b| match b {
            Block::Display(m) if m.get("type").and_then(Value::as_str) == Some("math") => Some((
                m.get("tex").and_then(Value::as_str).unwrap_or_default(),
                m.get("display").and_then(Value::as_bool).unwrap_or(true),
            )),
            _ => None,
        })
    }

    /// One stream block.
    pub fn stream(id: &str, url: Option<&str>, state: StreamState) -> Self {
        let mut m = Map::new();
        m.insert("type".into(), "stream".into());
        m.insert("id".into(), id.into());
        if let Some(u) = url {
            m.insert("url".into(), u.into());
        }
        m.insert(
            "state".into(),
            serde_json::to_value(state).unwrap_or(Value::Null),
        );
        Self {
            v: RICH_VERSION,
            blocks: vec![Block::Display(m)],
        }
    }

    /// One buttons block.
    pub fn buttons(buttons: Vec<Button>) -> Self {
        Self {
            v: RICH_VERSION,
            blocks: vec![Block::Buttons(Prompts::new(buttons))],
        }
    }

    /// Parses a payload, turns its floats into decimal strings
    /// ([`Rich::canonicalize`]) and validates it.
    pub fn parse(json: &str) -> Result<Self, String> {
        let mut r: Rich =
            serde_json::from_str(json).map_err(|e| format!("bad rich payload: {e}"))?;
        r.canonicalize()?;
        r.validate()?;
        Ok(r)
    }

    /// Makes the payload canonical JSON, which event content must be: every
    /// float becomes an integer (no fraction) or its shortest decimal string
    /// (`62.99` → `"62.99"`). Senders call this before [`Rich::validate`], so
    /// callers that write floats keep working. Integers outside
    /// ±[`MAX_SAFE_INT`] are an error.
    pub fn canonicalize(&mut self) -> Result<(), String> {
        for (i, b) in self.blocks.iter_mut().enumerate() {
            let path = format!("blocks[{i}]");
            match b {
                Block::Display(m) => number::canonicalize_map(m, &path)?,
                Block::Unknown(v) => number::canonicalize(v, &path)?,
                Block::Buttons(_) | Block::Chips(_) => {}
            }
        }
        Ok(())
    }

    /// Whether this version can send it: known `v`, 1..=[`MAX_BLOCKS`]
    /// blocks of known types, 1..=[`MAX_BUTTONS`] buttons (or
    /// 1..=[`MAX_CHIPS`] chips) per action block with labels of
    /// 1..=[`MAX_LABEL`] characters, non-empty react keys and send bodies,
    /// display blocks with their required fields, and the size caps.
    pub fn validate(&self) -> Result<(), String> {
        if self.v != RICH_VERSION {
            return Err(format!(
                "rich payload version {} isn't supported (only {RICH_VERSION})",
                self.v
            ));
        }
        if self.blocks.is_empty() || self.blocks.len() > MAX_BLOCKS {
            return Err(format!("a rich payload has 1 to {MAX_BLOCKS} blocks"));
        }
        for b in &self.blocks {
            b.validate()?;
        }
        if self.blocks.iter().filter(|b| b.kind() == "math").count() > 1 {
            return Err("at most one math block per message".into());
        }
        // Prompt ids (buttons, card actions, forms) are unique per message.
        let mut ids: Vec<String> = Vec::new();
        for id in self.blocks.iter().flat_map(Block::prompt_ids) {
            if ids.contains(&id) {
                return Err(format!("prompt id {id:?} used twice in one message"));
            }
            ids.push(id);
        }
        let n = serde_json::to_string(self).map_or(usize::MAX, |s| s.len());
        if n > MAX_PAYLOAD_BYTES {
            return Err(format!(
                "rich payload: {n} bytes of JSON, at most {MAX_PAYLOAD_BYTES}"
            ));
        }
        Ok(())
    }

    /// A plain-text `body` for the payload's forms ([`form_fallback`]), or
    /// `None` without forms: a sender's default text when it has none.
    pub fn form_fallback(&self) -> Option<String> {
        let forms: Vec<String> = self
            .blocks
            .iter()
            .filter_map(|b| match b {
                Block::Display(m) if b.kind() == "form" => Some(form_fallback(m)),
                _ => None,
            })
            .collect();
        (!forms.is_empty()).then(|| forms.join("\n\n"))
    }

    /// The keys of every `react` action (buttons, chips, card actions), in
    /// order, without duplicates.
    pub fn react_keys(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for btn in self.blocks.iter().flat_map(Block::actions) {
            if let Action::React { key } = btn.action
                && !out.contains(&key)
            {
                out.push(key);
            }
        }
        out
    }

    /// Every user-visible string of the actions (labels, keys, send bodies).
    pub fn texts(&self) -> Vec<String> {
        let mut out = Vec::new();
        for btn in self.blocks.iter().flat_map(Block::actions) {
            out.push(btn.label);
            match btn.action {
                Action::React { key } => out.push(key),
                Action::Send { body } => out.push(body),
                Action::Unknown => {}
            }
        }
        out
    }
}

/// One button or chip: a label and what a click does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Button {
    /// Stable per message (MSC4139 prompt `id`): 1 to 64 of `[A-Za-z0-9_.:-]`.
    /// Echoed as `com.ianm.mtrix.used.id` on `send` clicks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// The text on the button, 1..=[`MAX_LABEL`] characters.
    pub label: String,
    /// How the button is drawn (ignored on chips).
    #[serde(default)]
    pub style: Style,
    /// What a click does.
    pub action: Action,
}

/// A button's look.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Style {
    /// The main, recommended choice.
    Primary,
    /// A destructive or risky choice.
    Danger,
    /// A plain button.
    #[default]
    Default,
}

/// What a button click does, tagged by `type` on the wire.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    /// React to the message with `key`.
    React {
        /// The reaction key, 1..=[`MAX_KEY`] characters, no whitespace.
        key: String,
    },
    /// Send `body` as the clicking user.
    Send {
        /// The message body, up to [`MAX_SEND_BODY`] UTF-16 code units.
        body: String,
    },
    /// An action type this version doesn't know.
    #[serde(other)]
    Unknown,
}

impl Button {
    /// A button that reacts with `key`.
    pub fn react(label: &str, style: Style, key: &str) -> Self {
        Self {
            id: None,
            label: label.to_owned(),
            style,
            action: Action::React {
                key: key.to_owned(),
            },
        }
    }

    /// A button that sends `body` as the clicking user.
    pub fn send(label: &str, style: Style, body: &str) -> Self {
        Self {
            id: None,
            label: label.to_owned(),
            style,
            action: Action::Send {
                body: body.to_owned(),
            },
        }
    }

    /// With a stable id (MSC4139 prompt id).
    pub fn with_id(mut self, id: &str) -> Self {
        self.id = Some(id.to_owned());
        self
    }

    fn validate(&self) -> Result<(), String> {
        if let Some(id) = &self.id {
            validate_id(id).map_err(|e| format!("button {e}"))?;
        }
        let n = self.label.trim().chars().count();
        if n == 0 || self.label.chars().count() > MAX_LABEL {
            return Err(format!(
                "button label {:?}: 1 to {MAX_LABEL} characters",
                self.label
            ));
        }
        match &self.action {
            Action::React { key } => {
                validate_key(key).map_err(|e| format!("button {:?}: {e}", self.label))?
            }
            Action::Send { body } => {
                if body.trim().is_empty() || body.encode_utf16().count() > MAX_SEND_BODY {
                    return Err(format!(
                        "button {:?}: a send body has 1 to {MAX_SEND_BODY} characters",
                        self.label
                    ));
                }
            }
            Action::Unknown => {
                return Err(format!(
                    "button {:?}: unsupported action type (react or send)",
                    self.label
                ));
            }
        }
        Ok(())
    }
}

/// An MSC4139 prompt id (buttons, forms, form fields): 1 to 64 of
/// `[A-Za-z0-9_.:-]`.
pub fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_.:-".contains(c))
    {
        return Err(format!("id {id:?}: 1 to 64 of A-Z a-z 0-9 _ . : -"));
    }
    Ok(())
}

/// A reaction key: 1..=[`MAX_KEY`] characters, no whitespace.
pub fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.chars().count() > MAX_KEY || key.chars().any(char::is_whitespace) {
        return Err(format!(
            "reaction key {key:?}: 1 to {MAX_KEY} characters, no spaces"
        ));
    }
    Ok(())
}

/// Reaction seeds: valid keys, at most [`MAX_SEEDS`], no duplicates.
pub fn validate_seeds(keys: &[String]) -> Result<(), String> {
    if keys.len() > MAX_SEEDS {
        return Err(format!("at most {MAX_SEEDS} reaction seeds"));
    }
    for (i, k) in keys.iter().enumerate() {
        validate_key(k)?;
        if keys[..i].contains(k) {
            return Err(format!("reaction seed {k:?} given twice"));
        }
    }
    Ok(())
}

/// Every number in `v` (any JSON, e.g. a whole event content with its
/// `m.new_content`) made canonical: [`number::canonicalize`] from the top.
///
/// # Errors
/// An integer outside ±[`MAX_SAFE_INT`] or a non-finite number, naming where.
pub fn canonical_numbers(v: &mut Value) -> Result<(), String> {
    number::canonicalize(v, "content")
}

/// Whether `v` has a float anywhere (cheap check before [`canonical_numbers`]).
pub fn has_float(v: &Value) -> bool {
    match v {
        Value::Number(n) => n.is_f64(),
        Value::Array(a) => a.iter().any(has_float),
        Value::Object(m) => m.values().any(has_float),
        _ => false,
    }
}

/// `content` (a whole event content, `m.new_content` included) as
/// canonical JSON, ready to send: floats become integers or decimal strings
/// ([`canonical_numbers`]). Borrowed when it has no float; also borrowed,
/// unchanged, when it can't be fixed (an integer beyond ±[`MAX_SAFE_INT`]),
/// so the homeserver's own error reaches the caller.
pub fn canonical_content(content: &Value) -> std::borrow::Cow<'_, Value> {
    if !has_float(content) {
        return std::borrow::Cow::Borrowed(content);
    }
    let mut c = content.clone();
    match canonical_numbers(&mut c) {
        Ok(()) => std::borrow::Cow::Owned(c),
        Err(_) => std::borrow::Cow::Borrowed(content),
    }
}

/// A payload from JSON, made canonical ([`Rich::canonicalize`]) and
/// validated, as [`Rich::parse`] does with text.
///
/// # Errors
/// What's invalid, as a message for the user.
pub fn rich_from_value(v: Value) -> Result<Rich, String> {
    let mut r: Rich = serde_json::from_value(v).map_err(|e| format!("bad rich payload: {e}"))?;
    r.canonicalize()?;
    r.validate()?;
    Ok(r)
}

/// A `--button` spec: `[STYLE:]LABEL=react:KEY` or
/// `[STYLE:]LABEL=send:BODY`, STYLE one of primary, danger, default. The
/// label can't contain `=` (use `--rich` for that).
pub fn parse_button(spec: &str) -> Result<Button, String> {
    let (left, act) = spec.split_once('=').ok_or_else(|| {
        format!("--button {spec:?}: expected [STYLE:]LABEL=react:KEY or [STYLE:]LABEL=send:BODY")
    })?;
    let (style, label) = match left.split_once(':') {
        Some(("primary", l)) => (Style::Primary, l),
        Some(("danger", l)) => (Style::Danger, l),
        Some(("default", l)) => (Style::Default, l),
        _ => (Style::Default, left),
    };
    let action = match act.split_once(':') {
        Some(("react", key)) => Action::React {
            key: key.to_owned(),
        },
        Some(("send", body)) => Action::Send {
            body: body.to_owned(),
        },
        _ => {
            return Err(format!(
                "--button {spec:?}: the action is react:KEY or send:BODY"
            ));
        }
    };
    let b = Button {
        id: None,
        label: label.to_owned(),
        style,
        action,
    };
    b.validate()?;
    Ok(b)
}

/// `--react-seed KEYS`: comma-separated keys; `""` or `none`: no seeds.
pub fn parse_seeds(arg: &str) -> Vec<String> {
    if arg.trim().eq_ignore_ascii_case("none") {
        return Vec::new();
    }
    arg.split(',')
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map(str::to_owned)
        .collect()
}

/// A reaction key as compared: without the U+FE0F variation selector
/// (clients add or drop it).
pub fn norm_key(key: &str) -> String {
    key.replace('\u{fe0f}', "")
}

/// The payload from `--button` specs (one buttons block) or a `--rich`
/// JSON text (not both); `None` when neither is given.
///
/// # Errors
/// What's invalid, as a message for the user.
pub fn from_args(buttons: &[String], rich: Option<&str>) -> Result<Option<Rich>, String> {
    match (buttons.is_empty(), rich) {
        (true, None) => Ok(None),
        (false, Some(_)) => Err("give --button or --rich, not both".into()),
        (true, Some(json)) => Rich::parse(json).map(Some),
        (false, None) => {
            let bs = buttons
                .iter()
                .map(|s| parse_button(s))
                .collect::<Result<Vec<_>, _>>()?;
            let r = Rich::buttons(bs);
            r.validate()?;
            Ok(Some(r))
        }
    }
}

/// A math block (`--math TEX [--inline]`).
pub fn math_block(tex: &str, display: bool) -> Block {
    let mut m = Map::new();
    m.insert("type".into(), "math".into());
    m.insert("tex".into(), tex.into());
    m.insert("display".into(), display.into());
    Block::Display(m)
}

/// [`from_args`] plus `--math`: the math block first, then the buttons
/// (`--rich` with `--math` is refused: put the math block in the JSON).
///
/// # Errors
/// What's invalid, as a message for the user.
pub fn from_args_math(
    buttons: &[String],
    rich: Option<&str>,
    math: Option<(&str, bool)>,
) -> Result<Option<Rich>, String> {
    let Some((tex, display)) = math else {
        return from_args(buttons, rich);
    };
    if rich.is_some() {
        return Err(
            "give --math or --rich, not both (put a {\"type\":\"math\"} block in the JSON)".into(),
        );
    }
    let mut blocks = vec![math_block(tex, display)];
    if let Some(b) = from_args(buttons, None)? {
        blocks.extend(b.blocks);
    }
    let r = Rich {
        v: RICH_VERSION,
        blocks,
    };
    r.validate()?;
    Ok(Some(r))
}

/// The reactions to seed: `given` (`--react-seed`), else the react keys.
pub fn seeds(rich: Option<&Rich>, given: Option<&[String]>) -> Vec<String> {
    match given {
        Some(g) => g.to_vec(),
        None => rich.map(Rich::react_keys).unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sent_content_is_canonical_json() {
        use std::borrow::Cow;
        let plain = json!({"body": "x", "n": 1});
        assert!(matches!(canonical_content(&plain), Cow::Borrowed(_)));
        let edit = json!({"body": "* x", "com.ianm.mtrix": {"v": 1, "blocks": [
                {"type": "weather", "location": "M", "temp": 30.5}]},
            "m.new_content": {"body": "x", "com.ianm.mtrix": {"v": 1, "blocks": [
                {"type": "chart", "kind": "line", "series": [{"values": [1.0, -0.61]}]}]}}});
        let c = canonical_content(&edit);
        assert!(!has_float(&c), "{c}");
        assert_eq!(c["com.ianm.mtrix"]["blocks"][0]["temp"], "30.5");
        assert_eq!(
            c["m.new_content"]["com.ianm.mtrix"]["blocks"][0]["series"][0]["values"],
            json!([1, "-0.61"])
        );
        // Unfixable: sent as is, for the homeserver to refuse.
        let big = json!({"n": 1.5, "m": 9_007_199_254_740_993_u64});
        assert!(matches!(canonical_content(&big), Cow::Borrowed(_)));
    }

    #[test]
    fn wire_format() {
        let r = Rich::buttons(vec![
            Button::react("Send", Style::Primary, "✅"),
            Button::react("Drop", Style::Danger, "❌"),
        ]);
        assert_eq!(
            serde_json::to_value(&r).unwrap(),
            json!({"v": 1, "blocks": [{"type": "buttons", "buttons": [
                {"label": "Send", "style": "primary", "action": {"type": "react", "key": "✅"}},
                {"label": "Drop", "style": "danger", "action": {"type": "react", "key": "❌"}}
            ]}]})
        );
        r.validate().unwrap();
        assert_eq!(r.react_keys(), vec!["✅", "❌"]);
    }

    #[test]
    fn parses_and_validates() {
        let ok = r#"{"v":1,"blocks":[{"type":"buttons","buttons":[
            {"label":"Yes","action":{"type":"send","body":"yes please"}}]}]}"#;
        let r = Rich::parse(ok).unwrap();
        let Block::Buttons(p) = &r.blocks[0] else {
            panic!()
        };
        assert_eq!(p.items[0].style, Style::Default);
        assert!(r.react_keys().is_empty());

        // Unknown block/action types load but don't validate.
        let holo = r#"{"v":1,"blocks":[{"type":"hologram","series":[1,2]}]}"#;
        let r: Rich = serde_json::from_str(holo).unwrap();
        assert_eq!(
            r.blocks,
            vec![Block::Unknown(
                json!({"type": "hologram", "series": [1, 2]})
            )]
        );
        assert!(
            Rich::parse(holo)
                .unwrap_err()
                .contains("unsupported block type \"hologram\"")
        );
        let act = r#"{"v":1,"blocks":[{"type":"buttons","buttons":[
            {"label":"x","action":{"type":"open_url","url":"https://x"}}]}]}"#;
        assert!(Rich::parse(act).unwrap_err().contains("unsupported action"));

        for bad in [
            r#"{"v":2,"blocks":[{"type":"buttons","buttons":[{"label":"x","action":{"type":"react","key":"a"}}]}]}"#,
            r#"{"v":1,"blocks":[]}"#,
            r#"{"v":1,"blocks":[{"type":"buttons","buttons":[]}]}"#,
            r#"{"v":1,"blocks":[{"type":"buttons","buttons":[{"label":" ","action":{"type":"react","key":"a"}}]}]}"#,
            r#"{"v":1,"blocks":[{"type":"buttons","buttons":[{"label":"x","action":{"type":"react","key":""}}]}]}"#,
            r#"{"v":1,"blocks":[{"type":"buttons","buttons":[{"label":"x","action":{"type":"send","body":""}}]}]}"#,
            r#"{"v":1,"blocks":[{"type":"buttons","buttons":[{"label":"x","style":"loud","action":{"type":"react","key":"a"}}]}]}"#,
            "not json",
        ] {
            assert!(Rich::parse(bad).is_err(), "{bad}");
        }
        let long = Rich::buttons(vec![Button::react(
            &"x".repeat(MAX_LABEL + 1),
            Style::Default,
            "a",
        )]);
        assert!(long.validate().is_err());
        let ok = Rich::buttons(vec![Button::react(
            &"é".repeat(MAX_LABEL),
            Style::Default,
            "a",
        )]);
        ok.validate().unwrap();
        let body = |n: usize| {
            Rich::buttons(vec![Button {
                id: None,
                label: "x".into(),
                style: Style::Default,
                action: Action::Send {
                    body: "😀".repeat(n),
                },
            }])
        };
        body(500).validate().unwrap();
        assert!(body(501).validate().is_err(), "1002 UTF-16 units");
        let nine = Rich::buttons(vec![Button::react("x", Style::Default, "a"); 9]);
        assert!(nine.validate().is_err());
    }

    #[test]
    fn chips_are_action_blocks() {
        let r = Rich::parse(
            r#"{"v":1,"blocks":[{"type":"chips","chips":[
                {"label":"Tell me more","action":{"type":"send","body":"tell me more"}},
                {"label":"👍","action":{"type":"react","key":"👍"}}]}]}"#,
        )
        .unwrap();
        assert_eq!(r.blocks[0].kind(), "chips");
        assert_eq!(r.react_keys(), vec!["👍"]);
        assert_eq!(r.texts().len(), 4);
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["blocks"][0]["type"], "chips");
        assert_eq!(v["blocks"][0]["chips"][0]["action"]["type"], "send");
        let empty = r#"{"v":1,"blocks":[{"type":"chips","chips":[]}]}"#;
        assert!(Rich::parse(empty).is_err());
        let chip = json!({"label": "x", "action": {"type": "react", "key": "a"}});
        let thirteen = json!({"v": 1, "blocks": [{"type": "chips", "chips": vec![chip; 13]}]});
        assert!(Rich::parse(&thirteen.to_string()).is_err());
    }

    #[test]
    fn display_blocks_pass_through() {
        let blocks = json!([
            {"type": "table", "columns": ["a", "b"], "rows": [[1, 2]], "caption": "t"},
            {"type": "chart", "kind": "line", "series": [{"name": "x", "values": [1, 2, 3]}]},
            {"type": "sources", "sources": [{"title": "x", "url": "https://x.com"}]},
            {"type": "card", "title": "Keyboard", "price": "₱2,499"},
            {"type": "cards", "cards": [{"title": "a"}, {"title": "b"}]},
            {"type": "progress", "steps": [{"id": "a", "label": "A", "status": "running"}]},
            {"type": "details", "summary": "Logs", "body": "..."},
            {"type": "code", "code": "fn main() {}", "language": "rust"},
        ]);
        let r = Rich::parse(&json!({"v": 1, "blocks": blocks}).to_string()).unwrap();
        assert!(r.blocks.iter().all(|b| matches!(b, Block::Display(_))));
        // Round-trips byte for byte (extra optional fields included).
        assert_eq!(serde_json::to_value(&r).unwrap()["blocks"], blocks);
        assert!(r.react_keys().is_empty() && r.texts().is_empty());

        let more = json!([
            {"type": "diff", "diff": "-a\n+b"},
            {"type": "countdown", "until": 1_800_000_000_000_u64, "label": "x"},
            {"type": "event", "title": "Dinner", "start": "2026-10-15T18:00:00+08:00"},
            {"type": "place", "name": "Downtown"},
            {"type": "ticker", "symbol": "BTC", "price": "1.5"},
            {"type": "weather", "location": "Example City", "temp": 31},
            {"type": "buttons", "buttons": [{"label": "Ok", "action": {"type": "react", "key": "👍"}}]},
        ]);
        Rich::parse(&json!({"v": 1, "blocks": more}).to_string()).unwrap();

        for (bad, why) in [
            (
                json!({"type": "table", "columns": [], "rows": [[1]]}),
                "\"columns\"",
            ),
            (
                json!({"type": "chart", "kind": "pie", "series": [1]}),
                "kind \"pie\"",
            ),
            (json!({"type": "card"}), "\"title\""),
            (
                json!({"type": "ticker", "symbol": "X", "price": "one"}),
                "\"price\"",
            ),
            (
                json!({"type": "details", "summary": "x", "body": "  "}),
                "\"body\"",
            ),
            (
                json!({"type": "event", "title": "x", "start": true}),
                "\"start\"",
            ),
        ] {
            let err = Rich::parse(&json!({"v": 1, "blocks": [bad]}).to_string()).unwrap_err();
            assert!(err.contains(why), "{err}");
        }

        let huge =
            json!({"v": 1, "blocks": [{"type": "code", "code": "x".repeat(MAX_BLOCK_BYTES)}]});
        assert!(
            Rich::parse(&huge.to_string())
                .unwrap_err()
                .contains("bytes")
        );
        let big = json!({"type": "code", "code": "x".repeat(MAX_BLOCK_BYTES - 100)});
        let total = json!({"v": 1, "blocks": [big.clone(), big]});
        assert!(
            Rich::parse(&total.to_string())
                .unwrap_err()
                .contains("payload")
        );
        let nine = json!({"v": 1, "blocks": vec![json!({"type": "card", "title": "x"}); 9]});
        assert!(Rich::parse(&nine.to_string()).is_err());
    }

    #[test]
    fn prompt_ids_scope_and_fallback() {
        let ok = json!({"v": 1, "blocks": [
            {"type": "buttons", "scope": ["@alice:example.org"], "fallback": "React ✅ or ❌",
             "buttons": [
                {"id": "approve", "style": "default", "label": "Send", "action": {"type": "react", "key": "✅"}},
                {"id": "deny", "style": "default", "label": "Drop", "action": {"type": "react", "key": "❌"}}]},
            {"type": "card", "title": "x", "actions": [
                {"id": "buy", "label": "Buy", "action": {"type": "send", "body": "buy x"}}]}
        ]});
        let r = Rich::parse(&ok.to_string()).unwrap();
        let Block::Buttons(p) = &r.blocks[0] else {
            panic!()
        };
        assert_eq!(
            p.scope.as_deref(),
            Some(&["@alice:example.org".to_owned()][..])
        );
        assert_eq!(p.items[0].id.as_deref(), Some("approve"));
        // Round-trips, and card actions count as actions.
        assert_eq!(serde_json::to_value(&r).unwrap(), ok);
        assert_eq!(r.react_keys(), vec!["✅", "❌"]);
        assert_eq!(r.blocks[1].actions()[0].id.as_deref(), Some("buy"));

        let btn =
            |id: &str| json!({"id": id, "label": "x", "action": {"type": "react", "key": "a"}});
        for (bad, why) in [
            (
                json!([{"type": "buttons", "buttons": [btn("a b")]}]),
                "button id",
            ),
            (
                json!([{"type": "buttons", "buttons": [btn("x")]}, {"type": "chips", "chips": [btn("x")]}]),
                "twice",
            ),
            (
                json!([{"type": "buttons", "scope": ["alice"], "buttons": [btn("x")]}]),
                "scope entry",
            ),
            (
                json!([{"type": "buttons", "fallback": "", "buttons": [btn("x")]}]),
                "fallback",
            ),
            (
                json!([{"type": "card", "title": "x", "actions": [btn("a"), btn("b"), btn("c")]}]),
                "1 to 2 actions",
            ),
            (
                json!([{"type": "cards", "cards": [{"title": "x", "actions": [btn("a"), btn("b")]}]}]),
                "carousel item",
            ),
            (
                json!([{"type": "cards", "cards": vec![json!({"title": "x"}); 9]}]),
                "at most 8",
            ),
            (
                json!([{"type": "card", "title": "x", "scope": "everyone"}]),
                "scope",
            ),
        ] {
            let err = Rich::parse(&json!({"v": 1, "blocks": bad}).to_string()).unwrap_err();
            assert!(err.contains(why), "{why}: {err}");
        }

        // Unknown types and newer block versions need a fallback.
        let newer = json!({"type": "table", "v": 2, "fallback": "a table", "grid": {}});
        let r = Rich::parse(&json!({"v": 1, "blocks": [newer]}).to_string()).unwrap();
        assert!(matches!(r.blocks[0], Block::Unknown(_)));
        let holo = json!({"type": "hologram", "fallback": "a hologram"});
        Rich::parse(&json!({"v": 1, "blocks": [holo]}).to_string()).unwrap();
        let bare = json!({"type": "buttons", "v": 2, "buttons": []});
        let err = Rich::parse(&json!({"v": 1, "blocks": [bare]}).to_string()).unwrap_err();
        assert!(err.contains("fallback"), "{err}");
    }

    #[test]
    fn math_blocks() {
        let r = Rich::parse(
            r#"{"v":1,"blocks":[{"type":"math","tex":"\\frac{a}{b}","display":true,"alt":"a over b"}]}"#,
        )
        .unwrap();
        assert_eq!(
            r.math_only(),
            Some(Math {
                tex: "\\frac{a}{b}".into(),
                display: true
            })
        );
        // display defaults to true; inline via Rich::math.
        let r = Rich::parse(r#"{"v":1,"blocks":[{"type":"math","tex":"x^2"}]}"#).unwrap();
        assert!(r.math_only().unwrap().display);
        let inline = Rich::math("e^{i\\pi}", false);
        inline.validate().unwrap();
        assert_eq!(
            serde_json::to_value(&inline).unwrap(),
            json!({"v": 1, "blocks": [{"type": "math", "tex": "e^{i\\pi}", "display": false}]})
        );
        assert!(!inline.math_only().unwrap().display);
        // Mixed payloads aren't math-only.
        let mixed = json!({"v": 1, "blocks": [
            {"type": "math", "tex": "x"}, {"type": "card", "title": "y"}]});
        let mixed = Rich::parse(&mixed.to_string()).unwrap();
        assert_eq!(mixed.math_only(), None);
        assert_eq!(
            Rich::buttons(vec![Button::react("a", Style::Default, "b")]).math_only(),
            None
        );

        Rich::math(&"x".repeat(MAX_TEX), true).validate().unwrap();
        for (bad, why) in [
            (json!({"type": "math"}), "\"tex\""),
            (json!({"type": "math", "tex": "  "}), "\"tex\""),
            (json!({"type": "math", "tex": 1}), "\"tex\""),
            (
                json!({"type": "math", "tex": "x".repeat(MAX_TEX + 1)}),
                "at most 4000",
            ),
            (json!({"type": "math", "tex": "a\u{0}b"}), "NUL"),
            (
                json!({"type": "math", "tex": "x", "display": "yes"}),
                "display",
            ),
            (json!({"type": "math", "tex": "x", "alt": ""}), "alt"),
            (
                json!({"type": "math", "tex": "x", "caption": "a\nb"}),
                "caption",
            ),
            (
                json!({"type": "math", "tex": "x", "caption": "c".repeat(201)}),
                "caption",
            ),
        ] {
            let err = Rich::parse(&json!({"v": 1, "blocks": [bad]}).to_string()).unwrap_err();
            assert!(err.contains(why), "{why}: {err}");
        }
    }

    #[test]
    fn tracker() {
        let full = json!({"type": "tracker", "title": "Noodle Bar", "provider": "Example Delivery",
            "kind": "food", "status": "Picking up", "state": "live",
            "stages": [
                {"id": "placed", "label": "Placed", "status": "done", "at": "2026-10-15T21:20:00+08:00"},
                {"id": "pickup", "label": "Picking up", "status": "running"},
                {"id": "deliver", "label": "On the way", "status": "pending"}],
            "eta": "2026-10-15T21:50:00+08:00",
            "map": {"url": "mxc://example.org/AbC_d-1", "w": 600, "h": 400, "alt": "Rider near Uptown"},
            "driver": {"name": "Sam D.", "vehicle": "Scooter", "plate": "ABC 1234", "rating": "4.9"},
            "items": ["2× Tonkotsu", "1× Gyoza"],
            "total": {"amount": "1240.5", "currency": "PHP"},
            "link": "https://delivery.example.org/order/A-123",
            "updated_at": 1_760_535_000_000_u64});
        let r = Rich::parse(&json!({"v": 1, "blocks": [full]}).to_string()).unwrap();
        assert_eq!(r.blocks[0].kind(), "tracker");
        assert_eq!(serde_json::to_value(&r).unwrap()["blocks"][0], full);
        let min = json!({"type": "tracker", "title": "Courier parcel", "provider": "Example Courier", "status": "In transit"});
        Rich::parse(&json!({"v": 1, "blocks": [min]}).to_string()).unwrap();

        let with = |k: &str, v: Value| {
            let mut b = json!({"type": "tracker", "title": "x", "provider": "Example Delivery", "status": "s"});
            b[k] = v;
            Rich::parse(&json!({"v": 1, "blocks": [b]}).to_string())
        };
        for (k, v, why) in [
            ("status", json!(""), "\"status\""),
            ("kind", json!("boat"), "kind"),
            ("state", json!("finished"), "state"),
            ("eta", json!(true), "\"eta\""),
            (
                "stages",
                json!([{"label": "x", "status": "waiting"}]),
                "stage",
            ),
            ("stages", json!([{"status": "done"}]), "stage"),
            (
                "stages",
                json!(vec![json!({"label": "x", "status": "done"}); 13]),
                "at most 12",
            ),
            ("map", json!({"url": "https://maps.example/x.png"}), "mxc"),
            ("map", json!({"url": "mxc://server/../x"}), "mxc"),
            ("driver", json!({"plate": "X"}), "driver"),
            ("items", json!([1, 2]), "items"),
            (
                "total",
                json!({"amount": "1,240", "currency": "PHP"}),
                "total",
            ),
            ("link", json!("http://delivery.example.org"), "https"),
        ] {
            let err = with(k, v).unwrap_err();
            assert!(err.contains(why), "{k}: {err}");
        }
    }

    #[test]
    fn math_fallback_html() {
        let m = Math {
            tex: r#"a<b & "c" 'd'"#.into(),
            display: true,
        };
        assert_eq!(
            m.html(),
            r#"<div data-mx-maths="a&lt;b &amp; &quot;c&quot; &#39;d&#39;"><code>a&lt;b &amp; &quot;c&quot; &#39;d&#39;</code></div>"#
        );
        let m = Math {
            tex: "x^2".into(),
            display: false,
        };
        assert_eq!(
            m.html(),
            r#"<span data-mx-maths="x^2"><code>x^2</code></span>"#
        );
    }

    #[test]
    fn button_specs() {
        assert_eq!(
            parse_button("primary:✅ Send=react:✅").unwrap(),
            Button::react("✅ Send", Style::Primary, "✅")
        );
        assert_eq!(
            parse_button("Drop=react:❌").unwrap(),
            Button::react("Drop", Style::Default, "❌")
        );
        let b = parse_button("danger:Cancel=send:no: cancel it").unwrap();
        assert_eq!(b.style, Style::Danger);
        assert_eq!(
            b.action,
            Action::Send {
                body: "no: cancel it".into()
            }
        );
        // A label with a colon that isn't a style keeps it.
        assert_eq!(
            parse_button("Re: lunch=react:👍").unwrap().label,
            "Re: lunch"
        );
        for bad in [
            "Send",
            "Send=",
            "Send=click:x",
            "=react:✅",
            "x=react:",
            "x=react:a b",
        ] {
            assert!(parse_button(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn numbers_are_canonical_json() {
        // Floats everywhere a number goes: chart values, ticker, weather,
        // place, tracker rating/amount, a float timestamp.
        let json = r#"{"v":1,"blocks":[
            {"type":"chart","kind":"line","series":[{"name":"a","values":[1.5,2,null,3.25]}]},
            {"type":"ticker","symbol":"AAPL","price":229.87,"change":-1.2,"change_pct":-0.52,"series":[1.1,2.0]},
            {"type":"weather","location":"Example City","temp":31.5,"high":33.0,"low":"26.4"},
            {"type":"place","name":"Downtown","lat":51.5007,"lng":-0.1246},
            {"type":"tracker","title":"Noodle Bar","provider":"Example Delivery","status":"Picking up",
             "driver":{"name":"Sam","rating":4.9},"total":{"amount":1240.5,"currency":"PHP"},
             "eta":1760536200000.0},
            {"type":"table","columns":["a"],"rows":[[0.1]]}]}"#;
        let r = Rich::parse(json).unwrap();
        let out = serde_json::to_value(&r).unwrap();
        assert_eq!(non_canonical(&out, "rich"), None);
        let text = serde_json::to_string(&r).unwrap();
        for n in ["229.87", "-0.52", "31.5", "51.5007", "4.9", "1240.5", "0.1"] {
            assert!(
                text.contains(&format!("\"{n}\"")),
                "{n} is a string: {text}"
            );
        }
        assert_eq!(
            out["blocks"][2]["high"], 33,
            "integral floats become integers"
        );
        assert_eq!(out["blocks"][4]["eta"], 1_760_536_200_000_i64);
        assert_eq!(
            out["blocks"][0]["series"][0]["values"],
            json!(["1.5", 2, null, "3.25"])
        );

        // Without canonicalize, validation refuses floats (the homeserver would).
        let raw: Rich = serde_json::from_str(json).unwrap();
        let e = raw.validate().unwrap_err();
        assert!(e.contains("blocks") || e.contains("chart"), "{e}");
        assert!(e.contains("decimal string"), "{e}");

        // Decimal strings and integers are numbers; other strings are not.
        let ok = r#"{"v":1,"blocks":[{"type":"ticker","symbol":"X","price":"62.99"}]}"#;
        Rich::parse(ok).unwrap();
        let bad = r#"{"v":1,"blocks":[{"type":"ticker","symbol":"X","price":"62,99"}]}"#;
        assert!(Rich::parse(bad).unwrap_err().contains("decimal string"));
        let big = r#"{"v":1,"blocks":[{"type":"weather","location":"X","temp":9007199254740993}]}"#;
        assert!(Rich::parse(big).unwrap_err().contains("outside"));
        let amt = r#"{"v":1,"blocks":[{"type":"tracker","title":"t","provider":"p","status":"s",
            "total":{"amount":"12x","currency":"PHP"}}]}"#;
        assert!(Rich::parse(amt).is_err());
    }

    #[test]
    fn seed_keys() {
        validate_seeds(&["✅".into(), "❌".into()]).unwrap();
        assert!(validate_seeds(&["✅".into(), "✅".into()]).is_err());
        assert!(validate_seeds(&[String::new()]).is_err());
        assert!(validate_seeds(&vec!["a".to_string(); 9]).is_err());
    }

    #[test]
    fn math_gallery_form_file() {
        let ok = json!({"v": 1, "blocks": [
            {"type": "math", "tex": "e^{i\\pi} + 1 = 0", "display": true, "alt": "Euler"},
            {"type": "gallery", "images": [{"url": "mxc://hs/a", "alt": "a"}, {"url": "mxc://hs/b"}]},
            {"type": "form", "id": "book", "fields": [{"id": "date", "kind": "date", "label": "When"}],
             "submit": {"label": "Book"}},
            {"type": "file", "name": "report.pdf", "size": 1234, "url": "mxc://hs/f"},
        ]});
        let r = Rich::parse(&ok.to_string()).unwrap();
        assert_eq!(serde_json::to_value(&r).unwrap(), ok);
        assert_eq!(r.find_math(), Some(("e^{i\\pi} + 1 = 0", true)));
        let inline = Rich::parse(r#"{"v":1,"blocks":[{"type":"math","tex":"x^2"}]}"#).unwrap();
        assert_eq!(
            inline.find_math(),
            Some(("x^2", true)),
            "display defaults to true"
        );
        for (bad, why) in [
            (json!({"type": "math", "tex": " "}), "\"tex\""),
            (
                json!({"type": "math", "tex": "x".repeat(MAX_TEX + 1)}),
                "at most",
            ),
            (
                json!({"type": "math", "tex": "x", "display": "yes"}),
                "display",
            ),
            (
                json!({"type": "math", "tex": "x", "caption": "a\nb"}),
                "caption",
            ),
            (json!({"type": "math", "tex": "x\u{0}"}), "NUL"),
            (
                json!({"type": "gallery", "images": [{"url": "https://x"}, {"url": "mxc://a/b"}]}),
                "mxc",
            ),
            (
                json!({"type": "gallery", "images": vec![json!({"url": "mxc://a/b"}); 21]}),
                "images",
            ),
            (
                json!({"type": "form", "id": "f", "fields": [{"label": "x"}], "submit": {"label": "Go"}}),
                "form field 1",
            ),
            (
                json!({"type": "form", "id": "f", "fields": [{"id": "x", "kind": "text", "label": "X"}]}),
                "submit",
            ),
            (json!({"type": "file", "size": 3}), "\"name\""),
        ] {
            let err = Rich::parse(&json!({"v": 1, "blocks": [bad]}).to_string()).unwrap_err();
            assert!(err.contains(why), "{why}: {err}");
        }
        let two =
            json!({"v": 1, "blocks": [{"type": "math", "tex": "a"}, {"type": "math", "tex": "b"}]});
        assert!(
            Rich::parse(&two.to_string())
                .unwrap_err()
                .contains("one math")
        );

        let r = from_args_math(&["Ok=react:👍".to_owned()], None, Some(("x^2", false)))
            .unwrap()
            .unwrap();
        assert_eq!(r.find_math(), Some(("x^2", false)));
        assert_eq!(r.blocks[1].kind(), "buttons");
        assert_eq!(r.react_keys(), vec!["👍"]);
        assert!(from_args_math(&[], Some("{}"), Some(("x", true))).is_err());
        assert!(from_args_math(&[], None, Some(("", true))).is_err());
        assert_eq!(from_args_math(&[], None, None).unwrap(), None);
    }

    #[test]
    fn stream_block() {
        let r = Rich::stream(
            "ab12",
            Some("https://s.example/stream/ab12"),
            StreamState::Live,
        );
        assert_eq!(
            serde_json::to_value(&r).unwrap(),
            json!({"v": 1, "blocks": [{"type": "stream", "id": "ab12",
                    "url": "https://s.example/stream/ab12", "state": "live"}]})
        );
        r.validate().unwrap();
        assert!(r.react_keys().is_empty());
        let done = Rich::stream("ab12", None, StreamState::Done);
        assert_eq!(
            serde_json::to_value(&done).unwrap(),
            json!({"v": 1, "blocks": [{"type": "stream", "id": "ab12", "state": "done"}]})
        );
        let back: Rich = serde_json::from_value(serde_json::to_value(&done).unwrap()).unwrap();
        assert_eq!(back, done);
        // A newer state parses but doesn't validate; so do bad ids and urls.
        let odd: Rich = serde_json::from_str(
            r#"{"v":1,"blocks":[{"type":"stream","id":"x","state":"paused"}]}"#,
        )
        .unwrap();
        assert!(odd.validate().is_err());
        assert!(
            Rich::stream("a b", None, StreamState::Live)
                .validate()
                .is_err()
        );
        assert!(
            Rich::stream("", None, StreamState::Live)
                .validate()
                .is_err()
        );
        assert!(
            Rich::stream("x", Some("http://s/stream/x"), StreamState::Live)
                .validate()
                .is_err()
        );
    }

    #[test]
    fn args_and_seeds() {
        assert_eq!(from_args(&[], None).unwrap(), None);
        let two = ["Yes=react:✅".to_owned(), "No=react:❌".to_owned()];
        let r = from_args(&two, None).unwrap().unwrap();
        assert_eq!(r.react_keys(), vec!["✅", "❌"]);
        assert!(from_args(&two, Some("{}")).is_err());
        assert!(from_args(&vec!["x=react:a".to_owned(); 9], None).is_err());
        assert!(parse_button("x=send: ").is_err());
        assert_eq!(
            parse_button("danger:Cancel=send:no: cancel it").unwrap(),
            Button::send("Cancel", Style::Danger, "no: cancel it")
        );
        let json = r#"{"v":1,"blocks":[{"type":"buttons","buttons":[{"label":"Go","action":{"type":"react","key":"🚀"}}]}]}"#;
        assert_eq!(
            from_args(&[], Some(json)).unwrap().unwrap().react_keys(),
            vec!["🚀"]
        );
        let table = r#"{"v":1,"blocks":[{"type":"table","columns":["a"],"rows":[[1]]}]}"#;
        assert!(
            from_args(&[], Some(table))
                .unwrap()
                .unwrap()
                .react_keys()
                .is_empty()
        );

        assert_eq!(seeds(Some(&r), None), vec!["✅", "❌"]);
        assert!(seeds(Some(&r), Some(&[])).is_empty());
        assert_eq!(seeds(None, Some(&["👍".to_owned()])), vec!["👍"]);
        assert_eq!(parse_seeds("✅, ❌"), vec!["✅", "❌"]);
        assert!(parse_seeds("").is_empty());
        assert!(parse_seeds("none").is_empty());
        assert_eq!(norm_key("✔\u{fe0f}"), "✔");
    }

    #[test]
    fn canonical_json_numbers() {
        let mut v = json!({"a": [1.5, 2.0, -0.61, 62.99, 1e-7, 7],
                           "b": {"c": 0.1}, "s": "1.5"});
        canonical_numbers(&mut v).unwrap();
        assert_eq!(
            v,
            json!({"a": ["1.5", 2, "-0.61", "62.99", "0.0000001", 7],
                   "b": {"c": "0.1"}, "s": "1.5"})
        );
        assert!(!has_float(&v));
        let e = canonical_numbers(&mut json!({"x": [MAX_SAFE_INT + 1]})).unwrap_err();
        assert!(e.starts_with("content.x[0]: the integer"), "{e}");
        assert!(canonical_numbers(&mut json!({"x": u64::MAX})).is_err());
        canonical_numbers(&mut json!([MAX_SAFE_INT, -MAX_SAFE_INT])).unwrap();
        // Number fields take an integer or a decimal string; a float left
        // uncoerced (validate without canonicalize) is refused, as is text.
        let w =
            |t: Value| json!({"v": 1, "blocks": [{"type": "weather", "location": "M", "temp": t}]});
        for t in [json!(31), json!("30.5"), json!(30.5)] {
            Rich::parse(&w(t.clone()).to_string()).unwrap_or_else(|e| panic!("{t}: {e}"));
        }
        let mut raw: Rich = serde_json::from_value(w(json!(30.5))).unwrap();
        let e = raw.validate().unwrap_err();
        assert!(e.contains("weather.temp") && e.contains("decimal"), "{e}");
        raw = serde_json::from_value(w(json!("warm"))).unwrap();
        assert!(raw.validate().is_err());
        let tracker = json!({"v": 1, "blocks": [{"type": "tracker", "title": "t", "provider": "p",
            "status": "s", "total": {"amount": 62.99, "currency": "PHP"}}]});
        let r = rich_from_value(tracker).unwrap();
        assert_eq!(
            serde_json::to_value(&r).unwrap()["blocks"][0]["total"]["amount"],
            "62.99"
        );
        let big = json!({"v": 1, "blocks": [{"type": "ticker", "symbol": "X", "price": u64::MAX}]});
        let e = rich_from_value(big).unwrap_err();
        assert!(e.contains("blocks[0].price"), "{e}");
    }

    /// The demo payloads (`tests/fixtures/rich/NN-*.json`, one per block
    /// family of the catalogue) validate, with their `body` fallback text
    /// beside them.
    #[test]
    fn catalogue_fixtures() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/rich");
        let mut n = 0;
        let mut kinds = std::collections::BTreeSet::new();
        for e in std::fs::read_dir(dir).unwrap() {
            let path = e.unwrap().path();
            if path.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let json = std::fs::read_to_string(&path).unwrap();
            let r = Rich::parse(&json).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            // Float-free (canonical JSON), as a message and as an edit.
            let sent = serde_json::to_value(&r).unwrap();
            let edit = json!({"body": "x", RICH_KEY: sent,
                              "m.new_content": {"body": "x", RICH_KEY: sent}});
            assert!(!has_float(&edit), "{}: {edit}", path.display());
            kinds.extend(r.blocks.iter().map(|b| b.kind().to_owned()));
            n += 1;
        }
        assert!(n >= 9, "{n} fixtures");
        // The two Synapse refused with M_BAD_JSON "float": decimal strings now.
        let read = |f: &str| {
            let j = std::fs::read_to_string(format!("{dir}/{f}")).unwrap();
            serde_json::to_value(Rich::parse(&j).unwrap()).unwrap()
        };
        let chart = read("03-chart-sources.json");
        assert_eq!(chart["blocks"][0]["series"][0]["values"][0], "-0.61");
        assert_eq!(chart["blocks"][0]["series"][0]["values"][1], "-0.6");
        let tw = read("09-ticker-weather.json");
        assert_eq!(tw["blocks"][0]["price"], "0.53396");
        assert_eq!(tw["blocks"][0]["change"], "0.0038");
        assert_eq!(tw["blocks"][1]["temp"], 29);
        for t in ["buttons", "chips"]
            .into_iter()
            .chain(DISPLAY_TYPES.iter().map(|(t, _)| *t))
            .filter(|t| *t != "stream")
        {
            assert!(kinds.contains(t), "no fixture has a {t} block");
        }
    }

    #[test]
    fn read_any_key() {
        let r = Rich::buttons(vec![Button::react("Ok", Style::Default, "👍")]);
        let v = serde_json::to_value(&r).unwrap();
        for key in RICH_KEYS {
            let mut c = Map::new();
            c.insert("body".into(), "x".into());
            c.insert((*key).into(), v.clone());
            assert_eq!(read_rich(&c).as_ref(), Some(&r), "{key}");
            assert_eq!(rich_value(&c).map(|(k, _)| k), Some(*key));
        }
        // The newest key present wins; a broken newer one falls through.
        let other = Rich::buttons(vec![Button::react("New", Style::Default, "🆕")]);
        let mut c = Map::new();
        c.insert(RICH_KEY.into(), v.clone());
        c.insert(RICH_KEY_NEW.into(), serde_json::to_value(&other).unwrap());
        assert_eq!(read_rich(&c), Some(other));
        c.insert(RICH_KEY_NEW.into(), json!("garbage"));
        assert_eq!(read_rich(&c), Some(r));
        assert_eq!(read_rich(&Map::new()), None);

        for (i, key) in USED_KEYS.iter().enumerate() {
            let mut c = Map::new();
            c.insert((*key).into(), json!({"id": format!("b{i}")}));
            assert_eq!(read_used(&c), Some(&json!({"id": format!("b{i}")})));
        }
        for key in ALBUM_KEYS {
            let mut c = Map::new();
            c.insert((*key).into(), json!({"n": 2}));
            assert_eq!(read_album(&c), Some(&json!({"n": 2})));
        }
        // The key sets line up: `<rich key>.used`, `<rich key>.album`.
        for (i, k) in RICH_KEYS.iter().enumerate() {
            assert_eq!(USED_KEYS[i], format!("{k}.used"));
            assert_eq!(ALBUM_KEYS[i], format!("{k}.album"));
        }
    }

    #[test]
    fn write_chosen_key() {
        // Today's behaviour: the default writes com.ianm.mtrix.
        assert_eq!(WriteKey::default(), WriteKey::Legacy);
        assert_eq!(WriteKey::default().rich_key(), "com.ianm.mtrix");
        assert_eq!(WriteKey::default().used_key(), "com.ianm.mtrix.used");
        assert_eq!(WriteKey::default().album_key(), "com.ianm.mtrix.album");
        assert_eq!(WriteKey::New.rich_key(), "com.talaagent.mxblocks");
        assert_eq!(WriteKey::New.used_key(), "com.talaagent.mxblocks.used");
        assert_eq!(WriteKey::New.album_key(), "com.talaagent.mxblocks.album");
        assert_eq!(serde_json::to_value(WriteKey::New).unwrap(), json!("new"));
        assert_eq!(
            serde_json::from_value::<WriteKey>(json!("legacy")).unwrap(),
            WriteKey::Legacy
        );

        let r = Rich::buttons(vec![Button::react("Ok", Style::Default, "👍")]);
        for wk in [WriteKey::Legacy, WriteKey::New] {
            // An edit of a message that had the payload under the other keys.
            let mut c = Map::new();
            for k in RICH_KEYS {
                c.insert((*k).into(), json!({"v": 1, "blocks": []}));
            }
            wk.write_rich(&mut c, &r);
            let keys: Vec<&str> = RICH_KEYS
                .iter()
                .copied()
                .filter(|k| c.contains_key(*k))
                .collect();
            assert_eq!(keys, vec![wk.rich_key()]);
            assert_eq!(read_rich(&c), Some(r.clone()));

            let mut c = Map::new();
            c.insert(USED_KEYS[0].into(), json!(1));
            wk.write_used(&mut c, json!({"id": "x"}));
            assert_eq!(c.len(), 1);
            assert_eq!(c[&wk.used_key()], json!({"id": "x"}));

            let mut c = Map::new();
            wk.write_album(&mut c, json!({"n": 3}));
            assert_eq!(read_album(&c), Some(&json!({"n": 3})));
            assert!(c.contains_key(&wk.album_key()));
        }
        let mut c = Map::new();
        c.insert(RICH_KEY_NEW.into(), json!({}));
        assert!(strip_rich(&mut c));
        assert!(!strip_rich(&mut c));
    }
}
