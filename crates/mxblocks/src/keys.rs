//! Caller-controlled message namespaces and the default compatibility keys.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::Rich;

/// The content key written today ([`WriteKey::Legacy`], the default).
pub const RICH_KEY: &str = "com.ianm.mtrix";
/// The new content key ([`WriteKey::New`]). Readers accept it now; writers
/// switch to it once every renderer they target reads it.
pub const RICH_KEY_NEW: &str = "com.talaagent.mxblocks";
/// Every content key a reader must accept, in the order to try them.
pub const RICH_KEYS: &[&str] = &[RICH_KEY_NEW, RICH_KEY];
/// `<key>.used`: what a click sent (on the clicking user's message), for
/// every key in [`RICH_KEYS`], in the same order.
pub const USED_KEYS: &[&str] = &["com.talaagent.mxblocks.used", "com.ianm.mtrix.used"];
/// `<key>.album`: the gallery marker on album images, for every key in
/// [`RICH_KEYS`], in the same order.
pub const ALBUM_KEYS: &[&str] = &["com.talaagent.mxblocks.album", "com.ianm.mtrix.album"];
/// Which key a writer puts the payload (and a click's `.used`, and an
/// album's `.album`) under. Default readers accept the public compatibility keys;
/// use [`ContentKeys`] for custom reader namespaces.
///
/// The default is [`WriteKey::Legacy`] (`com.ianm.mtrix`), what every
/// deployed renderer reads; flip to [`WriteKey::New`] only after the
/// renderers that matter read [`RICH_KEY_NEW`].
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WriteKey {
    /// `com.ianm.mtrix` ([`RICH_KEY`]).
    #[default]
    Legacy,
    /// `com.talaagent.mxblocks` ([`RICH_KEY_NEW`]).
    New,
    /// A caller-selected payload key; suffixes are derived from it.
    #[serde(untagged)]
    Custom(String),
}

impl WriteKey {
    /// The payload key.
    pub fn rich_key(&self) -> &str {
        match self {
            WriteKey::Legacy => RICH_KEY,
            WriteKey::New => RICH_KEY_NEW,
            WriteKey::Custom(key) => key,
        }
    }

    /// The `.used` key (a click's echo).
    pub fn used_key(&self) -> String {
        format!("{}.used", self.rich_key())
    }

    /// The `.album` key (a gallery image's marker).
    pub fn album_key(&self) -> String {
        format!("{}.album", self.rich_key())
    }

    /// Puts `rich` under [`WriteKey::rich_key`] in `content` and removes it
    /// from every other key in [`RICH_KEYS`], so an edit never leaves a stale
    /// payload behind under another key.
    pub fn write_rich(&self, content: &mut Map<String, Value>, rich: &Rich) {
        strip_rich(content);
        content.insert(
            self.rich_key().to_owned(),
            serde_json::to_value(rich).unwrap_or(Value::Null),
        );
    }

    /// Puts `used` under [`WriteKey::used_key`], removing the other `.used` keys.
    pub fn write_used(&self, content: &mut Map<String, Value>, used: Value) {
        for k in USED_KEYS {
            content.remove(*k);
        }
        content.insert(self.used_key().to_owned(), used);
    }

    /// Puts `album` under [`WriteKey::album_key`], removing the other `.album` keys.
    pub fn write_album(&self, content: &mut Map<String, Value>, album: Value) {
        for k in ALBUM_KEYS {
            content.remove(*k);
        }
        content.insert(self.album_key().to_owned(), album);
    }
}

/// The first of `keys` present in `content`, with its value.
fn first_of<'a>(
    content: &'a Map<String, Value>,
    keys: &[&'static str],
) -> Option<(&'static str, &'a Value)> {
    keys.iter().find_map(|k| content.get(*k).map(|v| (*k, v)))
}

/// The raw payload of an event `content` under any of [`RICH_KEYS`] (the
/// newest key present wins), with the key it was under.
pub fn rich_value(content: &Map<String, Value>) -> Option<(&'static str, &Value)> {
    first_of(content, RICH_KEYS)
}

