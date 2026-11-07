// `math` blocks, drawn with KaTeX bundled into the module (no CDN). KaTeX's
// CSS is injected once, on first use, with its @font-face URLs pointing at
// the woff2 files shipped next to mxblocks-rich.js (`fonts/`, resolved against
// import.meta.url, so the module and its fonts move together).
//
// This is the one place the module sets innerHTML: the markup is KaTeX's
// own output for a TeX string, with trust off (no \href, \url,
// \includegraphics, \htmlClass/\htmlData/..., so no links, URLs, classes or
// attributes from the payload), errors thrown (a broken formula falls back
// to the image or the TeX source, never a half-rendered one), and
// maxSize/maxExpand caps against size and macro bombs.

import katexCss from "katex/dist/katex.min.css";

import { rebaseKatexCss, renderTex } from "../lib/tex.ts";
import { React } from "../react";
import type { MathBlock } from "../schema/index.ts";

const STYLE_ID = "mxblocks-katex";

function injectKatexCss(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = rebaseKatexCss(katexCss, new URL("./fonts/", import.meta.url).href);
  document.head.appendChild(style);
}

export interface MathProps {
  block: MathBlock;
  /** What to draw when KaTeX can't render the TeX (default: the TeX source). */
  fallback?: React.ReactNode;
}

export function MathView({ block, fallback }: MathProps): React.JSX.Element {
  const html = React.useMemo(() => renderTex(block.tex, block.display), [block.tex, block.display]);
  React.useLayoutEffect(() => {
    if (html !== null) injectKatexCss();
  }, [html]);
  if (html === null) {
    return (
      <>
        {fallback ?? (
          <code className="mxblocks_mathSource" title="LaTeX">
            {block.tex}
          </code>
        )}
      </>
    );
  }
  const Tag = block.display ? "div" : "span";
  return (
    <figure
      className={`mxblocks_math ${block.display ? "mxblocks_mathDisplay" : "mxblocks_mathInline"}`}
      role="group"
      aria-label={block.alt ?? block.tex}
    >
      <Tag className="mxblocks_mathBody" dangerouslySetInnerHTML={{ __html: html }} />
      {block.caption && <figcaption className="mxblocks_mathCaption">{block.caption}</figcaption>}
    </figure>
  );
}
