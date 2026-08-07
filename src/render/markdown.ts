import { marked } from "marked";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import diff from "highlight.js/lib/languages/diff";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import cpp from "highlight.js/lib/languages/cpp";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("cpp", cpp);

marked.setOptions({ gfm: true, breaks: false });

// Fenced code blocks are highlighted at write time (never on the read path).
// A fence with no language, or a language highlight.js doesn't have
// registered, falls back to marked's own default: plain HTML-escaped
// <pre><code>. There's no language auto-detection — guessing wrong would be
// worse than not highlighting at all.
marked.use({
  renderer: {
    code({ text, lang }) {
      const langString = (lang || "").match(/^\S*/)?.[0];
      const code = text.replace(/\n$/, "") + "\n";
      if (langString && hljs.getLanguage(langString)) {
        const { value } = hljs.highlight(code, { language: langString });
        return `<pre><code class="hljs language-${langString}">${value}</code></pre>\n`;
      }
      return false;
    },
  },
});

export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}
