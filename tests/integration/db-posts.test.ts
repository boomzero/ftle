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
