//! The `rich_send` / `rich_edit` tools for an LLM agent that posts mxblocks
//! messages: one definition (names, descriptions, input schemas:
//! [`tool_specs`]) and one argument check ([`plan`]), for whatever tools
//! server the agent runs (MCP or a native tool API). Sending is the
//! caller's: [`plan`] gives the checked payload, text and targets.
//!
//! Payloads are checked by [`mxblocks`] (the v1 catalogue); floats become
//! decimal strings, since Matrix refuses JSON floats.

#![doc = include_str!("../README.md")]
#![warn(missing_docs)]

use serde_json::{Map, Value, json};

use mxblocks::Rich;

/// `rich_send`'s name.
pub const RICH_SEND: &str = "rich_send";
/// `rich_edit`'s name.
pub const RICH_EDIT: &str = "rich_edit";
/// Longest `fallback`, in characters (like `say`'s text).
pub const MAX_FALLBACK: usize = 20000;
/// Longest `room` argument.
pub const MAX_ROOM: usize = 300;

/// Which blocks to use for what: shared by the tool description and the
/// prompts.
pub const BLOCK_GUIDE: &str = "Pick the block for the answer: weather for weather questions; \
table for comparing options or listing rows; place for one venue or address; event for a \
date/time thing (meeting, flight, booking); countdown for a deadline; chart for a trend or \
numbers over time; card/cards for one or a few products, listings or orders; sources for \
links you used; code/diff for code; progress for multi-step work; details for long \
optional text; ticker for prices; tracker for live order/ride/parcel status (send it once \
with rich_send, then rich_edit it as the status changes, about every 30-60 s, ending with \
state done); math for equations; gallery for 2+ images (mxc); file for one upload; form \
for several choices at once; buttons/chips for a quick decision or quick replies. Numbers \
are whole numbers or decimal strings (\"price\":\"62.99\"): Matrix refuses JSON floats, so a \
float is sent as its decimal string.";

/// A minimal `rich_send` example (weather).
pub const WEATHER_EXAMPLE: &str = r#"{"payload":{"v":1,"blocks":[{"type":"weather","location":"Lisbon","temp":24,"unit":"C","condition":"Partly cloudy","high":26,"low":17}]},"fallback":"Lisbon: 24°C, partly cloudy (26/17)."}"#;

/// The prompt line of the tools for a sandboxed context (a served user's
/// DM, a multi-user room), where they post in this chat.
pub fn prompt_line() -> String {
    format!(
        "- rich_send, rich_edit: rich messages as you in this chat: blocks that Element Web \
         draws (table, weather, place, event, chart, tracker, …) plus a `fallback` text that \
         carries everything for other clients (Element on phones shows only the text). Use them \
         instead of a plain answer when structure helps; then end your turn with `[no reply]` \
         unless there's more to say. {BLOCK_GUIDE} rich_send returns the new message's event id; \
         rich_edit replaces that message (only your own, at most one edit every 2.5 s). \
         Example rich_send: {WEATHER_EXAMPLE}"
    )
}

/// One tool: name, description, input schema.
#[derive(Debug, Clone)]
pub struct ToolSpec {
    /// The tool's name.
    pub name: &'static str,
    /// What it does, for the model.
    pub description: String,
    /// Its input's JSON Schema.
    pub schema: Value,
}

/// The two tools. `rooms`: what `room` may name in this context (shown in
/// its description).
pub fn tool_specs(rooms: &str) -> Vec<ToolSpec> {
    let payload = json!({"type": "object", "description":
        "the mxblocks payload: {\"v\":1,\"blocks\":[…]} (up to 8 blocks; the mxblocks v1 \
         catalogue, validated before sending)"});
    let fallback = json!({"type": "string", "description":
        "the message text (CommonMark, rendered like a normal message): it must carry \
         everything, since only Element Web draws the blocks"});
    let room = json!({"type": "string", "description": format!(
        "where to post (default: this chat). {rooms}")});
    let event = |d: &str| json!({"type": "string", "description": d});
    vec![
        ToolSpec {
            name: RICH_SEND,
            description: format!(
                "Send a rich message as you: blocks (tables, weather, places, events, charts, \
                 trackers, …) drawn by Element Web, with a text fallback for everything else. \
                 Returns the new message's event id (keep it to rich_edit it later). {BLOCK_GUIDE} \
                 Example: {WEATHER_EXAMPLE}"
            ),
            schema: json!({"type": "object", "properties": {
                "payload": payload, "fallback": fallback,
                "reply_to": event("reply to this event id ($…), optional"),
                "thread": event("post it in this thread (its root event id $…), optional"),
                "room": room}, "required": ["payload", "fallback"],
                "additionalProperties": false}),
        },
        ToolSpec {
            name: RICH_EDIT,
            description: "Replace one of your own earlier messages in place (an m.replace with \
                          the new blocks and text; pings nobody). Only your own messages, at \
                          most one edit per message every 2.5 s (a faster edit waits); a typical \
                          live update is every 30-60 s."
                .to_owned(),
            schema: json!({"type": "object", "properties": {
                "event_id": event("the message to replace ($…, the one rich_send returned)"),
                "payload": payload, "fallback": fallback, "room": room},
                "required": ["event_id", "payload", "fallback"],
                "additionalProperties": false}),
        },
    ]
}

