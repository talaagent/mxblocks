# mxblocks

[![CI](https://github.com/talaagent/mxblocks/actions/workflows/ci.yml/badge.svg)](https://github.com/talaagent/mxblocks/actions/workflows/ci.yml)
[![crates.io](https://img.shields.io/crates/v/mxblocks.svg)](https://crates.io/crates/mxblocks)
[![Rust docs](https://docs.rs/mxblocks/badge.svg)](https://docs.rs/mxblocks)
[![Element npm](https://img.shields.io/npm/v/@talaagent/mxblocks-element.svg?label=Element)](https://www.npmjs.com/package/@talaagent/mxblocks-element)
[![Math npm](https://img.shields.io/npm/v/@talaagent/mxblocks-math.svg?label=math)](https://www.npmjs.com/package/@talaagent/mxblocks-math)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Rich message blocks for Matrix bots: buttons, chips, tables, charts, cards,
progress, trackers, forms, media galleries, and math. Blocks ride as an extra
key on an ordinary `m.room.message`. Clients that understand that key render
them; everyone else sees the plain `body`, so every message stands on its own.

The [specification](docs/spec.md) defines the wire contract. Applications control
their payload namespace and its compatibility aliases.

## Workspace

| Path | Package | Purpose |
| --- | --- | --- |
| `crates/mxblocks` | `mxblocks` | serde types, validation, content keys, shared fixtures |
| `crates/mxblocks-asks` | `mxblocks-asks` | reaction asks and buttons |
| `crates/mxblocks-tex` | `mxblocks-tex` | math renderer integration and Matrix image events |
| `crates/mxblocks-tools` | `mxblocks-tools` | rich_send/rich_edit definitions and validation |
| `packages/mxblocks-element` | `@talaagent/mxblocks-element` | Element Web runtime renderer |
| `packages/mxblocks-math` | `@talaagent/mxblocks-math` | MathJax + resvg LaTeX-to-PNG CLI |

Cargo metadata/dependencies are shared at the virtual workspace root. JavaScript
packages use one pnpm lockfile; Turborepo runs their builds, tests, and typechecks.
The root JavaScript package is private; the two packages have explicit file lists
and can be packed independently.

## Install

```sh
cargo add mxblocks
pnpm add @talaagent/mxblocks-element @talaagent/mxblocks-math
```

Rust APIs: [mxblocks](https://docs.rs/mxblocks),
[mxblocks-asks](https://docs.rs/mxblocks-asks),
[mxblocks-tex](https://docs.rs/mxblocks-tex), and
[mxblocks-tools](https://docs.rs/mxblocks-tools).
See the [integration guide](docs/integration.md) for deployment archives, npm,
and Nix consumption, including the Cargo source paths after the workspace move.

## Application-selected keys

```rust
use mxblocks::{Button, ContentKeys, Rich, Style};
use serde_json::Map;

let keys = ContentKeys::new("org.example.blocks")
    .with_read_aliases(["org.example.previous"]);
let rich = Rich::buttons(vec![Button::react("OK", Style::Default, "👍")]);
let mut content = Map::new();
keys.write_rich(&mut content, &rich);
assert_eq!(keys.read_rich(&content), Some(rich));
```

`ContentKeys` reads only its configured namespaces and derives matching `.used`
and `.album` keys. Its write methods remove stale configured aliases on edits.
Default helpers retain `com.talaagent.mxblocks` and `com.ianm.mtrix` as public
compatibility keys. `WriteKey::Custom` chooses an arbitrary writer namespace;
use `ContentKeys` when the reader aliases should be configurable too.

Element has the corresponding configuration under its public settings key:

```json
{
  "com.talaagent.mxblocks": {
    "senders": ["@bot:example.org"],
    "write_key": "org.example.blocks",
    "read_keys": ["org.example.previous"]
  }
}
```

The writer key is also read. Custom keys have no implicit compatibility aliases.
The sender allow-list remains required, and plain message bodies remain the
fallback for clients without the module.

## Development

Use Rust 1.88+, Node 24.21+, and the pnpm version pinned in `packageManager`.
`nix develop` supplies the Rust/Node tools, pnpm, resvg, and fonts.

```sh
pnpm install --frozen-lockfile
pnpm check                   # Turbo: typecheck, test, build
pnpm check:rust              # entire Cargo workspace
scripts/privacy-check        # generic current-tree privacy patterns
```

`pnpm test` runs the math renderer against resvg. Outside the Nix shell, install
resvg and fonts or set `MXBLOCKS_MATH_BIN` to a built wrapper. Math tests are
uncached because they execute external tools. Turbo also tracks shared Rust
fixtures and the renderer environment; `pnpm --filter <package> <script>` runs
one package directly.

```sh
nix build .#element-module    # result/mxblocks-rich.js, map, and fonts/
nix build .#mxblocks-math     # result/bin/mxblocks-math
nix flake check -L
```

Nix uses the same pnpm workspace and lockfile. See the package READMEs for
[Element installation](packages/mxblocks-element/README.md) and the
[math CLI](packages/mxblocks-math/README.md), and
[CONTRIBUTING.md](CONTRIBUTING.md) for release and privacy checks.

## License

[Apache-2.0](LICENSE), with dependency and font attribution in [NOTICE](NOTICE).
