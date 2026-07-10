# Draft posts — Design Spec

**Date:** 2026-07-10
**Status:** Approved design, pre-implementation

## What it is

Adds a `draft` status as a third post state alongside the existing `unlisted`/`listed` states introduced in the previous change. A draft post is not publicly reachable at all — visiting its URL directly returns 404 — whereas an unlisted post remains reachable by direct URL but is omitted from the homepage, tag pages, RSS, and sitemap.

## Data model

Replace the `posts.listed` INTEGER column with a `posts.status` TEXT column holding one of `'draft' | 'unlisted' | 'listed'`.

**Migration `migrations/0003_add_status_to_posts.sql`:**

```sql
ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'listed';
UPDATE posts SET status = CASE WHEN listed = 1 THEN 'listed' ELSE 'unlisted' END;
ALTER TABLE posts DROP COLUMN listed;
```

The DB-level default of `'listed'` exists only to give the backfill `UPDATE` something to overwrite; it is not the application-level default for new posts. Every existing post keeps its exact current visibility — nothing existing becomes a draft as a side effect of this migration.

## Application defaults

- `createPost` defaults `status` to `'draft'` when the caller omits it (previously `PostInput.listed` defaulted to published/`true`). This is the one intentional behavior change: brand-new posts are no longer public by default.
- `updatePost` requires an explicit `status`, same as it required an explicit `listed` before — the editor form always submits a value.

## Types (`src/db/posts.ts`)

- `Post.listed: number` → `Post.status: 'draft' | 'unlisted' | 'listed'`
- `PostInput.listed?: boolean` → `PostInput.status?: 'draft' | 'unlisted' | 'listed'`

## Public-facing behavior

- `GET /:slug` (`src/routes/public.ts`): after `getPostBySlug` resolves a post, if `post.status === 'draft'`, return `c.notFound()` — identical response to a nonexistent slug.
- `listPosts(db, listedOnly)` / `listPostsByTag(db, tag, listedOnly)`: the `listedOnly` query filter changes from `WHERE listed = 1` to `WHERE status = 'listed'`. No caller changes — homepage, tag pages, RSS, and sitemap already pass `listedOnly = true`, so both draft and unlisted posts are excluded from all of them.

## Admin UI

**Editor form** (`editorForm` in `src/routes/admin.ts`): the "Listed" checkbox is replaced with a `<select name="status">` offering `Draft`, `Published — unlisted`, `Published — listed`.

- `GET /admin/new` preselects `Draft`.
- `GET /admin/edit/:id` preselects the post's current status.
- `POST /admin/save` reads `body.status`, validates against the three allowed values (falling back to `'draft'` on anything unrecognized, mirroring today's defensive parsing of the `listed` checkbox), and passes it through to `createPost`/`updatePost`.

**Admin list** (`GET /admin`):

- Each row's badge reflects all three states (e.g. gray = draft, amber = unlisted, green = listed).
- The existing one-click toggle button is replaced by an inline `<select>` per row that auto-submits on change, posting to `POST /admin/set-status/:id` (replacing `POST /admin/toggle-listed/:id`) with a `status` form field.
- The "view" link is shown for unlisted/listed posts only; draft posts have no public page to view (the editor's preview iframe is the only way to see a draft's rendered output).

**Cache purging on status change:** same behavior as today's `toggle-listed` — purge home/RSS/sitemap/tag paths but not the post's own URL, since a status transition alone doesn't change the post's own page content. (A draft's own URL was never servable before a transition to unlisted/listed, so there's nothing stale to purge for that URL either way.)

## Testing (TDD — write these failing first, per AGENTS.md)

- `tests/integration/db-posts.test.ts`: status stored/round-tripped correctly; `createPost` defaults to `'draft'` when status is omitted; `listPosts`/`listPostsByTag` with `listedOnly` return only `status = 'listed'` posts.
- `tests/integration/unlisted.test.ts` → rename to `tests/integration/post-visibility.test.ts` and extend: draft posts 404 on direct URL; unlisted posts remain reachable by direct URL but excluded from home/tag/RSS/sitemap (existing coverage, migrated); listed posts appear everywhere.
- `tests/integration/admin-editor.test.ts`: new-post page defaults the status selector to draft; save round-trips each of the three status values; `POST /admin/set-status/:id` updates status and purges the expected cache paths.
- Migration coverage: pre-existing `listed = 1`/`0` rows land on `'listed'`/`'unlisted'` respectively after migration, never `'draft'`.

## Out of scope

- No scheduled/future publishing (publish-at-a-timestamp). Status changes are immediate and manual only.
- No draft-preview links shareable with non-admins (e.g. a signed preview URL). The editor's preview iframe is the only draft-viewing mechanism, same as today.
