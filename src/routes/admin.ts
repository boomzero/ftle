import { Hono } from "hono";
import { verifyAccessRequest } from "../auth/access";
import { listPosts } from "../db/posts";
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
