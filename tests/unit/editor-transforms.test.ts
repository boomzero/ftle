import { describe, it, expect } from "vitest";
import { wrapSelection, makeLink, indentLines, dedentLines, insertAtCursor, makeUploadPlaceholder } from "../../public/admin-editor.mjs";

describe("wrapSelection", () => {
  it("wraps the selected text in the marker and keeps the inner text selected", () => {
    expect(
      wrapSelection({ text: "say word now", selectionStart: 4, selectionEnd: 8 }, "**"),
    ).toEqual({ text: "say **word** now", selectionStart: 6, selectionEnd: 10 });
  });

  it("supports an explicit closing marker different from the opening one", () => {
    expect(
      wrapSelection({ text: "x", selectionStart: 0, selectionEnd: 1 }, "<sub>", "</sub>"),
    ).toEqual({ text: "<sub>x</sub>", selectionStart: 5, selectionEnd: 6 });
  });

  it("inserts an empty marker pair at a collapsed cursor and puts the cursor between them", () => {
    expect(wrapSelection({ text: "ab", selectionStart: 1, selectionEnd: 1 }, "*")).toEqual({
      text: "a**b",
      selectionStart: 2,
      selectionEnd: 2,
    });
  });
});

describe("makeLink", () => {
  it("turns the selection into a link and puts the cursor inside the empty parens", () => {
    expect(makeLink({ text: "see docs", selectionStart: 4, selectionEnd: 8 })).toEqual({
      text: "see [docs]()",
      selectionStart: 11,
      selectionEnd: 11,
    });
  });

  it("inserts an empty link at a collapsed cursor with the cursor inside the brackets", () => {
    expect(makeLink({ text: "see ", selectionStart: 4, selectionEnd: 4 })).toEqual({
      text: "see []()",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });
});

describe("indentLines", () => {
  it("inserts two spaces at a collapsed cursor", () => {
    expect(indentLines({ text: "ab", selectionStart: 1, selectionEnd: 1 })).toEqual({
      text: "a  b",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it("replaces a single-line selection with two spaces", () => {
    expect(indentLines({ text: "hello", selectionStart: 1, selectionEnd: 3 })).toEqual({
      text: "h  lo",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it("indents every line touched by a multi-line selection", () => {
    // "one\ntwo\nthree", selecting from inside line 1 to inside line 3
    expect(indentLines({ text: "one\ntwo\nthree", selectionStart: 1, selectionEnd: 9 })).toEqual({
      text: "  one\n  two\n  three",
      selectionStart: 3,
      selectionEnd: 15,
    });
  });

  it("does not indent the line after a selection ending exactly on a newline", () => {
    expect(indentLines({ text: "a\nb", selectionStart: 0, selectionEnd: 2 })).toEqual({
      text: "  a\nb",
      selectionStart: 2,
      selectionEnd: 4,
    });
  });
});

describe("dedentLines", () => {
  it("removes two leading spaces from the current line at a collapsed cursor", () => {
    expect(dedentLines({ text: "  foo", selectionStart: 4, selectionEnd: 4 })).toEqual({
      text: "foo",
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  it("dedents even when the cursor sits before the leading spaces", () => {
    expect(dedentLines({ text: "  foo", selectionStart: 0, selectionEnd: 0 })).toEqual({
      text: "foo",
      selectionStart: 0,
      selectionEnd: 0,
    });
  });

  it("removes a single leading space when there are fewer than two", () => {
    expect(dedentLines({ text: " a", selectionStart: 2, selectionEnd: 2 })).toEqual({
      text: "a",
      selectionStart: 1,
      selectionEnd: 1,
    });
  });

  it("dedents every line touched by a multi-line selection", () => {
    expect(
      dedentLines({ text: "  one\n    two", selectionStart: 0, selectionEnd: 13 }),
    ).toEqual({ text: "one\n  two", selectionStart: 0, selectionEnd: 9 });
  });

  it("is a no-op on a line with no leading spaces", () => {
    expect(dedentLines({ text: "foo", selectionStart: 1, selectionEnd: 1 })).toEqual({
      text: "foo",
      selectionStart: 1,
      selectionEnd: 1,
    });
  });
});

describe("insertAtCursor", () => {
  it("inserts text at a collapsed cursor and moves the cursor to the end of the inserted text", () => {
    expect(insertAtCursor({ text: "ab", selectionStart: 1, selectionEnd: 1 }, "XYZ")).toEqual({
      text: "aXYZb",
      selectionStart: 4,
      selectionEnd: 4,
    });
  });

  it("replaces a selection with the inserted text", () => {
    expect(
      insertAtCursor({ text: "hello world", selectionStart: 6, selectionEnd: 11 }, "there"),
    ).toEqual({ text: "hello there", selectionStart: 11, selectionEnd: 11 });
  });

  it("inserts at the start of an empty string", () => {
    expect(insertAtCursor({ text: "", selectionStart: 0, selectionEnd: 0 }, "hi")).toEqual({
      text: "hi",
      selectionStart: 2,
      selectionEnd: 2,
    });
  });
});

describe("makeUploadPlaceholder", () => {
  it("builds a placeholder markdown image embedding the given token", () => {
    expect(makeUploadPlaceholder("a1b2")).toBe("![Uploading a1b2…]()");
  });

  it("produces different placeholders for different tokens", () => {
    expect(makeUploadPlaceholder("aaa")).not.toBe(makeUploadPlaceholder("bbb"));
  });
});
