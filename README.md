# ftle

[![CI](https://github.com/boomzero/ftle/actions/workflows/ci.yml/badge.svg)](https://github.com/boomzero/ftle/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A dynamically-editable blog engine that runs entirely on Cloudflare's free tier — no server to patch, no database to babysit, no monthly hosting bill.

Most self-hosted blog engines (WordPress and friends) trade you a web-based editor for a PHP server, a MySQL instance, plugin security patches, and a hosting bill. ftle keeps the part that's actually useful — write and publish from a browser, from anywhere — and throws away the rest: it's a single Cloudflare Worker and a D1 (SQLite) database, deployed with one command, with nothing to patch because there's no server process to compromise.

- **Free to run.** Fits comfortably in Cloudflare's free Workers + D1 tier.
- **Fast.** Reader-facing pages ship **0 bytes of JavaScript** and **≤ 14KB compressed HTML**, served from Cloudflare's edge cache. A regression test enforces this budget on every commit — see [Performance budget](#performance-budget).
- **Small attack surface.** No PHP, no plugin ecosystem, no database credentials to leak. The admin panel is gated by [Cloudflare Access](#cloudflare-access-setup-admin-auth) — Cloudflare verifies your identity before a request ever reaches the Worker.
- **Edit from anywhere.** A web-based Markdown editor with live LaTeX math preview — no local tooling, no build step, no static-site regeneration.

## Features

- Markdown posts with raw HTML passthrough and server-side [KaTeX](https://katex.org) math rendering (`$inline$` and `$$display$$`)
- Draft / unlisted / listed post visibility
- Tags, an Atom feed (`/rss.xml`), `sitemap.xml`, and `robots.txt`
- OpenGraph, Twitter Card, and JSON-LD `BlogPosting` metadata on every post
- Dark-mode-aware styling with Tailwind, inlined into each page (no external stylesheet)
- Cache-tag-based CDN invalidation — edits go live immediately, not after a TTL

## Quickstart

### Option A: Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/boomzero/ftle)

This clones the repo into your own GitHub account, provisions a D1 database, and deploys the Worker in a few clicks. The `deploy` script (`package.json`) runs `wrangler d1 migrations apply DB --remote` before `wrangler deploy`, so the database schema is applied automatically as part of that same build — nothing extra to run.

One manual step remains before your site is safe to use: **set up Cloudflare Access.** The button can't create a Zero Trust application on your behalf — until you complete [Cloudflare Access setup](#cloudflare-access-setup-admin-auth), `/admin` is either unprotected or (if `ACCESS_AUD`/`ACCESS_TEAM_DOMAIN` are left as placeholders) simply broken. Do this before you publish anything you care about.

### Option B: Manual setup

1. `npm install`
2. Create the D1 database: `npx wrangler d1 create ftle` — copy the returned `database_id` into `wrangler.jsonc`'s `d1_databases[0].database_id`.
3. Apply migrations locally: `npm run migrate:local`
4. Set the Worker vars in `wrangler.jsonc` (`vars`) — see [Configuration](#configuration) below.
5. Generate types: `npx wrangler types`
6. Generate the self-hosted KaTeX assets: `npm run prepare:katex`
7. `npm run dev` to try it locally, then see [Deploying](#deploying) when you're ready to go live.

## Configuration

All configuration lives in `wrangler.jsonc`'s `vars` block — no secrets, no `.env` file required.

| Var | Purpose |
|---|---|
| `SITE_URL` | Canonical origin, e.g. `https://example.com` — used to build absolute URLs, RSS, and sitemap entries |
| `SITE_TITLE` | Site name, shown in the nav and page titles |
| `SITE_DESCRIPTION` | Default meta description |
| `SITE_AUTHOR` | Author name, used in feed/JSON-LD metadata |
| `SITE_NAV_LINKS` | Optional extra nav links, as `Label\|URL` pairs separated by commas, e.g. `Twig\|https://twig.example.com,Sinv\|https://sinv.example.com`. Leave empty for no extra links. |
| `ACCESS_TEAM_DOMAIN` | Your Cloudflare Access team domain — see below |
| `ACCESS_AUD` | Your Access application's AUD tag — see below |

## Cloudflare Access setup (admin auth)

`/admin*` isn't protected by a username/password login — it's protected by [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/), which sits in front of the Worker and only lets a request through after Cloudflare itself has verified your identity. The Worker additionally verifies the `Cf-Access-Jwt-Assertion` JWT in-process via [`jose`](https://github.com/panva/jose) against Access's public keys (`src/auth/access.ts`) as defense in depth, but Access is the actual gate.

1. **Attach your domain to the Worker first.** Your domain needs to already be on Cloudflare (proxied) before it'll show up as an option below — see step 2 of [Deploying](#deploying). Access sits in front of the existing route; it doesn't create one.
2. **Create the application.** In the Cloudflare dashboard, go to **Zero Trust → Access controls → Applications → Add an application → Self-hosted**. This is a self-hosted, DNS-routed app (not a "Private" app requiring the WARP client) — visitors reach it through normal HTTPS. Under **Add public hostname**, pick your domain and set the path to `/admin*` so the policy covers the whole admin panel.
3. **Add an Allow policy restricted to your email.** On the same screen, add a policy with **Action: Allow** and an **Include** rule of type **Emails**, with your email address as the value. Use the exact-match **Emails** selector, not **Emails ending in** a domain — the latter would let anyone with an email at that domain request a login code.
4. **Leave One-Time PIN as the login method** (it's on by default) unless you already have an identity provider configured — no extra signup service is required for a single-author blog.
5. **Save the application**, then find its **AUD tag**: back in **Access controls → Applications**, select your app, open **Configure**, and copy the **Application Audience (AUD) Tag** from the Overview/Additional settings panel. Paste it into `wrangler.jsonc`'s `ACCESS_AUD`.
6. **Find your team domain**: **Zero Trust → Settings → Custom Pages** (or **General**) shows your **Team name and domain**, in the form `https://<your-team>.cloudflareaccess.com`. Paste it into `ACCESS_TEAM_DOMAIN`.
7. Redeploy (or just apply the new vars with `npx wrangler deploy`). Visiting `/admin` should now redirect you through a Cloudflare-hosted login page before the Worker ever sees the request.

No other secrets are required — there's no client secret, API token, or session cookie for the Worker to manage.

## Architecture

One Cloudflare Worker, one D1 (SQLite) database. No KV, no R2, no queues, no build step for content.

Posts render **at write time**, not read time: saving a post runs Markdown ([`marked`](https://github.com/markedjs/marked), with raw HTML passed through) and KaTeX server-side once, storing both the original `source` and the pre-rendered HTML in D1. The read path is then just: edge cache hit → serve; miss → one indexed D1 query → wrap in the layout template → serve and populate the cache. Nothing is ever rendered on a reader's request.

The single trusted author is the security model for content: HTML is intentionally *not* sanitized (you're the only one who can save a post, and that's gated by Cloudflare Access), which is what lets raw HTML and math pass through untouched without a client-side sanitizer or extra request.

## Performance budget

Enforced by a regression test (`tests/perf/page-weight.test.ts`), not just a guideline:

| Metric | Budget |
|---|---|
| JavaScript on reader-facing pages | 0 bytes |
| Blocking external requests | 0 — CSS is inlined into the HTML |
| Typical post page, compressed | ≤ 14KB |

Admin pages are exempt — they may use minimal JS for the editor.

## Commands

```sh
npm test               # full suite (vitest + @cloudflare/vitest-pool-workers)
npm run dev             # wrangler dev with local D1
npm run typecheck       # tsc --noEmit
npm run migrate:local   # apply D1 migrations to local dev DB
npm run migrate:remote  # apply D1 migrations to the deployed DB
npm run deploy           # apply pending remote migrations, then wrangler deploy
```

## Deploying

1. `npm run deploy` — applies any pending remote D1 migrations, then deploys the Worker.
2. In the Cloudflare dashboard, attach your domain to the Worker and confirm the Access application from [setup](#cloudflare-access-setup-admin-auth) covers `/admin*` on that domain.

Deploying requires Wrangler ≥ 4.69.0. No cache-purge secrets are needed — this project uses Cloudflare's native Workers Caching (`"cache": { "enabled": true }` in `wrangler.jsonc`), with `ctx.cache.purge()` called in-process on save/delete/rerender via cache-tag-based invalidation.

## Known limitations

Explicitly out of scope for v1: image uploads, comments, search, and multi-author support. KaTeX assets are self-hosted but not glyph-subsetted yet (loaded only on pages containing math, so this doesn't affect the 14KB budget on pages without it).

## License

[MIT](LICENSE)
