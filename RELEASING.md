# Releasing

| Package | Registry | Workflow | Auth |
|---|---|---|---|
| `mxblocks`, `mxblocks-asks`, `mxblocks-tex`, `mxblocks-tools` | crates.io | `release-plz.yml` (environment `release`) | crates.io trusted publishing (OIDC) |
| `@talaagent/mxblocks-element`, `@talaagent/mxblocks-math` | npm | `npm-release.yml` (environment `npm`) | npm trusted publishing (OIDC), with provenance |

No long-lived registry token is stored in GitHub.

## Rust crates (release-plz)

1. Merge changes to `main` as usual (conventional commit titles feed the changelog).
2. `release-plz.yml` opens or updates a `chore: release vX.Y.Z` PR. All four crates
   share one version (`version_group = "mxblocks"`). The workflow dispatches CI on
   that PR, because PRs created by the built-in token don't trigger workflows on their own.
3. Merge the release PR. The `publish` job publishes the new versions to crates.io
   in dependency order, tags them, and creates the GitHub release (`mxblocks` is
   marked as the latest release).

`cargo publish --workspace --dry-run --locked` runs in CI on every PR.

Manual or partial release: run the `release` workflow from the Actions tab with
`bootstrap: true` and an optional `release_packages` list. It publishes the
committed versions without needing a release PR.

## npm packages

1. `pnpm version:packages X.Y.Z`. Both packages share one version. Add the
   changes to `CHANGELOG.md`.
2. Run `pnpm check && pnpm artifacts` and inspect `artifacts/` (`tar tzf ...`).
3. Open a PR and merge it. On `main`, `npm-release.yml` builds and tests the
   packages, packs them, and publishes each `name@version` that is not on the
   registry yet, with `--provenance`. It then attaches the tarballs and the Element
   deployment archive to a GitHub release named `npm-element-X-math-Y`.

Publishing only runs when the repository variable `NPM_RELEASE` is `true`.
Until then the workflow is skipped.

## One-time setup: current state (2026-11)

- crates.io: **done**. Ian (`macalinao`) published 0.1.0 by hand with a
  token, and 0.1.1 was published by `release-plz.yml` through trusted publishing.
  So all four crates already have the GitHub trusted publisher configured.
  Optional hardening: on each crate's crates.io Settings page, turn on
  "require trusted publishing" so tokens can no longer publish.
- GitHub: environments `release` and `npm` exist, and `RELEASE_PR=true` is set.
  Optional: restrict both environments to the `main` branch.
- npm: **not done**. Nothing is published, and the `@talaagent` scope is not
  claimed yet (no npm user or org called `talaagent`).

## One-time setup: owner steps for npm

npm can only attach a trusted publisher to a package that already exists, so the
first version has to be published with a token.

1. On npmjs.com (Ian's account, 2FA on), create the free organization
   **`talaagent`**. This claims the `@talaagent` scope.
2. Publish 0.1.0 of both packages. Pick one:
   - **CI bootstrap (recommended: the first version also gets provenance).**
     Create a granular access token: read/write for packages and scopes,
     limited to the `@talaagent` scope, 1-day expiry, "bypass 2FA" on. Add it as
     an **environment secret** `NPM_BOOTSTRAP_TOKEN` on the `npm` environment, set
     the repository variable `NPM_RELEASE=true`, then run "npm release" from the
     Actions tab (workflow_dispatch on `main`).
   - **Local.** `pnpm install --frozen-lockfile && nix develop --command pnpm check && pnpm artifacts`,
     then `npm login` and
     `npm publish ./artifacts/talaagent-mxblocks-element-0.1.0.tgz --access public`
     and the same for `talaagent-mxblocks-math-0.1.0.tgz`. Keep the `./`:
     without it, npm reads the path as a GitHub shorthand. This first version
     has no provenance.
3. For each package, go to npmjs.com → package → Settings → Trusted publisher →
   GitHub Actions: organization `talaagent`, repository `mxblocks`, workflow
   `npm-release.yml`, environment `npm`.
4. If you used the CI bootstrap, delete the `NPM_BOOTSTRAP_TOKEN` secret and
   revoke the token on npmjs.com.
5. Make sure the repository variable `NPM_RELEASE=true` is set.
6. Optional hardening: on each package's settings page, set publishing access to
   "Require two-factor authentication and disallow tokens". Trusted publishing
   still works with that setting.

## Adding a new crate later

A new crate also needs one manual first publish. Locally, use the crates.io token
in Vaultwarden ("crates.io publish token (tala)"): `cargo publish -p <crate>`.
Trusted publishing can't create a crate. Then, on crates.io → the crate →
Settings → Trusted Publishing, add GitHub: owner `talaagent`, repository
`mxblocks`, workflow `release-plz.yml`, environment `release`. Add the crate to
`release-plz.toml` with `version_group = "mxblocks"`.

## Before any release

- `scripts/privacy-check` (CI runs it with the private pattern list from the
  `MXBLOCKS_PRIVATE_PATTERNS` secret).
- `nix run nixpkgs#gitleaks -- detect --log-opts=--all` for the full history.
