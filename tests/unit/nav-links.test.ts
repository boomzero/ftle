import { describe, it, expect } from "vitest";
import { parseNavLinks } from "../../src/util/nav-links";

describe("parseNavLinks", () => {
  it("returns an empty array for undefined or empty input", () => {
    expect(parseNavLinks(undefined)).toEqual([]);
    expect(parseNavLinks("")).toEqual([]);
  });

  it("parses a single label|url pair", () => {
    expect(parseNavLinks("Twig|https://twig.example.com")).toEqual([
      { label: "Twig", url: "https://twig.example.com" },
    ]);
  });

  it("parses multiple comma-separated pairs and trims whitespace", () => {
    expect(parseNavLinks(" Twig | https://twig.example.com , Sinv|https://sinv.example.com ")).toEqual([
      { label: "Twig", url: "https://twig.example.com" },
      { label: "Sinv", url: "https://sinv.example.com" },
    ]);
  });

  it("skips malformed entries missing a label or url", () => {
    expect(parseNavLinks("Twig|https://twig.example.com,BadEntry,|https://missing-label.com")).toEqual([
      { label: "Twig", url: "https://twig.example.com" },
    ]);
  });
});
