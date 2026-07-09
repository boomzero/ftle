import { describe, it, expect } from "vitest";
import { renderMath, KatexRenderError } from "../../src/render/katex-render";

describe("renderMath", () => {
  it("renders valid inline latex to HTML containing the katex class", () => {
    const html = renderMath("x^2", false);
    expect(html).toContain('class="katex"');
  });

  it("renders valid display latex with katex-display wrapper", () => {
    const html = renderMath("x^2 + y^2", true);
    expect(html).toContain("katex-display");
  });

  it("throws KatexRenderError with the offending latex on invalid input", () => {
    expect(() => renderMath("\\frac{1}", false)).toThrow(KatexRenderError);
    try {
      renderMath("\\frac{1}", false);
    } catch (e) {
      expect((e as KatexRenderError).latex).toBe("\\frac{1}");
    }
  });
});
