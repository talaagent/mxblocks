# mxblocks-tex

Math messages for [mxblocks](https://github.com/talaagent/mxblocks/blob/main/README.md): render a formula with the
`mxblocks-math` program and build the `m.image` event that carries
it, with MSC2191 markup (`data-mx-maths`) for clients that render LaTeX and
the raw TeX as the plain body.

## Runtime requirement

The crate builds with no extra tools, but rendering runs an external renderer at
runtime. The default is `mxblocks-math` on `PATH`, published to npm as
[`@talaagent/mxblocks-math`](https://www.npmjs.com/package/@talaagent/mxblocks-math):

```sh
npm install --global @talaagent/mxblocks-math   # needs Node 24.21+
# plus `resvg` and fonts; see the package README for MXBLOCKS_MATH_RESVG / MXBLOCKS_MATH_FONT_DIR
```

With Nix, `nix build github:talaagent/mxblocks#mxblocks-math` gives a wrapper with
resvg and fonts pinned. `Renderer::new` takes any path, so a different program
that keeps the contract below works too. Without a renderer, `render` returns an
error and the rest of the crate (`math_content`, `maths_html`, `with_caption`)
still works.

The renderer contract: `mxblocks-math render [--inline] --out PATH.png -`,
TeX on stdin; exit 0 with one JSON line on stdout
(`{"mimetype":"image/png","w":W,"h":H,"size":BYTES}`, `w`/`h` the display
size of a 2x PNG), or non-zero with the TeX error on stderr.

```no_run
# async fn render() -> Result<(), Box<dyn std::error::Error>> {
let r = mxblocks_tex::Renderer::new("mxblocks-math").render(r"e^{i\pi} + 1 = 0", true).await?;
// Upload r.png with your Matrix client, then pass its returned mxc URI.
let mxc = "mxc://example.org/rendered";
let content = mxblocks_tex::math_content(r"e^{i\pi} + 1 = 0", true, "", &r, &mxc, None);
assert_eq!(content["msgtype"], "m.image");
# Ok(())
# }
```

Apache-2.0.
