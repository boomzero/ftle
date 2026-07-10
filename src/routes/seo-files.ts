import { Hono } from "hono";
import { listPosts } from "../db/posts";
import { absoluteUrl } from "../seo/meta";
import { escapeXml } from "../util/escape";

export const seoFileRoutes = new Hono<{ Bindings: Env }>();

seoFileRoutes.get("/robots.txt", (c) => {
  const body = `User-agent: *
Allow: /
Disallow: /admin
Sitemap: ${absoluteUrl(c.env.SITE_URL, "/sitemap.xml")}
`;
  return c.body(body, 200, { "Content-Type": "text/plain; charset=utf-8" });
});

seoFileRoutes.get("/sitemap.xml", async (c) => {
  const posts = await listPosts(c.env.DB, true);
  const tags = Array.from(new Set(posts.flatMap((p) => p.tags)));

  const urls: { loc: string; lastmod?: string }[] = [
    { loc: absoluteUrl(c.env.SITE_URL, "/") },
    ...posts.map((p) => ({
      loc: absoluteUrl(c.env.SITE_URL, `/${encodeURIComponent(p.slug)}`),
      lastmod: p.updated_at,
    })),
    ...tags.map((t) => ({ loc: absoluteUrl(c.env.SITE_URL, `/tag/${encodeURIComponent(t)}`) })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>`;

  return c.body(xml, 200, { "Content-Type": "application/xml; charset=utf-8" });
});
