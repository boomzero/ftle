# ftle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ftle, a personal blog engine on Cloudflare Workers + D1, exactly per `docs/superpowers/specs/2026-07-08-ftle-design.md`, plus a full SEO surface (title/meta description, canonical URL, OpenGraph/Twitter cards, JSON-LD `BlogPosting`, `robots.txt`, `sitemap.xml`), from an empty repository to a deployable, fully-tested Worker.

**Architecture:** One Hono-routed Cloudflare Worker backed by one D1 database. Posts render to HTML at *save time* (Markdown via `marked` with raw HTML passthrough, math via server-side KaTeX); the read path is edge-cache-hit → serve, or cache-miss → one indexed D1 query → wrap in a layout template string → serve. Public pages ship 0 bytes of JS and inline all CSS. Admin pages sit behind Cloudflare Access, verified in-Worker via JWT, and may use minimal JS.

**Tech Stack:** TypeScript, Hono, `marked`, `katex`, `jose` (Access JWT verification), D1, Vitest + `@cloudflare/vitest-pool-workers`, Wrangler.

## Deviations from the literal spec text (confirmed with the project owner before writing this plan)

1. **Access JWT verification uses the `jose` npm package**, not hand-rolled Web Crypto. The spec's defense-in-depth JWT check is unchanged in behavior; only the implementation mechanism differs. This is the pattern in Cloudflare's own current official docs. Counts as the "discussion" AGENTS.md requires before adding a runtime dependency.
2. **Cache invalidation uses Cloudflare's native Workers Caching (`ctx.cache.purge()` / `cache.purge()` from `cloudflare:workers`)**, not the classic zone-level `purge_cache` REST API. This is a newer platform capability that postdates the spec's literal text. It achieves the same observable behavior the spec requires ("edits visible worldwide within seconds") with fewer moving parts: no `CF_API_TOKEN` secret, no zone ID, no external HTTP round-trip — the purge call happens in-process. Requires Wrangler ≥ 4.69.0 and a `"cache": { "enabled": true }` block in `wrangler.jsonc`. **Confirmed during Task 1 by direct probing:** `cache.purge` does not exist in the local Miniflare/workerd test runtime on any published `@cloudflare/vitest-pool-workers` version — it's a production-only edge capability, not a version gap. `src/cache/purge.ts` (Task 14) therefore feature-detects `cache.purge` and no-ops with a logged warning when it's unavailable, so the function is safe to call in every environment and purge correctness beyond "doesn't throw" can only be verified by code review and manual post-deploy checks, not the automated suite. This was an explicit, deliberate call by the project owner, made after confirming the local-untestability empirically (not a default we chose silently).
3. **KaTeX self-hosted CSS/fonts are not glyph-subsetted**, only self-hosted and content-hash-versioned. True glyph subsetting needs external font tooling (`fonttools`/`glyphhanger`) outside this stack's toolchain. Since KaTeX assets load only on `has_math` pages and never count against the 14KB HTML budget (that budget is for the HTML document itself), this does not violate the performance contract. Flagged as a follow-up, not a blocker.
4. **SEO meta description is auto-derived** from `rendered` (strip tags, collapse whitespace, truncate at a word boundary to ~155 chars) rather than a hand-written excerpt field — no schema change, consistent with the spec's "no draft state" minimalism.

## Global Constraints

- TDD: red → green → refactor for every behavior change. Write the failing test, watch it fail, write minimal code to pass, refactor with the suite green. No production code without a failing test demanding it.
- Never weaken, delete, or skip a test to reach green.
- Test through public interfaces (routes, render pipeline entry points), not private internals.
- Performance budget (enforced by a regression test, treated as any other failing test): reader-facing pages ship 0 bytes of JS, 0 blocking external requests, ≤ 14KB compressed for a typical post page. Admin pages are exempt.
- TypeScript, Hono router. No additional runtime dependencies beyond `hono`, `marked`, `katex`, `jose` without further discussion.
- Site CSS is inlined into the layout template — no external stylesheet except the versioned, self-hosted KaTeX CSS on `has_math` pages.
- Schema changes go through numbered migration files under `migrations/`, applied with `wrangler d1 migrations`.
- Save-path errors (invalid LaTeX, duplicate slug, empty title) return the editor re-rendered with the error message and the submitted source intact — never lose typed work.
- Sanitization is deliberately absent. Raw HTML in post source passes through untouched. Do not add a sanitizer.
- No draft state: the first save publishes.
- Commit messages: imperative mood, one logical change per commit.

---

### Task 1: Project scaffolding & test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `.gitignore`, `migrations/0001_init.sql`, `src/index.ts`, `tests/apply-migrations.ts`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: a Hono `app` default-exported from `src/index.ts`, importable by every later route/test task; a working `npm test` harness with D1 migrations auto-applied; `worker-configuration.d.ts` generated `Env` type used by every later task instead of a hand-written interface.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ftle",
  "private": true,
  "type": "module",
  "scripts": {
    "predev": "npm run prepare:katex && wrangler types",
    "pretest": "npm run prepare:katex && wrangler types",
    "prepare:katex": "node scripts/prepare-katex-assets.mjs",
    "dev": "wrangler dev",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "deploy": "wrangler deploy",
    "migrate:local": "wrangler d1 migrations apply DB --local",
    "migrate:remote": "wrangler d1 migrations apply DB --remote"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "marked": "^14.1.0",
    "katex": "^0.16.11",
    "jose": "^5.9.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.6.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^4.69.0"
  }
}
```

Run: `npm install`. If any package's latest major differs from these ranges, install latest and note the actual installed version in the commit message — these are best-effort pins, not hard requirements.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "types": ["./worker-configuration.d.ts"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src", "tests", "scripts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `wrangler.jsonc`**

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "ftle",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-09",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "cache": { "enabled": true },
  "vars": {
    "SITE_URL": "https://example.com",
    "SITE_TITLE": "ftle",
    "SITE_DESCRIPTION": "A personal blog.",
    "SITE_AUTHOR": "Your Name",
    "ACCESS_TEAM_DOMAIN": "https://your-team.cloudflareaccess.com",
    "ACCESS_AUD": "replace-with-access-aud-tag"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "ftle",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ],
  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  }
}
```

`database_id` is a placeholder — real deployment requires `wrangler d1 create ftle` first (documented in Task 24). Local dev/test does not need a real ID.

- [ ] **Step 4: Create `migrations/0001_init.sql`**

```sql
CREATE TABLE posts (
  id         INTEGER PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL,
  title      TEXT NOT NULL,
  source     TEXT NOT NULL,
  rendered   TEXT NOT NULL,
  has_math   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX idx_post_tags_tag ON post_tags(tag);
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
.wrangler/
dist/
worker-configuration.d.ts
public/katex.*.css
public/fonts/
.dev.vars
```

- [ ] **Step 6: Create a placeholder `public/` dir and empty `scripts/prepare-katex-assets.mjs` so `wrangler dev`/`types` don't fail before Task 9**

```bash
mkdir -p public scripts
```

```js
// scripts/prepare-katex-assets.mjs
// Populated in Task 9. No-op placeholder so predev/pretest don't fail earlier tasks.
console.log("prepare:katex — not yet implemented (see Task 9)");
```

- [ ] **Step 7: Generate the Env type**

Run: `npx wrangler types`
Expected: creates `worker-configuration.d.ts` at the repo root declaring `interface Env { DB: D1Database; ASSETS: Fetcher; SITE_URL: string; SITE_TITLE: string; SITE_DESCRIPTION: string; SITE_AUTHOR: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; }`. Re-run this command any time `wrangler.jsonc` bindings/vars change.

- [ ] **Step 8: Create `vitest.config.ts`**

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  const migrationsPath = path.join(__dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    plugins: [
      cloudflareTest(async () => ({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      })),
    ],
    test: {
      setupFiles: ["./tests/apply-migrations.ts"],
    },
  };
});
```

If `@cloudflare/vitest-pool-workers` in `node_modules` exports a different API shape than `cloudflareTest`/`readD1Migrations` (check `node_modules/@cloudflare/vitest-pool-workers/package.json` `exports` field and its README), adapt this file to match — the goal is: Workers-runtime test execution, wired to `wrangler.jsonc`, with D1 migrations available to apply in a setup file.

- [ ] **Step 9: Create `tests/apply-migrations.ts`**

```ts
import { env, applyD1Migrations } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- [ ] **Step 10: Write the failing smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../src/index";

