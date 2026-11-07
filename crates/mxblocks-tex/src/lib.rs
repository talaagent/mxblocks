//! Math messages: a formula rendered to a PNG by the `mxblocks-math`
//! program (`packages/mxblocks-math/` in this repository) and sent as an `m.image`.
//!
//! The renderer's contract: `mxblocks-math render [--inline] --out PATH.png -`
//! with the LaTeX on stdin, exit 0 and one JSON line on stdout
//! (`{"mimetype":"image/png","w":W,"h":H,"size":BYTES}`, w/h the display
//! size of a 2x PNG); non-zero with the TeX error on stderr. Any program
//! that keeps it works ([`Renderer::new`] takes its path).
//!
//! The event ([`math_content`]): `msgtype: m.image` with the upload's `url`
//! and `info`, `filename: math.png`, `body` the raw LaTeX (readable on
//! clients that render nothing), `formatted_body` MSC2191 markup
//! ([`maths_html`]: `<div data-mx-maths="…"><code>…</code></div>`, a
//! `<span>` inline, which Element's LaTeX labs flag renders). The sender
//! adds the mxblocks payload with the math block ([`with_caption`]). A
//! caption goes first in `body` and `formatted_body` (a blank line, a
//! `<p>`), and on the math block as `caption`.

#![doc = include_str!("../README.md")]
#![warn(missing_docs)]

use core::time::Duration;
use std::path::Path;
use std::process::Stdio;

use mxblocks::{Block, MAX_MATH_LINE, Rich};
use serde_json::{Value, json};
use tokio::{io::AsyncWriteExt as _, process::Command};

/// The default renderer (on `PATH`).
pub const DEFAULT_RENDERER: &str = "mxblocks-math";
/// The default time the renderer may take.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
/// The default largest PNG accepted, in bytes.
pub const DEFAULT_MAX_PNG: u64 = 8 * 1024 * 1024;

/// A rendered formula.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rendered {
    /// The PNG (2x the display size).
    pub png: Vec<u8>,
    /// Its MIME type (`image/png`).
    pub mimetype: String,
    /// Display width.
    pub w: u64,
    /// Display height.
    pub h: u64,
}

/// The first non-blank of `choices` (an env var, a config value, ...),
/// trimmed, else `default`.
pub fn pick_renderer<'a>(
    choices: impl IntoIterator<Item = Option<&'a str>>,
    default: &str,
) -> String {
    choices
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|s| !s.is_empty())
        .unwrap_or(default)
        .to_owned()
}

/// A renderer program and its limits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Renderer {
    /// The program (a path, or a name on `PATH`).
    pub bin: String,
    /// How long one render may take; the program is killed after it.
    pub timeout: Duration,
    /// The largest PNG accepted, in bytes.
    pub max_png: u64,
}

impl Default for Renderer {
    fn default() -> Self {
        Self::new(DEFAULT_RENDERER)
    }
}

impl Renderer {
    /// `bin` with the default limits.
    pub fn new(bin: impl Into<String>) -> Self {
        Self {
            bin: bin.into(),
            timeout: DEFAULT_TIMEOUT,
            max_png: DEFAULT_MAX_PNG,
        }
    }

    /// With this timeout.
    #[must_use]
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// With this PNG size cap.
    #[must_use]
    pub fn max_png(mut self, bytes: u64) -> Self {
        self.max_png = bytes;
        self
    }

    /// Render `tex` (`display`: a display formula, else inline).
    ///
    /// # Errors
    /// The TeX error, a timeout, or a broken renderer, as a message for the
    /// person who wrote the formula.
    pub async fn render(&self, tex: &str, display: bool) -> Result<Rendered, String> {
        let out = std::env::temp_dir().join(format!(
            "mxblocks-math-{}-{}-{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_millis()),
            next_id()
        ));
        let r = self.render_to(tex, display, &out).await;
        let _ = tokio::fs::remove_file(&out).await;
        r
    }

