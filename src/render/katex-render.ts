import katex from "katex";

export class KatexRenderError extends Error {
  constructor(message: string, public readonly latex: string) {
    super(message);
    this.name = "KatexRenderError";
  }
}

export function renderMath(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: true,
      strict: "warn",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new KatexRenderError(message, latex);
  }
}
