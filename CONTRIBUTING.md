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
release-plz handles Rust release PRs and crates.io publication through OIDC.
Actions-created PRs are enabled at the organization/repository level; RELEASE_PR=true
allows the built-in GitHub token to create them. CI is dispatched explicitly for
these PRs. First publication uses a scoped maintainer token locally, followed by a
trusted publisher for each crate (`release-plz.yml`, environment `release`). No
long-lived crates.io token is stored in Actions.

JavaScript packages are public under `@talaagent`. Use
`pnpm version:packages <major.minor.patch>` and describe changes in CHANGELOG.md.
On merge to main, `npm-release.yml` checks the registry, publishes only versions
that do not exist, and attaches deployment assets to a GitHub release. Network
errors fail the release rather than being interpreted as missing versions.
First publish each package with npm organization access, then configure its
GitHub trusted publisher: owner `talaagent`, repo `mxblocks`, workflow
`npm-release.yml`, environment `npm`, with direct publishing allowed. Set the repository variable `NPM_RELEASE=true`
after both publishers are configured. Until then, CI still builds and uploads
the tested deployment archives. The workflow
uses npm OIDC and provenance; no npm token is stored in Actions. Run
`pnpm artifacts` before merging a package release and inspect the archives.

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
