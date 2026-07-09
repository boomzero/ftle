import { createHash } from "node:crypto";

export function buildKatexManifest(cssSource) {
  const rewritten = cssSource.replace(/url\(fonts\//g, "url(/fonts/");
  const hash = createHash("sha256").update(rewritten).digest("hex").slice(0, 10);
  return { hash, filename: `katex.${hash}.css`, css: rewritten };
}
