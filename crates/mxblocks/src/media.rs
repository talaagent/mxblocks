//! `gallery` and `file` blocks: media referenced like Matrix's own `m.image`
//! / `m.file` content, as a plain `url` (`mxc://`) or an encrypted `file`
//! (`EncryptedFile`: url, key, iv, hashes, v) in E2EE rooms. Shapes and
//! limits: `docs/spec.md`.

use serde_json::{Map, Value};

/// Images in a `gallery` (validation refuses fewer or more; renderers draw 1 and
/// drop past 20).
pub const MIN_GALLERY: usize = 2;
/// Most images in a `gallery`.
pub const MAX_GALLERY: usize = 20;
/// Captions, alt texts and gallery titles, in characters.
pub const MAX_CAPTION: usize = 200;
/// A `file` block's `preview`: the first lines of a text file.
pub const MAX_PREVIEW_LINES: usize = 40;
/// A `file` block's `preview`, in bytes (UTF-8).
pub const MAX_PREVIEW_BYTES: usize = 4096;
/// A file name, in characters.
pub const MAX_FILE_NAME: usize = 255;

/// `mxc://server/mediaId` (the renderer's check, byte for byte).
pub fn is_mxc(s: &str) -> bool {
    let Some(rest) = s.strip_prefix("mxc://") else {
        return false;
    };
    let Some((server, id)) = rest.split_once('/') else {
        return false;
    };
    s.len() <= 255
        && !server.is_empty()
        && server
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".:-[]".contains(c))
        && !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// An `EncryptedFile` (attachment encryption v2) as Matrix carries it.
fn is_encrypted_file(v: &Value) -> bool {
    let s = |k: &str| v.get(k).and_then(Value::as_str);
    s("url").is_some_and(is_mxc)
        && s("v") == Some("v2")
        && s("iv").is_some_and(|x| !x.is_empty())
        && v.get("key")
            .and_then(|k| k.get("k"))
            .and_then(Value::as_str)
            .is_some_and(|x| !x.is_empty())
        && v.get("hashes")
            .and_then(|h| h.get("sha256"))
            .and_then(Value::as_str)
            .is_some_and(|x| !x.is_empty())
}

/// A media source: `url_key` (plain mxc) or `file_key` (EncryptedFile), not
/// both; one is needed when `required`.
fn validate_source(
    o: &Map<String, Value>,
    url_key: &str,
    file_key: &str,
    required: bool,
    what: &str,
) -> Result<(), String> {
    match (o.get(url_key), o.get(file_key)) {
        (Some(_), Some(_)) => Err(format!("{what}: {url_key:?} or {file_key:?}, not both")),
        (Some(u), None) if !u.as_str().is_some_and(is_mxc) => Err(format!(
            "{what}: {url_key:?} must be an mxc://server/mediaId URI"
        )),
        (None, Some(f)) if !is_encrypted_file(f) => Err(format!(
            "{what}: {file_key:?} must be an EncryptedFile (url, key.k, iv, hashes.sha256, v \"v2\")"
        )),
        (None, None) if required => Err(format!(
            "{what}: needs \"{url_key}\" (mxc://) or \"{file_key}\" (encrypted)"
        )),
        _ => Ok(()),
    }
}

/// An optional one-line string of 1..=`max` characters.
pub(super) fn opt_text(
    o: &Map<String, Value>,
    key: &str,
    max: usize,
    what: &str,
) -> Result<(), String> {
    match o.get(key) {
        None => Ok(()),
        Some(Value::String(s)) if !s.trim().is_empty() && s.chars().count() <= max => Ok(()),
        Some(_) => Err(format!("{what}: {key:?} is text of 1 to {max} characters")),
    }
}

fn opt_uint(o: &Map<String, Value>, key: &str, positive: bool, what: &str) -> Result<(), String> {
    match o.get(key) {
        None => Ok(()),
        Some(v) if v.as_u64().is_some_and(|n| !positive || n > 0) => Ok(()),
        Some(_) => Err(format!(
            "{what}: {key:?} is a {} integer",
            if positive { "positive" } else { "non-negative" }
        )),
    }
}

