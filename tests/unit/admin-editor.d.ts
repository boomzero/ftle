// Type declarations for the hand-written client module public/admin-editor.mjs,
// which is plain JS (served as a static asset; no build step to emit types).
declare module "*admin-editor.mjs" {
  export interface TextState {
    text: string;
    selectionStart: number;
    selectionEnd: number;
  }
  export function wrapSelection(state: TextState, before: string, after?: string): TextState;
  export function makeLink(state: TextState): TextState;
  export function indentLines(state: TextState): TextState;
  export function dedentLines(state: TextState): TextState;
  export function insertAtCursor(state: TextState, insertText: string): TextState;
  export function makeUploadPlaceholder(token: string): string;
}
