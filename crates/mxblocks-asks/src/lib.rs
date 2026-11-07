//! Reaction asks in a bot's plain-text reply: a paragraph that asks the
//! reader to react gets those reactions seeded (and mxblocks buttons), so on
//! a phone they tap one instead of hunting for the emoji, and the tap can be
//! handled like a button press.
//!
//! - **The marker.** `[ask: ✅ deploy | ❌ skip]` (2 to 4 options, an emoji
//!   and a short label each) anywhere in a paragraph: that paragraph goes
//!   as its own message, the marker replaced by `✅ deploy · ❌ skip`, with a
//!   buttons block and the keys seeded. A label over [`MAX_LABEL`] is
//!   shortened on its button, kept whole in the text. A marker that still
//!   doesn't parse is never posted raw: it becomes its options joined
//!   with ` · `.
//! - **The safety net.** Without a marker, only the end of the reply's last
//!   paragraph, only strict shapes: `✅ to deploy, ❌ to skip` (two or three,
//!   buttons too), `react ✅`, `👍/👎?` and `👍 or 👎` (seeds only). A last
//!   paragraph that is only the marker's rendered form (`✅ deploy · ❌
//!   skip`, written instead of the marker) stays text: [`rendered_only`]
//!   lets the sender log it. A press note can quote the ask in marker form
//!   ([`Ask::marker`], [`Ask::quoted`]), so the model never sees the
//!   rendered form as its own.
//!
//! Pure: [`plan`] says what each message carries; the sender seeds the
//! reactions and registers the buttons.

#![doc = include_str!("../README.md")]
#![warn(missing_docs)]

use std::sync::LazyLock;

use mxblocks::{Button, MAX_LABEL, Rich, Style, norm_key};
use regex::Regex;

/// One emoji (with its variation selector, skin tone, ZWJ sequence), or a
/// keycap.
const EMO: &str = r"(?:\p{Extended_Pictographic}|[#*0-9]\x{FE0F}?\x{20E3})(?:\x{FE0F}|\p{Emoji_Modifier})*(?:\x{200D}\p{Extended_Pictographic}(?:\x{FE0F}|\p{Emoji_Modifier})*)*";

fn re(p: &str) -> Regex {
    Regex::new(&p.replace("EMO", EMO)).unwrap_or_else(|e| panic!("reaction_asks regex: {e}"))
}

static EMO_RE: LazyLock<Regex> = LazyLock::new(|| re("EMO"));
/// A code fence: up to 3 spaces, then 3+ backticks or tildes.
static FENCE_RE: LazyLock<Regex> = LazyLock::new(|| re(r"^\s{0,3}(`{3,}|~{3,})(.*)$"));
static MARKER_RE: LazyLock<Regex> = LazyLock::new(|| re(r"\[ask:\s*([^\]\n]+)\]"));
static OPTION_RE: LazyLock<Regex> = LazyLock::new(|| re(r"^(EMO)\s*(.*)$"));
/// `✅ to deploy, ❌ to skip` (or `/`, `;`, `·`, `|`, `or`), two or three,
/// at the end of the line.
static TO_RE: LazyLock<Regex> = LazyLock::new(|| {
    let item = r"EMO\s+to\s+[^,;·|/\n\p{Extended_Pictographic}]{1,60}?";
    let sep = r"(?:\s*[,;·|/]\s*(?:or\s+)?|\s+or\s+)";
    re(&format!(r"{item}{sep}{item}(?:{sep}{item})?[\s.!?)]*$"))
});
/// `✅ merge #5366 · ⏸ hold`: the marker's rendered form, a whole line
/// ([`rendered_only`]).
static RENDERED_RE: LazyLock<Regex> = LazyLock::new(|| {
    let item = r"EMO\s*[^·|\n\p{Extended_Pictographic}]{1,80}?";
    re(&format!(r"^\s*{item}(?:\s+·\s+{item}){{1,3}}\s*$"))
});
/// `react ✅`, `react with 👍 or 👎`.
static REACT_RE: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)\breact(?:\s+with)?\s+(EMO(?:\s*(?:/|,|or)\s*EMO){0,3})[\s.!?)]*$"));
/// `👍/👎?`, `👍 or 👎`.
static PAIR_RE: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?:^|[\s(:—–-])(EMO\s*(?:/|or)\s*EMO(?:\s*(?:/|or)\s*EMO)?)\s*\??[\s.!)]*$")
});

