//! The `form` block: MSC4139 **input prompts**. A form has a stable `id`, an
//! optional `scope`, up to 8 fields (select, radio, text, checkbox, date) and
//! a submit button. Submitting sends one visible reply whose body is
//! [`FORM_REPLY_FORMAT`] and whose `com.ianm.mtrix.used` carries the raw
//! values. Shapes and limits: `docs/spec.md`.

use serde_json::{Map, Value};

use super::{MAX_LABEL, media::opt_text, validate_id};

/// Fields in one form.
pub const MAX_FORM_FIELDS: usize = 8;
/// Options in one `select` or `radio` field.
pub const MAX_FORM_OPTIONS: usize = 10;
/// A text field's `maxlength` cap (and default).
pub const MAX_FORM_TEXT: usize = 200;
/// An option's `value`, in characters.
pub const MAX_OPTION_VALUE: usize = 100;
/// The field kinds a form may use (`fields[].kind`).
pub const FORM_KINDS: &[&str] = &["select", "radio", "text", "checkbox", "date"];

/// What a submit click sends (documentation; the Element module builds it).
pub const FORM_REPLY_FORMAT: &str = "Form \"<title>\": <label>: <value>; <label>: <value>";

/// `YYYY-MM-DD` with a real month and day.
fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let n = |r: std::ops::Range<usize>| s.get(r).and_then(|x| x.parse::<u32>().ok());
    let (Some(y), Some(m), Some(d)) = (n(0..4), n(5..7), n(8..10)) else {
        return false;
    };
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (2000..=2200).contains(&y) && (1..=days).contains(&d)
}

/// An option: `"Label"` (value = label) or `{value, label?}`; returns
/// `(value, label)`.
fn option(v: &Value) -> Option<(String, String)> {
    match v {
        Value::String(s) => Some((s.clone(), s.clone())),
        Value::Object(o) => {
            let value = o.get("value")?.as_str()?.to_owned();
            let label = match o.get("label") {
                None => value.clone(),
                Some(l) => l.as_str()?.to_owned(),
            };
            Some((value, label))
        }
        _ => None,
    }
}

fn options(f: &Map<String, Value>) -> Vec<(String, String)> {
    f.get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(option)
        .collect()
}

