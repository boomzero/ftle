import type { NavLink } from "../layout";

/** Parses a "Label|URL,Label2|URL2" string (the SITE_NAV_LINKS var) into nav links. */
export function parseNavLinks(raw: string | undefined): NavLink[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => {
      const [label, url] = entry.split("|").map((s) => s.trim());
      return { label, url };
    })
    .filter((link): link is NavLink => Boolean(link.label && link.url));
}
