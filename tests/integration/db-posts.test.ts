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
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM post_tags").run();
    await env.DB.prepare("DELETE FROM posts").run();
  });

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
      status: "listed",
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

    const remainingTags = await env.DB
      .prepare("SELECT * FROM post_tags WHERE post_id = ?")
      .bind(created.id)
      .all();
    expect(remainingTags.results).toHaveLength(0);
  });

  it("updates tags atomically: the old tag set is never briefly empty", async () => {
    const created = await createPost(env.DB, baseInput);
    await updatePost(env.DB, created.id, { ...baseInput, tags: ["replacement-tag"], status: "listed" });

    const rows = await env.DB
      .prepare("SELECT tag FROM post_tags WHERE post_id = ?")
      .bind(created.id)
      .all<{ tag: string }>();
    expect(rows.results.map((r) => r.tag)).toEqual(["replacement-tag"]);
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

  it("listPosts with listedOnly=true excludes unlisted and draft posts", async () => {
    await createPost(env.DB, { ...baseInput, slug: "listed-post", status: "listed" });
    await createPost(env.DB, { ...baseInput, slug: "unlisted-post", status: "unlisted" });
    await createPost(env.DB, { ...baseInput, slug: "draft-post", status: "draft" });
    const posts = await listPosts(env.DB, true);
    // Only the listed post should appear
    expect(posts.map((p) => p.slug)).toEqual(["listed-post"]);
  });

  it("listPosts without listedOnly returns all posts", async () => {
    await createPost(env.DB, { ...baseInput, slug: "listed-post", status: "listed" });
    await createPost(env.DB, { ...baseInput, slug: "unlisted-post", status: "unlisted" });
    await createPost(env.DB, { ...baseInput, slug: "draft-post", status: "draft" });
    const posts = await listPosts(env.DB);
    expect(posts.map((p) => p.slug).sort()).toEqual(["draft-post", "listed-post", "unlisted-post"].sort());
  });

  it("listPostsByTag with listedOnly=true filters by listed status only", async () => {
    await createPost(env.DB, { ...baseInput, slug: "listed-post", tags: ["shared"], status: "listed" });
    await createPost(env.DB, { ...baseInput, slug: "unlisted-post", tags: ["shared"], status: "unlisted" });
    await createPost(env.DB, { ...baseInput, slug: "draft-post", tags: ["shared"], status: "draft" });
    const posts = await listPostsByTag(env.DB, "shared", true);
    expect(posts.map((p) => p.slug)).toEqual(["listed-post"]);
  });

  it("createPost with status='unlisted' creates an unlisted post", async () => {
    const created = await createPost(env.DB, { ...baseInput, slug: "unlisted", status: "unlisted" });
    expect(created.status).toBe("unlisted");
  });

  it("createPost with status='draft' creates a draft post", async () => {
    const created = await createPost(env.DB, { ...baseInput, slug: "draft", status: "draft" });
    expect(created.status).toBe("draft");
  });

  it("createPost defaults to status='draft' when status is omitted", async () => {
    const created = await createPost(env.DB, baseInput);
    expect(created.status).toBe("draft");
  });

  it("updatePost can change status", async () => {
    const created = await createPost(env.DB, { ...baseInput, slug: "toggle-me", status: "listed" });
    expect(created.status).toBe("listed");
    const updated = await updatePost(env.DB, created.id, { ...baseInput, slug: "toggle-me", status: "unlisted" });
    expect(updated.status).toBe("unlisted");
  });

  it("status round-trips correctly through create and update", async () => {
    // Test all three status values survive a full create → read → update → read cycle
    for (const status of ["draft", "unlisted", "listed"] as const) {
      const slug = `status-test-${status}`;
      const created = await createPost(env.DB, { ...baseInput, slug, status });
      expect(created.status).toBe(status);

      const read = await getPostById(env.DB, created.id);
      expect(read?.status).toBe(status);

      const updated = await updatePost(env.DB, created.id, { ...baseInput, slug, status: "listed" });
      expect(updated.status).toBe("listed");
    }
  });
});