/// One option: the reaction key and its label (empty: the key alone).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opt {
    /// The reaction key (an emoji).
    pub key: String,
    /// Its label; empty: the key alone.
    pub label: String,
}

/// A message's ask: its options, and whether Element shows them as
/// buttons (the seeds go either way).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ask {
    /// The options, in order.
    pub opts: Vec<Opt>,
    /// Whether the message shows them as buttons.
    pub buttons: bool,
}

impl Ask {
    /// The reactions to seed, in order.
    pub fn seeds(&self) -> Vec<String> {
        self.opts.iter().map(|o| o.key.clone()).collect()
    }

    /// The buttons block (each label, shortened to [`MAX_LABEL`], or its
    /// key without one): what is registered for presses, and shown with
    /// [`Self::buttons`].
    pub fn rich(&self) -> Rich {
        Rich::buttons(
            self.opts
                .iter()
                .map(|o| {
                    let label = if o.label.is_empty() {
                        o.key.clone()
                    } else {
                        short(&o.label)
                    };
                    Button::react(&label, Style::Default, &o.key)
                })
                .collect(),
        )
    }

    /// The block to put on the message, if it shows buttons.
    pub fn shown(&self) -> Option<Rich> {
        self.buttons.then(|| self.rich())
    }

    /// The marker itself: `[ask: ✅ deploy | ❌ skip]`.
    pub fn marker(&self) -> String {
        let opts: Vec<String> = self
            .opts
            .iter()
            .map(|o| format!("{} {}", o.key, o.label).trim().to_owned())
            .collect();
        format!("[ask: {}]", opts.join(" | "))
    }

    /// `text` (the message this ask went out in) with its fallback back in
    /// marker form: what a press note quotes.
    pub fn quoted(&self, text: &str) -> String {
        text.replacen(&self.fallback(), &self.marker(), 1)
    }

    /// The plain-text stand-in for the marker: `✅ deploy · ❌ skip`.
    pub fn fallback(&self) -> String {
        self.opts
            .iter()
            .map(|o| format!("{} {}", o.key, o.label).trim().to_owned())
            .collect::<Vec<_>>()
            .join(" · ")
    }
}

/// `label` cut to [`MAX_LABEL`] characters for a button: at a word
/// boundary when there is one, ending in `…`.
fn short(label: &str) -> String {
    if label.chars().count() <= MAX_LABEL {
        return label.to_owned();
    }
    let head: String = label.chars().take(MAX_LABEL - 1).collect();
    let cut = match head.rfind(char::is_whitespace) {
        Some(i) if head[..i].trim_end().chars().count() >= MAX_LABEL / 2 => &head[..i],
        _ => &head,
    };
    let cut = cut.trim_end_matches(|c: char| c.is_whitespace() || ",;:·-–—|/".contains(c));
    format!("{cut}…")
}

/// 1 to 4 options with distinct keys, else `None`.
fn ask_of(opts: Vec<Opt>, min: usize, buttons: bool) -> Option<Ask> {
    if opts.len() < min || opts.len() > 4 {
        return None;
    }
    let mut keys: Vec<String> = opts.iter().map(|o| norm_key(&o.key)).collect();
    keys.sort();
    keys.dedup();
    (keys.len() == opts.len()).then_some(Ask { opts, buttons })
}

/// A marker's inside (`✅ deploy | ❌ skip`).
fn parse_marker(inner: &str) -> Option<Ask> {
    let opts = inner
        .split('|')
        .map(|o| {
            let c = OPTION_RE.captures(o.trim())?;
            let label = c[2].trim();
            (!label.is_empty()).then(|| Opt {
                key: c[1].to_owned(),
                label: label.to_owned(),
            })
        })
        .collect::<Option<Vec<_>>>()?;
    ask_of(opts, 2, true)
}

/// Lines of `text` outside fenced code blocks, as byte ranges.
fn prose_lines(text: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut fence = false;
    let mut at = 0;
    for line in text.split('\n') {
        let start = at;
        at += line.len() + 1;
        if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") {
            fence = !fence;
            continue;
        }
        if !fence {
            out.push((start, line));
        }
    }
    out
}

/// The first valid marker in `para` outside code: the paragraph with it
/// replaced by its fallback, and the ask.
pub fn take_marker(para: &str) -> Option<(String, Ask)> {
    for (start, line) in prose_lines(para) {
        for m in MARKER_RE.captures_iter(line) {
            let all = m.get(0)?;
            // Inside inline code: left alone.
            if line[..all.start()].matches('`').count() % 2 == 1 {
                continue;
            }
            let Some(ask) = parse_marker(&m[1]) else {
                continue;
            };
            let (a, b) = (start + all.start(), start + all.end());
            let text = format!("{}{}{}", &para[..a], ask.fallback(), &para[b..]);
            return Some((text.trim().to_owned(), ask));
        }
    }
    None
}

