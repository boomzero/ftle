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
