# Changelog

All notable changes to the `mxblocks` crate are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
crate uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1](https://github.com/talaagent/mxblocks/compare/mxblocks-v0.1.0...mxblocks-v0.1.1) - 2026-11-07

### Other

- Refresh Nix inputs and keep npm tooling compatible with the supported runtime

## [0.1.0] - 2026-11-07

First release as a standalone crate. It unifies two earlier
implementations of the format, one in a Matrix client and one in a bot,
which had drifted apart. Where they differed, the choices are listed
under Changed.

### Added

- `canonical_content`: a whole event's content with its floats made decimal
  strings (Matrix refuses JSON floats), unchanged when it has none or one
  can't be fixed.
- Workspace crates: `mxblocks-tex` (math messages: the `mxblocks-math`
  renderer client and the `m.image` content), `mxblocks-asks` (reaction
  asks: `[ask: …]` markers and the safety net, planned into messages with
  buttons and seeds) and `mxblocks-tools` (`rich_send` / `rich_edit` tool
  specs and argument checks).
- Two content keys, read newest first: `com.talaagent.mxblocks`,
  `com.ianm.mtrix` (`RICH_KEYS`, `USED_KEYS`,
  `ALBUM_KEYS`).
- `WriteKey` picks the one key a writer uses. The default, `Legacy`, writes
  `com.ianm.mtrix`; `New` writes `com.talaagent.mxblocks`.
- `read_rich`, `read_used`, `read_album`, `rich_value` and `strip_rich`.

### Changed

- The sample payloads in `crates/mxblocks/tests/fixtures/rich/` use invented shops, items
  and people only.
- **One math block per message.** `Rich::validate` now rejects a payload
  with more than one `math` block ("at most one math block per message").
  One of the earlier implementations accepted several.
- The accessor for a message's math block is now `Rich::find_math`.
  `Rich::math` is the constructor. Code that used `Rich::math()` as an
  accessor must switch to `find_math()`.

### Workspace

- Move every Rust crate under crates/ with shared workspace metadata.
- Add a pnpm/Turborepo workspace for the Element module and math CLI.
- Let applications configure reader aliases and writer namespaces, including reply and album keys.
