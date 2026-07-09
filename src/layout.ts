import { SITE_CSS } from "./css/site-css";

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

function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;");
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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${escapeAttr(description)}">
<link rel="canonical" href="${escapeAttr(canonicalUrl)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ""}<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${escapeAttr(pageTitle)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:url" content="${escapeAttr(canonicalUrl)}">
<meta name="twitter:card" content="summary">
${rssUrl ? `<link rel="alternate" type="application/atom+xml" href="${escapeAttr(rssUrl)}">\n` : ""}${hasMath && katexCssPath ? `<link rel="stylesheet" href="${escapeAttr(katexCssPath)}">\n` : ""}${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>\n` : ""}<style>${SITE_CSS}</style>
</head>
<body>
<nav><a href="/">${siteTitle}</a> <a href="/rss.xml">RSS</a></nav>
${bodyHtml}
<footer>${siteTitle}</footer>
</body>
</html>`;
}
