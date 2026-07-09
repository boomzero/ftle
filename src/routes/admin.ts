import { Hono } from "hono";
import { verifyAccessRequest } from "../auth/access";
import { listPosts, getPostById, createPost, updatePost, deletePost, DuplicateSlugError } from "../db/posts";
import { computePurgePaths, purgePaths } from "../cache/purge";
import { renderLayout } from "../layout";
import { renderPost } from "../render/pipeline";
import { KatexRenderError } from "../render/katex-render";
import { escapeAttr, escapeHtml } from "../util/escape";

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.use("*", async (c, next) => {
  const identity = await verifyAccessRequest(c.req.raw, c.env);
  if (!identity) {
    c.header("X-Robots-Tag", "noindex");
    c.header("Cache-Control", "no-store");
    return c.text("Forbidden", 403);
  }
  c.header("X-Robots-Tag", "noindex");
  c.header("Cache-Control", "no-store");
  await next();
});

adminRoutes.get("/", async (c) => {
  const posts = await listPosts(c.env.DB);
  const rows = posts
    .map(
      (p) =>
        `<li><a href="/admin/edit/${p.id}">${escapeHtml(p.title)}</a> (${escapeHtml(p.slug)}) — <a href="/${encodeURIComponent(p.slug)}">view</a></li>`,
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

function editorForm(opts: {
  isEdit: boolean;
  action: string;
  title: string;
  slug: string;
  tags: string;
  source: string;
  error?: string;
}): string {
  return `
    <h1>${opts.isEdit ? "Edit" : "New"} Post</h1>
    ${opts.error ? `<p style="color:red">${escapeHtml(opts.error)}</p>` : ""}
    <form method="post" action="${escapeAttr(opts.action)}">
      <p><label>Title <input name="title" value="${escapeAttr(opts.title)}"></label></p>
      <p><label>Slug <input name="slug" value="${escapeAttr(opts.slug)}"></label></p>
      <p><label>Tags <input name="tags" value="${escapeAttr(opts.tags)}"></label></p>
      <p><textarea name="source" rows="20" cols="80">${escapeHtml(opts.source)}</textarea></p>
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
    bodyHtml: editorForm({
      isEdit: false,
      action: "/admin/save",
      title: "",
      slug: "",
      tags: "",
      source: "",
    }),
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
      isEdit: true,
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

adminRoutes.post("/preview", async (c) => {
  const body = await c.req.parseBody();
  const source = String(body.source ?? "");
  try {
    const { rendered } = renderPost(source);
    return c.html(rendered);
  } catch (e) {
    if (e instanceof KatexRenderError) {
      return c.html(
        `<p style="color:red">Math error: ${escapeHtml(e.message)} (in "${escapeHtml(e.latex)}")</p>`,
      );
    }
    throw e;
  }
});

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
        isEdit: Boolean(id),
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
    // Any other save-path failure (e.g. the post behind `id` was deleted in
    // another tab between page load and submit) must still return the editor
    // with the submitted source intact -- never lose typed work, per
    // AGENTS.md's non-negotiable. Falling through to an uncaught throw here
    // would drop the draft behind a bare 500.
    const message = e instanceof Error ? e.message : String(e);
    return renderError(`Save failed: ${message}`);
  }
});

adminRoutes.post("/rerender", async (c) => {
  const posts = await listPosts(c.env.DB);
  const allTags = new Set<string>();
  const failures: { slug: string; message: string }[] = [];

  for (const post of posts) {
    try {
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
    } catch (e) {
      // A renderer regression in one post (the exact scenario this endpoint
      // exists to catch, per its purpose after a renderer upgrade) must not
      // abort re-rendering every other post in the batch.
      const message = e instanceof Error ? e.message : String(e);
      failures.push({ slug: post.slug, message });
      console.error(`rerender failed for post "${post.slug}":`, message);
    }
  }

  const paths = new Set<string>(["/", "/rss.xml", "/sitemap.xml"]);
  posts.forEach((p) => paths.add(`/${p.slug}`));
  allTags.forEach((t) => paths.add(`/tag/${t}`));
  await purgePaths(Array.from(paths));

  if (failures.length > 0) {
    const list = failures.map((f) => `<li>${escapeHtml(f.slug)}: ${escapeHtml(f.message)}</li>`).join("");
    const html = renderLayout({
      siteTitle: c.env.SITE_TITLE,
      pageTitle: "Rerender",
      description: "Rerender results.",
      canonicalUrl: `${c.env.SITE_URL}/admin`,
      bodyHtml: `<h1>Rerender completed with errors</h1><p>${posts.length - failures.length} of ${posts.length} posts re-rendered successfully.</p><ul>${list}</ul><p><a href="/admin">Back to admin</a></p>`,
      noindex: true,
    });
    return c.html(html, 200);
  }

  return c.redirect("/admin", 303);
});

adminRoutes.post("/delete/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const post = await getPostById(c.env.DB, id);
  if (!post) return c.notFound();

  await deletePost(c.env.DB, id);
  const paths = computePurgePaths({ postPath: `/${post.slug}`, oldTags: post.tags, newTags: [] });
  await purgePaths(paths);

  return c.redirect("/admin", 303);
});
