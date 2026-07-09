import { Hono } from "hono";
import { verifyAccessRequest } from "../auth/access";
import { listPosts, getPostById } from "../db/posts";
import { renderLayout } from "../layout";

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
