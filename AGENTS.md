# AGENTS.md

Guidance for AI agents (and humans) working on **ftle**, a self-hostable blog engine on Cloudflare Workers + D1. See the [README](README.md) for setup and the "Architecture in one paragraph" section below for the design.

## The two non-negotiables

### 1. TDD is required

Every behavior change follows red → green → refactor:

1. Write a failing test that specifies the behavior. Run it and **watch it fail** — a test that has never failed proves nothing.
2. Write the minimum code to make it pass.
3. Refactor with the suite green.

Rules that follow from this:

- No production code without a failing test demanding it. This includes bug fixes: first reproduce the bug as a failing test, then fix it.
- Never weaken, delete, or skip a test to get to green. If a test seems wrong, say so and stop for discussion.
- Never claim work is done without pasting the output of a full green `npm test` run.
- Test through public interfaces (routes, the render pipeline's entry points), not private internals.

### 2. The performance budget is a test, not a guideline

Reader-facing pages: **0 bytes of JavaScript, 0 blocking external requests, ≤ 14KB compressed** for a typical post. The regression test in the suite enforces page weight; treat a violation exactly like any other failing test — fix the cause, never raise the limit. Admin pages are exempt (they may use minimal JS).

## Commands

```sh
npm test          # full suite (vitest + @cloudflare/vitest-pool-workers)
npm run dev       # wrangler dev with local D1
npm run deploy    # wrangler deploy — only when explicitly asked
```

## Architecture in one paragraph

Rendering happens at **write time**: saving a post runs Markdown (`marked`, raw HTML passed through unsanitized) and KaTeX (server-side), storing both `source` and `rendered` in D1. The read path is edge cache → one D1 query → layout wrap. Never move rendering onto the read path. Never add sanitization — the single trusted author is the security model; Cloudflare Access guards `/admin*`, with JWT verification in the Worker as defense in depth.

## Conventions

- TypeScript, Hono router, no additional runtime dependencies without discussion.
- Site CSS lives in the layout template and is inlined into every page — no external stylesheet (the versioned KaTeX CSS is the sole exception, and only on `has_math` pages).
- Schema changes go through numbered migration files applied with `wrangler d1 migrations`.
- Save-path errors must return the editor with the user's submitted source intact — losing typed work is a bug.
- Commit messages: imperative mood, one logical change per commit. Design notes and implementation plans (via the Superpowers skill) live under `docs/superpowers/`, which is gitignored — keep them local, not in commits.

## When unsure

Prefer deleting code to adding it. If a requirement seems to conflict with the spec or the performance budget, stop and ask rather than guessing.
