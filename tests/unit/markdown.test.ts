import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/render/markdown";

describe("renderMarkdown", () => {
  it("renders bold text", () => {
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
  });

  it("passes raw HTML through unsanitized", () => {
    const html = renderMarkdown('<div class="callout">note</div>');
    expect(html).toContain('<div class="callout">note</div>');
  });

  it("renders fenced code blocks", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("const x = 1;");
  });

  it("renders headings", () => {
    expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
  });
});
