import { describe, it, expect } from "vitest";
import { renderPost } from "../../src/render/pipeline";
import { KatexRenderError } from "../../src/render/katex-render";

describe("renderPost", () => {
  it("renders plain markdown with hasMath false", () => {
    const result = renderPost("# Hello\n\nWorld.");
    expect(result.hasMath).toBe(false);
    expect(result.rendered).toContain("<h1>Hello</h1>");
  });

  it("renders inline math and sets hasMath true", () => {
    const result = renderPost("The value is $x^2$.");
    expect(result.hasMath).toBe(true);
    expect(result.rendered).toContain('class="katex"');
    expect(result.rendered).toContain("The value is");
  });

  it("renders display math inside a paragraph without breaking markdown", () => {
    const result = renderPost("Consider:\n\n$$a^2+b^2=c^2$$\n\nDone.");
    expect(result.hasMath).toBe(true);
    expect(result.rendered).toContain("katex-display");
    expect(result.rendered).toContain("Consider:");
    expect(result.rendered).toContain("Done.");
  });

  it("preserves code blocks containing $ untouched by math rendering", () => {
    const result = renderPost("```\ncost: $5\n```");
    expect(result.hasMath).toBe(false);
    expect(result.rendered).toContain("cost: $5");
  });

  it("throws KatexRenderError for invalid latex and renders nothing", () => {
    expect(() => renderPost("Bad math: $\\frac{1}$")).toThrow(KatexRenderError);
  });

  it("passes raw HTML through untouched alongside math", () => {
    const result = renderPost('<div class="note">see $x$</div>');
    expect(result.rendered).toContain('class="note"');
    expect(result.rendered).toContain('class="katex"');
  });
});