/// A checked call.
#[derive(Debug, Clone, PartialEq)]
pub struct RichCall {
    /// The checked payload (canonical numbers).
    pub payload: Rich,
    /// The message text (Markdown).
    pub fallback: String,
    /// `rich_send`: reply to this event.
    pub reply_to: Option<String>,
    /// `rich_send`: in this thread (its root event id).
    pub thread: Option<String>,
    /// `rich_edit`: the message replaced.
    pub edit: Option<String>,
    /// As named by the caller (`dm`, a room id, …); `None`: this chat.
    pub room: Option<String>,
}

/// An event id as the tools take it: `$`, then 1 to 254 non-space
/// characters.
pub fn valid_event_id(s: &str) -> bool {
    s.len() <= 255
        && s.strip_prefix('$')
            .is_some_and(|r| !r.is_empty() && !r.chars().any(char::is_whitespace))
}

fn event_arg(a: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    match a.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if valid_event_id(s.trim()) => Ok(Some(s.trim().to_owned())),
        Some(_) => Err(format!("`{key}` must be an event id ($…)")),
    }
}

/// Whether `name` is one of these tools.
pub fn is_rich_tool(name: &str) -> bool {
    name == RICH_SEND || name == RICH_EDIT
}

/// Check a call's arguments.
///
/// # Errors
/// What's wrong, for the caller.
pub fn plan(name: &str, args: &Value) -> Result<RichCall, String> {
    let empty = Map::new();
    let a = match args {
        Value::Object(m) => m,
        Value::Null => &empty,
        _ => return Err("arguments must be an object".into()),
    };
    let edit = match name {
        RICH_SEND => false,
        RICH_EDIT => true,
        _ => return Err(format!("no tool `{name}`")),
    };
    let keys: &[&str] = if edit {
        &["event_id", "payload", "fallback", "room"]
    } else {
        &["payload", "fallback", "reply_to", "thread", "room"]
    };
    if let Some(k) = a.keys().find(|k| !keys.contains(&k.as_str())) {
        return Err(format!(
            "unknown argument `{}`",
            k.chars().take(40).collect::<String>()
        ));
    }
    let payload = match a.get("payload") {
        Some(Value::String(s)) => Rich::parse(s)?,
        Some(v @ Value::Object(_)) => Rich::parse(&v.to_string())?,
        _ => return Err("`payload` (a {\"v\":1,\"blocks\":[…]} object) is required".into()),
    };
    let fallback = a
        .get("fallback")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if fallback.is_empty() && payload.find_math().is_none() {
        return Err("`fallback` (the message text) is required".into());
    }
    if fallback.chars().count() > MAX_FALLBACK {
        return Err(format!("`fallback` has at most {MAX_FALLBACK} characters"));
    }
    let room = match a.get("room") {
        None | Some(Value::Null) => None,
        Some(Value::String(s))
            if !s.trim().is_empty() && s.len() <= MAX_ROOM && !s.contains(['\n', '\t']) =>
        {
            Some(s.trim().to_owned())
        }
        Some(_) => return Err("`room` is one line naming a room".into()),
    };
    let (reply_to, thread, edit) = if edit {
        let e = event_arg(a, "event_id")?.ok_or("`event_id` ($…) is required")?;
        (None, None, Some(e))
    } else {
        (event_arg(a, "reply_to")?, event_arg(a, "thread")?, None)
    };
    Ok(RichCall {
        payload,
        fallback: fallback.to_owned(),
        reply_to,
        thread,
        edit,
        room,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn specs() {
        let t = tool_specs("`dm` or a session room id.");
        assert_eq!(
            t.iter().map(|t| t.name).collect::<Vec<_>>(),
            [RICH_SEND, RICH_EDIT]
        );
        assert!(t[0].description.contains("weather for weather"));
        assert!(
            t[0].schema["properties"]["room"]["description"]
                .as_str()
                .unwrap()
                .contains("`dm`")
        );
        // The example is a valid call.
        let ex: Value = serde_json::from_str(WEATHER_EXAMPLE).unwrap();
        plan(RICH_SEND, &ex).unwrap();
    }

    #[test]
    fn floats_become_decimal_strings() {
        // Synapse refuses floats (M_BAD_JSON): the tools send them as strings.
        let p = json!({"v": 1, "blocks": [{"type": "ticker", "symbol": "PHP/THB",
            "price": 0.53396, "change": 0.0038, "series": [0.53, 1.0]}]});
        for args in [
            json!({"payload": p, "fallback": "x"}),
            json!({"payload": p.to_string(), "fallback": "x"}),
        ] {
            let c = plan(RICH_SEND, &args).unwrap();
            let v = serde_json::to_value(&c.payload).unwrap();
            assert!(!mxblocks::has_float(&v), "{v}");
            assert_eq!(v["blocks"][0]["price"], "0.53396");
            assert_eq!(v["blocks"][0]["series"], json!(["0.53", 1]));
        }
        let big = json!({"v": 1, "blocks": [{"type": "ticker", "symbol": "X",
            "price": 9_007_199_254_740_993_u64}]});
        let e = plan(RICH_SEND, &json!({"payload": big, "fallback": "x"})).unwrap_err();
        assert!(e.contains("blocks[0].price"), "{e}");
    }

    #[test]
    fn calls() {
        let p = json!({"v": 1, "blocks": [{"type": "table", "columns": ["a"], "rows": [["1"]]}]});
        let c = plan(RICH_SEND, &json!({"payload": p, "fallback": " a: 1 "})).unwrap();
        assert_eq!(c.fallback, "a: 1");
        assert_eq!((c.reply_to, c.edit, c.room), (None, None, None));
        // A JSON string payload works too.
        let c = plan(
            RICH_SEND,
            &json!({"payload": p.to_string(), "fallback": "x", "reply_to": "$r", "room": "dm"}),
        )
        .unwrap();
        assert_eq!(c.reply_to.as_deref(), Some("$r"));
        assert_eq!(c.room.as_deref(), Some("dm"));
        let c = plan(
            RICH_SEND,
            &json!({"payload": p.to_string(), "fallback": "x", "thread": "$t"}),
        )
        .unwrap();
        assert_eq!(c.thread.as_deref(), Some("$t"));
        assert_eq!(c.room, None);
        let c = plan(
            RICH_EDIT,
            &json!({"event_id": "$e", "payload": p, "fallback": "x"}),
        )
        .unwrap();
        assert_eq!(c.edit.as_deref(), Some("$e"));
        // Math needs no fallback.
        let m = json!({"v": 1, "blocks": [{"type": "math", "tex": "x^2"}]});
        assert!(plan(RICH_SEND, &json!({"payload": m})).is_ok());

        for (name, args, why) in [
            (RICH_SEND, json!({"fallback": "x"}), "payload"),
            (RICH_SEND, json!({"payload": p}), "fallback"),
            (
                RICH_SEND,
                json!({"payload": p, "fallback": "x", "event_id": "$e"}),
                "unknown",
            ),
            (
                RICH_EDIT,
                json!({"payload": p, "fallback": "x"}),
                "event_id",
            ),
            (
                RICH_EDIT,
                json!({"event_id": "e", "payload": p, "fallback": "x"}),
                "event id",
            ),
            (
                RICH_SEND,
                json!({"payload": p, "fallback": "x", "reply_to": "$ x"}),
                "event id",
            ),
            (
                RICH_SEND,
                json!({"payload": p, "fallback": "x", "room": "a\nb"}),
                "room",
            ),
            (
                RICH_SEND,
                json!({"payload": {"v": 1, "blocks": [{"type": "weather"}]}, "fallback": "x"}),
                "weather",
            ),
            (
                RICH_SEND,
                json!({"payload": p, "fallback": "x".repeat(MAX_FALLBACK + 1)}),
                "at most",
            ),
            ("rich_other", json!({}), "no tool"),
        ] {
            let e = plan(name, &args).unwrap_err();
            assert!(e.contains(why), "{why}: {e}");
        }
        assert!(plan(RICH_SEND, &json!([1])).is_err());
    }
}
