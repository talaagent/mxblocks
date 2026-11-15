# Contributing

Use a focused branch and include a minimal synthetic reproduction for bugs.
The root is a virtual Cargo workspace and a private pnpm/Turbo orchestrator.
Keep Rust crates under `crates/` and JavaScript packages under `packages/`.

## Checks

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm check:rust
RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps --locked
cargo publish --workspace --dry-run --locked
scripts/privacy-check
nix flake check -L
```

The Nix shell provides resvg and fonts for math tests. One pnpm lockfile is
shared by local development, Turbo, CI, and the Nix fixed-output dependency
fetch. After changing JavaScript dependencies, update that lockfile and regenerate
`pnpmDeps.hash` in flake.nix with the usual fixed-output hash mismatch procedure.
Do not add npm lockfiles or rely on a globally installed bundler.

Rust, renderer, and specification tests share fixtures under
`crates/mxblocks/tests/fixtures/rich`. Preserve the key ordering, validation,
sender allow-list, fallback text, and namespaced `.used`/`.album` contracts.
Custom key configurations must affect reads and writes together and must not
implicitly accept unconfigured aliases.

## Packages and releases

Rust packages share version/edition/license/MSRV/dependencies at the root.
release-plz publishes the crates and `npm-release.yml` publishes the npm packages,
both through OIDC trusted publishing. See [RELEASING.md](RELEASING.md) for the
release flow and the one-time owner setup.

The Element bundle is a runtime module and uses the host's React, not a bundled
React instance. The math CLI needs a separately installed resvg and fonts; its
Nix wrapper pins those dependencies and supplies a timeout.

## Privacy before public visibility

Use example.org and synthetic IDs in public fixtures. Optional private patterns
live outside the repository and are passed through `MXBLOCKS_PRIVATE_PATTERNS`.
Never commit their actual values or an unsanitized match report. Current-tree
privacy checks do not remove material from Git history, PRs, tags, or artifacts.
Review those separately before changing repository visibility.

The Element build uses Nix esbuild 0.27.2; keep its npm version matched to
the Nix binary. The newer npm 0.28 line cannot be combined with this Nix binary.
Node type definitions track the supported Node 24 runtime.