/// `text` with every marker outside code that [`take_marker`] left (one
/// that doesn't parse, or a second one in a paragraph) made readable: its
/// options joined with ` · `, without the brackets and `ask:`.
pub fn plain_markers(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    for (start, line) in prose_lines(text) {
        for m in MARKER_RE.captures_iter(line) {
            let Some(all) = m.get(0) else { continue };
            if line[..all.start()].matches('`').count() % 2 == 1 {
                continue;
            }
            let plain = m[1]
                .split('|')
                .map(str::trim)
                .filter(|o| !o.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            out.push_str(&text[at..start + all.start()]);
            out.push_str(&plain);
            at = start + all.end();
        }
    }
    out.push_str(&text[at..]);
    out
}

/// `s` without trailing separators, `or` and closing punctuation.
fn label_end(s: &str) -> String {
    let trim = |s: &str| {
        s.trim_end_matches(|c: char| c.is_whitespace() || ",;·|/.!?)".contains(c))
            .to_owned()
    };
    let mut s = trim(s);
    if let Some(r) = s.strip_suffix(" or") {
        s = trim(r);
    }
    s
}

/// The safety net: an ask in one of the strict shapes at the very end of
/// `text` (a reply's last paragraph), outside code.
pub fn detect(text: &str) -> Option<Ask> {
    let text = text.trim_end();
    let (_, line) = *prose_lines(text).last()?;
    // The paragraph's last line, not one inside or closing a code block.
    if !text.ends_with(line) || line.contains('`') {
        return None;
    }
    if let Some(m) = TO_RE.find(line) {
        let span = m.as_str();
        let emos: Vec<_> = EMO_RE.find_iter(span).collect();
        let opts = emos
            .iter()
            .enumerate()
            .map(|(i, e)| {
                let end = emos.get(i + 1).map_or(span.len(), regex::Match::start);
                let rest = span[e.end()..end].trim_start();
                let label = label_end(rest.strip_prefix("to")?.trim_start());
                (!label.is_empty()).then(|| Opt {
                    key: e.as_str().to_owned(),
                    label,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        return ask_of(opts, 2, true);
    }
    let keys = |s: &str| -> Vec<Opt> {
        EMO_RE
            .find_iter(s)
            .map(|e| Opt {
                key: e.as_str().to_owned(),
                label: String::new(),
            })
            .collect()
    };
    if let Some(c) = REACT_RE.captures(line) {
        return ask_of(keys(&c[1]), 1, false);
    }
    if let Some(c) = PAIR_RE.captures(line) {
        let g = c.get(1)?;
        // A question, or the pair alone on its line.
        if line.contains('?') || line[..g.start()].trim().is_empty() {
            return ask_of(keys(g.as_str()), 2, false);
        }
    }
    None
}

/// Whether `text`'s last paragraph is only the marker's rendered form
/// (`✅ deploy · ❌ skip`, two to four options, distinct keys): an ask
/// written without its marker, which goes out as text.
pub fn rendered_only(text: &str) -> bool {
    let text = text.trim_end();
    let Some(&(_, line)) = prose_lines(text).last() else {
        return false;
    };
    let before = text[..text.len() - line.len()].trim_end_matches([' ', '\t']);
    (before.is_empty() || before.ends_with("\n\n"))
        && text.ends_with(line)
        && RENDERED_RE.is_match(line)
        && parse_marker(&line.replace('·', "|")).is_some()
}

/// `text`'s paragraphs (blank-line separated) of Markdown; a fenced code
/// block stays in one piece even with blank lines inside.
pub fn paragraphs(text: &str) -> Vec<String> {
    let mut blocks: Vec<Vec<&str>> = Vec::new();
    let mut cur: Vec<&str> = Vec::new();
    let mut fence: Option<String> = None;
    for line in text.split('\n') {
        if fence.is_none() && line.trim().is_empty() {
            if !cur.is_empty() {
                blocks.push(core::mem::take(&mut cur));
            }
            continue;
        }
        cur.push(line);
        if let Some(m) = FENCE_RE.captures(line) {
            match &fence {
                None => fence = Some(m[1].to_owned()),
                Some(f) if m[1].starts_with(f.as_str()) && m[2].trim().is_empty() => fence = None,
                _ => {}
            }
        }
    }
    if !cur.is_empty() {
        blocks.push(cur);
    }
    blocks.into_iter().map(|b| b.join("\n")).collect()
}

/// What each message of a reply carries: the parts (each with the
/// caller's per-message data `M`: a reply target, a thread, ...) with every
/// paragraph ([`paragraphs`]) that has a marker split off as its own
/// message (the marker replaced by its fallback), each with its ask;
/// without any marker, the last one's ask by [`detect`]. A split part's
/// `M` goes on its first message, the rest get `M::default()`.
pub fn plan<M: Default>(parts: Vec<(M, String)>) -> Vec<(M, String, Option<Ask>)> {
    plan_with(parts, paragraphs)
}

/// [`plan`] with the caller's paragraph splitter.
pub fn plan_with<M: Default>(
    parts: Vec<(M, String)>,
    split: impl Fn(&str) -> Vec<String>,
) -> Vec<(M, String, Option<Ask>)> {
    let mut out: Vec<(M, String, Option<Ask>)> = Vec::new();
    for (marks, part) in parts {
        let blocks = split(&part);
        if blocks.len() < 2 || !blocks.iter().any(|b| take_marker(b).is_some()) {
            let (text, ask) = take_marker(&part).map_or((part, None), |(t, a)| (t, Some(a)));
            out.push((marks, text, ask));
            continue;
        }
        let mut marks = Some(marks);
        let mut run: Vec<String> = Vec::new();
        let flush = |run: &mut Vec<String>, out: &mut Vec<_>, marks: &mut Option<M>| {
            if !run.is_empty() {
                out.push((marks.take().unwrap_or_default(), run.join("\n\n"), None));
                run.clear();
            }
        };
        for b in blocks {
            match take_marker(&b) {
                Some((text, ask)) => {
                    flush(&mut run, &mut out, &mut marks);
                    out.push((marks.take().unwrap_or_default(), text, Some(ask)));
                }
                None => run.push(b),
            }
        }
        flush(&mut run, &mut out, &mut marks);
    }
    for (_, text, _) in &mut out {
        if text.contains("[ask:") {
            *text = plain_markers(text);
        }
    }
    if out.iter().all(|(_, _, a)| a.is_none())
        && let Some(last) = out.last_mut()
    {
        last.2 = detect(&last.1);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A caller's per-message data.
    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    struct Marks {
        reply: Option<String>,
    }

    fn keys(a: &Ask) -> Vec<(&str, &str)> {
        a.opts
            .iter()
            .map(|o| (o.key.as_str(), o.label.as_str()))
            .collect()
    }

    #[test]
    fn markers() {
        let (t, a) = take_marker("v2 is staged. Deploy? [ask: ✅ deploy | ❌ skip]").unwrap();
        assert_eq!(t, "v2 is staged. Deploy? ✅ deploy · ❌ skip");
        assert_eq!(keys(&a), [("✅", "deploy"), ("❌", "skip")]);
        assert!(a.buttons);
        assert_eq!(a.seeds(), ["✅", "❌"]);
        let r = serde_json::to_value(a.rich()).unwrap();
        assert_eq!(r["blocks"][0]["buttons"][1]["label"], "skip");
        assert_eq!(r["blocks"][0]["buttons"][1]["action"]["key"], "❌");
        // Four, with presentation selectors and a ZWJ sequence.
        let (_, a) =
            take_marker("[ask:👍🏽 yes|❤\u{fe0f} love it | 🧑‍💻 later | 1\u{fe0f}\u{20e3} one]")
                .unwrap();
        assert_eq!(a.opts.len(), 4);
        assert_eq!(a.opts[2].key, "🧑‍💻");
        // Too few, too many, no label, duplicate keys, not an emoji: left as is.
        for bad in [
            "[ask: ✅ deploy]",
            "[ask: ✅ a | ❌ b | 👍 c | 👎 d | 🕐 e]",
            "[ask: ✅ | ❌ skip]",
            "[ask: ✅ a | ✅\u{fe0f} b]",
            "[ask: yes deploy | no skip]",
            "`[ask: ✅ deploy | ❌ skip]` is the marker",
            "```\n[ask: ✅ deploy | ❌ skip]\n```",
        ] {
            assert!(take_marker(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn long_labels() {
        let labels = |a: &Ask| -> Vec<String> {
            let r = serde_json::to_value(a.rich()).unwrap();
            r["blocks"][0]["buttons"]
                .as_array()
                .unwrap()
                .iter()
                .map(|b| b["label"].as_str().unwrap().to_owned())
                .collect()
        };
        // A 47-character label: a button as is.
        let msg = "[ask: ✅ keep the old schema, migrate the rows next week | 🔀 do the full schema migration right now | ❌ hold]";
        let (t, a) = take_marker(msg).unwrap();
        assert_eq!(
            t,
            "✅ keep the old schema, migrate the rows next week · 🔀 do the full schema migration right now · ❌ hold"
        );
        assert_eq!(a.seeds(), ["✅", "🔀", "❌"]);
        assert!(a.buttons);
        assert_eq!(
            labels(&a),
            [
                "keep the old schema, migrate the rows next week",
                "do the full schema migration right now",
                "hold"
            ]
        );
        a.rich().validate().unwrap();
        // Over MAX_LABEL: shortened on its button at a word, whole in the text.
        let long = "ship the whole thing now, ".repeat(5) + "then tell the team";
        assert!(long.chars().count() > MAX_LABEL);
        let (t, a) = take_marker(&format!("Go? [ask: ✅ {long} | ❌ hold]")).unwrap();
        assert_eq!(t, format!("Go? ✅ {long} · ❌ hold"));
        let b = &labels(&a)[0];
        assert!(b.ends_with(" whole…"), "{b}");
        assert!(b.chars().count() <= MAX_LABEL);
        assert!(long.starts_with(b.trim_end_matches('…')));
        a.rich().validate().unwrap();
        // No space to cut at: cut mid-word.
        assert_eq!(
            short(&"x".repeat(MAX_LABEL + 10)),
            format!("{}…", "x".repeat(MAX_LABEL - 1))
        );
        assert_eq!(short("fits"), "fits");
    }

    #[test]
    fn unparsed_markers_are_plain() {
        let p = |t: &str| plan(vec![(Marks::default(), t.to_owned())]);
        let five = p("Pick: [ask: ✅ a | ❌ b | 👍 c | 👎 d | 🕐 e]");
        assert_eq!(five[0].1, "Pick: ✅ a · ❌ b · 👍 c · 👎 d · 🕐 e");
        assert!(five[0].2.is_none());
        let bare = p("Ship? [ask: yes deploy | no skip]");
        assert_eq!(bare[0].1, "Ship? yes deploy · no skip");
        assert_eq!(p("[ask: ✅ deploy]")[0].1, "✅ deploy");
        // A second marker in a paragraph that already has one.
        let two = p("Now? [ask: ✅ go | ❌ wait] Later? [ask: 👍 yes | 👎 no]");
        assert_eq!(two[0].1, "Now? ✅ go · ❌ wait Later? 👍 yes · 👎 no");
        assert!(two[0].2.is_some());
        // In code: untouched.
        for code in [
            "`[ask: ✅ deploy | ❌ skip]` is the marker",
            "```\n[ask: yes | no]\n```",
        ] {
            assert_eq!(p(code)[0].1, code);
        }
    }

    #[test]
    fn safety_net() {
        let d = |s: &str| {
            detect(s).map(|a| {
                (
                    keys(&a)
                        .iter()
                        .map(|(k, l)| format!("{k}={l}"))
                        .collect::<Vec<_>>()
                        .join(" "),
                    a.buttons,
                )
            })
        };
        assert_eq!(
            d("Staged v2.\n\n✅ to deploy, ❌ to skip"),
            Some(("✅=deploy ❌=skip".into(), true))
        );
        assert_eq!(
            d("Shall I send it? (✅ to send it now or ❌ to drop it.)"),
            Some(("✅=send it now ❌=drop it".into(), true))
        );
        assert_eq!(
            d("👍 to merge / 👎 to hold / 🕐 to wait a day"),
            Some(("👍=merge 👎=hold 🕐=wait a day".into(), true))
        );
        assert_eq!(d("Want it? React ✅."), Some(("✅=".into(), false)));
        assert_eq!(d("react with 👍 or 👎"), Some(("👍= 👎=".into(), false)));
        assert_eq!(d("Ship it? 👍/👎"), Some(("👍= 👎=".into(), false)));
        assert_eq!(d("Good to go 👍/👎?"), Some(("👍= 👎=".into(), false)));
        assert_eq!(
            d("Notes are up.\n👍 or 👎"),
            Some(("👍= 👎=".into(), false))
        );
        // Negatives.
        for s in [
            "Approve the ✅ ones and I'll do the rest.",
            "✅ to deploy, ❌ to skip.\n\nAnyway, the build is green.",
            "I marked ✅ to deploy and ❌ to skip in the doc, then left",
            "```\n✅ to deploy, ❌ to skip\n```",
            "Use `👍/👎?` in the template",
            "I had 🍕 or 🍔 for lunch",
            "✅ to deploy, ✅ to skip",
            "Done ✅",
            // The marker's rendered form, or a status line: text.
            "#5366 is ready.\n\n✅ merge #5366 · ⏸ hold",
            "✅ CI green · ❌ e2e red",
            "",
        ] {
            assert!(detect(s).is_none(), "{s}");
        }
    }

    #[test]
    fn rendered_forms() {
        for s in [
            "#5366 is ready. CI is green.\n\n✅ merge #5366 · ⏸ hold",
            "✅ merge both · 👀 merge #5297 only · ⏸ hold",
        ] {
            assert!(rendered_only(s), "{s}");
        }
        for s in [
            "CI:\n✅ merge #5366 · ⏸ hold",
            "Shipped ✅ merge #5366 · ⏸ hold",
            "✅ lint · ✅ tests",
            "✅ a · ❌ b · 👍 c · 👎 d · 🕐 e",
            "Deploy? [ask: ✅ deploy | ❌ skip]",
            "Done ✅",
            "",
        ] {
            assert!(!rendered_only(s), "{s}");
        }
        // A press quotes the ask in marker form.
        let (t, a) = take_marker("Close #5293?\n[ask: ✅ close #5293 | ⏸ leave it]").unwrap();
        assert_eq!(t, "Close #5293?\n✅ close #5293 · ⏸ leave it");
        assert_eq!(a.marker(), "[ask: ✅ close #5293 | ⏸ leave it]");
        assert_eq!(
            a.quoted(&t),
            "Close #5293?\n[ask: ✅ close #5293 | ⏸ leave it]"
        );
        // A safety-net ask has no fallback in its text: as is.
        let a = detect("Ship it? 👍/👎").unwrap();
        assert_eq!(a.quoted("Ship it? 👍/👎"), "Ship it? 👍/👎");
    }

    #[test]
    fn plans() {
        let m = |t: &str| (Marks::default(), t.to_owned());
        // A marker paragraph inside a merged part goes on its own.
        let first = Marks {
            reply: Some("$r".into()),
        };
        let p = plan(vec![
            (
                first.clone(),
                "Built.\n\nDeploy? [ask: ✅ deploy | ❌ skip]\n\nMore after.".into(),
            ),
            m("Last one ✅ to a, ❌ to b"),
        ]);
        let texts: Vec<_> = p
            .iter()
            .map(|(_, t, a)| (t.as_str(), a.is_some()))
            .collect();
        assert_eq!(
            texts,
            [
                ("Built.", false),
                ("Deploy? ✅ deploy · ❌ skip", true),
                ("More after.", false),
                // A marker anywhere: no auto-detect.
                ("Last one ✅ to a, ❌ to b", false),
            ]
        );
        assert_eq!(p[0].0, first);
        assert_eq!(p[1].0, Marks::default());
        // No marker: the last part only.
        let p = plan(vec![m("✅ to a, ❌ to b"), m("Ship it? 👍/👎")]);
        assert!(p[0].2.is_none());
        assert_eq!(p[1].2.as_ref().unwrap().seeds(), ["👍", "👎"]);
        assert!(plan(vec![m("Plain.")])[0].2.is_none());
        // A blank line inside a fence doesn't split it.
        let p = plan(vec![m(
            "```\n[ask: ✅ a | ❌ b]\n\nx\n```\n\nGo? [ask: ✅ go | ❌ no]",
        )]);
        assert_eq!(p.len(), 2);
        assert!(p[0].2.is_none() && p[1].2.is_some());
        assert_eq!(p[0].1, "```\n[ask: ✅ a | ❌ b]\n\nx\n```");
    }

    #[test]
    fn splits_paragraphs() {
        assert_eq!(paragraphs("a\nb\n\n\nc"), ["a\nb", "c"]);
        assert_eq!(
            paragraphs("x\n~~~~\n\n```\n~~~\n\n~~~~\ny"),
            ["x\n~~~~\n\n```\n~~~\n\n~~~~\ny"]
        );
        assert!(paragraphs("\n\n").is_empty());
    }
}
