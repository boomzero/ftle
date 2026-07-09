export function buildDescription(renderedHtml: string, maxLen = 155): string {
  const text = renderedHtml
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s([.,;:!?)])/g, "$1")
    .trim();

  if (text.length <= maxLen) return text;

  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  const cut = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
  return `${cut}…`;
}

export function absoluteUrl(siteUrl: string, path: string): string {
  const base = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export interface JsonLdPostInput {
  url: string;
  title: string;
  description: string;
  datePublished: string;
  dateModified: string;
  author: string;
}

export function buildBlogPostingJsonLd(input: JsonLdPostInput): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "mainEntityOfPage": { "@type": "WebPage", "@id": input.url },
    headline: input.title,
    description: input.description,
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    author: { "@type": "Person", name: input.author },
  });
}