describe("smoke", () => {
  it("responds on /", async () => {
    const res = await app.request("/", {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ftle");
  });
});
```

- [ ] **Step 11: Run test, verify it fails**

Run: `npm test`
Expected: FAIL — `src/index.ts` does not exist / no default export.

- [ ] **Step 12: Create minimal `src/index.ts`**

```ts
import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("ftle"));

export default app;
```

- [ ] **Step 13: Run test, verify it passes**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 14: Commit**

```bash
git add package.json tsconfig.json wrangler.jsonc migrations .gitignore public scripts src/index.ts tests
git commit -m "Scaffold ftle: Worker, D1 migration, Vitest harness"
```

---

### Task 2: Math span extraction

**Files:**
- Create: `src/render/math.ts`
- Test: `tests/unit/math.test.ts`

**Interfaces:**
- Produces: `MathSpan { type: 'inline' | 'display'; latex: string; start: number; end: number }`, `extractMathSpans(source: string): MathSpan[]`. Consumed by Task 5 (pipeline).

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/math.test.ts
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/unit/math.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/render/math.ts`**

```ts
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
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/unit/math.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/math.ts tests/unit/math.test.ts
git commit -m "Add math span extraction for the render pipeline"
```

---

### Task 3: KaTeX math rendering

**Files:**
- Create: `src/render/katex-render.ts`
- Test: `tests/unit/katex-render.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `KatexRenderError extends Error { latex: string }`, `renderMath(latex: string, displayMode: boolean): string`. Consumed by Task 5 (pipeline).

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/katex-render.test.ts
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/unit/katex-render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/render/katex-render.ts`**

```ts
import katex from "katex";

export class KatexRenderError extends Error {
  constructor(message: string, public readonly latex: string) {
    super(message);
    this.name = "KatexRenderError";
  }
}

export function renderMath(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: true,
      strict: "warn",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new KatexRenderError(message, latex);
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/unit/katex-render.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/katex-render.ts tests/unit/katex-render.test.ts
git commit -m "Add server-side KaTeX rendering with typed error"
```

---

### Task 4: Markdown rendering

**Files:**
- Create: `src/render/markdown.ts`
- Test: `tests/unit/markdown.test.ts`

**Interfaces:**
- Produces: `renderMarkdown(text: string): string`. Consumed by Task 5 (pipeline).

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/markdown.test.ts
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/unit/markdown.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/render/markdown.ts`**

```ts
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/unit/markdown.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/markdown.ts tests/unit/markdown.test.ts
git commit -m "Add Markdown rendering with unsanitized raw HTML passthrough"
```

---

### Task 5: Full render pipeline

**Files:**
- Create: `src/render/pipeline.ts`
- Test: `tests/unit/pipeline.test.ts`

**Interfaces:**
- Consumes: `extractMathSpans` (Task 2), `renderMath`/`KatexRenderError` (Task 3), `renderMarkdown` (Task 4).
- Produces: `RenderResult { rendered: string; hasMath: boolean }`, `renderPost(source: string): RenderResult` (throws `KatexRenderError`). Consumed by Task 18 (preview), Task 19 (save), Task 20 (rerender).

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/pipeline.test.ts
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/unit/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/render/pipeline.ts`**

```ts
import { extractMathSpans } from "./math";
import { renderMath } from "./katex-render";
import { renderMarkdown } from "./markdown";

export interface RenderResult {
  rendered: string;
  hasMath: boolean;
}

const PLACEHOLDER_PREFIX = " MATH";
const PLACEHOLDER_SUFFIX = " ";

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
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/unit/pipeline.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/pipeline.ts tests/unit/pipeline.test.ts
git commit -m "Combine math and markdown rendering into the save-time pipeline"
```

---

### Task 6: SEO meta helpers

**Files:**
- Create: `src/seo/meta.ts`
- Test: `tests/unit/seo-meta.test.ts`

**Interfaces:**
- Produces: `buildDescription(renderedHtml: string, maxLen?: number): string`, `absoluteUrl(siteUrl: string, path: string): string`, `JsonLdPostInput { url: string; title: string; description: string; datePublished: string; dateModified: string; author: string }`, `buildBlogPostingJsonLd(input: JsonLdPostInput): string`. Consumed by Task 8 (layout) and Task 10 (public post routes).

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/seo-meta.test.ts
import { describe, it, expect } from "vitest";
import { buildDescription, absoluteUrl, buildBlogPostingJsonLd } from "../../src/seo/meta";

describe("buildDescription", () => {
  it("strips HTML tags", () => {
    expect(buildDescription("<p>Hello <strong>world</strong>.</p>")).toBe("Hello world.");
  });

  it("collapses whitespace and newlines", () => {
    expect(buildDescription("<p>Hello\n\n  world</p>")).toBe("Hello world");
  });

  it("does not truncate content shorter than the limit", () => {
    expect(buildDescription("<p>Short post.</p>", 155)).toBe("Short post.");
  });

  it("truncates at a word boundary and appends an ellipsis", () => {
    const long = "<p>" + "word ".repeat(60).trim() + "</p>";
    const result = buildDescription(long, 40);
    expect(result.length).toBeLessThanOrEqual(41);
    expect(result.endsWith("…")).toBe(true);
    expect(result.endsWith(" …")).toBe(false);
  });
});

describe("absoluteUrl", () => {
  it("joins a site URL and path without double slashes", () => {
    expect(absoluteUrl("https://example.com", "/my-post")).toBe("https://example.com/my-post");
    expect(absoluteUrl("https://example.com/", "/my-post")).toBe("https://example.com/my-post");
  });
});

describe("buildBlogPostingJsonLd", () => {
  it("produces valid JSON with BlogPosting type", () => {
    const json = buildBlogPostingJsonLd({
      url: "https://example.com/my-post",
      title: "My Post",
      description: "A post.",
      datePublished: "2026-07-01T00:00:00.000Z",
      dateModified: "2026-07-02T00:00:00.000Z",
      author: "Jane Doe",
    });
    const parsed = JSON.parse(json);
    expect(parsed["@type"]).toBe("BlogPosting");
    expect(parsed.headline).toBe("My Post");
    expect(parsed.author).toEqual({ "@type": "Person", name: "Jane Doe" });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/unit/seo-meta.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/seo/meta.ts`**

```ts
export function buildDescription(renderedHtml: string, maxLen = 155): string {
  const text = renderedHtml
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLen) return text;

  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  const cut = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
  return `${cut}…`;
}

export function absoluteUrl(siteUrl: string, path: string): string {
  const base = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export interface JsonLdPostInput {
  url: string;
  title: string;
  description: string;
  datePublished: string;
  dateModified: string;
  author: string;
}

export function buildBlogPostingJsonLd(input: JsonLdPostInput): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "mainEntityOfPage": { "@type": "WebPage", "@id": input.url },
    headline: input.title,
    description: input.description,
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    author: { "@type": "Person", name: input.author },
  });
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/unit/seo-meta.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/seo/meta.ts tests/unit/seo-meta.test.ts
git commit -m "Add SEO description truncation and JSON-LD helpers"
```

---

### Task 7: D1 posts data layer

**Files:**
- Create: `src/db/posts.ts`
- Test: `tests/integration/db-posts.test.ts`

**Interfaces:**
- Produces: `Post`, `PostWithTags`, `PostInput { slug, title, source, rendered, hasMath, tags }`, `DuplicateSlugError`, `createPost(db, input)`, `updatePost(db, id, input)`, `deletePost(db, id)`, `getPostBySlug(db, slug)`, `getPostById(db, id)`, `listPosts(db)`, `listPostsByTag(db, tag)`, `isSlugTaken(db, slug, excludeId?)`. Consumed by every route task (10, 16–21).

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/db-posts.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  createPost,
  updatePost,
  deletePost,
  getPostBySlug,
  getPostById,
  listPosts,
  listPostsByTag,
  isSlugTaken,
  DuplicateSlugError,
} from "../../src/db/posts";

const baseInput = {
  slug: "hello-world",
  title: "Hello World",
  source: "# Hello",
  rendered: "<h1>Hello</h1>",
  hasMath: false,
  tags: ["intro", "meta"],
};

describe("posts data layer", () => {
  it("creates a post with tags and retrieves it by slug", async () => {
    const created = await createPost(env.DB, baseInput);
    expect(created.id).toBeTypeOf("number");
    expect(created.slug).toBe("hello-world");
    expect(created.tags.sort()).toEqual(["intro", "meta"]);

    const fetched = await getPostBySlug(env.DB, "hello-world");
    expect(fetched?.title).toBe("Hello World");
    expect(fetched?.tags.sort()).toEqual(["intro", "meta"]);
  });

  it("rejects duplicate slugs", async () => {
    await createPost(env.DB, baseInput);
    await expect(createPost(env.DB, baseInput)).rejects.toThrow(DuplicateSlugError);
  });

  it("updates a post and its tags, changing updated_at", async () => {
    const created = await createPost(env.DB, baseInput);
    await new Promise((r) => setTimeout(r, 10));
    const updated = await updatePost(env.DB, created.id, {
      ...baseInput,
      title: "Hello Again",
      tags: ["meta", "new-tag"],
    });
    expect(updated.title).toBe("Hello Again");
    expect(updated.tags.sort()).toEqual(["meta", "new-tag"]);
    expect(updated.updated_at).not.toBe(created.updated_at);
    expect(updated.created_at).toBe(created.created_at);
  });

  it("deletes a post and cascades tag deletion", async () => {
    const created = await createPost(env.DB, baseInput);
    await deletePost(env.DB, created.id);
    expect(await getPostById(env.DB, created.id)).toBeNull();
  });

  it("lists posts newest-first", async () => {
    await createPost(env.DB, { ...baseInput, slug: "first" });
    await new Promise((r) => setTimeout(r, 10));
    await createPost(env.DB, { ...baseInput, slug: "second" });
    const posts = await listPosts(env.DB);
    expect(posts.map((p) => p.slug)).toEqual(["second", "first"]);
  });

  it("lists posts by tag", async () => {
    await createPost(env.DB, { ...baseInput, slug: "a", tags: ["x"] });
    await createPost(env.DB, { ...baseInput, slug: "b", tags: ["y"] });
    const posts = await listPostsByTag(env.DB, "x");
    expect(posts.map((p) => p.slug)).toEqual(["a"]);
  });

  it("checks slug availability, excluding a given id", async () => {
    const created = await createPost(env.DB, baseInput);
    expect(await isSlugTaken(env.DB, "hello-world")).toBe(true);
    expect(await isSlugTaken(env.DB, "hello-world", created.id)).toBe(false);
    expect(await isSlugTaken(env.DB, "unused-slug")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/integration/db-posts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/db/posts.ts`**

```ts
export interface Post {
  id: number;
  slug: string;
  title: string;
  source: string;
  rendered: string;
  has_math: number;
  created_at: string;
  updated_at: string;
}

export interface PostWithTags extends Post {
  tags: string[];
}

export interface PostInput {
  slug: string;
  title: string;
  source: string;
  rendered: string;
  hasMath: boolean;
  tags: string[];
}

export class DuplicateSlugError extends Error {
  constructor(slug: string) {
    super(`Slug already in use: ${slug}`);
    this.name = "DuplicateSlugError";
  }
}

async function attachTags(db: D1Database, posts: Post[]): Promise<PostWithTags[]> {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT post_id, tag FROM post_tags WHERE post_id IN (${placeholders})`)
    .bind(...ids)
    .all<{ post_id: number; tag: string }>();

  const tagsByPost = new Map<number, string[]>();
  for (const row of results) {
    const list = tagsByPost.get(row.post_id) ?? [];
    list.push(row.tag);
    tagsByPost.set(row.post_id, list);
  }
  return posts.map((p) => ({ ...p, tags: tagsByPost.get(p.id) ?? [] }));
}

export async function createPost(db: D1Database, input: PostInput): Promise<PostWithTags> {
  if (await isSlugTaken(db, input.slug)) throw new DuplicateSlugError(input.slug);

  const now = new Date().toISOString();
  const insertPost = db
    .prepare(
      `INSERT INTO posts (slug, title, source, rendered, has_math, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.slug, input.title, input.source, input.rendered, input.hasMath ? 1 : 0, now, now);

  const result = await insertPost.run();
  const id = result.meta.last_row_id as number;

  if (input.tags.length > 0) {
    const tagInserts = input.tags.map((tag) =>
      db.prepare(`INSERT INTO post_tags (post_id, tag) VALUES (?, ?)`).bind(id, tag),
    );
    await db.batch(tagInserts);
  }

  const created = await getPostById(db, id);
  if (!created) throw new Error("Failed to read back created post");
  return created;
}

export async function updatePost(
  db: D1Database,
  id: number,
  input: PostInput,
): Promise<PostWithTags> {
  if (await isSlugTaken(db, input.slug, id)) throw new DuplicateSlugError(input.slug);

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE posts SET slug = ?, title = ?, source = ?, rendered = ?, has_math = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(input.slug, input.title, input.source, input.rendered, input.hasMath ? 1 : 0, now, id)
    .run();

  await db.prepare(`DELETE FROM post_tags WHERE post_id = ?`).bind(id).run();
  if (input.tags.length > 0) {
    const tagInserts = input.tags.map((tag) =>
      db.prepare(`INSERT INTO post_tags (post_id, tag) VALUES (?, ?)`).bind(id, tag),
    );
    await db.batch(tagInserts);
  }

  const updated = await getPostById(db, id);
  if (!updated) throw new Error("Failed to read back updated post");
  return updated;
}

export async function deletePost(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM posts WHERE id = ?`).bind(id).run();
}

export async function getPostBySlug(db: D1Database, slug: string): Promise<PostWithTags | null> {
  const post = await db.prepare(`SELECT * FROM posts WHERE slug = ?`).bind(slug).first<Post>();
  if (!post) return null;
  const [withTags] = await attachTags(db, [post]);
  return withTags;
}

export async function getPostById(db: D1Database, id: number): Promise<PostWithTags | null> {
  const post = await db.prepare(`SELECT * FROM posts WHERE id = ?`).bind(id).first<Post>();
  if (!post) return null;
  const [withTags] = await attachTags(db, [post]);
  return withTags;
}

export async function listPosts(db: D1Database): Promise<PostWithTags[]> {
  const { results } = await db
    .prepare(`SELECT * FROM posts ORDER BY created_at DESC`)
    .all<Post>();
  return attachTags(db, results);
}

export async function listPostsByTag(db: D1Database, tag: string): Promise<PostWithTags[]> {
  const { results } = await db
    .prepare(
      `SELECT posts.* FROM posts
       JOIN post_tags ON post_tags.post_id = posts.id
       WHERE post_tags.tag = ?
       ORDER BY posts.created_at DESC`,
    )
    .bind(tag)
    .all<Post>();
  return attachTags(db, results);
}

export async function isSlugTaken(db: D1Database, slug: string, excludeId?: number): Promise<boolean> {
  const row = await db
    .prepare(`SELECT id FROM posts WHERE slug = ? AND id != ?`)
    .bind(slug, excludeId ?? -1)
    .first<{ id: number }>();
  return row !== null;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/integration/db-posts.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/posts.ts tests/integration/db-posts.test.ts
git commit -m "Add D1 posts data layer with tag support and slug uniqueness"
```

---

### Task 8: Layout template + inlined site CSS

**Files:**
- Create: `src/css/site-css.ts`, `src/layout.ts`
- Test: `tests/unit/layout.test.ts`

**Interfaces:**
- Produces: `LayoutOptions { siteTitle, pageTitle, description, canonicalUrl, bodyHtml, hasMath?, katexCssPath?, ogType?, jsonLd?, noindex?, rssUrl? }`, `renderLayout(opts: LayoutOptions): string`. Consumed by every route task that returns HTML (10–14, 16–21).

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/layout.test.ts
import { describe, it, expect } from "vitest";
import { renderLayout } from "../../src/layout";

const baseOpts = {
  siteTitle: "ftle",
  pageTitle: "My Post",
  description: "A post about things.",
  canonicalUrl: "https://example.com/my-post",
  bodyHtml: "<article>Hello</article>",
};

describe("renderLayout", () => {
  it("includes title, meta description, and canonical link", () => {
    const html = renderLayout(baseOpts);
    expect(html).toContain("<title>My Post — ftle</title>");
    expect(html).toContain('<meta name="description" content="A post about things.">');
    expect(html).toContain('<link rel="canonical" href="https://example.com/my-post">');
  });

  it("has html lang attribute and inlined CSS, no external stylesheet by default", () => {
    const html = renderLayout(baseOpts);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<style>");
    expect(html).not.toContain('rel="stylesheet" href="http');
  });

  it("omits the KaTeX link when hasMath is false", () => {
    const html = renderLayout(baseOpts);
    expect(html).not.toContain("katex");
  });

  it("includes the KaTeX link when hasMath is true", () => {
    const html = renderLayout({ ...baseOpts, hasMath: true, katexCssPath: "/katex.abc123.css" });
    expect(html).toContain('<link rel="stylesheet" href="/katex.abc123.css">');
  });

  it("includes JSON-LD when provided", () => {
    const html = renderLayout({ ...baseOpts, jsonLd: '{"@type":"BlogPosting"}' });
    expect(html).toContain('<script type="application/ld+json">{"@type":"BlogPosting"}</script>');
  });

  it("includes noindex meta when noindex is true", () => {
    const html = renderLayout({ ...baseOpts, noindex: true });
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("includes OpenGraph and Twitter card tags", () => {
    const html = renderLayout({ ...baseOpts, ogType: "article" });
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('<meta property="og:title" content="My Post">');
    expect(html).toContain('<meta property="og:description" content="A post about things.">');
    expect(html).toContain('<meta property="og:url" content="https://example.com/my-post">');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it("includes an RSS autodiscovery link when rssUrl is provided", () => {
    const html = renderLayout({ ...baseOpts, rssUrl: "https://example.com/rss.xml" });
    expect(html).toContain(
      '<link rel="alternate" type="application/atom+xml" href="https://example.com/rss.xml">',
    );
  });

  it("embeds bodyHtml verbatim inside body", () => {
    const html = renderLayout(baseOpts);
    expect(html).toContain("<article>Hello</article>");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/unit/layout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/css/site-css.ts`**

```ts
export const SITE_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  max-width: 42rem;
  margin: 0 auto;
  padding: 2rem 1rem;
  line-height: 1.6;
}
nav { margin-bottom: 2rem; font-size: 0.9rem; }
nav a { margin-right: 1rem; }
article { margin-bottom: 3rem; }
h1, h2, h3 { line-height: 1.25; }
pre { overflow-x: auto; padding: 1rem; background: rgba(127,127,127,0.1); border-radius: 4px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
a { color: inherit; }
footer { font-size: 0.85rem; opacity: 0.7; margin-top: 3rem; }
.post-list li { margin-bottom: 0.75rem; }
.post-date { opacity: 0.6; font-size: 0.85rem; }
`.trim();
```

- [ ] **Step 4: Implement `src/layout.ts`**

```ts
import { SITE_CSS } from "./css/site-css";

export interface LayoutOptions {
  siteTitle: string;
  pageTitle: string;
  description: string;
  canonicalUrl: string;
  bodyHtml: string;
  hasMath?: boolean;
  katexCssPath?: string;
  ogType?: "website" | "article";
  jsonLd?: string;
  noindex?: boolean;
  rssUrl?: string;
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;");
}

export function renderLayout(opts: LayoutOptions): string {
  const {
    siteTitle,
    pageTitle,
    description,
    canonicalUrl,
    bodyHtml,
    hasMath,
    katexCssPath,
    ogType = "website",
    jsonLd,
    noindex,
    rssUrl,
  } = opts;

  const title = pageTitle === siteTitle ? siteTitle : `${pageTitle} — ${siteTitle}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${escapeAttr(description)}">
<link rel="canonical" href="${escapeAttr(canonicalUrl)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ""}<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${escapeAttr(pageTitle)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:url" content="${escapeAttr(canonicalUrl)}">
<meta name="twitter:card" content="summary">
${rssUrl ? `<link rel="alternate" type="application/atom+xml" href="${escapeAttr(rssUrl)}">\n` : ""}${hasMath && katexCssPath ? `<link rel="stylesheet" href="${escapeAttr(katexCssPath)}">\n` : ""}${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>\n` : ""}<style>${SITE_CSS}</style>
</head>
<body>
<nav><a href="/">${siteTitle}</a> <a href="/rss.xml">RSS</a></nav>
${bodyHtml}
<footer>${siteTitle}</footer>
</body>
</html>`;
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm test -- tests/unit/layout.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/css/site-css.ts src/layout.ts tests/unit/layout.test.ts
git commit -m "Add HTML layout template with inlined CSS and full SEO tag set"
```

---

### Task 9: KaTeX self-hosted static assets

**Files:**
- Create: `scripts/katex-manifest.mjs`, `scripts/prepare-katex-assets.mjs` (overwrite placeholder), `public/_headers`

**Interfaces:**
- Produces: `public/katex.<hash>.css` and `public/fonts/*.woff2` on disk (generated, gitignored), plus `src/generated/katex-manifest.ts` exporting `KATEX_CSS_PATH: string`. Consumed by Task 10 (post route passes `katexCssPath` to the layout).

This task's script runs under Node (not the Workers runtime), so it is verified by direct execution and inspection rather than a Vitest-in-workerd test — there is no product *behavior* here yet, only build tooling that produces a file Task 10 will consume and test.

- [ ] **Step 1: Implement the pure manifest builder, `scripts/katex-manifest.mjs`**

```js
import { createHash } from "node:crypto";

export function buildKatexManifest(cssSource) {
  const rewritten = cssSource.replace(/url\(fonts\//g, "url(/fonts/");
  const hash = createHash("sha256").update(rewritten).digest("hex").slice(0, 10);
  return { hash, filename: `katex.${hash}.css`, css: rewritten };
}
```

- [ ] **Step 2: Implement the IO wrapper, `scripts/prepare-katex-assets.mjs`**

```js
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildKatexManifest } from "./katex-manifest.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const katexDist = path.join(root, "node_modules/katex/dist");
const publicDir = path.join(root, "public");
const fontsDir = path.join(publicDir, "fonts");
const generatedDir = path.join(root, "src/generated");

// Clean previous generated CSS (filename changes with content hash).
for (const file of existsSync(publicDir) ? readdirSync(publicDir) : []) {
  if (file.startsWith("katex.") && file.endsWith(".css")) {
    rmSync(path.join(publicDir, file));
  }
}

mkdirSync(publicDir, { recursive: true });
mkdirSync(fontsDir, { recursive: true });
mkdirSync(generatedDir, { recursive: true });

const cssSource = readFileSync(path.join(katexDist, "katex.min.css"), "utf8");
const manifest = buildKatexManifest(cssSource);

writeFileSync(path.join(publicDir, manifest.filename), manifest.css);

const distFontsDir = path.join(katexDist, "fonts");
for (const file of readdirSync(distFontsDir)) {
  if (file.endsWith(".woff2")) {
    copyFileSync(path.join(distFontsDir, file), path.join(fontsDir, file));
  }
}

writeFileSync(
  path.join(generatedDir, "katex-manifest.ts"),
  `// Generated by scripts/prepare-katex-assets.mjs — do not edit.\nexport const KATEX_CSS_PATH = "/${manifest.filename}";\n`,
);

console.log(`prepare:katex — wrote public/${manifest.filename} and ${readdirSync(fontsDir).length} font files`);
```

- [ ] **Step 3: Add gitignore entry for the generated manifest**

Add `src/generated/` to `.gitignore` (it's already covered by the broader `public/katex.*.css` / `public/fonts/` entries from Task 1 — add `src/generated/` alongside them).

- [ ] **Step 4: Create `public/_headers` for immutable caching of KaTeX assets**

```
/katex.*.css
  Cache-Control: public, max-age=31536000, immutable
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
```

- [ ] **Step 5: Run the script and verify output**

Run: `npm run prepare:katex`
Expected: logs `prepare:katex — wrote public/katex.<hash>.css and N font files`.

Run: `ls public/*.css public/fonts | head -5`
Expected: one `katex.<hash>.css` file and multiple `.woff2` files listed.

Run: `grep -o 'url(/fonts/[^)]*)' public/katex.*.css | head -3`
Expected: font URLs rewritten to `/fonts/...` (root-relative), not the original `fonts/...`.

- [ ] **Step 6: Commit**

```bash
git add scripts/katex-manifest.mjs scripts/prepare-katex-assets.mjs public/_headers .gitignore
git commit -m "Self-host KaTeX CSS and fonts as content-hash-versioned static assets"
```

---

### Task 10: Public routes — index, post, tag pages

**Files:**
- Create: `src/routes/public.ts`
- Modify: `src/index.ts` (mount public routes)
- Test: `tests/integration/public-routes.test.ts`

**Interfaces:**
- Consumes: `getPostBySlug`/`listPosts`/`listPostsByTag` (Task 7), `renderLayout` (Task 8), `buildDescription`/`absoluteUrl`/`buildBlogPostingJsonLd` (Task 6), `KATEX_CSS_PATH` (Task 9).
- Produces: a Hono sub-app `publicRoutes` mounted at `/` in `src/index.ts`. Consumed by Task 22 (final wiring) and Task 23 (perf test).

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/public-routes.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";

async function seedPost(overrides: Partial<Parameters<typeof createPost>[1]> = {}) {
  return createPost(env.DB, {
    slug: "hello-world",
    title: "Hello World",
    source: "# Hello\n\nWorld.",
    rendered: "<h1>Hello</h1><p>World.</p>",
    hasMath: false,
    tags: ["intro"],
    ...overrides,
  });
}

describe("public routes", () => {
  it("GET / lists posts newest-first with title and date", async () => {
    await seedPost({ slug: "first" });
    await new Promise((r) => setTimeout(r, 10));
    await seedPost({ slug: "second" });

    const res = await app.request("/", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.indexOf("second")).toBeLessThan(html.indexOf("first"));
  });

  it("GET /:slug renders the post with SEO tags", async () => {
    await seedPost();
    const res = await app.request("/hello-world", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('"@type":"BlogPosting"');
    expect(html).toContain('<link rel="canonical" href="https://example.com/hello-world">');
  });

  it("GET /:slug returns 404 for an unknown slug", async () => {
    const res = await app.request("/does-not-exist", {}, env);
    expect(res.status).toBe(404);
  });

  it("GET /tag/:tag lists only posts with that tag", async () => {
    await seedPost({ slug: "a", tags: ["x"] });
    await seedPost({ slug: "b", tags: ["y"] });
    const res = await app.request("/tag/x", {}, env);
    const html = await res.text();
    expect(html).toContain("a");
    expect(html).not.toContain(">b<");
  });

  it("post page includes the KaTeX stylesheet only when has_math is set", async () => {
    await seedPost({ slug: "math-post", hasMath: true, rendered: '<span class="katex">x</span>' });
    await seedPost({ slug: "no-math-post" });

    const mathRes = await app.request("/math-post", {}, env);
    expect(await mathRes.text()).toMatch(/rel="stylesheet" href="\/katex\./);

    const plainRes = await app.request("/no-math-post", {}, env);
    expect(await plainRes.text()).not.toContain("katex.");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/integration/public-routes.test.ts`
Expected: FAIL — `/` currently returns the Task 1 placeholder text, `/hello-world` and `/tag/x` are unmatched (404 from Hono's default handler, but not with the right body/shape).

- [ ] **Step 3: Implement `src/routes/public.ts`**

```ts
import { Hono } from "hono";
import { getPostBySlug, listPosts, listPostsByTag, type PostWithTags } from "../db/posts";
import { renderLayout } from "../layout";
import { buildDescription, absoluteUrl, buildBlogPostingJsonLd } from "../seo/meta";
import { KATEX_CSS_PATH } from "../generated/katex-manifest";

export const publicRoutes = new Hono<{ Bindings: Env }>();

function postListItem(post: PostWithTags): string {
  const date = post.created_at.slice(0, 10);
  return `<li><a href="/${post.slug}">${post.title}</a> <span class="post-date">${date}</span></li>`;
}

publicRoutes.get("/", async (c) => {
  const posts = await listPosts(c.env.DB);
  const body = `<h1>${c.env.SITE_TITLE}</h1><ul class="post-list">${posts.map(postListItem).join("")}</ul>`;
  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    pageTitle: c.env.SITE_TITLE,
    description: c.env.SITE_DESCRIPTION,
    canonicalUrl: absoluteUrl(c.env.SITE_URL, "/"),
    bodyHtml: body,
    rssUrl: absoluteUrl(c.env.SITE_URL, "/rss.xml"),
  });
  return c.html(html);
});

publicRoutes.get("/tag/:tag", async (c) => {
  const tag = c.req.param("tag");
  const posts = await listPostsByTag(c.env.DB, tag);
  const body = `<h1>Tag: ${tag}</h1><ul class="post-list">${posts.map(postListItem).join("")}</ul>`;
  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    pageTitle: `Tag: ${tag}`,
    description: `Posts tagged "${tag}" on ${c.env.SITE_TITLE}.`,
    canonicalUrl: absoluteUrl(c.env.SITE_URL, `/tag/${tag}`),
    bodyHtml: body,
    rssUrl: absoluteUrl(c.env.SITE_URL, "/rss.xml"),
  });
  return c.html(html);
});

publicRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const post = await getPostBySlug(c.env.DB, slug);
  if (!post) return c.notFound();

  const canonicalUrl = absoluteUrl(c.env.SITE_URL, `/${post.slug}`);
  const description = buildDescription(post.rendered);
  const tagLinks = post.tags.map((t) => `<a href="/tag/${t}">${t}</a>`).join(" ");
  const body = `<article><h1>${post.title}</h1><p class="post-date">${post.created_at.slice(0, 10)}</p>${post.rendered}<p>${tagLinks}</p></article>`;

  const jsonLd = buildBlogPostingJsonLd({
    url: canonicalUrl,
    title: post.title,
    description,
    datePublished: post.created_at,
    dateModified: post.updated_at,
    author: c.env.SITE_AUTHOR,
  });

  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    pageTitle: post.title,
    description,
    canonicalUrl,
    bodyHtml: body,
    hasMath: post.has_math === 1,
    katexCssPath: KATEX_CSS_PATH,
    ogType: "article",
    jsonLd,
    rssUrl: absoluteUrl(c.env.SITE_URL, "/rss.xml"),
  });
  return c.html(html);
});
```

- [ ] **Step 4: Mount in `src/index.ts`**

```ts
import { Hono } from "hono";
import { publicRoutes } from "./routes/public";

const app = new Hono<{ Bindings: Env }>();

app.route("/", publicRoutes);

export default app;
```

(This removes the Task 1 placeholder `app.get("/", ...)`.)

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm test -- tests/integration/public-routes.test.ts tests/smoke.test.ts`
Expected: the smoke test now fails (it asserted the literal text `"ftle"`, which the real index page no longer returns) — update `tests/smoke.test.ts` to assert `res.status` is 200 instead, since Task 1's placeholder assertion is now obsolete:

```ts
// tests/smoke.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../src/index";

describe("smoke", () => {
  it("responds on /", async () => {
    const res = await app.request("/", {}, env);
    expect(res.status).toBe(200);
  });
});
```

Run: `npm test -- tests/integration/public-routes.test.ts tests/smoke.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/routes/public.ts src/index.ts tests/integration/public-routes.test.ts tests/smoke.test.ts
git commit -m "Add public index, post, and tag routes with full SEO tags"
```

---

### Task 11: RSS (Atom) feed

**Files:**
- Create: `src/routes/rss.ts`
- Modify: `src/index.ts` (mount)
- Test: `tests/integration/rss.test.ts`

**Interfaces:**
- Consumes: `listPosts` (Task 7), `absoluteUrl` (Task 6).
- Produces: `rssRoutes` Hono sub-app, mounted before the `/:slug` catch-all so `/rss.xml` is matched first.

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/rss.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";

describe("GET /rss.xml", () => {
  it("serves an Atom feed with full content", async () => {
    await createPost(env.DB, {
      slug: "hello-world",
      title: "Hello World",
      source: "# Hello",
      rendered: "<h1>Hello</h1><p>Body text.</p>",
      hasMath: false,
      tags: [],
    });

    const res = await app.request("/rss.xml", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/atom+xml");

    const xml = await res.text();
    expect(xml).toContain("<feed xmlns=\"http://www.w3.org/2005/Atom\">");
    expect(xml).toContain("<title>Hello World</title>");
    expect(xml).toContain("Body text.");
    expect(xml).toContain("<id>https://example.com/hello-world</id>");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/integration/rss.test.ts`
Expected: FAIL — `/rss.xml` is currently swallowed by the `/:slug` route (post not found → 404), or module not found.

- [ ] **Step 3: Implement `src/routes/rss.ts`**

```ts
import { Hono } from "hono";
import { listPosts } from "../db/posts";
import { absoluteUrl } from "../seo/meta";

export const rssRoutes = new Hono<{ Bindings: Env }>();

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

rssRoutes.get("/rss.xml", async (c) => {
  const posts = await listPosts(c.env.DB);
  const siteUrl = absoluteUrl(c.env.SITE_URL, "/");
  const updated = posts[0]?.updated_at ?? new Date().toISOString();

  const entries = posts
    .map(
      (post) => `
  <entry>
    <title>${escapeXml(post.title)}</title>
    <id>${absoluteUrl(c.env.SITE_URL, `/${post.slug}`)}</id>
    <link href="${absoluteUrl(c.env.SITE_URL, `/${post.slug}`)}"/>
    <published>${post.created_at}</published>
    <updated>${post.updated_at}</updated>
    <content type="html">${escapeXml(post.rendered)}</content>
  </entry>`,
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(c.env.SITE_TITLE)}</title>
  <subtitle>${escapeXml(c.env.SITE_DESCRIPTION)}</subtitle>
  <id>${siteUrl}</id>
  <link href="${siteUrl}"/>
  <updated>${updated}</updated>${entries}
</feed>`;

  return c.body(xml, 200, { "Content-Type": "application/atom+xml; charset=utf-8" });
});
```

- [ ] **Step 4: Mount in `src/index.ts` before public routes' catch-all**

```ts
import { rssRoutes } from "./routes/rss";

app.route("/", rssRoutes);
app.route("/", publicRoutes);
```

(Hono matches static paths like `/rss.xml` before the dynamic `/:slug` regardless of mount order within the same trie, but mounting the more specific router first keeps intent obvious and protects against subtle Hono routing-precedence changes.)

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm test -- tests/integration/rss.test.ts`
Expected: PASS (1 test). Also re-run `tests/integration/public-routes.test.ts` to confirm `/rss.xml` didn't regress `/:slug` matching.

- [ ] **Step 6: Commit**

```bash
git add src/routes/rss.ts src/index.ts tests/integration/rss.test.ts
git commit -m "Add Atom feed at /rss.xml with full post content"
```

---

### Task 12: robots.txt & sitemap.xml

**Files:**
- Create: `src/routes/seo-files.ts`
- Modify: `src/index.ts` (mount)
- Test: `tests/integration/seo-files.test.ts`

**Interfaces:**
- Consumes: `listPosts` (Task 7), `absoluteUrl` (Task 6).
- Produces: `seoFileRoutes` Hono sub-app.

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/seo-files.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";

describe("robots.txt and sitemap.xml", () => {
  it("GET /robots.txt disallows /admin and points at the sitemap", async () => {
    const res = await app.request("/robots.txt", {}, env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Disallow: /admin");
    expect(text).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("GET /sitemap.xml lists the homepage and every post", async () => {
    await createPost(env.DB, {
      slug: "hello-world",
      title: "Hello",
      source: "x",
      rendered: "<p>x</p>",
      hasMath: false,
      tags: ["intro"],
    });
    const res = await app.request("/sitemap.xml", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain("<loc>https://example.com/</loc>");
    expect(xml).toContain("<loc>https://example.com/hello-world</loc>");
    expect(xml).toContain("<loc>https://example.com/tag/intro</loc>");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/integration/seo-files.test.ts`
Expected: FAIL — routes not matched (swallowed by `/:slug`, or 404).

- [ ] **Step 3: Implement `src/routes/seo-files.ts`**

```ts
import { Hono } from "hono";
import { listPosts } from "../db/posts";
import { absoluteUrl } from "../seo/meta";

export const seoFileRoutes = new Hono<{ Bindings: Env }>();

seoFileRoutes.get("/robots.txt", (c) => {
  const body = `User-agent: *
Allow: /
Disallow: /admin
Sitemap: ${absoluteUrl(c.env.SITE_URL, "/sitemap.xml")}
`;
  return c.body(body, 200, { "Content-Type": "text/plain; charset=utf-8" });
});

seoFileRoutes.get("/sitemap.xml", async (c) => {
  const posts = await listPosts(c.env.DB);
  const tags = Array.from(new Set(posts.flatMap((p) => p.tags)));

  const urls: { loc: string; lastmod?: string }[] = [
    { loc: absoluteUrl(c.env.SITE_URL, "/") },
    ...posts.map((p) => ({ loc: absoluteUrl(c.env.SITE_URL, `/${p.slug}`), lastmod: p.updated_at })),
    ...tags.map((t) => ({ loc: absoluteUrl(c.env.SITE_URL, `/tag/${t}`) })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`)
  .join("\n")}
</urlset>`;

  return c.body(xml, 200, { "Content-Type": "application/xml; charset=utf-8" });
});
```

- [ ] **Step 4: Mount in `src/index.ts` before `publicRoutes`**

```ts
import { seoFileRoutes } from "./routes/seo-files";

app.route("/", rssRoutes);
app.route("/", seoFileRoutes);
app.route("/", publicRoutes);
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm test -- tests/integration/seo-files.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/routes/seo-files.ts src/index.ts tests/integration/seo-files.test.ts
git commit -m "Add robots.txt and sitemap.xml for search engine discovery"
```

---

### Task 13: 404 page

**Files:**
- Modify: `src/index.ts` (add `app.notFound`)
- Test: `tests/integration/not-found.test.ts`

**Interfaces:**
- Consumes: `renderLayout` (Task 8).
- Produces: a 404 response for both unmatched routes and unknown slugs (Task 10's `/:slug` handler already calls `c.notFound()` for unknown slugs — Hono routes that through the same `app.notFound()` handler defined here).

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/not-found.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";

describe("404 handling", () => {
  it("returns a 404 page for an unknown slug", async () => {
    const res = await app.request("/nope", {}, env);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("404");
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("returns a 404 page for a totally unmatched path", async () => {
    const res = await app.request("/deeply/nested/nothing", {}, env);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/integration/not-found.test.ts`
Expected: FAIL — Hono's default `notFound` handler returns plain text `404 Not Found`, no `noindex` meta tag, no layout.

- [ ] **Step 3: Add `app.notFound` in `src/index.ts`**

```ts
import { renderLayout } from "./layout";
import { absoluteUrl } from "./seo/meta";

app.notFound((c) => {
  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    pageTitle: "Page Not Found",
    description: "This page does not exist.",
    canonicalUrl: absoluteUrl(c.env.SITE_URL, c.req.path),
    bodyHtml: "<h1>404</h1><p>That page does not exist.</p>",
    noindex: true,
  });
  return c.html(html, 404);
});
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/integration/not-found.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/integration/not-found.test.ts
git commit -m "Add a noindex 404 page via the shared layout"
```

---

### Task 14: Cache purge module (native Workers Caching)

**Files:**
- Create: `src/cache/purge.ts`
- Test: `tests/unit/purge.test.ts`

**Interfaces:**
- Produces: `computePurgePaths(opts: { postPath: string; oldTags: string[]; newTags: string[] }): string[]`, `purgePaths(paths: string[]): Promise<void>`. Consumed by Task 19 (save), Task 20 (rerender), Task 21 (delete).

**Confirmed by direct probing before this task was dispatched:** `cache.purge` does not exist in the local Miniflare/workerd test runtime at all — it is `undefined`, not a stub (`ExecutionContext` in `cloudflare:test` has only `waitUntil`/`passThroughOnException`; no `cache` property, on any currently published `@cloudflare/vitest-pool-workers` version). This is a production-only edge-network capability, not a version gap. `purgePaths` must therefore feature-detect `cache.purge` and no-op (with a logged warning) when it is unavailable, so the function is genuinely safe to call in every environment — including local dev and this test suite — and the "doesn't throw" test below is a true claim, not a hopeful one.

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/purge.test.ts
import { describe, it, expect, vi } from "vitest";
import { computePurgePaths, purgePaths } from "../../src/cache/purge";

describe("computePurgePaths", () => {
  it("always includes root, rss, and sitemap", () => {
    const paths = computePurgePaths({ postPath: "/hello", oldTags: [], newTags: [] });
    expect(paths).toEqual(expect.arrayContaining(["/", "/rss.xml", "/sitemap.xml", "/hello"]));
  });

  it("includes both old and new tag pages, deduplicated", () => {
    const paths = computePurgePaths({
      postPath: "/hello",
      oldTags: ["a", "b"],
      newTags: ["b", "c"],
    });
    const tagPaths = paths.filter((p) => p.startsWith("/tag/"));
    expect(tagPaths.sort()).toEqual(["/tag/a", "/tag/b", "/tag/c"]);
  });
});

describe("purgePaths", () => {
  it("does not throw when cache.purge is unavailable (e.g. local dev/test)", async () => {
    // In this test runtime, cache.purge is genuinely undefined (confirmed by
    // direct probing) — this exercises the real fallback path, not a mock.
    await expect(purgePaths(["/hello"])).resolves.toBeUndefined();
  });

  it("calls cache.purge with the given paths when it is available", async () => {
    const purge = vi.fn().mockResolvedValue({ success: true, errors: [] });
    const cfWorkers = await import("cloudflare:workers");
    vi.spyOn(cfWorkers, "cache", "get").mockReturnValue({ purge } as any);

    await purgePaths(["/a", "/b"]);
    expect(purge).toHaveBeenCalledWith({ pathPrefixes: ["/a", "/b"] });

    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/unit/purge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/cache/purge.ts`**

```ts
import { cache } from "cloudflare:workers";

export function computePurgePaths(opts: {
  postPath: string;
  oldTags: string[];
  newTags: string[];
}): string[] {
  const tagPaths = Array.from(new Set([...opts.oldTags, ...opts.newTags])).map(
    (tag) => `/tag/${tag}`,
  );
  return ["/", "/rss.xml", "/sitemap.xml", opts.postPath, ...tagPaths];
}

export async function purgePaths(paths: string[]): Promise<void> {
  if (typeof cache?.purge !== "function") {
    console.warn("cache.purge unavailable in this environment; skipping purge for", paths);
    return;
  }
  const result = await cache.purge({ pathPrefixes: paths });
  if (!result.success) {
    console.error("Cache purge failed", result.errors);
  }
}
```

If the second test (mocking `cache.purge` as available) can't get `vi.spyOn(cfWorkers, "cache", "get")` to work against the `cloudflare:workers` built-in module in this runtime, it's fine to drop that test and rely on the first (real, unmocked "doesn't throw" behavior) plus `computePurgePaths`'s coverage — note this in your report rather than fighting the mock. The unmockable case is exactly why `purgePaths` must stay a thin, obviously-correct wrapper: the two-line body around the feature-detect is the entire surface that can't be exercised against a real `cache.purge` locally.

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/unit/purge.test.ts`
Expected: PASS (3 or 4 tests, depending on whether the mock-based test was kept).

Note: because `purgePaths` no-ops safely when `cache.purge` is unavailable, the admin save/delete/rerender integration tests in Tasks 19–21 will exercise this same no-op fallback path every time they run locally — that's expected and correct, not a gap to work around.

- [ ] **Step 5: Commit**

```bash
git add src/cache/purge.ts tests/unit/purge.test.ts
git commit -m "Add cache purge path computation using native Workers Caching"
```

---

### Task 15: Access JWT verification

**Files:**
- Create: `src/auth/access.ts`
- Test: `tests/integration/access.test.ts`

**Interfaces:**
- Produces: `AccessIdentity { email: string }`, `verifyAccessRequest(request: Request, env: Env): Promise<AccessIdentity | null>`. Consumed by Task 16 (admin guard middleware).

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/access.test.ts
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { verifyAccessRequest } from "../../src/auth/access";

const TEAM_DOMAIN = "https://test-team.cloudflareaccess.com";
const AUD = "test-aud-tag";

let publicJwk: JsonWebKey;
let privateKey: CryptoKey;
const kid = "test-key-1";

beforeAll(async () => {
  const { publicKey, privateKey: priv } = await generateKeyPair("RS256");
  privateKey = priv;
  publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockCertsEndpoint() {
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === `${TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return original(input, init);
  });
}

async function makeToken(overrides: Partial<{ aud: string; exp: number; email: string }> = {}) {
  return new SignJWT({ email: overrides.email ?? "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt()
    .setIssuer(TEAM_DOMAIN)
    .setAudience(overrides.aud ?? AUD)
    .setExpirationTime(overrides.exp ?? Math.floor(Date.now() / 1000) + 3600)
    .sign(privateKey);
}

const env = { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD } as unknown as Env;

describe("verifyAccessRequest", () => {
  it("returns the identity for a valid token", async () => {
    mockCertsEndpoint();
    const token = await makeToken();
    const req = new Request("https://worker.example/admin", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    const identity = await verifyAccessRequest(req, env);
    expect(identity).toEqual({ email: "owner@example.com" });
  });

  it("returns null when the header is missing", async () => {
    const req = new Request("https://worker.example/admin");
    expect(await verifyAccessRequest(req, env)).toBeNull();
  });

  it("returns null for a token with the wrong audience", async () => {
    mockCertsEndpoint();
    const token = await makeToken({ aud: "wrong-aud" });
    const req = new Request("https://worker.example/admin", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(await verifyAccessRequest(req, env)).toBeNull();
  });

  it("returns null for an expired token", async () => {
    mockCertsEndpoint();
    const token = await makeToken({ exp: Math.floor(Date.now() / 1000) - 10 });
    const req = new Request("https://worker.example/admin", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(await verifyAccessRequest(req, env)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/integration/access.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/auth/access.ts`**

```ts
import { jwtVerify, createRemoteJWKSet } from "jose";

export interface AccessIdentity {
  email: string;
}

export async function verifyAccessRequest(
  request: Request,
  env: Env,
): Promise<AccessIdentity | null> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;

  try {
    const jwks = createRemoteJWKSet(new URL(`${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
    });
    if (typeof payload.email !== "string") return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/integration/access.test.ts`
Expected: PASS (4 tests). If `vi.stubGlobal("fetch", ...)` does not intercept `fetch` calls made from inside the workerd isolate (Miniflare test-runtime `fetch` may not go through the same global as the Node-side test file in all pool-workers versions), instead mock at the `cloudflare:test` level using that package's documented `fetchMock`/outbound-request-mocking API — check `@cloudflare/vitest-pool-workers`'s current docs for the exact mocking primitive if the global stub doesn't take effect.

- [ ] **Step 5: Commit**

```bash
git add src/auth/access.ts tests/integration/access.test.ts
git commit -m "Add Cloudflare Access JWT verification using jose"
```

---

### Task 16: Admin route guard + post list

**Files:**
- Create: `src/routes/admin.ts`
- Modify: `src/index.ts` (mount `/admin`)
- Test: `tests/integration/admin-guard.test.ts`

**Interfaces:**
- Consumes: `verifyAccessRequest` (Task 15), `listPosts` (Task 7), `renderLayout` (Task 8).
- Produces: `adminRoutes` Hono sub-app with an auth middleware applied to every route under it. Consumed by Tasks 17–21 (add more routes to this same file) and Task 22 (final mount).

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/admin-guard.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";

describe("admin guard", () => {
  it("returns 403 without a Cf-Access-Jwt-Assertion header", async () => {
    const res = await app.request("/admin", {}, env);
    expect(res.status).toBe(403);
  });

  it("sets X-Robots-Tag noindex on admin responses", async () => {
    const res = await app.request("/admin", {}, env);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });
});
```

Admin routes need a valid signed JWT to test the 200 path; that path is covered together with the editor/preview/save tests in Tasks 17–19 which already build the JWT-signing helper. For this task, only the unauthenticated-request behavior is testable without repeating that setup, so it's the only case asserted here.

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/integration/admin-guard.test.ts`
Expected: FAIL — `/admin` is unmatched, falls through to the public `/:slug` route or the 404 handler, not 403.

- [ ] **Step 3: Implement `src/routes/admin.ts`**

```ts
import { Hono } from "hono";
import { verifyAccessRequest } from "../auth/access";
import { listPosts } from "../db/posts";
import { renderLayout } from "../layout";

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.use("*", async (c, next) => {
  const identity = await verifyAccessRequest(c.req.raw, c.env);
  if (!identity) return c.text("Forbidden", 403);
  c.header("X-Robots-Tag", "noindex");
  c.header("Cache-Control", "no-store");
  await next();
});

adminRoutes.get("/", async (c) => {
  const posts = await listPosts(c.env.DB);
  const rows = posts
    .map(
      (p) =>
        `<li><a href="/admin/edit/${p.id}">${p.title}</a> (${p.slug}) — <a href="/${p.slug}">view</a></li>`,
    )
    .join("");
  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    pageTitle: "Admin",
    description: "Admin post list.",
    canonicalUrl: `${c.env.SITE_URL}/admin`,
    bodyHtml: `<h1>Posts</h1><p><a href="/admin/new">New post</a></p><ul>${rows}</ul>`,
    noindex: true,
  });
  return c.html(html);
});
```

- [ ] **Step 4: Mount in `src/index.ts`**

```ts
import { adminRoutes } from "./routes/admin";

app.route("/admin", adminRoutes);
```

Mount this **before** `app.route("/", publicRoutes)` so `/admin*` is matched by its own sub-router rather than falling into the public `/:slug` catch-all.

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm test -- tests/integration/admin-guard.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.ts src/index.ts tests/integration/admin-guard.test.ts
git commit -m "Add admin route guard (Access JWT) and post list page"
```

---

### Task 17: Admin editor pages (new / edit)

**Files:**
- Modify: `src/routes/admin.ts`
- Test: `tests/integration/admin-editor.test.ts`

**Interfaces:**
- Consumes: `getPostById` (Task 7), the JWT-signing test helper (duplicated from Task 15's test, factored into a shared test util here since Tasks 17–21 all need an authenticated request).
- Produces: a shared test helper `tests/helpers/access-token.ts` used by this and all remaining admin tests.

- [ ] **Step 1: Create the shared test helper `tests/helpers/access-token.ts`**

```ts
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { vi } from "vitest";

export const TEST_TEAM_DOMAIN = "https://test-team.cloudflareaccess.com";
export const TEST_AUD = "test-aud-tag";
const kid = "test-key-1";

let cachedPrivateKey: CryptoKey | undefined;
let cachedPublicJwk: JsonWebKey | undefined;

async function getKeys() {
  if (!cachedPrivateKey || !cachedPublicJwk) {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    cachedPrivateKey = privateKey;
    cachedPublicJwk = await exportJWK(publicKey);
    cachedPublicJwk.kid = kid;
    cachedPublicJwk.alg = "RS256";
    cachedPublicJwk.use = "sig";
  }
  return { privateKey: cachedPrivateKey, publicJwk: cachedPublicJwk };
}

export async function mockAccessCerts() {
  const { publicJwk } = await getKeys();
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === `${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return original(input, init);
  });
}

export async function makeAccessToken(email = "owner@example.com"): Promise<string> {
  const { privateKey } = await getKeys();
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt()
    .setIssuer(TEST_TEAM_DOMAIN)
    .setAudience(TEST_AUD)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(privateKey);
}

export async function authedHeaders(): Promise<Record<string, string>> {
  await mockAccessCerts();
  const token = await makeAccessToken();
  return { "Cf-Access-Jwt-Assertion": token };
}
```

Update `wrangler.jsonc`'s `vars.ACCESS_TEAM_DOMAIN` and `vars.ACCESS_AUD` are read from `c.env` at request time, but tests run against the real `env` from `cloudflare:test`, which reflects `wrangler.jsonc`'s configured values (`https://your-team.cloudflareaccess.com` / `replace-with-access-aud-tag`), not `TEST_TEAM_DOMAIN`/`TEST_AUD`. Reconcile this in Step 2.

- [ ] **Step 2: Point test env vars at the test Access domain**

Add a `.env.test` style override so integration tests authenticate against the same domain/aud the test helper signs for. Create `.dev.vars.test` is not read by vitest-pool-workers automatically; instead override bindings directly in `vitest.config.ts`'s `miniflare.bindings`:

```ts
// vitest.config.ts — extend the miniflare block from Task 1
miniflare: {
  bindings: {
    TEST_MIGRATIONS: migrations,
    ACCESS_TEAM_DOMAIN: "https://test-team.cloudflareaccess.com",
    ACCESS_AUD: "test-aud-tag",
  },
},
```

This overrides the `wrangler.jsonc` vars for tests only, matching `TEST_TEAM_DOMAIN`/`TEST_AUD` in the helper above. Re-run the full suite after this change:

Run: `npm test`
Expected: all previously-passing tests still PASS (this only affects `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`, unused outside auth-related tests).

- [ ] **Step 3: Write failing tests for the editor pages**

```ts
// tests/integration/admin-editor.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";
import { authedHeaders } from "../helpers/access-token";

describe("admin editor pages", () => {
  it("GET /admin/new returns an empty editor form", async () => {
    const headers = await authedHeaders();
    const res = await app.request("/admin/new", { headers }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<textarea");
    expect(html).toContain('name="title"');
    expect(html).toContain('name="slug"');
    expect(html).toContain('name="tags"');
  });

  it("GET /admin/edit/:id returns the form pre-filled with source", async () => {
    const post = await createPost(env.DB, {
      slug: "hello",
      title: "Hello",
      source: "# Hello\n\nbody",
      rendered: "<h1>Hello</h1><p>body</p>",
      hasMath: false,
      tags: ["a", "b"],
    });
    const headers = await authedHeaders();
    const res = await app.request(`/admin/edit/${post.id}`, { headers }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("# Hello");
    expect(html).toContain('value="hello"');
    expect(html).toContain('value="a, b"');
  });

  it("GET /admin/edit/:id returns 404 for a nonexistent id", async () => {
    const headers = await authedHeaders();
    const res = await app.request("/admin/edit/99999", { headers }, env);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 4: Run tests, verify they fail**

Run: `npm test -- tests/integration/admin-editor.test.ts`
Expected: FAIL — routes not defined.

- [ ] **Step 5: Add editor routes to `src/routes/admin.ts`**

```ts
import { getPostById } from "../db/posts";

function editorForm(opts: {
  action: string;
  title: string;
  slug: string;
  tags: string;
  source: string;
  error?: string;
}): string {
  return `
    <h1>${opts.action === "/admin/save" ? "Edit" : "New"} Post</h1>
    ${opts.error ? `<p style="color:red">${opts.error}</p>` : ""}
    <form method="post" action="${opts.action}">
      <p><label>Title <input name="title" value="${opts.title}"></label></p>
      <p><label>Slug <input name="slug" value="${opts.slug}"></label></p>
      <p><label>Tags <input name="tags" value="${opts.tags}"></label></p>
      <p><textarea name="source" rows="20" cols="80">${opts.source}</textarea></p>
      <p>
        <button type="submit" formaction="/admin/preview" formtarget="preview">Preview</button>
        <button type="submit">Save</button>
      </p>
    </form>
    <iframe name="preview" style="width:100%;height:300px;border:1px solid #ccc"></iframe>
  `;
}

adminRoutes.get("/new", (c) => {
  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    pageTitle: "New Post",
    description: "New post editor.",
    canonicalUrl: `${c.env.SITE_URL}/admin/new`,
    bodyHtml: editorForm({ action: "/admin/save", title: "", slug: "", tags: "", source: "" }),
    noindex: true,
  });
  return c.html(html);
});

adminRoutes.get("/edit/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const post = await getPostById(c.env.DB, id);
  if (!post) return c.notFound();
  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    pageTitle: `Edit: ${post.title}`,
    description: "Post editor.",
    canonicalUrl: `${c.env.SITE_URL}/admin/edit/${id}`,
    bodyHtml: editorForm({
      action: `/admin/save?id=${id}`,
      title: post.title,
      slug: post.slug,
      tags: post.tags.join(", "),
      source: post.source,
    }),
    noindex: true,
  });
  return c.html(html);
});
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `npm test -- tests/integration/admin-editor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/routes/admin.ts tests/helpers/access-token.ts tests/integration/admin-editor.test.ts vitest.config.ts
git commit -m "Add admin new/edit editor pages"
```

---

### Task 18: POST /admin/preview

**Files:**
- Modify: `src/routes/admin.ts`
- Test: `tests/integration/admin-preview.test.ts`

**Interfaces:**
- Consumes: `renderPost` (Task 5).

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/admin-preview.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { authedHeaders } from "../helpers/access-token";

describe("POST /admin/preview", () => {
  it("returns rendered HTML for valid source", async () => {
    const headers = { ...(await authedHeaders()), "Content-Type": "application/x-www-form-urlencoded" };
    const res = await app.request(
      "/admin/preview",
      { method: "POST", headers, body: "source=" + encodeURIComponent("# Hi") },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>Hi</h1>");
  });

  it("shows an error message without a 500 for invalid latex", async () => {
    const headers = { ...(await authedHeaders()), "Content-Type": "application/x-www-form-urlencoded" };
    const res = await app.request(
      "/admin/preview",
      { method: "POST", headers, body: "source=" + encodeURIComponent("Bad: $\\frac{1}$") },
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("error");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/integration/admin-preview.test.ts`
Expected: FAIL — route not defined.

- [ ] **Step 3: Add preview route to `src/routes/admin.ts`**

```ts
import { renderPost } from "../render/pipeline";
import { KatexRenderError } from "../render/katex-render";

adminRoutes.post("/preview", async (c) => {
  const body = await c.req.parseBody();
  const source = String(body.source ?? "");
  try {
    const { rendered } = renderPost(source);
    return c.html(rendered);
  } catch (e) {
    if (e instanceof KatexRenderError) {
      return c.html(`<p style="color:red">Math error: ${e.message} (in "${e.latex}")</p>`);
    }
    throw e;
  }
});
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/integration/admin-preview.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts tests/integration/admin-preview.test.ts
git commit -m "Add admin preview endpoint"
```

---

### Task 19: POST /admin/save

**Files:**
- Modify: `src/routes/admin.ts`
- Test: `tests/integration/admin-save.test.ts`

**Interfaces:**
- Consumes: `renderPost` (Task 5), `createPost`/`updatePost`/`getPostById`/`DuplicateSlugError` (Task 7), `computePurgePaths`/`purgePaths` (Task 14).

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/admin-save.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";
import { authedHeaders } from "../helpers/access-token";

function formBody(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

describe("POST /admin/save", () => {
  it("creates a new post and the public page reflects it", async () => {
    const headers = { ...(await authedHeaders()), "Content-Type": "application/x-www-form-urlencoded" };
    const res = await app.request(
      "/admin/save",
      { method: "POST", headers, body: formBody({ title: "New Post", slug: "new-post", tags: "a, b", source: "# New" }) },
      env,
    );
    expect(res.status).toBe(303);

    const publicRes = await app.request("/new-post", {}, env);
    expect(publicRes.status).toBe(200);
    expect(await publicRes.text()).toContain("<h1>New</h1>");
  });

  it("rejects a duplicate slug on create, preserving the submitted source", async () => {
    await createPost(env.DB, {
      slug: "taken",
      title: "Existing",
      source: "x",
      rendered: "<p>x</p>",
      hasMath: false,
      tags: [],
    });
    const headers = { ...(await authedHeaders()), "Content-Type": "application/x-www-form-urlencoded" };
    const res = await app.request(
      "/admin/save",
      { method: "POST", headers, body: formBody({ title: "New", slug: "taken", tags: "", source: "my draft text" }) },
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("slug");
    expect(html).toContain("my draft text");
  });

  it("rejects invalid latex, preserving the submitted source", async () => {
    const headers = { ...(await authedHeaders()), "Content-Type": "application/x-www-form-urlencoded" };
    const res = await app.request(
      "/admin/save",
      { method: "POST", headers, body: formBody({ title: "New", slug: "bad-math", tags: "", source: "Bad: $\\frac{1}$" }) },
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("error");
    expect(html).toContain("Bad: $\\frac{1}$");
  });

  it("updates an existing post via ?id=", async () => {
    const post = await createPost(env.DB, {
      slug: "editable",
      title: "Before",
      source: "before",
      rendered: "<p>before</p>",
      hasMath: false,
      tags: ["old-tag"],
    });
    const headers = { ...(await authedHeaders()), "Content-Type": "application/x-www-form-urlencoded" };
    const res = await app.request(
      `/admin/save?id=${post.id}`,
      { method: "POST", headers, body: formBody({ title: "After", slug: "editable", tags: "new-tag", source: "# After" }) },
      env,
    );
    expect(res.status).toBe(303);
    const publicRes = await app.request("/editable", {}, env);
    expect(await publicRes.text()).toContain("<h1>After</h1>");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/integration/admin-save.test.ts`
Expected: FAIL — route not defined.

- [ ] **Step 3: Add save route to `src/routes/admin.ts`**

```ts
import { createPost, updatePost, getPostById, DuplicateSlugError } from "../db/posts";
import { computePurgePaths, purgePaths } from "../cache/purge";

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

adminRoutes.post("/save", async (c) => {
  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const slug = String(body.slug ?? "").trim();
  const source = String(body.source ?? "");
  const tags = parseTags(String(body.tags ?? ""));
  const idParam = c.req.query("id");
  const id = idParam ? Number(idParam) : undefined;

  const renderError = (message: string) => {
    const html = renderLayout({
      siteTitle: c.env.SITE_TITLE,
      pageTitle: id ? "Edit Post" : "New Post",
      description: "Post editor.",
      canonicalUrl: `${c.env.SITE_URL}/admin/${id ? `edit/${id}` : "new"}`,
      bodyHtml: editorForm({
        action: id ? `/admin/save?id=${id}` : "/admin/save",
        title,
        slug,
        tags: tags.join(", "),
        source,
        error: message,
      }),
      noindex: true,
    });
    return c.html(html);
  };

  if (!title) return renderError("Title is required.");
  if (!slug) return renderError("Slug is required.");

  let rendered: string;
  let hasMath: boolean;
  try {
    const result = renderPost(source);
    rendered = result.rendered;
    hasMath = result.hasMath;
  } catch (e) {
    if (e instanceof KatexRenderError) {
      return renderError(`Math error: ${e.message} (in "${e.latex}")`);
    }
    throw e;
  }

  const existing = id ? await getPostById(c.env.DB, id) : null;
  const oldTags = existing?.tags ?? [];
  const oldSlug = existing?.slug;

  try {
    const saved = id
      ? await updatePost(c.env.DB, id, { slug, title, source, rendered, hasMath, tags })
      : await createPost(c.env.DB, { slug, title, source, rendered, hasMath, tags });

    const purgeTargets = new Set(computePurgePaths({ postPath: `/${saved.slug}`, oldTags, newTags: tags }));
    if (oldSlug && oldSlug !== saved.slug) purgeTargets.add(`/${oldSlug}`);
    await purgePaths(Array.from(purgeTargets));

    return c.redirect(`/admin/edit/${saved.id}`, 303);
  } catch (e) {
    if (e instanceof DuplicateSlugError) {
      return renderError(`That slug is already taken: ${slug}`);
    }
    throw e;
  }
});
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/integration/admin-save.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts tests/integration/admin-save.test.ts
git commit -m "Add admin save endpoint: render, persist, purge, redirect"
```

---

### Task 20: POST /admin/rerender

**Files:**
- Modify: `src/routes/admin.ts`
- Test: `tests/integration/admin-rerender.test.ts`

**Interfaces:**
- Consumes: `renderPost` (Task 5), `listPosts`/`updatePost` (Task 7), `purgePaths` (Task 14).

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/admin-rerender.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost, getPostBySlug } from "../../src/db/posts";
import { authedHeaders } from "../helpers/access-token";

describe("POST /admin/rerender", () => {
  it("re-renders every post from its stored source", async () => {
    await createPost(env.DB, {
      slug: "a",
      title: "A",
      source: "# A",
      rendered: "<h1>stale</h1>",
      hasMath: false,
      tags: [],
    });
    const headers = await authedHeaders();
    const res = await app.request("/admin/rerender", { method: "POST", headers }, env);
    expect(res.status).toBe(303);

    const post = await getPostBySlug(env.DB, "a");
    expect(post?.rendered).toContain("<h1>A</h1>");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/integration/admin-rerender.test.ts`
Expected: FAIL — route not defined.

- [ ] **Step 3: Add rerender route to `src/routes/admin.ts`**

```ts
adminRoutes.post("/rerender", async (c) => {
  const posts = await listPosts(c.env.DB);
  const allTags = new Set<string>();
  for (const post of posts) {
    const { rendered, hasMath } = renderPost(post.source);
    await updatePost(c.env.DB, post.id, {
      slug: post.slug,
      title: post.title,
      source: post.source,
      rendered,
      hasMath,
      tags: post.tags,
    });
    post.tags.forEach((t) => allTags.add(t));
  }

  const paths = new Set<string>(["/", "/rss.xml", "/sitemap.xml"]);
  posts.forEach((p) => paths.add(`/${p.slug}`));
  allTags.forEach((t) => paths.add(`/tag/${t}`));
  await purgePaths(Array.from(paths));

  return c.redirect("/admin", 303);
});
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/integration/admin-rerender.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts tests/integration/admin-rerender.test.ts
git commit -m "Add admin rerender-all endpoint for renderer upgrades"
```

---

### Task 21: POST /admin/delete/:id

**Files:**
- Modify: `src/routes/admin.ts`
- Test: `tests/integration/admin-delete.test.ts`

**Interfaces:**
- Consumes: `getPostById`/`deletePost` (Task 7), `computePurgePaths`/`purgePaths` (Task 14).

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/admin-delete.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost, getPostById } from "../../src/db/posts";
import { authedHeaders } from "../helpers/access-token";

describe("POST /admin/delete/:id", () => {
  it("deletes the post; it disappears from the public site", async () => {
    const post = await createPost(env.DB, {
      slug: "to-delete",
      title: "Bye",
      source: "x",
      rendered: "<p>x</p>",
      hasMath: false,
      tags: ["temp"],
    });
    const headers = await authedHeaders();
    const res = await app.request(`/admin/delete/${post.id}`, { method: "POST", headers }, env);
    expect(res.status).toBe(303);

    expect(await getPostById(env.DB, post.id)).toBeNull();
    const publicRes = await app.request("/to-delete", {}, env);
    expect(publicRes.status).toBe(404);
  });

  it("returns 404 when deleting a nonexistent post", async () => {
    const headers = await authedHeaders();
    const res = await app.request("/admin/delete/99999", { method: "POST", headers }, env);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/integration/admin-delete.test.ts`
Expected: FAIL — route not defined.

- [ ] **Step 3: Add delete route to `src/routes/admin.ts`**

```ts
import { deletePost } from "../db/posts";

adminRoutes.post("/delete/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const post = await getPostById(c.env.DB, id);
  if (!post) return c.notFound();

  await deletePost(c.env.DB, id);
  const paths = computePurgePaths({ postPath: `/${post.slug}`, oldTags: post.tags, newTags: [] });
  await purgePaths(paths);

  return c.redirect("/admin", 303);
});
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/integration/admin-delete.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts tests/integration/admin-delete.test.ts
git commit -m "Add admin delete endpoint with cache purge"
```

---

### Task 22: Cache-Control headers on public responses

**Files:**
- Modify: `src/routes/public.ts`, `src/routes/rss.ts`, `src/routes/seo-files.ts`, `src/index.ts` (notFound handler)
- Test: `tests/integration/cache-headers.test.ts`

**Interfaces:**
- Consumes: nothing new — adds a response header to routes built in Tasks 10–13.

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/cache-headers.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";

describe("Cache-Control headers", () => {
  it("public pages carry a long edge TTL with a short browser TTL", async () => {
    await createPost(env.DB, {
      slug: "hello",
      title: "Hello",
      source: "x",
      rendered: "<p>x</p>",
      hasMath: false,
      tags: [],
    });
    for (const path of ["/", "/hello", "/rss.xml", "/sitemap.xml", "/robots.txt"]) {
      const res = await app.request(path, {}, env);
      const cc = res.headers.get("Cache-Control") ?? "";
      expect(cc).toContain("public");
      expect(cc).toContain("s-maxage=31536000");
    }
  });

  it("admin responses are never cached", async () => {
    const res = await app.request("/admin", {}, env);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/integration/cache-headers.test.ts`
Expected: FAIL — no `Cache-Control` header set yet on public routes (admin already sets `no-store` from Task 16).

- [ ] **Step 3: Add a shared middleware in `src/index.ts` for non-admin routes**

```ts
app.use("*", async (c, next) => {
  await next();
  if (!c.req.path.startsWith("/admin") && !c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "public, max-age=60, s-maxage=31536000");
  }
});
```

Place this `app.use("*", ...)` registration **before** the route mounts, so it wraps every downstream handler (Hono middleware registered first wraps outer, running its post-`next()` code after inner handlers complete).

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/integration/cache-headers.test.ts`
Expected: PASS (2 tests). Re-run the full suite to confirm no regressions from the new global middleware:

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/integration/cache-headers.test.ts
git commit -m "Apply long-edge-TTL Cache-Control to public responses"
```

---

### Task 23: Performance regression test

**Files:**
- Create: `tests/perf/page-weight.test.ts`

**Interfaces:**
- Consumes: `createPost` (Task 7), the full routed `app` (Task 22).

- [ ] **Step 1: Write the test**

```ts
// tests/perf/page-weight.test.ts
import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";
import { renderPost } from "../../src/render/pipeline";

const REFERENCE_SOURCE = `# A Reference Post

This post exercises prose, inline math like $E = mc^2$, display math:

$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$

and raw HTML:

<div class="callout"><strong>Note:</strong> this is a custom callout block that a real author might paste into a post.</div>

${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20)}

\`\`\`js
function fib(n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}
\`\`\`
`;

describe("performance budget", () => {
  it("a typical post page is <= 14KB gzipped, 0 script tags, no external origins", async () => {
    const { rendered, hasMath } = renderPost(REFERENCE_SOURCE);
    await createPost(env.DB, {
      slug: "reference-post",
      title: "A Reference Post",
      source: REFERENCE_SOURCE,
      rendered,
      hasMath,
      tags: ["reference"],
    });

    const res = await app.request("/reference-post", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();

    const gzipped = gzipSync(Buffer.from(html, "utf8"));
    expect(gzipped.byteLength).toBeLessThanOrEqual(14 * 1024);

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/href="https?:\/\/(?!example\.com)/i);
    expect(html).not.toMatch(/src="https?:\/\/(?!example\.com)/i);
  });

  it("the index page is similarly bounded", async () => {
    for (let i = 0; i < 20; i++) {
      await createPost(env.DB, {
        slug: `post-${i}`,
        title: `Post number ${i} with a moderately descriptive title`,
        source: "x",
        rendered: "<p>x</p>",
        hasMath: false,
        tags: [],
      });
    }
    const res = await app.request("/", {}, env);
    const html = await res.text();
    const gzipped = gzipSync(Buffer.from(html, "utf8"));
    expect(gzipped.byteLength).toBeLessThanOrEqual(14 * 1024);
    expect(html).not.toMatch(/<script/i);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- tests/perf/page-weight.test.ts`
Expected: PASS (2 tests). If it fails on page weight, the fix is to trim `SITE_CSS` (Task 8) or the layout markup — never raise the 14KB limit (per AGENTS.md, a budget violation is a bug to fix at the cause).

If `node:zlib` is unavailable in the test execution context, confirm `"compatibility_flags": ["nodejs_compat"]` is present in `wrangler.jsonc` (set in Task 1) and re-run `wrangler types`.

- [ ] **Step 3: Commit**

```bash
git add tests/perf/page-weight.test.ts
git commit -m "Add performance regression test enforcing the 14KB page-weight budget"
```

---

### Task 24: README and deployment documentation

**Files:**
- Create: `README.md`

**Interfaces:** None — documentation only, no test cycle.

- [ ] **Step 1: Write `README.md`**

```markdown
# ftle

A personal blog engine on Cloudflare Workers + D1. See `docs/superpowers/specs/2026-07-08-ftle-design.md` for the design and `AGENTS.md` for engineering rules.

## First-time setup

1. `npm install`
2. Create the D1 database: `npx wrangler d1 create ftle` — copy the returned `database_id` into `wrangler.jsonc`'s `d1_databases[0].database_id`.
3. Apply migrations locally: `npm run migrate:local`
4. Set Worker vars in `wrangler.jsonc` (`vars`): `SITE_URL`, `SITE_TITLE`, `SITE_DESCRIPTION`, `SITE_AUTHOR`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`.
5. Generate types: `npx wrangler types`
6. Generate the self-hosted KaTeX assets: `npm run prepare:katex`

## Cloudflare Access setup (admin auth)

1. In the Cloudflare Zero Trust dashboard, create an Access application covering `/admin*` on your domain, with a policy allowing only your email (One-Time PIN or your identity provider).
2. Copy the application's AUD tag into `wrangler.jsonc`'s `ACCESS_AUD` var, and your team domain (`https://<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`.
3. No other secrets are required for auth — the Worker verifies the `Cf-Access-Jwt-Assertion` JWT in-process via `jose` against Access's public keys.

## Caching

No cache-purge secrets are required. This project uses Cloudflare's native Workers Caching (`"cache": { "enabled": true }` in `wrangler.jsonc`, `ctx.cache.purge()` called in-process on save/delete/rerender). Deploying requires Wrangler ≥ 4.69.0.

## Commands

```sh
npm test              # full suite (vitest + @cloudflare/vitest-pool-workers)
npm run dev            # wrangler dev with local D1
npm run migrate:local  # apply D1 migrations to local dev DB
npm run migrate:remote # apply D1 migrations to the deployed DB
npm run deploy          # wrangler deploy — only when explicitly asked
```

## Deploying

1. `npm run migrate:remote`
2. `npm run deploy`
3. In the Cloudflare dashboard, attach your domain to the Worker and confirm the Access application from setup step 1 covers `/admin*` on that domain.

## Known follow-ups (not blocking v1)

- KaTeX assets are self-hosted but not glyph-subsetted (see the design spec's "subsetted" note and the implementation plan's "Deviations" section). Loaded only on `has_math` pages; does not affect the 14KB HTML budget.
- Image uploads, drafts, comments, search, multi-author: explicitly out of scope per the design spec.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add README with setup, Access, and deployment instructions"
```

---

## Final verification

After Task 24, run the full suite and paste its output before claiming completion, per AGENTS.md:

```bash
npm run typecheck
npm test
```

Expected: `tsc --noEmit` exits 0, and every test file across `tests/unit`, `tests/integration`, and `tests/perf` passes.