    async fn render_to(&self, tex: &str, display: bool, out: &Path) -> Result<Rendered, String> {
        let bin = &self.bin;
        let mut cmd = Command::new(bin);
        cmd.arg("render");
        if !display {
            cmd.arg("--inline");
        }
        cmd.arg("--out")
            .arg(out)
            .arg("-")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("can't run the math renderer {bin}: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            // A renderer that exits early (bad flags) closes the pipe: its
            // exit status says why.
            let _ = stdin.write_all(tex.as_bytes()).await;
        }
        // Timed out: dropping the child (kill_on_drop) kills it.
        let res = tokio::time::timeout(self.timeout, child.wait_with_output())
            .await
            .map_err(|_| {
                format!(
                    "the math renderer took over {} s; simplify the formula",
                    self.timeout.as_secs()
                )
            })?
            .map_err(|e| format!("math renderer: {e}"))?;
        if !res.status.success() {
            let err = String::from_utf8_lossy(&res.stderr);
            let err = err.trim();
            return Err(if err.is_empty() {
                format!("the math renderer failed ({})", res.status)
            } else {
                format!("LaTeX error (nothing sent): {}", short(err, 1500))
            });
        }
        let line = String::from_utf8_lossy(&res.stdout);
        let meta: Value = line
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .and_then(|l| serde_json::from_str(l).ok())
            .ok_or_else(|| format!("the math renderer printed no JSON: {}", line.trim()))?;
        let (Some(w), Some(h)) = (meta["w"].as_u64(), meta["h"].as_u64()) else {
            return Err(format!("the math renderer's JSON has no w/h: {meta}"));
        };
        let len = tokio::fs::metadata(out)
            .await
            .map_err(|e| format!("the math renderer wrote no image: {e}"))?
            .len();
        if len > self.max_png {
            return Err(format!("the rendered formula is {len} bytes; too big"));
        }
        let png = tokio::fs::read(out)
            .await
            .map_err(|e| format!("reading the rendered formula: {e}"))?;
        if !png.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("the math renderer's output isn't a PNG".into());
        }
        Ok(Rendered {
            png,
            mimetype: meta["mimetype"].as_str().unwrap_or("image/png").to_owned(),
            w,
            h,
        })
    }
}

/// A per-call number for the temp file name.
fn next_id() -> u32 {
    use core::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    N.fetch_add(1, Ordering::Relaxed)
}

