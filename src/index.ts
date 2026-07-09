import { Hono } from "hono";
import { rssRoutes } from "./routes/rss";
import { seoFileRoutes } from "./routes/seo-files";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";
import { renderLayout } from "./layout";
import { absoluteUrl } from "./seo/meta";

const app = new Hono<{ Bindings: Env }>();

app.route("/", rssRoutes);
app.route("/", seoFileRoutes);
app.route("/admin", adminRoutes);
app.route("/", publicRoutes);

app.notFound((c) => {
  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    pageTitle: "Page Not Found",
    description: "This page does not exist.",
    canonicalUrl: absoluteUrl(c.env.SITE_URL, c.req.path),
    bodyHtml: "<h1>404</h1><p>That page does not exist.</p>",
    noindex: true,
  });
  return c.html(html, 404);
});

export default app;