/// The payload of an event `content` under any of [`RICH_KEYS`]: the first
/// key, newest first, whose value deserializes. Not validated: the payload
/// may come from a newer sender (unknown blocks load as [`crate::Block::Unknown`]).
pub fn read_rich(content: &Map<String, Value>) -> Option<Rich> {
    RICH_KEYS
        .iter()
        .filter_map(|k| content.get(*k))
        .find_map(|v| serde_json::from_value(v.clone()).ok())
}

/// A click's `.used` echo under any of [`USED_KEYS`] (newest first).
pub fn read_used(content: &Map<String, Value>) -> Option<&Value> {
    first_of(content, USED_KEYS).map(|(_, v)| v)
}

/// An album marker under any of [`ALBUM_KEYS`] (newest first).
pub fn read_album(content: &Map<String, Value>) -> Option<&Value> {
    first_of(content, ALBUM_KEYS).map(|(_, v)| v)
}

/// Removes the payload under every key in [`RICH_KEYS`] (an edit that drops
/// the blocks). Whether any was there.
pub fn strip_rich(content: &mut Map<String, Value>) -> bool {
    let mut any = false;
    for k in RICH_KEYS {
        any |= content.remove(*k).is_some();
    }
    any
}

/// A writer namespace and an explicit, ordered set of reader namespaces.
///
/// `new` reads only the selected write key. Add compatibility aliases explicitly
/// with [`Self::with_read_aliases`]. The default retains the two public keys.
///
/// ```
/// use mxblocks::{Button, ContentKeys, Rich, Style};
/// use serde_json::{Map, json};
///
/// let keys = ContentKeys::new("org.example.blocks")
///     .with_read_aliases(["org.example.previous"]);
/// let rich = Rich::buttons(vec![Button::react("OK", Style::Default, "👍")]);
/// let mut content = Map::new();
/// keys.write_rich(&mut content, &rich);
/// assert_eq!(keys.read_rich(&content), Some(rich));
/// keys.write_used(&mut content, json!({"id": "choice"}));
/// assert!(content.contains_key("org.example.blocks.used"));
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentKeys {
    write: WriteKey,
    read: Vec<String>,
}

impl Default for ContentKeys {
    fn default() -> Self {
        Self {
            write: WriteKey::default(),
            read: RICH_KEYS.iter().map(|key| (*key).to_owned()).collect(),
        }
    }
}

impl ContentKeys {
    /// Read and write only `key`, deriving its `.used` and `.album` keys.
    pub fn new(key: impl Into<String>) -> Self {
        let key = key.into();
        Self {
            write: WriteKey::Custom(key.clone()),
            read: vec![key],
        }
    }

    /// Add read aliases after the primary write key, preserving order and
    /// discarding duplicates. Callers decide which compatibility keys to accept.
    pub fn with_read_aliases<I, S>(mut self, aliases: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        for alias in aliases {
            let alias = alias.into();
            if !self.read.contains(&alias) {
                self.read.push(alias);
            }
        }
        self
    }

    /// The chosen writer.
    pub fn writer(&self) -> &WriteKey {
        &self.write
    }

    /// The exact read keys, highest priority first.
    pub fn read_keys(&self) -> &[String] {
        &self.read
    }

    /// The first configured key present, together with its raw value.
    pub fn rich_value<'k, 'c>(
        &'k self,
        content: &'c Map<String, Value>,
    ) -> Option<(&'k str, &'c Value)> {
        self.read
            .iter()
            .find_map(|key| content.get(key).map(|v| (key.as_str(), v)))
    }

    /// The first payload under the configured keys that deserializes as [`Rich`].
    pub fn read_rich(&self, content: &Map<String, Value>) -> Option<Rich> {
        self.read
            .iter()
            .filter_map(|key| content.get(key))
            .find_map(|value| serde_json::from_value(value.clone()).ok())
    }