/// `{type: "gallery", title?, images: [{url | file, caption?, alt?, w?, h?, mimetype?, size?}]}`.
pub(super) fn validate_gallery(m: &Map<String, Value>) -> Result<(), String> {
    opt_text(m, "title", MAX_CAPTION, "gallery block")?;
    let images = m
        .get("images")
        .and_then(Value::as_array)
        .map_or(&[][..], |a| a);
    if images.len() < MIN_GALLERY || images.len() > MAX_GALLERY {
        return Err(format!(
            "gallery block: {MIN_GALLERY} to {MAX_GALLERY} images (one image is an m.image)"
        ));
    }
    for (i, img) in images.iter().enumerate() {
        let what = format!("gallery image {}", i + 1);
        let o = img.as_object().ok_or(format!("{what}: an object"))?;
        validate_source(o, "url", "file", true, &what)?;
        opt_text(o, "caption", MAX_CAPTION, &what)?;
        opt_text(o, "alt", MAX_CAPTION, &what)?;
        opt_uint(o, "w", true, &what)?;
        opt_uint(o, "h", true, &what)?;
        opt_uint(o, "size", false, &what)?;
        if let Some(mt) = o.get("mimetype")
            && !mt
                .as_str()
                .is_some_and(|s| s.starts_with("image/") && s.len() <= 100)
        {
            return Err(format!("{what}: \"mimetype\" is an image/* type"));
        }
    }
    Ok(())
}

/// `{type: "file", name, size?, mimetype?, url | file, preview?, thumbnail_url | thumbnail_file}`.
pub(super) fn validate_file(m: &Map<String, Value>) -> Result<(), String> {
    let what = "file block";
    opt_text(m, "name", MAX_FILE_NAME, what)?;
    validate_source(m, "url", "file", true, what)?;
    validate_source(m, "thumbnail_url", "thumbnail_file", false, what)?;
    opt_uint(m, "size", false, what)?;
    opt_text(m, "mimetype", 100, what)?;
    if let Some(p) = m.get("preview") {
        let p = p.as_str().ok_or(format!("{what}: \"preview\" is text"))?;
        if p.len() > MAX_PREVIEW_BYTES || p.lines().count() > MAX_PREVIEW_LINES {
            return Err(format!(
                "{what}: \"preview\" is at most {MAX_PREVIEW_LINES} lines and {MAX_PREVIEW_BYTES} bytes"
            ));
        }
    }
    Ok(())
}

/// The start of a text file for a `file` block's `preview`: at most
/// [`MAX_PREVIEW_LINES`] lines and [`MAX_PREVIEW_BYTES`] bytes, cut at a
/// character boundary. `None` for binary data (a NUL, or invalid UTF-8
/// before the cut) and for blank text.
pub fn text_preview(data: &[u8]) -> Option<String> {
    let head = &data[..data.len().min(MAX_PREVIEW_BYTES)];
    if head.contains(&0) {
        return None;
    }
    let text = match std::str::from_utf8(head) {
        Ok(s) => s,
        // A multi-byte character cut by the byte cap is fine; anything else
        // is binary.
        Err(e) if head.len() == MAX_PREVIEW_BYTES && head.len() - e.valid_up_to() < 4 => {
            std::str::from_utf8(&head[..e.valid_up_to()]).ok()?
        }
        Err(_) => return None,
    };
    let text = text.replace("\r\n", "\n");
    let mut out: Vec<&str> = text.split('\n').take(MAX_PREVIEW_LINES).collect();
    // A last line cut by the byte cap is kept: the renderer marks the preview
    // as partial when `size` says there's more.
    while out.last().is_some_and(|l| l.trim().is_empty()) {
        out.pop();
    }
    let s = out.join("\n");
    (!s.trim().is_empty()).then_some(s)
}