/// `{type: "form", id, title?, scope?, fields: [{id, kind, label, required?,
/// options?, maxlength?, placeholder?, min?, max?, default?}], submit: {label}}`.
pub(super) fn validate_form(m: &Map<String, Value>) -> Result<(), String> {
    let id = m.get("id").and_then(Value::as_str).unwrap_or_default();
    validate_id(id).map_err(|e| format!("form block: {e}"))?;
    opt_text(m, "title", 200, "form block")?;
    let submit = m.get("submit").and_then(Value::as_object);
    let label = submit
        .and_then(|s| s.get("label"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if label.trim().is_empty() || label.chars().count() > MAX_LABEL {
        return Err(format!(
            "form block: submit.label has 1 to {MAX_LABEL} characters"
        ));
    }
    let fields = m
        .get("fields")
        .and_then(Value::as_array)
        .map_or(&[][..], |a| a);
    if fields.is_empty() || fields.len() > MAX_FORM_FIELDS {
        return Err(format!("form block: 1 to {MAX_FORM_FIELDS} fields"));
    }
    let mut ids: Vec<&str> = Vec::new();
    for (i, f) in fields.iter().enumerate() {
        let f = f
            .as_object()
            .ok_or(format!("form field {}: an object", i + 1))?;
        let fid = f.get("id").and_then(Value::as_str).unwrap_or_default();
        let what = format!("form field {fid:?}");
        validate_id(fid).map_err(|e| format!("form field {}: {e}", i + 1))?;
        if ids.contains(&fid) {
            return Err(format!("{what}: id used twice in the form"));
        }
        ids.push(fid);
        let kind = f.get("kind").and_then(Value::as_str).unwrap_or_default();
        if !FORM_KINDS.contains(&kind) {
            return Err(format!(
                "{what}: kind {kind:?} isn't one of {}",
                FORM_KINDS.join(", ")
            ));
        }
        let label = f.get("label").and_then(Value::as_str).unwrap_or_default();
        if label.trim().is_empty() || label.chars().count() > MAX_LABEL {
            return Err(format!("{what}: label has 1 to {MAX_LABEL} characters"));
        }
        if f.get("required").is_some_and(|r| !r.is_boolean()) {
            return Err(format!("{what}: required is true or false"));
        }
        let choice = matches!(kind, "select" | "radio");
        if f.contains_key("options") != choice {
            return Err(format!(
                "{what}: options are required on select/radio fields and only there"
            ));
        }
        let default = f.get("default");
        match kind {
            "select" | "radio" => {
                let raw = f
                    .get("options")
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len);
                let opts = options(f);
                if raw == 0 || raw > MAX_FORM_OPTIONS || opts.len() != raw {
                    return Err(format!(
                        "{what}: 1 to {MAX_FORM_OPTIONS} options, each \"label\" or {{value, label?}}"
                    ));
                }
                for (n, (value, label)) in opts.iter().enumerate() {
                    if value.trim().is_empty() || value.chars().count() > MAX_OPTION_VALUE {
                        return Err(format!(
                            "{what}: option values have 1 to {MAX_OPTION_VALUE} characters"
                        ));
                    }
                    if label.trim().is_empty() || label.chars().count() > MAX_LABEL {
                        return Err(format!(
                            "{what}: option labels have 1 to {MAX_LABEL} characters"
                        ));
                    }
                    if opts[..n].iter().any(|(v, _)| v == value) {
                        return Err(format!("{what}: option value {value:?} given twice"));
                    }
                }
                if let Some(d) = default
                    && !d.as_str().is_some_and(|d| opts.iter().any(|(v, _)| v == d))
                {
                    return Err(format!("{what}: default is one of the option values"));
                }
            }
            "text" => {
                let max = match f.get("maxlength") {
                    None => MAX_FORM_TEXT,
                    Some(n) => match n.as_u64() {
                        Some(n) if (1..=MAX_FORM_TEXT as u64).contains(&n) => n as usize,
                        _ => {
                            return Err(format!("{what}: maxlength is 1 to {MAX_FORM_TEXT}"));
                        }
                    },
                };
                opt_text(f, "placeholder", 64, &what)?;
                if let Some(d) = default
                    && !d.as_str().is_some_and(|d| d.chars().count() <= max)
                {
                    return Err(format!(
                        "{what}: default is text of at most {max} characters"
                    ));
                }
            }
            "checkbox" => {
                if default.is_some_and(|d| !d.is_boolean()) {
                    return Err(format!("{what}: default is true or false"));
                }
            }
            _ => {
                // date
                for key in ["min", "max", "default"] {
                    if f.get(key).is_some_and(|v| !v.as_str().is_some_and(is_date)) {
                        return Err(format!("{what}: {key} is a YYYY-MM-DD date"));
                    }
                }
                if let (Some(a), Some(b)) = (
                    f.get("min").and_then(Value::as_str),
                    f.get("max").and_then(Value::as_str),
                ) && a > b
                {
                    return Err(format!("{what}: min is after max"));
                }
            }
        }
    }
    Ok(())
}

/// A plain-text fallback for a (valid) form, for `body`: the title, each
/// field numbered with its options numbered, and how to answer by typing,
/// e.g.
///
/// ```text
/// Book a table
/// 1. Date (YYYY-MM-DD)
/// 2. Party size: 1) 2 people 2) 4 people
/// 3. Notes (optional, up to 200 characters)
/// 4. High chair (yes/no, optional)
/// Reply with the numbers, e.g. "1: 2026-10-17; 2: 1; 4: yes".
/// ```
pub fn form_fallback(m: &Map<String, Value>) -> String {
    let s = |o: &Map<String, Value>, k: &str| o.get(k).and_then(Value::as_str).map(str::to_owned);
    let mut out = vec![
        s(m, "title")
            .or_else(|| s(m, "id"))
            .unwrap_or_else(|| "Form".into()),
    ];
    let mut example: Vec<String> = Vec::new();
    let fields = m.get("fields").and_then(Value::as_array);
    for (i, f) in fields.into_iter().flatten().enumerate() {
        let Some(f) = f.as_object() else { continue };
        let n = i + 1;
        let label = s(f, "label").unwrap_or_default();
        let required = f.get("required").and_then(Value::as_bool) == Some(true);
        let opt = if required { "" } else { ", optional" };
        let line = match s(f, "kind").as_deref() {
            Some("select" | "radio") => {
                let opts: Vec<String> = options(f)
                    .iter()
                    .enumerate()
                    .map(|(j, (_, l))| format!("{}) {l}", j + 1))
                    .collect();
                if example.len() < 2 {
                    example.push(format!("{n}: 1"));
                }
                let note = if required { "" } else { " (optional)" };
                format!("{n}. {label}{note}: {}", opts.join(" "))
            }
            Some("checkbox") => {
                if example.len() < 2 {
                    example.push(format!("{n}: yes"));
                }
                format!("{n}. {label} (yes/no{opt})")
            }
            Some("date") => {
                if example.len() < 2 {
                    example.push(format!("{n}: 2026-10-17"));
                }
                format!("{n}. {label} (YYYY-MM-DD{opt})")
            }
            _ => {
                let max = f
                    .get("maxlength")
                    .and_then(Value::as_u64)
                    .unwrap_or(MAX_FORM_TEXT as u64);
                if example.len() < 2 {
                    example.push(format!("{n}: …"));
                }
                let opt = if required { "" } else { "optional, " };
                format!("{n}. {label} ({opt}up to {max} characters)")
            }
        };
        out.push(line);
    }
    out.push(format!(
        "Reply with the numbers, e.g. \"{}\".",
        example.join("; ")
    ));
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Rich;
    use serde_json::json;

    fn book() -> Value {
        json!({"type": "form", "id": "book", "title": "Book a table", "scope": ["@alice:example.org"],
            "fields": [
                {"id": "date", "kind": "date", "label": "Date", "required": true, "min": "2026-10-15"},
                {"id": "party", "kind": "select", "label": "Party size", "required": true, "default": "2",
                 "options": [{"value": "2", "label": "2 people"}, {"value": "4", "label": "4 people"}]},
                {"id": "seat", "kind": "radio", "label": "Seating", "options": ["Indoor", "Outdoor"]},
                {"id": "notes", "kind": "text", "label": "Notes", "maxlength": 120, "placeholder": "Allergies…"},
                {"id": "chair", "kind": "checkbox", "label": "High chair", "default": false}
            ],
            "submit": {"label": "Book"}})
    }

    fn parse(block: Value) -> Result<Rich, String> {
        Rich::parse(&json!({"v": 1, "blocks": [block]}).to_string())
    }

    #[test]
    fn valid_form_round_trips() {
        let r = parse(book()).unwrap();
        assert_eq!(serde_json::to_value(&r).unwrap()["blocks"][0], book());
        assert_eq!(r.blocks[0].prompt_ids(), vec!["book"]);
    }

    #[test]
    fn form_limits() {
        let with = |f: &dyn Fn(&mut Value)| {
            let mut b = book();
            f(&mut b);
            b
        };
        let field = |kind: &str| json!({"id": "x", "kind": kind, "label": "X"});
        for (bad, why) in [
            (with(&|b| b["id"] = json!("a b")), "form block: id"),
            (
                with(&|b| {
                    b.as_object_mut().unwrap().remove("submit");
                }),
                "\"submit\"",
            ),
            (
                with(&|b| b["submit"] = json!({"label": ""})),
                "submit.label",
            ),
            (
                with(&|b| b["fields"] = json!(vec![field("text"); 9])),
                "1 to 8 fields",
            ),
            (
                with(&|b| b["fields"][1]["id"] = json!("date")),
                "used twice",
            ),
            (
                with(&|b| b["fields"][0]["kind"] = json!("color")),
                "kind \"color\"",
            ),
            (with(&|b| b["fields"][0]["label"] = json!(" ")), "label"),
            (
                with(&|b| b["fields"][0]["required"] = json!("yes")),
                "required",
            ),
            (
                with(&|b| {
                    b["fields"][1]["options"] =
                        json!((0..11).map(|i| i.to_string()).collect::<Vec<_>>())
                }),
                "1 to 10 options",
            ),
            (
                with(&|b| b["fields"][1]["options"] = json!([])),
                "1 to 10 options",
            ),
            (
                with(&|b| b["fields"][2]["options"] = json!(["A", "A"])),
                "given twice",
            ),
            (
                with(&|b| b["fields"][2]["options"] = json!([{"label": "x"}])),
                "options",
            ),
            (with(&|b| b["fields"][1]["default"] = json!("3")), "default"),
            (
                with(&|b| {
                    b["fields"][2].as_object_mut().unwrap().remove("options");
                }),
                "options are required",
            ),
            (
                with(&|b| b["fields"][3]["options"] = json!(["a"])),
                "only there",
            ),
            (
                with(&|b| b["fields"][3]["maxlength"] = json!(201)),
                "maxlength",
            ),
            (
                with(&|b| b["fields"][3]["default"] = json!("x".repeat(121))),
                "default",
            ),
            (
                with(&|b| b["fields"][4]["default"] = json!("no")),
                "default",
            ),
            (
                with(&|b| b["fields"][0]["min"] = json!("2026-02-30")),
                "YYYY-MM-DD",
            ),
            (
                with(&|b| b["fields"][0]["max"] = json!("2026-10-01")),
                "after max",
            ),
            (with(&|b| b["scope"] = json!(["alice"])), "scope entry"),
        ] {
            let err = parse(bad).unwrap_err();
            assert!(err.contains(why), "{why}: {err}");
        }
        // The form id shares the message's prompt-id space with buttons.
        let btn = json!({"type": "buttons", "buttons": [{"id": "book", "label": "x", "action": {"type": "react", "key": "a"}}]});
        let both = json!({"v": 1, "blocks": [book(), btn]});
        assert!(
            Rich::parse(&both.to_string())
                .unwrap_err()
                .contains("twice")
        );
    }

    #[test]
    fn dates() {
        for ok in ["2026-10-15", "2028-02-29", "2000-01-01"] {
            assert!(is_date(ok), "{ok}");
        }
        for bad in [
            "2026-13-01",
            "2027-02-29",
            "26-10-15",
            "2026/10/15",
            "1999-12-31",
            "2026-1-15",
        ] {
            assert!(!is_date(bad), "{bad}");
        }
    }

    #[test]
    fn fallback_text() {
        let r = parse(book()).unwrap();
        assert_eq!(
            r.form_fallback().unwrap(),
            "Book a table\n\
             1. Date (YYYY-MM-DD)\n\
             2. Party size: 1) 2 people 2) 4 people\n\
             3. Seating (optional): 1) Indoor 2) Outdoor\n\
             4. Notes (optional, up to 120 characters)\n\
             5. High chair (yes/no, optional)\n\
             Reply with the numbers, e.g. \"1: 2026-10-17; 2: 1\"."
        );
        let table = json!({"v": 1, "blocks": [{"type": "table", "columns": ["a"], "rows": [[1]]}]});
        assert_eq!(
            Rich::parse(&table.to_string()).unwrap().form_fallback(),
            None
        );
    }
}
