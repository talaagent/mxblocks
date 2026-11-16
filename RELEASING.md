# Releasing

| Package | Registry | Workflow | Auth |
|---|---|---|---|
| `mxblocks`, `mxblocks-asks`, `mxblocks-tex`, `mxblocks-tools` | crates.io | `release-plz.yml` (environment `release`) | crates.io trusted publishing (OIDC) |
| `@talaagent/mxblocks-element` | npm | `npm-release.yml` (environment `npm`), driven by [changesets](https://github.com/changesets/changesets) | npm trusted publishing (OIDC), with provenance |

No long-lived registry token is stored in GitHub. `@talaagent/mxblocks-math`
is private: it is not published to npm (consumers use the Nix package or the
repository), and changesets ignores it.

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

## npm package (changesets)

1. Every PR that changes what `@talaagent/mxblocks-element` ships adds a
   changeset: run `pnpm changeset`, pick the package and the bump
   (patch/minor/major), and write a line for the changelog. This commits a
   `.changeset/*.md` file with the PR. Changes that don't affect the package
   need no changeset.
2. On `main`, `npm-release.yml` runs
   [changesets/action](https://github.com/changesets/action). While changesets
   are pending it opens or updates a **Version Packages** PR on the
   `changeset-release/main` branch: `changeset version` bumps
   `packages/mxblocks-element/package.json`, writes its `CHANGELOG.md` (with PR
   and author links from `@changesets/changelog-github`, using the workflow's
   `GITHUB_TOKEN`) and deletes the consumed changesets. The workflow then starts
   CI on that branch, because PRs opened by the built-in token don't trigger
   workflows on their own.
3. Merge the Version Packages PR. With no changesets left, the action runs
   `scripts/publish-packages`: for each public package whose version is not on
   npm yet (a genuine registry 404), it runs
   `npm publish ./artifacts/<archive>.tgz --access public --provenance` on the
   archive that `pnpm artifacts` built and `scripts/test-artifacts` tested in the
   same job. Then `changeset git-tag` tags `@talaagent/mxblocks-element@X.Y.Z`,
   and the action pushes the tag and creates the GitHub release from the
   changelog entry. The workflow attaches the npm archives, the Element
   deployment archive, `manifest.json` and `SHA256SUMS` to that release.

A version that is already on npm is never published again, so a version
published by hand (such as the first 0.1.0) is only tagged and released. Re-running
the workflow is safe. Check locally with `pnpm changeset status`,
`pnpm artifacts` and `python3 scripts/publish-packages --dry-run`.

Publishing only runs when the repository variable `NPM_RELEASE` is `true`.
Until then the workflow is skipped. Settings → Actions → General must allow
GitHub Actions to create pull requests (already needed for release-plz).

## One-time setup: current state (2026-11)

- crates.io: **done**. Ian (`macalinao`) published 0.1.0 by hand with a
  token, and 0.1.1 was published by `release-plz.yml` through trusted publishing.
  So all four crates already have the GitHub trusted publisher configured.
  Optional hardening: on each crate's crates.io Settings page, turn on
  "require trusted publishing" so tokens can no longer publish.
- GitHub: environments `release` and `npm` exist, and `RELEASE_PR=true` is set.
  Optional: restrict both environments to the `main` branch.
- npm: **not done**. Nothing is published, and the `@talaagent` scope is not
  claimed yet (no npm user or org called `talaagent`). Only
  `@talaagent/mxblocks-element` will be published; `@talaagent/mxblocks-math` stays
  off npm.

## One-time setup: owner steps for npm

npm can only attach a trusted publisher to a package that already exists, so the
first version is published by hand with a token. The workflow has no token
fallback (the old `NPM_BOOTSTRAP_TOKEN` path is gone); the repository needs no
npm secret at all.

1. On npmjs.com (Ian's account, 2FA on), create the free organization
   **`talaagent`**. This claims the `@talaagent` scope.
2. Publish 0.1.0 locally, from an up-to-date `main`:
   `pnpm install --frozen-lockfile && nix develop --command pnpm check && pnpm artifacts`,
   then `npm login` and
   `npm publish ./artifacts/talaagent-mxblocks-element-0.1.0.tgz --access public`.
   Keep the `./`: without it, npm reads the path as a GitHub shorthand. This
   first version has no provenance. Don't add a changeset for it: the committed
   version is already 0.1.0, and a changeset would bump it to 0.1.1.
3. On npmjs.com → `@talaagent/mxblocks-element` → Settings → Trusted publisher →
   GitHub Actions: organization `talaagent`, repository `mxblocks`, workflow
   `npm-release.yml`, environment `npm`.
4. Set the repository variable `NPM_RELEASE=true`. The next run of "npm release"
   (on a push to `main`, or from the Actions tab) finds 0.1.0 on npm, skips the
   publish, and tags and releases it with the deployment assets.
5. Optional hardening: on the package's settings page, set publishing access to
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
