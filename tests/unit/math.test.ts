import { describe, it, expect } from "vitest";
import { extractMathSpans } from "../../src/render/math";

describe("extractMathSpans", () => {
  it("extracts a single inline span", () => {
    const spans = extractMathSpans("The answer is $x^2$ here.");
    expect(spans).toEqual([
      { type: "inline", latex: "x^2", start: 14, end: 19 },
    ]);
  });

  it("extracts a single display span", () => {
    const spans = extractMathSpans("Before\n$$x^2 + y^2 = z^2$$\nAfter");
    expect(spans).toHaveLength(1);
    expect(spans[0].type).toBe("display");
    expect(spans[0].latex).toBe("x^2 + y^2 = z^2");
  });

  it("ignores $ inside a fenced code block", () => {
    const source = "```\nprice is $5, $10 too\n```\nreal math: $a+b$";
    const spans = extractMathSpans(source);
    expect(spans).toHaveLength(1);
    expect(spans[0].latex).toBe("a+b");
  });

  it("ignores $ inside inline code", () => {
    const source = "use `$var` in shell, but $x=1$ in math";
    const spans = extractMathSpans(source);
    expect(spans).toHaveLength(1);
    expect(spans[0].latex).toBe("x=1");
  });

  it("extracts multiple spans in document order", () => {
    const source = "$a$ then $$b$$ then $c$";
    const spans = extractMathSpans(source);
    expect(spans.map((s) => s.latex)).toEqual(["a", "b", "c"]);
    expect(spans.map((s) => s.type)).toEqual(["inline", "display", "inline"]);
  });

  it("returns no spans for unterminated $", () => {
    const spans = extractMathSpans("this has a lone $ sign with no match");
    expect(spans).toEqual([]);
  });
});