/// Width and height of a PNG, GIF, JPEG or WebP from its header, for
/// `info.w`/`info.h` (Element X sizes the image tile before loading it).
pub fn image_size(d: &[u8]) -> Option<(u32, u32)> {
    let be16 = |i: usize| Some(u16::from_be_bytes([*d.get(i)?, *d.get(i + 1)?]) as u32);
    let le16 = |i: usize| Some(u16::from_le_bytes([*d.get(i)?, *d.get(i + 1)?]) as u32);
    let be32 = |i: usize| Some(u32::from_be_bytes(d.get(i..i + 4)?.try_into().ok()?));
    let le24 = |i: usize| {
        Some(u32::from_le_bytes([
            *d.get(i)?,
            *d.get(i + 1)?,
            *d.get(i + 2)?,
            0,
        ]))
    };
    let size = if d.starts_with(b"\x89PNG\r\n\x1a\n") && d.get(12..16) == Some(b"IHDR") {
        (be32(16)?, be32(20)?)
    } else if d.starts_with(b"GIF87a") || d.starts_with(b"GIF89a") {
        (le16(6)?, le16(8)?)
    } else if d.starts_with(b"RIFF") && d.get(8..12) == Some(b"WEBP") {
        match d.get(12..16)? {
            b"VP8 " => (le16(26)? & 0x3fff, le16(28)? & 0x3fff),
            b"VP8L" => {
                let b = u32::from_le_bytes(d.get(21..25)?.try_into().ok()?);
                ((b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1)
            }
            b"VP8X" => (le24(24)? + 1, le24(27)? + 1),
            _ => return None,
        }
    } else if d.starts_with(&[0xff, 0xd8]) {
        // Walk the JPEG segments to the first start-of-frame.
        let mut i = 2;
        loop {
            while *d.get(i)? == 0xff && d.get(i + 1) == Some(&0xff) {
                i += 1;
            }
            if *d.get(i)? != 0xff {
                return None;
            }
            let marker = *d.get(i + 1)?;
            let len = be16(i + 2)? as usize;
            let sof = matches!(marker, 0xc0..=0xcf) && !matches!(marker, 0xc4 | 0xc8 | 0xcc);
            if sof {
                break (be16(i + 7)?, be16(i + 5)?);
            }
            i += 2 + len;
        }
    } else {
        return None;
    };
    (size.0 > 0 && size.1 > 0).then_some(size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Rich;
    use serde_json::json;

    fn parse(block: Value) -> Result<Rich, String> {
        Rich::parse(&json!({"v": 1, "blocks": [block]}).to_string())
    }

    fn enc(url: &str) -> Value {
        json!({"url": url, "v": "v2", "iv": "AAAAAAAAAAAAAAAAAAAAAA",
               "key": {"kty": "oct", "alg": "A256CTR", "ext": true, "key_ops": ["encrypt", "decrypt"], "k": "abc"},
               "hashes": {"sha256": "xyz"}})
    }

    #[test]
    fn mxc_uris() {
        assert!(is_mxc("mxc://example.org/AbC_d-1"));
        assert!(is_mxc("mxc://[::1]:8448/x"));
        for bad in [
            "https://x/y",
            "mxc://",
            "mxc://server",
            "mxc://server/",
            "mxc:///id",
            "mxc://s/a/b",
            "mxc://s/a b",
        ] {
            assert!(!is_mxc(bad), "{bad}");
        }
    }

    #[test]
    fn gallery() {
        let img = |u: &str| json!({"url": u, "caption": "A cat", "alt": "a cat", "w": 800, "h": 600, "mimetype": "image/jpeg"});
        let ok = json!({"type": "gallery", "title": "Cats", "images": [
            img("mxc://s/a"), {"file": enc("mxc://s/b"), "size": 10}]});
        let r = parse(ok.clone()).unwrap();
        assert_eq!(serde_json::to_value(&r).unwrap()["blocks"][0], ok);

        let many = json!({"type": "gallery", "images": vec![img("mxc://s/a"); 21]});
        for (bad, why) in [
            (
                json!({"type": "gallery", "images": [img("mxc://s/a")]}),
                "2 to 20",
            ),
            (many, "2 to 20"),
            (json!({"type": "gallery", "images": []}), "\"images\""),
            (
                json!({"type": "gallery", "images": [img("https://x/a.png"), img("mxc://s/b")]}),
                "mxc://",
            ),
            (
                json!({"type": "gallery", "images": [{"caption": "x"}, img("mxc://s/b")]}),
                "needs \"url\"",
            ),
            (
                json!({"type": "gallery", "images": [{"url": "mxc://s/a", "file": enc("mxc://s/a")}, img("mxc://s/b")]}),
                "not both",
            ),
            (
                json!({"type": "gallery", "images": [{"file": {"url": "mxc://s/a"}}, img("mxc://s/b")]}),
                "EncryptedFile",
            ),
            (
                json!({"type": "gallery", "images": [{"url": "mxc://s/a", "caption": "x".repeat(201)}, img("mxc://s/b")]}),
                "\"caption\"",
            ),
            (
                json!({"type": "gallery", "images": [{"url": "mxc://s/a", "w": 0}, img("mxc://s/b")]}),
                "\"w\"",
            ),
            (
                json!({"type": "gallery", "images": [{"url": "mxc://s/a", "mimetype": "text/html"}, img("mxc://s/b")]}),
                "image/*",
            ),
            (
                json!({"type": "gallery", "images": ["mxc://s/a", img("mxc://s/b")]}),
                "an object",
            ),
        ] {
            let err = parse(bad).unwrap_err();
            assert!(err.contains(why), "{why}: {err}");
        }
    }

    #[test]
    fn file() {
        let ok = json!({"type": "file", "name": "build.log", "size": 5120, "mimetype": "text/plain",
                        "url": "mxc://s/log", "preview": "line 1\nline 2", "thumbnail_url": "mxc://s/t"});
        parse(ok).unwrap();
        parse(json!({"type": "file", "name": "a.pdf", "file": enc("mxc://s/a"), "thumbnail_file": enc("mxc://s/t")})).unwrap();
        let lines = (0..41)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        for (bad, why) in [
            (json!({"type": "file", "url": "mxc://s/a"}), "\"name\""),
            (json!({"type": "file", "name": "a"}), "needs \"url\""),
            (
                json!({"type": "file", "name": "a", "url": "mxc://s/a", "preview": lines}),
                "40 lines",
            ),
            (
                json!({"type": "file", "name": "a", "url": "mxc://s/a", "preview": "x".repeat(4097)}),
                "4096 bytes",
            ),
            (
                json!({"type": "file", "name": "a", "url": "mxc://s/a", "size": -1}),
                "\"size\"",
            ),
            (
                json!({"type": "file", "name": "a", "url": "mxc://s/a", "thumbnail_url": "https://x"}),
                "\"thumbnail_url\"",
            ),
            (
                json!({"type": "file", "name": "x".repeat(256), "url": "mxc://s/a"}),
                "\"name\"",
            ),
        ] {
            let err = parse(bad).unwrap_err();
            assert!(err.contains(why), "{why}: {err}");
        }
    }

    #[test]
    fn previews() {
        assert_eq!(
            text_preview(b"a\r\nb\n\n\n").as_deref(),
            Some("a\nb"),
            "CRLF and trailing blank lines"
        );
        assert_eq!(text_preview(b"\x00\x01PNG"), None);
        assert_eq!(text_preview(b"\xff\xfe\xfd garbage"), None);
        assert_eq!(text_preview(b"  \n "), None);
        let long: String = (0..100).map(|i| format!("line {i}\n")).collect();
        let p = text_preview(long.as_bytes()).unwrap();
        assert_eq!(p.lines().count(), MAX_PREVIEW_LINES);
        // A multi-byte character cut at the byte cap.
        let wide = "é".repeat(MAX_PREVIEW_BYTES);
        let p = text_preview(wide.as_bytes()).unwrap();
        assert!(p.len() <= MAX_PREVIEW_BYTES && p.chars().all(|c| c == 'é'));
        // A preview always passes the block check.
        let block = json!({"type": "file", "name": "a", "url": "mxc://s/a", "preview": p});
        parse(block).unwrap();
    }

    #[test]
    fn image_sizes() {
        let mut png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR".to_vec();
        png.extend(640u32.to_be_bytes());
        png.extend(480u32.to_be_bytes());
        assert_eq!(image_size(&png), Some((640, 480)));
        let gif = b"GIF89a\x20\x03\x58\x02rest";
        assert_eq!(image_size(gif), Some((800, 600)));
        // JPEG: SOI, an APP0 segment, then SOF0 (precision, h, w).
        let jpeg = [
            0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01,
            0xe0, 0x02, 0x80,
        ];
        assert_eq!(image_size(&jpeg), Some((640, 480)));
        let mut webp = b"RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x00\x00\x00\x00".to_vec();
        webp.extend([0x7f, 0x02, 0x00, 0xdf, 0x01, 0x00]);
        assert_eq!(image_size(&webp), Some((640, 480)));
        assert_eq!(image_size(b"not an image"), None);
        assert_eq!(image_size(&[0xff, 0xd8, 0xff]), None);
    }
}
