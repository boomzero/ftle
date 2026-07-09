import { Hono } from "hono";
import { listPosts } from "../db/posts";
import { absoluteUrl } from "../seo/meta";

export const rssRoutes = new Hono<{ Bindings: Env }>();

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

rssRoutes.get("/rss.xml", async (c) => {
  const posts = await listPosts(c.env.DB);
  const siteUrl = absoluteUrl(c.env.SITE_URL, "/");
  const updated = posts[0]?.updated_at ?? new Date().toISOString();

  const entries = posts
    .map(
      (post) => `
  <entry>
    <title>${escapeXml(post.title)}</title>
    <id>${absoluteUrl(c.env.SITE_URL, `/${post.slug}`)}</id>
    <link href="${absoluteUrl(c.env.SITE_URL, `/${post.slug}`)}"/>
    <published>${post.created_at}</published>
    <updated>${post.updated_at}</updated>
    <content type="html">${escapeXml(post.rendered)}</content>
  </entry>`,
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(c.env.SITE_TITLE)}</title>
  <subtitle>${escapeXml(c.env.SITE_DESCRIPTION)}</subtitle>
  <id>${siteUrl}</id>
  <link href="${siteUrl}"/>
  <updated>${updated}</updated>${entries}
</feed>`;

  return c.body(xml, 200, { "Content-Type": "application/atom+xml; charset=utf-8" });
});
