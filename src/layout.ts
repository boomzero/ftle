import { SITE_CSS } from "./generated/site-css";
import { escapeAttr, escapeHtml } from "./util/escape";

export interface LayoutOptions {
  siteTitle: string;
  pageTitle: string;
  description: string;
  canonicalUrl: string;
  bodyHtml: string;
  hasMath?: boolean;
  katexCssPath?: string;
  ogType?: "website" | "article";
  jsonLd?: string;
  noindex?: boolean;
  rssUrl?: string;
}

export function renderLayout(opts: LayoutOptions): string {
  const {
    siteTitle,
    pageTitle,
    description,
    canonicalUrl,
    bodyHtml,
    hasMath,
    katexCssPath,
    ogType = "website",
    jsonLd,
    noindex,
    rssUrl,
  } = opts;

  const title = pageTitle === siteTitle ? siteTitle : `${pageTitle} — ${siteTitle}`;
  const safeSiteTitle = escapeHtml(siteTitle);

  return `<!doctype html>
<html lang="en" class="bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeAttr(description)}">
<link rel="canonical" href="${escapeAttr(canonicalUrl)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ""}<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${escapeAttr(pageTitle)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:url" content="${escapeAttr(canonicalUrl)}">
<meta name="twitter:card" content="summary">
${rssUrl ? `<link rel="alternate" type="application/atom+xml" href="${escapeAttr(rssUrl)}">\n` : ""}${hasMath && katexCssPath ? `<link rel="stylesheet" href="${escapeAttr(katexCssPath)}">\n` : ""}${jsonLd ? `<script type="application/ld+json">${jsonLd.replace(/</g, "\\u003c")}</script>\n` : ""}<style>${SITE_CSS}</style>
</head>
<body class="mx-auto max-w-4xl px-4 py-12 font-sans leading-relaxed">
<nav class="mb-10 flex gap-4 text-sm">
<a class="font-medium hover:text-indigo-600 dark:hover:text-indigo-400" href="/">${safeSiteTitle}</a>
<a class="text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400" href="/rss.xml">RSS</a>
<a class="text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400" href="https://twig.boomzero.uk">Twig</a>
<a class="text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400" href="https://sinv.boomzero.uk">Sinv</a>
</nav>
${bodyHtml}
<footer class="mt-16 text-sm text-gray-500 dark:text-gray-400">${safeSiteTitle}</footer>
</body>
</html>`;
}
