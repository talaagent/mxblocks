# mxblocks-math

LaTeX-to-PNG CLI using MathJax and a separate `resvg` process. The command reads
TeX as an argument or from stdin and writes a PNG plus JSON dimensions:

```sh
mxblocks-math render --out formula.png 'x^2 + y^2 = z^2'
printf '%s' '\frac{a}{b}' | mxblocks-math render --inline --out fraction.png -
```

Node 24.21 or newer, `resvg`, and fonts are required. Set `MXBLOCKS_MATH_RESVG` and
`MXBLOCKS_MATH_FONT_DIR` when they are not available through the environment.
`nix build .#mxblocks-math` provides a wrapper with pinned dependencies, fonts,
and a wall-clock timeout. For development, `nix develop` supplies the same tools.

From the root, run `pnpm --filter @talaagent/mxblocks-math test` or `pnpm test` through Turbo.
`MXBLOCKS_MATH_BIN` can select an already-built wrapper for tests.

Apache-2.0. See LICENSE and NOTICE for dependency attribution.
