export interface MathSpan {
  type: "inline" | "display";
  latex: string;
  start: number;
  end: number;
}

export function extractMathSpans(source: string): MathSpan[] {
  const spans: MathSpan[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    // Skip fenced code blocks (```...```), consuming them verbatim.
    if (source.startsWith("```", i)) {
      const close = source.indexOf("```", i + 3);
      i = close === -1 ? n : close + 3;
      continue;
    }
    // Skip inline code (`...`), consuming it verbatim.
    if (source[i] === "`") {
      const close = source.indexOf("`", i + 1);
      i = close === -1 ? n : close + 1;
      continue;
    }
    // Display math: $$...$$
    if (source.startsWith("$$", i)) {
      const close = source.indexOf("$$", i + 2);
      if (close === -1) {
        i += 2;
        continue;
      }
      const start = i;
      const latex = source.slice(i + 2, close);
      const end = close + 2;
      spans.push({ type: "display", latex, start, end });
      i = end;
      continue;
    }
    // Inline math: $...$ (not spanning a blank line, no leading/trailing space
    // immediately inside the delimiters — standard Markdown-math convention).
    if (source[i] === "$") {
      const close = source.indexOf("$", i + 1);
      if (close === -1) {
        i += 1;
        continue;
      }
      const inner = source.slice(i + 1, close);
      if (inner.length > 0 && !inner.includes("\n")) {
        spans.push({ type: "inline", latex: inner, start: i, end: close + 1 });
        i = close + 1;
        continue;
      }
      i += 1;
      continue;
    }
    i += 1;
  }

  return spans;
}
