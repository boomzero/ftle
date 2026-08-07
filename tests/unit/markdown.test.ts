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

  it("renders headings", () => {
    expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
  });

  describe("code block highlighting", () => {
    it("highlights a fenced block in a registered language", () => {
      const html = renderMarkdown("```js\nconst x = 1;\n```");
      expect(html).toContain('<pre><code class="hljs language-js">');
      expect(html).toContain('<span class="hljs-keyword">const</span>');
      expect(html).toContain('<span class="hljs-number">1</span>');
    });

    it("leaves a fence with no language as plain escaped code", () => {
      const html = renderMarkdown("```\nconst x = 1;\n```");
      expect(html).toContain("<pre><code>const x = 1;\n</code></pre>");
      expect(html).not.toContain("hljs");
    });

    it("leaves a fence with an unregistered language as plain escaped code", () => {
      const html = renderMarkdown("```brainfuck\n++++++++[>++++[>++\n```");
      expect(html).toContain('<pre><code class="language-brainfuck">');
      expect(html).not.toContain("hljs");
    });

    it("HTML-escapes highlighted output", () => {
      const html = renderMarkdown('```js\nconst s = "<script>";\n```');
      expect(html).not.toContain("<script>");
      expect(html).toContain("&quot;&lt;script&gt;&quot;");
    });
  });
});
