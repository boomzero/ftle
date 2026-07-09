export const SITE_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  max-width: 42rem;
  margin: 0 auto;
  padding: 2rem 1rem;
  line-height: 1.6;
}
nav { margin-bottom: 2rem; font-size: 0.9rem; }
nav a { margin-right: 1rem; }
article { margin-bottom: 3rem; }
h1, h2, h3 { line-height: 1.25; }
pre { overflow-x: auto; padding: 1rem; background: rgba(127,127,127,0.1); border-radius: 4px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
a { color: inherit; }
footer { font-size: 0.85rem; opacity: 0.7; margin-top: 3rem; }
.post-list li { margin-bottom: 0.75rem; }
.post-date { opacity: 0.6; font-size: 0.85rem; }
`.trim();
