// Admin editor enhancements: live server-rendered preview, keyboard
// shortcuts, Tab indentation, and a dirty guard. Loaded only on
// /admin/new and /admin/edit/:id. Reader-facing pages ship no JS.
//
// The pure text transforms below are unit-tested (tests/unit/
// editor-transforms.test.ts); the DOM wiring at the bottom only runs in a
// browser.

/** @typedef {{ text: string, selectionStart: number, selectionEnd: number }} TextState */

export function wrapSelection(state, before, after = before) {
  const { text, selectionStart: start, selectionEnd: end } = state;
  const inner = text.slice(start, end);
  return {
    text: text.slice(0, start) + before + inner + after + text.slice(end),
    selectionStart: start + before.length,
    selectionEnd: end + before.length,
  };
}

export function makeLink(state) {
  const { text, selectionStart: start, selectionEnd: end } = state;
  const inner = text.slice(start, end);
  const replaced = "[" + inner + "]()";
  // With text selected the next thing to type is the URL; with nothing
  // selected it's the link text.
  const cursor = inner.length > 0 ? start + replaced.length - 1 : start + 1;
  return {
    text: text.slice(0, start) + replaced + text.slice(end),
    selectionStart: cursor,
    selectionEnd: cursor,
  };
}

export function indentLines(state) {
  const { text, selectionStart: start, selectionEnd: end } = state;
  if (!text.slice(start, end).includes("\n")) {
    return {
      text: text.slice(0, start) + "  " + text.slice(end),
      selectionStart: start + 2,
      selectionEnd: start + 2,
    };
  }
  const blockStart = text.lastIndexOf("\n", start - 1) + 1;
  const block = text.slice(blockStart, end);
  // Prefix each line start within the block; a selection ending exactly on
  // a newline must not indent the following line.
  const indented = "  " + block.replace(/\n(?!$)/g, "\n  ");
  return {
    text: text.slice(0, blockStart) + indented + text.slice(end),
    selectionStart: start + 2,
    selectionEnd: end + (indented.length - block.length),
  };
}

export function dedentLines(state) {
  const { text, selectionStart: start, selectionEnd: end } = state;
  const blockStart = text.lastIndexOf("\n", start - 1) + 1;
  // Extend to the end of the line containing the selection end, so a
  // collapsed cursor at a line start still dedents that line.
  let blockEnd = text.indexOf("\n", end);
  if (blockEnd === -1) blockEnd = text.length;
  const block = text.slice(blockStart, blockEnd);
  let removedFirst = 0;
  let removedBeforeEnd = 0;
  const dedented = block.replace(/(^|\n)( {1,2})/g, (match, boundary, spaces, offset) => {
    if (offset === 0 && boundary === "") removedFirst = spaces.length;
    if (blockStart + offset + boundary.length < end) removedBeforeEnd += spaces.length;
    return boundary;
  });
  const newStart = Math.max(blockStart, start - removedFirst);
  return {
    text: text.slice(0, blockStart) + dedented + text.slice(blockEnd),
    selectionStart: newStart,
    selectionEnd: Math.max(newStart, end - removedBeforeEnd),
  };
}

export function insertAtCursor(state, insertText) {
  const { text, selectionStart: start, selectionEnd: end } = state;
  const cursor = start + insertText.length;
  return {
    text: text.slice(0, start) + insertText + text.slice(end),
    selectionStart: cursor,
    selectionEnd: cursor,
  };
}

export function makeUploadPlaceholder(token) {
  return `![Uploading ${token}…]()`;
}

// ---------------------------------------------------------------------------
// DOM wiring — browser only. Guarded so the module can be imported by tests
// (vitest workers pool) and node without a document.
// ---------------------------------------------------------------------------

function replaceText(el, newText) {
  // Replace only the changed slice, via execCommand where available, so the
  // browser's undo history survives programmatic edits.
  const old = el.value;
  let start = 0;
  while (start < old.length && start < newText.length && old[start] === newText[start]) start++;
  let oldEnd = old.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && old[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  if (start === oldEnd && start === newEnd) return;
  const replacement = newText.slice(start, newEnd);
  el.focus();
  el.setSelectionRange(start, oldEnd);
  let ok = false;
  try {
    ok = replacement
      ? document.execCommand("insertText", false, replacement)
      : document.execCommand("delete");
  } catch {
    ok = false;
  }
  if (!ok || el.value !== newText) el.setRangeText(replacement, start, oldEnd, "end");
}

function init() {
  const form = document.getElementById("editor-form");
  const source = document.getElementById("editor-source");
  const preview = document.getElementById("editor-preview");
  const status = document.getElementById("preview-status");
  const previewButton = document.getElementById("preview-button");
  if (!form || !source || !preview) return;

  // Live preview supersedes the no-JS fallback button.
  if (previewButton) previewButton.hidden = true;

  let timer;
  let controller = null;
  async function renderPreview() {
    if (controller) controller.abort();
    controller = new AbortController();
    try {
      const res = await fetch("/admin/preview", {
        method: "POST",
        body: new URLSearchParams({ source: source.value }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      preview.srcdoc = await res.text();
      if (status) status.hidden = true;
    } catch (e) {
      if (e && e.name === "AbortError") return;
      if (status) status.hidden = false;
    }
  }
  function schedulePreview() {
    clearTimeout(timer);
    timer = setTimeout(renderPreview, 400);
  }
  source.addEventListener("input", schedulePreview);
  renderPreview();

  let dirty = false;
  form.addEventListener("input", () => {
    dirty = true;
  });
  form.addEventListener("submit", () => {
    dirty = false;
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });

  function apply(transform) {
    const next = transform({
      text: source.value,
      selectionStart: source.selectionStart,
      selectionEnd: source.selectionEnd,
    });
    replaceText(source, next.text);
    source.setSelectionRange(next.selectionStart, next.selectionEnd);
    dirty = true;
    schedulePreview();
  }

  source.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === "b") { e.preventDefault(); apply((s) => wrapSelection(s, "**")); return; }
      if (key === "i") { e.preventDefault(); apply((s) => wrapSelection(s, "*")); return; }
      if (key === "k") { e.preventDefault(); apply(makeLink); return; }
      if (key === "s") { e.preventDefault(); form.requestSubmit(); return; }
    }
    if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      apply(e.shiftKey ? dedentLines : indentLines);
    }
  });

  // Keyboard-shortcuts help modal: ? button opens; ×, backdrop, Escape close.
  // Toggling the `hidden` attribute (display:none !important in the base
  // layer) reliably hides the flex backdrop — same trick as previewButton.
  const shortcutsButton = document.getElementById("shortcuts-button");
  const shortcutsModal = document.getElementById("shortcuts-modal");
  const shortcutsClose = document.getElementById("shortcuts-close");
  if (shortcutsButton && shortcutsModal) {
    const close = () => { shortcutsModal.hidden = true; };
    shortcutsButton.addEventListener("click", () => { shortcutsModal.hidden = false; });
    if (shortcutsClose) shortcutsClose.addEventListener("click", close);
    // Only a click on the backdrop itself (not the card bubbling up) closes.
    shortcutsModal.addEventListener("click", (e) => {
      if (e.target === shortcutsModal) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !shortcutsModal.hidden) close();
    });
  }
}

if (typeof document !== "undefined") {
  init();
}
