import { Hono } from "hono";
import { verifyAccessRequest } from "../auth/access";
import { listPosts, getPostById, createPost, updatePost, deletePost, DuplicateSlugError, validateStatus, type PostStatus } from "../db/posts";
import { computePurgePaths, purgePaths } from "../cache/purge";
import { renderLayout } from "../layout";
import { renderPost } from "../render/pipeline";
import { KatexRenderError } from "../render/katex-render";
import { escapeAttr, escapeHtml } from "../util/escape";
import { parseNavLinks } from "../util/nav-links";
import { SITE_CSS } from "../generated/site-css";
import { KATEX_CSS_PATH } from "../generated/katex-manifest";

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

function statusBadge(s: PostStatus): string {
  const color =
    s === "listed"  ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
    : s === "unlisted" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
    : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return `<span class="rounded px-2 py-0.5 text-xs font-medium ${color}">${s}</span>`;
}

adminRoutes.get("/", async (c) => {
  const posts = await listPosts(c.env.DB);
  const rows = posts
    .map(
      (p) => {
        const badge = statusBadge(p.status);
        const viewLink =
          p.status !== "draft"
            ? ` — <a class="hover:text-indigo-600 dark:hover:text-indigo-400" href="/${encodeURIComponent(p.slug)}">view</a>`
            : "";
        return `<li class="flex items-baseline justify-between gap-4 py-3"><a class="font-medium hover:text-indigo-600 dark:hover:text-indigo-400" href="/admin/edit/${p.id}">${escapeHtml(p.title)}</a><span class="shrink-0 text-sm text-gray-500 dark:text-gray-400">${badge} <form method="post" action="/admin/set-status/${p.id}" class="inline"><select name="status" class="text-xs rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-900" onchange="this.form.submit()"><option value="draft"${p.status === "draft" ? " selected" : ""}>Draft</option><option value="unlisted"${p.status === "unlisted" ? " selected" : ""}>Unlisted</option><option value="listed"${p.status === "listed" ? " selected" : ""}>Listed</option></select></form> (${escapeHtml(p.slug)})${viewLink}</span></li>`;
      },
    )
    .join("");
  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    navLinks: parseNavLinks(c.env.SITE_NAV_LINKS),
    pageTitle: "Admin",
    description: "Admin post list.",
    canonicalUrl: `${c.env.SITE_URL}/admin`,
    bodyHtml: `<h1 class="mb-6 text-3xl font-bold tracking-tight">Posts</h1><p class="mb-6"><a class="inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700" href="/admin/new">New post</a></p><ul class="divide-y divide-gray-200 dark:divide-gray-800">${rows}</ul>`,
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
  status?: PostStatus;
  error?: string;
}): string {
  const s = opts.status ?? 'draft';
  return `
    <p class="mb-4"><a class="text-sm hover:text-indigo-600 dark:hover:text-indigo-400" href="/admin">← Back to admin</a></p>
    <h1 class="mb-6 text-3xl font-bold tracking-tight">${opts.isEdit ? "Edit" : "New"} Post</h1>
    ${opts.error ? `<p class="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">${escapeHtml(opts.error)}</p>` : ""}
    <form class="flex flex-col gap-4" method="post" action="${escapeAttr(opts.action)}">
      <label class="flex flex-col gap-1 text-sm font-medium">Title
        <input class="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900" name="title" value="${escapeAttr(opts.title)}">
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium">Slug
        <input class="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900" name="slug" value="${escapeAttr(opts.slug)}">
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium">Tags
        <input class="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900" name="tags" value="${escapeAttr(opts.tags)}">
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium">Source
        <textarea class="rounded-md border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900" name="source" rows="20" cols="80">${escapeHtml(opts.source)}</textarea>
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium">Status
        <select class="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900" name="status">
          <option value="draft"${s === "draft" ? " selected" : ""}>Draft</option>
          <option value="unlisted"${s === "unlisted" ? " selected" : ""}>Published — unlisted</option>
          <option value="listed"${s === "listed" ? " selected" : ""}>Published — listed</option>
        </select>
      </label>
      <p class="flex gap-3">
        <button class="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900" type="submit" formaction="/admin/preview" formtarget="preview">Preview</button>
        <button class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700" type="submit">Save</button>
      </p>
    </form>
    <iframe class="mt-6 h-[300px] w-full rounded-md border border-gray-300 dark:border-gray-700" name="preview"></iframe>
  `;
}

adminRoutes.get("/new", (c) => {
  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    navLinks: parseNavLinks(c.env.SITE_NAV_LINKS),
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
    navLinks: parseNavLinks(c.env.SITE_NAV_LINKS),
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
      status: post.status,
    }),
    noindex: true,
  });
  return c.html(html);
});

