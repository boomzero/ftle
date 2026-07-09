import { extractMathSpans } from "./math";
import { renderMath } from "./katex-render";
import { renderMarkdown } from "./markdown";

export interface RenderResult {
  rendered: string;
  hasMath: boolean;
}

// Placeholder tokens are spliced into the source in place of math spans before
// markdown rendering, then swapped for the real KaTeX HTML afterward — this
// keeps KaTeX's own HTML (which can contain underscores, asterisks, etc.) from
// ever being reinterpreted as markdown syntax.
//
// U+0000 (NUL) cannot occur in normal post source (it's not a character anyone
// can type or paste meaningfully), so it can't collide with real user content.
// It's also inert to marked: it isn't part of any Markdown syntax and isn't one
// of the characters marked HTML-escapes (&, <, >, ", '), so it survives
// markdown rendering completely untouched and stays trivially identifiable for
// the post-render substitution pass. The token never appears in the returned
// `rendered` string — substitution always completes before this function
// returns.
const PLACEHOLDER_PREFIX = "\u0000MATH";
const PLACEHOLDER_SUFFIX = "\u0000";

export function renderPost(source: string): RenderResult {
  const spans = extractMathSpans(source);
  if (spans.length === 0) {
    return { rendered: renderMarkdown(source), hasMath: false };
  }

  const htmlBySpan: string[] = [];
  let withPlaceholders = "";
  let cursor = 0;

  for (const span of spans) {
    withPlaceholders += source.slice(cursor, span.start);
    const html = renderMath(span.latex, span.type === "display");
    const token = `${PLACEHOLDER_PREFIX}${htmlBySpan.length}${PLACEHOLDER_SUFFIX}`;
    htmlBySpan.push(html);
    withPlaceholders += token;
    cursor = span.end;
  }
  withPlaceholders += source.slice(cursor);

  let rendered = renderMarkdown(withPlaceholders);
  htmlBySpan.forEach((html, index) => {
    const token = `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;
    rendered = rendered.replace(token, html);
  });

  return { rendered, hasMath: true };
}
