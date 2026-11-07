// KaTeX helpers for `math` blocks (no DOM, so they run under node's tests).

import katex from "katex";

/** KaTeX's CSS with font URLs rebased onto the module's `fonts/` dir, woff2 only. */
export function rebaseKatexCss(css: string, fontsBase: string): string {
  return (
    css
      // Every browser Element supports has woff2: drop the woff/ttf fallbacks.
      .replace(/,\s*url\(fonts\/[^)]+\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, "")
      .replace(/url\(fonts\//g, `url(${fontsBase}`)
  );
}

/**
 * KaTeX HTML for `tex`, or null when KaTeX can't parse it. Trust is off, so
 * \href, \url, \includegraphics and \html* produce no links, URLs, classes
 * or attributes; maxSize/maxExpand cap sizes and macro expansion.
 */
export function renderTex(tex: string, display: boolean): string | null {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: "ignore",
      // em: caps \rule, \kern and sizing; macro expansions per formula.
      maxSize: 20,
      maxExpand: 500,
      // HTML for the eye, MathML for screen readers and copy/paste.
      output: "htmlAndMathml",
    });
  } catch {
    return null;
  }
}
