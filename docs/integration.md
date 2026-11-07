# Consuming mxblocks

Use the same release of the Rust types, Element module, and math CLI when adopting
wire-format changes. The Rust crates and npm packages have independent versions;
`artifacts/manifest.json` records the npm versions, entrypoints, and SHA-256 hashes.

## Rust

```sh
cargo add mxblocks mxblocks-asks mxblocks-tools mxblocks-tex
```

Each crate is also usable as a Git dependency. Cargo discovers the crate under
`crates/`; a Nix override that supplies crate sources directly must use
`${inputs.mxblocks}/crates/mxblocks` rather than the repository root. For the other
crates, use the matching directory under `crates/`.

```rust
use mxblocks::{Button, ContentKeys, Rich, Style};
use serde_json::{Map, Value};

let keys = ContentKeys::new("org.example.blocks");
let rich = Rich::buttons(vec![Button::react("Approve", Style::Default, "✅")]);
let mut content = Map::new();
content.insert("msgtype".into(), Value::String("m.text".into()));
content.insert("body".into(), Value::String("Approve this action? React ✅".into()));
keys.write_rich(&mut content, &rich);
assert_eq!(keys.read_rich(&content), Some(rich));
```

Namespaces and read aliases belong to the consuming application. Configure the
same keys in its sender and Element; old private aliases are never built in.

## Element deployment assets

```sh
pnpm add @talaagent/mxblocks-element
cp -R node_modules/@talaagent/mxblocks-element/dist/. ./public/modules/
```

Alternatively, unpack `mxblocks-element-assets-VERSION.tar.gz` from a GitHub
release or CI artifact directly into the directory served at `/modules/`. Keep
`mxblocks-rich.js`, its source map, and the complete `fonts/` directory together.
Verify downloaded files with `sha256sum -c SHA256SUMS`. The archive includes a
`config.example.json`; merge its module URL and your bot's sender allow-list into
Element's existing configuration. Never replace the whole configuration file.

This is an Element runtime module, not a React component library. Element supplies
React and module API `^2.2.0`; load the file through Element's `modules` setting.
The npm export `@talaagent/mxblocks-element/assets/mxblocks-rich.js` also exposes
the asset to build systems that resolve package subpaths.

## Math CLI

```sh
pnpm add @talaagent/mxblocks-math
pnpm exec mxblocks-math render --out formula.png 'x^2 + y^2 = z^2'
```

The npm CLI requires Node 24+, `resvg`, and fonts. Configure
`MXBLOCKS_MATH_RESVG` and `MXBLOCKS_MATH_FONT_DIR` explicitly in a service. It reads
TeX from stdin when the last argument is `-` and returns one JSON line containing
`mimetype`, `w`, `h`, and `size`. `mxblocks_tex::Renderer` consumes this contract.
An application can install the CLI locally and pass its `.bin/mxblocks-math` path
to `Renderer::new`, without any global npm installation.

## Nix deployments

Use the flake as a normal public input, pinned in the consuming application's
`flake.lock`:

```nix
{
  inputs.mxblocks.url = "github:talaagent/mxblocks";

  outputs = { self, nixpkgs, mxblocks, ... }: let
    system = "x86_64-linux";
    packages = mxblocks.packages.${system};
  in {
    # Copy this directory into the Element static document root under /modules/.
    packages.${system}.element-assets = packages.element-module;
    # Add this package to the service's PATH or pass its bin path to Renderer.
    packages.${system}.math-cli = packages.mxblocks-math;
  };
}
```

`element-module` contains the bundle/map/fonts at its output root. `mxblocks-math`
contains `bin/mxblocks-math` with pinned Node, resvg, fonts, dependencies, and a
wall-clock timeout. These output names remain stable across the workspace move.
Do not set `flake = false` when consuming the packages. An application using the
input only for Cargo source overrides can continue using `flake = false`.

## Building release archives

```sh
nix develop --command pnpm install --frozen-lockfile
nix develop --command pnpm check
pnpm artifacts
```

The final command builds both packages and writes two scoped npm archives, the
Element deployment archive, `manifest.json`, and `SHA256SUMS` under `artifacts/`.
CI uploads these files for every tested commit. The npm release workflow attaches
the same files to its GitHub release after publishing both versions.