adminRoutes.post("/preview", async (c) => {
  const body = await c.req.parseBody();
  const source = String(body.source ?? "");
  try {
    const { rendered, hasMath } = renderPost(source);
    const katexCss = hasMath
      ? `<link rel="stylesheet" href="${escapeAttr(KATEX_CSS_PATH)}">`
      : "";
    return c.html(`<style>${SITE_CSS}</style>${katexCss}<div class="prose dark:prose-invert max-w-none">${rendered}</div>`);
  } catch (e) {
    if (e instanceof KatexRenderError) {
      return c.html(
        `<style>${SITE_CSS}</style><p class="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">Math error: ${escapeHtml(e.message)} (in "${escapeHtml(e.latex)}")</p>`,
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
  const rawStatus = String(body.status ?? "");
  const status = validateStatus(rawStatus, "draft");
  const idParam = c.req.query("id");
  const id = idParam ? Number(idParam) : undefined;

  const renderError = (message: string) => {
    const html = renderLayout({
      siteTitle: c.env.SITE_TITLE,
      navLinks: parseNavLinks(c.env.SITE_NAV_LINKS),
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
        status,
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

  // For edits, fall back to the existing post's status when the form field
  // is missing or unrecognised — a stale pre-deploy browser tab without the
  // new <select> would otherwise silently unpublish a live post.
  const saveStatus: PostStatus = validateStatus(rawStatus, existing?.status ?? 'draft');

  let saved;
  try {
    saved = id
      ? await updatePost(c.env.DB, id, { slug, title, source, rendered, hasMath, tags, status: saveStatus })
      : await createPost(c.env.DB, { slug, title, source, rendered, hasMath, tags, status: saveStatus });
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

  // The post is already committed at this point. A cache-purge failure here
  // is not a save failure -- it must never be reported as one (the earlier
  // catch block above is scoped to the DB write only, not this). purgePaths
  // itself only throws if cache.purge() rejects (a real, uncommon runtime
  // failure); log and proceed rather than lose the "saved" redirect over it.
  try {
    const purgeTargets = new Set(
      computePurgePaths({ postPath: `/${encodeURIComponent(saved.slug)}`, oldTags, newTags: tags }),
    );
    if (oldSlug && oldSlug !== saved.slug) purgeTargets.add(`/${encodeURIComponent(oldSlug)}`);
    await purgePaths(Array.from(purgeTargets));
  } catch (e) {
    console.error("Cache purge failed after successful save", e);
  }

  return c.redirect(`/admin/edit/${saved.id}`, 303);
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
        status: post.status,
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
  posts.forEach((p) => paths.add(`/${encodeURIComponent(p.slug)}`));
  allTags.forEach((t) => paths.add(`/tag/${encodeURIComponent(t)}`));
  await purgePaths(Array.from(paths));

  if (failures.length > 0) {
    const list = failures
      .map((f) => `<li class="py-1">${escapeHtml(f.slug)}: ${escapeHtml(f.message)}</li>`)
      .join("");
    const html = renderLayout({
      siteTitle: c.env.SITE_TITLE,
      navLinks: parseNavLinks(c.env.SITE_NAV_LINKS),
      pageTitle: "Rerender",
      description: "Rerender results.",
      canonicalUrl: `${c.env.SITE_URL}/admin`,
      bodyHtml: `<h1 class="mb-4 text-3xl font-bold tracking-tight">Rerender completed with errors</h1><p class="mb-4 text-sm text-gray-500 dark:text-gray-400">${posts.length - failures.length} of ${posts.length} posts re-rendered successfully.</p><ul class="mb-6 divide-y divide-gray-200 dark:divide-gray-800">${list}</ul><p><a class="hover:text-indigo-600 dark:hover:text-indigo-400" href="/admin">Back to admin</a></p>`,
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
  const paths = computePurgePaths({
    postPath: `/${encodeURIComponent(post.slug)}`,
    oldTags: post.tags,
    newTags: [],
  });
  await purgePaths(paths);

  return c.redirect("/admin", 303);
});

adminRoutes.post("/set-status/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const post = await getPostById(c.env.DB, id);
  if (!post) return c.notFound();

  const body = await c.req.parseBody();
  const rawStatus = String(body.status ?? "");
  const newStatus = validateStatus(rawStatus, post.status);

  await c.env.DB
    .prepare(`UPDATE posts SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(newStatus, new Date().toISOString(), id)
    .run();

  // Purge home, rss, sitemap, tag pages, AND the post's own URL.  A
  // draft ↔ non-draft transition changes 200 ↔ 404 for that URL, so the
  // stale two-state assumption (post content unchanged → skip post URL) no
  // longer holds for all three statuses.
  const paths = computePurgePaths({
    postPath: `/${encodeURIComponent(post.slug)}`,
    oldTags: post.tags,
    newTags: post.tags,
  });
  await purgePaths(paths);

  return c.redirect("/admin", 303);
});