/// `s` with its whitespace runs collapsed, cut to `n` characters (`…`).
fn short(s: &str, n: usize) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() <= n {
        return s;
    }
    let mut out: String = s.chars().take(n.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// HTML-escaped `s` (quotes too).
pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

/// MSC2191 markup for `tex`: a `div` (display) or `span` (inline) with
/// `data-mx-maths` and the source in `<code>` for clients without it.
pub fn maths_html(tex: &str, display: bool) -> String {
    let e = html_escape(tex);
    let tag = if display { "div" } else { "span" };
    format!("<{tag} data-mx-maths=\"{e}\"><code>{e}</code></{tag}>")
}

/// The `m.image` content for a rendered formula uploaded to `mxc`, without
/// the mxblocks payload (write [`with_caption`]'s under the content key).
/// `caption`: text to go with the formula, if any; `reply_to`: an event to
/// reply to.
pub fn math_content(
    tex: &str,
    display: bool,
    caption: &str,
    r: &Rendered,
    mxc: &str,
    reply_to: Option<&str>,
) -> Value {
    let caption = caption.trim();
    let (body, html) = if caption.is_empty() {
        (tex.to_owned(), maths_html(tex, display))
    } else {
        (
            format!("{caption}\n\n{tex}"),
            format!(
                "<p>{}</p>{}",
                html_escape(caption),
                maths_html(tex, display)
            ),
        )
    };
    let mut c = json!({
        "msgtype": "m.image",
        "body": body,
        "filename": "math.png",
        "format": "org.matrix.custom.html",
        "formatted_body": html,
        "url": mxc,
        "info": {"mimetype": r.mimetype, "size": r.png.len(), "w": r.w, "h": r.h},
    });
    if let Some(ev) = reply_to.filter(|e| !e.is_empty()) {
        c["m.relates_to"] = json!({"m.in_reply_to": {"event_id": ev}});
    }
    c
}

/// The payload with the caption put on its math block (`caption`, kept
/// only when it is one line of at most [`MAX_MATH_LINE`] characters, as
/// the spec requires; a longer caption stays in the body only).
pub fn with_caption(rich: &Rich, caption: &str) -> Rich {
    let mut r = rich.clone();
    let caption = caption.trim();
    if caption.is_empty() || caption.contains('\n') || caption.chars().count() > MAX_MATH_LINE {
        return r;
    }
    for b in &mut r.blocks {
        if let Block::Display(m) = b
            && m.get("type").and_then(Value::as_str) == Some("math")
            && !m.contains_key("caption")
        {
            m.insert("caption".into(), caption.into());
        }
    }
    r
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt as _;

    use super::*;

    /// A fake renderer: a shell script that checks its arguments, copies
    /// a 1x1 PNG to `--out` and prints the JSON, or fails on `\bad`.
    fn fake(dir: &Path) -> String {
        let png = dir.join("one.png");
        // A real 1x1 PNG.
        let bytes: &[u8] = &[
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
            0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0x0d, 0x49,
            0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0,
            0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ];
        std::fs::write(&png, bytes).unwrap();
        let script = dir.join("mxblocks-math");
        std::fs::write(
            &script,
            format!(
                r#"#!/bin/sh
[ "$1" = render ] || {{ echo "usage" >&2; exit 2; }}
shift
inline=0
[ "$1" = --inline ] && {{ inline=1; shift; }}
[ "$1" = --out ] || {{ echo "no --out" >&2; exit 2; }}
out=$2
[ "$3" = - ] || {{ echo "no -" >&2; exit 2; }}
tex=$(cat)
case "$tex" in
  *'\bad'*) echo "! Undefined control sequence \\bad." >&2; exit 1 ;;
  *'\slow'*) sleep 5 ;;
esac
cp {png} "$out"
echo '{{"mimetype":"image/png","w":'"$((100 + inline))"',"h":20,"size":69}}'
"#,
                png = png.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script.display().to_string()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn renders_with_a_fake_renderer() {
        let dir = tempfile::tempdir().unwrap();
        let r = Renderer::new(fake(dir.path()));
        let img = r.render(r"e^{i\pi} + 1 = 0", true).await.unwrap();
        assert_eq!(
            (img.w, img.h, img.mimetype.as_str()),
            (100, 20, "image/png")
        );
        assert!(img.png.starts_with(b"\x89PNG"));
        let inline = r.render("x^2", false).await.unwrap();
        assert_eq!(inline.w, 101, "--inline passed");
        // A formula that starts with '-' isn't taken for a flag (stdin).
        r.render("-x", true).await.unwrap();

        let err = r.render(r"\bad{x}", true).await.unwrap_err();
        assert!(
            err.contains("LaTeX error") && err.contains("Undefined control sequence"),
            "{err}"
        );
        let err = r
            .clone()
            .timeout(Duration::from_millis(300))
            .render(r"\slow", true)
            .await
            .unwrap_err();
        assert!(err.contains("took over"), "{err}");
        let err = r.clone().max_png(10).render("x", true).await.unwrap_err();
        assert!(err.contains("too big"), "{err}");
        let err = Renderer::new("/nonexistent/mxblocks-math")
            .render("x", true)
            .await
            .unwrap_err();
        assert!(err.contains("can't run"), "{err}");
    }

    #[test]
    fn picks_the_renderer() {
        let d = DEFAULT_RENDERER;
        assert_eq!(pick_renderer([None, None], d), "mxblocks-math");
        assert_eq!(
            pick_renderer([None, Some("/opt/math/bin/m")], d),
            "/opt/math/bin/m"
        );
        assert_eq!(
            pick_renderer([Some("/tmp/fake"), Some("/opt/x")], d),
            "/tmp/fake"
        );
        assert_eq!(pick_renderer([Some(" "), Some("/opt/x")], d), "/opt/x");
        assert_eq!(pick_renderer([Some(" ")], "other"), "other");
        assert_eq!(Renderer::default().bin, d);
    }

    #[test]
    fn shortens_errors() {
        assert_eq!(short(" a \n b ", 10), "a b");
        assert_eq!(short("abcdef", 4), "abc…");
    }

    #[test]
    fn escapes_and_builds_the_event() {
        let tex = r#"a<b & c>"d" 'e'"#;
        assert_eq!(
            maths_html(tex, true),
            "<div data-mx-maths=\"a&lt;b &amp; c&gt;&quot;d&quot; &#x27;e&#x27;\">\
             <code>a&lt;b &amp; c&gt;&quot;d&quot; &#x27;e&#x27;</code></div>"
        );
        assert!(
            maths_html("x", false).starts_with("<span data-mx-maths=\"x\"><code>x</code></span>")
        );

        let r = Rendered {
            png: vec![0; 69],
            mimetype: "image/png".into(),
            w: 100,
            h: 20,
        };
        let c = math_content(r"\frac{1}{2}", true, "", &r, "mxc://example.org/m", None);
        assert_eq!(
            c,
            json!({
                "msgtype": "m.image", "body": r"\frac{1}{2}", "filename": "math.png",
                "format": "org.matrix.custom.html",
                "formatted_body": r#"<div data-mx-maths="\frac{1}{2}"><code>\frac{1}{2}</code></div>"#,
                "url": "mxc://example.org/m",
                "info": {"mimetype": "image/png", "size": 69, "w": 100, "h": 20},
            })
        );
        let c = math_content(
            "x<1",
            false,
            " Area <m²> ",
            &r,
            "mxc://example.org/m",
            Some("$e"),
        );
        assert_eq!(c["body"], "Area <m²>\n\nx<1");
        assert_eq!(
            c["formatted_body"],
            "<p>Area &lt;m²&gt;</p><span data-mx-maths=\"x&lt;1\"><code>x&lt;1</code></span>"
        );
        assert_eq!(c["m.relates_to"]["m.in_reply_to"]["event_id"], "$e");

        let rich = mxblocks::from_args_math(&[], None, Some(("x", true)))
            .unwrap()
            .unwrap();
        let v = serde_json::to_value(with_caption(&rich, "Area")).unwrap();
        assert_eq!(v["blocks"][0]["caption"], "Area");
        assert_eq!(with_caption(&rich, " "), rich);
        assert_eq!(with_caption(&rich, "two\nlines"), rich);
        assert_eq!(with_caption(&rich, &"x".repeat(MAX_MATH_LINE + 1)), rich);
    }
}
