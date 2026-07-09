import { Hono } from "hono";
import { getPostBySlug, listPosts, listPostsByTag, type PostWithTags } from "../db/posts";
import { renderLayout } from "../layout";
import { buildDescription, absoluteUrl, buildBlogPostingJsonLd } from "../seo/meta";
import { KATEX_CSS_PATH } from "../generated/katex-manifest";
import { escapeHtml } from "../util/escape";

export const publicRoutes = new Hono<{ Bindings: Env }>();

function postListItem(post: PostWithTags): string {
  const date = post.created_at.slice(0, 10);
  return `<li class="flex items-baseline justify-between gap-4 py-3"><a class="font-medium hover:text-indigo-600 dark:hover:text-indigo-400" href="/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a><span class="shrink-0 text-sm text-gray-500 dark:text-gray-400">${date}</span></li>`;
}

publicRoutes.get("/", async (c) => {
  const posts = await listPosts(c.env.DB);
  const body = `<h1 class="mb-8 text-3xl font-bold tracking-tight">${escapeHtml(c.env.SITE_TITLE)}</h1><ul class="divide-y divide-gray-200 dark:divide-gray-800">${posts.map(postListItem).join("")}</ul>`;
  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    pageTitle: c.env.SITE_TITLE,
    description: c.env.SITE_DESCRIPTION,
    canonicalUrl: absoluteUrl(c.env.SITE_URL, "/"),
    bodyHtml: body,
    rssUrl: absoluteUrl(c.env.SITE_URL, "/rss.xml"),
  });
  return c.html(html);
});

publicRoutes.get("/tag/:tag", async (c) => {
  const tag = c.req.param("tag");
  const safeTag = escapeHtml(tag);
  const posts = await listPostsByTag(c.env.DB, tag);
  const body = `<h1 class="mb-8 text-3xl font-bold tracking-tight">Tag: ${safeTag}</h1><ul class="divide-y divide-gray-200 dark:divide-gray-800">${posts.map(postListItem).join("")}</ul>`;
  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    pageTitle: `Tag: ${tag}`,
    description: `Posts tagged "${tag}" on ${c.env.SITE_TITLE}.`,
    canonicalUrl: absoluteUrl(c.env.SITE_URL, `/tag/${encodeURIComponent(tag)}`),
    bodyHtml: body,
    rssUrl: absoluteUrl(c.env.SITE_URL, "/rss.xml"),
  });
  return c.html(html);
});

publicRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const post = await getPostBySlug(c.env.DB, slug);
  if (!post) return c.notFound();

  const canonicalUrl = absoluteUrl(c.env.SITE_URL, `/${encodeURIComponent(post.slug)}`);
  const description = buildDescription(post.rendered);
  const tagLinks = post.tags
    .map(
      (t) =>
        `<a class="text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400" href="/tag/${encodeURIComponent(t)}">${escapeHtml(t)}</a>`,
    )
    .join(" ");
  const body = `<article><h1 class="mb-2 text-3xl font-bold tracking-tight">${escapeHtml(post.title)}</h1><p class="mb-8 text-sm text-gray-500 dark:text-gray-400">${post.created_at.slice(0, 10)}</p><div class="prose dark:prose-invert max-w-none">${post.rendered}</div><p class="mt-10 flex flex-wrap gap-3 text-sm">${tagLinks}</p></article>`;

  const jsonLd = buildBlogPostingJsonLd({
    url: canonicalUrl,
    title: post.title,
    description,
    datePublished: post.created_at,
    dateModified: post.updated_at,
    author: c.env.SITE_AUTHOR,
  });

  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    pageTitle: post.title,
    description,
    canonicalUrl,
    bodyHtml: body,
    hasMath: post.has_math === 1,
    katexCssPath: KATEX_CSS_PATH,
    ogType: "article",
    jsonLd,
    rssUrl: absoluteUrl(c.env.SITE_URL, "/rss.xml"),
  });
  return c.html(html);
});
