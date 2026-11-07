//! Numbers in rich payloads. Event content must be canonical JSON (room v6+),
//! which allows only integers in ±(2^53 - 1): Synapse refuses a float with
//! `M_BAD_JSON "Bad JSON value: float"`. So every numeric field is a JSON
//! integer or a decimal string (`"62.99"`); senders turn floats into decimal
//! strings before validating ([`canonicalize`]).

use serde_json::{Map, Value};

/// The largest integer canonical JSON allows (2^53 - 1); the smallest is its
/// negation.
pub const MAX_SAFE_INT: i64 = (1 << 53) - 1;

/// `^-?\d+(\.\d+)?([eE][-+]?\d+)?$`.
pub fn is_decimal(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = usize::from(b.first() == Some(&b'-'));
    let digits = |i: &mut usize| {
        let start = *i;
        while b.get(*i).is_some_and(u8::is_ascii_digit) {
            *i += 1;
        }
        *i > start
    };
    if !digits(&mut i) {
        return false;
    }
    if b.get(i) == Some(&b'.') {
        i += 1;
        if !digits(&mut i) {
            return false;
        }
    }
    if matches!(b.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(b.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        if !digits(&mut i) {
            return false;
        }
    }
    i == b.len()
}

fn safe_int(v: &Value) -> bool {
    v.as_i64()
        .is_some_and(|n| (-MAX_SAFE_INT..=MAX_SAFE_INT).contains(&n))
}

/// A numeric field's value: an integer in ±(2^53 - 1) or a decimal string.
pub fn is_num(v: &Value) -> bool {
    safe_int(v) || v.as_str().is_some_and(is_decimal)
}

/// Rewrites every number in `v` for canonical JSON: a float with no
/// fractional part in range becomes an integer, any other float its shortest
/// decimal string (`62.99` → `"62.99"`). Integers outside ±(2^53 - 1) are
/// an error (they would be rejected by the homeserver), as are NaN/Inf.
pub fn canonicalize(v: &mut Value, path: &str) -> Result<(), String> {
    match v {
        Value::Number(n) => {
            if n.is_i64() || n.is_u64() {
                let ok = n
                    .as_i64()
                    .is_some_and(|i| (-MAX_SAFE_INT..=MAX_SAFE_INT).contains(&i));
                if !ok {
                    return Err(format!(
                        "{path}: the integer {n} is outside ±{MAX_SAFE_INT} \
                         (send it as a decimal string)"
                    ));
                }
                return Ok(());
            }
            let f = n.as_f64().unwrap_or(f64::NAN);
            if !f.is_finite() {
                return Err(format!("{path}: {f} isn't a finite number"));
            }
            *v = if f.fract() == 0.0 && f.abs() <= MAX_SAFE_INT as f64 {
                // Exact: |f| < 2^53 with no fraction.
                Value::from(f as i64)
            } else {
                // Display is the shortest string that round-trips, and never
                // uses an exponent, so it matches `is_decimal`.
                Value::String(format!("{f}"))
            };
            Ok(())
        }
        Value::Array(a) => a
            .iter_mut()
            .enumerate()
            .try_for_each(|(i, x)| canonicalize(x, &format!("{path}[{i}]"))),
        Value::Object(m) => canonicalize_map(m, path),
        _ => Ok(()),
    }
}

/// [`canonicalize`] over an object's values.
pub fn canonicalize_map(m: &mut Map<String, Value>, path: &str) -> Result<(), String> {
    m.iter_mut()
        .try_for_each(|(k, x)| canonicalize(x, &format!("{path}.{k}")))
}

/// The path of the first float or out-of-range integer in `v`, if any.
pub fn non_canonical(v: &Value, path: &str) -> Option<String> {
    match v {
        Value::Number(_) if !safe_int(v) => Some(path.to_owned()),
        Value::Array(a) => a
            .iter()
            .enumerate()
            .find_map(|(i, x)| non_canonical(x, &format!("{path}[{i}]"))),
        Value::Object(m) => non_canonical_map(m, path),
        _ => None,
    }
}

/// [`non_canonical`] over an object's values.
pub fn non_canonical_map(m: &Map<String, Value>, path: &str) -> Option<String> {
    m.iter()
        .find_map(|(k, x)| non_canonical(x, &format!("{path}.{k}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decimal_strings() {
        for ok in ["0", "-1", "62.99", "1e3", "-2.5E-4", "007"] {
            assert!(is_decimal(ok), "{ok}");
        }
        for bad in [
            "", "-", ".5", "5.", "1e", "1e+", "+1", " 1", "1 ", "NaN", "1,000", "0x10",
        ] {
            assert!(!is_decimal(bad), "{bad:?}");
        }
        assert!(is_num(&json!(5)) && is_num(&json!("5.5")) && is_num(&json!(-MAX_SAFE_INT)));
        assert!(!is_num(&json!(5.5)) && !is_num(&json!(MAX_SAFE_INT + 1)) && !is_num(&json!("x")));
    }

    #[test]
    fn floats_become_decimal_strings() {
        let mut v = json!({"price": 62.99, "n": 3.0, "neg": -0.5, "tiny": 1e-7, "big": 1e300,
                           "i": 7, "list": [1.5, null, 2], "s": "x"});
        canonicalize(&mut v, "b").unwrap();
        assert_eq!(
            v,
            json!({"price": "62.99", "n": 3, "neg": "-0.5", "tiny": "0.0000001",
                   "big": format!("{}", 1e300), "i": 7, "list": ["1.5", null, 2], "s": "x"})
        );
        assert!(is_decimal(v["big"].as_str().unwrap()));
        assert_eq!(non_canonical(&v, "b"), None);
    }

    #[test]
    fn out_of_range_integers_are_refused() {
        let mut v = json!({"a": [u64::MAX]});
        let e = canonicalize(&mut v, "b").unwrap_err();
        assert!(e.contains("b.a[0]"), "{e}");
        assert_eq!(
            non_canonical(&json!({"x": [1, 2.5]}), "b").as_deref(),
            Some("b.x[1]")
        );
    }
}