    /// A click echo under a configured `.used` key.
    pub fn read_used<'c>(&self, content: &'c Map<String, Value>) -> Option<&'c Value> {
        self.read
            .iter()
            .find_map(|key| content.get(&format!("{key}.used")))
    }

    /// An album marker under a configured `.album` key.
    pub fn read_album<'c>(&self, content: &'c Map<String, Value>) -> Option<&'c Value> {
        self.read
            .iter()
            .find_map(|key| content.get(&format!("{key}.album")))
    }

    /// Remove rich payloads under the configured keys. Return whether any existed.
    pub fn strip_rich(&self, content: &mut Map<String, Value>) -> bool {
        let mut removed = false;
        for key in &self.read {
            removed |= content.remove(key).is_some();
        }
        removed
    }

    /// Write a payload, removing stale payloads under configured aliases only.
    pub fn write_rich(&self, content: &mut Map<String, Value>, rich: &Rich) {
        self.strip_rich(content);
        content.insert(
            self.write.rich_key().to_owned(),
            serde_json::to_value(rich).unwrap_or(Value::Null),
        );
    }

    /// Write a click echo, removing stale configured `.used` aliases.
    pub fn write_used(&self, content: &mut Map<String, Value>, used: Value) {
        for key in &self.read {
            content.remove(&format!("{key}.used"));
        }
        content.insert(self.write.used_key(), used);
    }

    /// Write an album marker, removing stale configured `.album` aliases.
    pub fn write_album(&self, content: &mut Map<String, Value>, album: Value) {
        for key in &self.read {
            content.remove(&format!("{key}.album"));
        }
        content.insert(self.write.album_key(), album);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Button, Style};
    use serde_json::json;

    fn rich() -> Rich {
        Rich::buttons(vec![Button::react("OK", Style::Default, "👍")])
    }

    #[test]
    fn custom_namespaces_read_aliases_and_remove_stale_values_on_edit() {
        let keys = ContentKeys::new("org.example.blocks")
            .with_read_aliases(["org.example.old", "org.example.old"]);
        let value = rich();
        let mut content = Map::new();
        content.insert(
            "org.example.old".into(),
            serde_json::to_value(&value).unwrap(),
        );
        content.insert("org.example.unrelated".into(), json!(true));
        assert_eq!(keys.read_rich(&content), Some(value.clone()));
        assert_eq!(read_rich(&content), None);
        keys.write_rich(&mut content, &value);
        assert!(!content.contains_key("org.example.old"));
        assert_eq!(content["org.example.unrelated"], json!(true));
        assert_eq!(keys.rich_value(&content).unwrap().0, "org.example.blocks");
        assert_eq!(keys.read_keys().len(), 2);
    }

    #[test]
    fn custom_reply_and_album_keys_are_consistent() {
        let keys = ContentKeys::new("org.example.blocks").with_read_aliases(["org.example.old"]);
        let mut content = Map::new();
        content.insert("org.example.old.used".into(), json!({"id": "old"}));
        content.insert("org.example.old.album".into(), json!({"index": 2}));
        assert_eq!(keys.read_used(&content), Some(&json!({"id": "old"})));
        assert_eq!(keys.read_album(&content), Some(&json!({"index": 2})));
        keys.write_used(&mut content, json!({"id": "new"}));
        keys.write_album(&mut content, json!({"index": 3}));
        assert!(!content.contains_key("org.example.old.used"));
        assert!(!content.contains_key("org.example.old.album"));
        assert_eq!(keys.read_used(&content), Some(&json!({"id": "new"})));
        assert_eq!(keys.read_album(&content), Some(&json!({"index": 3})));
        assert_eq!(read_used(&content), None);
        assert_eq!(read_album(&content), None);
    }

    #[test]
    fn custom_writer_round_trips_in_configuration() {
        let key = WriteKey::Custom("org.example.blocks".into());
        let encoded = serde_json::to_value(&key).unwrap();
        assert_eq!(encoded, json!("org.example.blocks"));
        assert_eq!(serde_json::from_value::<WriteKey>(encoded).unwrap(), key);
    }
}
