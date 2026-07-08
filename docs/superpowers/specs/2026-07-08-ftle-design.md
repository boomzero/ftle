# ftle — Design Spec

**Date:** 2026-07-08
**Status:** Approved design, pre-implementation

## What it is

A personal blog engine on Cloudflare Workers + D1. Primary objective: pages load as fast as physically possible. Dynamically editable from a web admin UI (no static site generator, no build step, no local tooling). Posts are Markdown with raw HTML passed through untouched and LaTeX math rendered server-side.

**Speed baseline to beat:** <https://www.catherinejue.com/fast> — 6.3KB HTML (2.9KB gzipped), zero JS, but with two weaknesses ftle avoids: an external `style.css` request and Google Fonts (two extra origins delaying text render).

## Performance budget (the contract)

| Metric | Target |
|---|---|
| JavaScript on reader-facing pages | 0 bytes |
| Blocking external requests | 0 — CSS inlined into HTML; system font stack |
| Typical post page, compressed | ≤ 14KB (one TCP initial congestion window) |
| TTFB, edge cache hit | ~10–50ms |
| TTFB, cache miss | < 300ms worldwide (one indexed D1 query) |
| KaTeX CSS + fonts | Loaded only on pages containing math, self-hosted, subsetted |

Any change that violates this table is a bug. A performance regression test enforces the page-weight line.

## Architecture

One Cloudflare Worker, one D1 database. No KV, no R2, no queues.

**Render at write time:** all expensive work (Markdown parsing, KaTeX rendering) happens when a post is saved, never when a reader loads a page. Read path:

1. Cloudflare edge cache hit → serve (~10–50ms), done.
2. Miss → one indexed D1 query returns pre-rendered HTML → wrap in layout template string → serve and populate cache.

**Stack:**

- TypeScript Worker, [Hono](https://hono.dev) router — server-side only, adds zero client bytes.
- `marked` for Markdown, with raw HTML passthrough enabled.
- `katex` for server-side math rendering (runs in the Worker at save time only).
- Vitest + `@cloudflare/vitest-pool-workers` for tests.
- `wrangler` for dev and deploy.

## Data model (D1)

```sql
CREATE TABLE posts (
  id         INTEGER PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL,   -- editable, used in URL
  title      TEXT NOT NULL,
  source     TEXT NOT NULL,          -- markdown + raw HTML + LaTeX; the editable truth
  rendered   TEXT NOT NULL,          -- pre-rendered HTML body
  has_math   INTEGER NOT NULL DEFAULT 0,  -- gates KaTeX CSS inclusion
  created_at TEXT NOT NULL,          -- ISO 8601
  updated_at TEXT NOT NULL
);

CREATE TABLE post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX idx_post_tags_tag ON post_tags(tag);
```

No draft state: the first save publishes. (Adding a `published` flag later is one column and one WHERE clause.)

## Routes

### Public — zero JS, edge-cached

| Route | Purpose |
|---|---|
| `GET /` | Index: posts newest-first, title + date |
| `GET /:slug` | Post page |
| `GET /tag/:tag` | Posts having that tag |
| `GET /rss.xml` | Atom feed, full content |
| `GET /katex.<hash>.css` | Self-hosted subsetted KaTeX CSS (fonts referenced from same origin), `Cache-Control: immutable`, hash-versioned URL |
| anything else | Tiny cached 404 page |

Every public page is a complete HTML document with the site CSS inlined in `<head>`. Post pages where `has_math = 1` additionally reference the versioned KaTeX stylesheet.

### Admin — behind Cloudflare Access, never cached

| Route | Purpose |
|---|---|
| `GET /admin` | Post list with edit links |
| `GET /admin/new` | Editor (empty) |
| `GET /admin/edit/:id` | Editor (loaded with `source`) |
| `POST /admin/preview` | Renders submitted source, returns preview HTML |
| `POST /admin/save` | Render → write to D1 → purge caches |
| `POST /admin/rerender` | Re-render every post from `source` (after layout/renderer changes) |
| `POST /admin/delete/:id` | Delete post, purge caches |

The editor is a plain `<textarea>` with title, slug, and tags (comma-separated) fields, a Preview button, and a Save button. Admin pages may use minimal JS (they are not on the reader path and not performance-bound).

## Rendering pipeline (at save time)

1. Extract `$$...$$` (display) and `$...$` (inline) spans from the source, skipping fenced/inline code blocks.
2. Render each span with KaTeX → HTML. Any KaTeX error aborts the save; the error message and untouched source are shown in the editor. No broken math ever ships.
3. Set `has_math` if any span was rendered.
4. Run the remaining text through `marked` with raw HTML passed through **unsanitized**.
5. Store `rendered` alongside `source`.

**Sanitization is deliberately absent.** This is a single-author personal blog; Cloudflare Access is the security boundary. Unsanitized passthrough is what makes "post custom HTML" a real feature rather than a whitelist.

## Caching & invalidation

- Public responses carry long-TTL cache headers and are stored in Cloudflare's edge cache.
- On save/delete, the Worker purges by URL via the Cloudflare API (global purge, not per-colo `cache.delete`): the post's URL, `/`, `/rss.xml`, and every affected tag page (old tags and new). Requires a `CF_API_TOKEN` secret with cache-purge permission and the zone ID.
- Edits are therefore visible worldwide within seconds. Cold-colo misses are acceptable: one D1 query.
- `/katex.css` is versioned (e.g. `/katex.<hash>.css`) and immutable; a KaTeX upgrade changes the URL and requires a re-render-all.

## Auth: Cloudflare Zero Trust (Access)

- A Cloudflare Access application covers `/admin*` on the blog's domain, with a policy allowing only the owner's email (One-Time PIN or identity provider — configured in the Zero Trust dashboard, not in code).
- **Defense in depth in the Worker:** every `/admin*` request must carry a valid `Cf-Access-Jwt-Assertion` JWT. The Worker verifies its signature against the team's public keys (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, cached) and checks the `aud` claim against the Access application AUD tag. Requests failing verification get 403 — so admin routes stay closed even if someone reaches the Worker without traversing Access (e.g. direct `workers.dev` URL, misconfigured DNS).
- No login UI, no password, no session code in the app. Config: `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` as Worker vars.

## Error handling

- Save-path errors (invalid LaTeX, duplicate slug, empty title) return the editor re-rendered with the error message and the submitted source intact — never lose typed work.
- Reader-path D1 errors return a plain 500 page (uncached).
- Unknown slugs and routes → the cached 404 page.

## Testing

- **Unit (render pipeline):** math span extraction (inline, display, `$` inside code blocks ignored), KaTeX error propagation, raw HTML passthrough fidelity, `has_math` flag correctness.
- **Integration (routes):** against local D1 via vitest-pool-workers — CRUD through admin routes, public pages reflect saves, purge list computed correctly, 403 on missing/invalid Access JWT, 404 behavior.
- **Performance regression:** a reference post (prose + math + custom HTML) must render to a page ≤ 14KB gzipped; index page similarly bounded. Fails the suite if exceeded.

## Explicitly out of scope (v1)

- Drafts, scheduled publishing
- Image uploads (hotlink or external hosting for now; R2 is the obvious later addition)
- Comments, analytics, search, multi-author
- Webfonts (system stack; layout template is one file, so adding a self-hosted WOFF2 later is a one-line change)
