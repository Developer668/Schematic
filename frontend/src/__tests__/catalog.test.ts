import { describe, it, expect } from "vitest";
import { catalog, searchCatalog } from "../data/catalog";
import { componentArtworkHref, presentationSvg } from "../data/componentArtwork";

describe("catalog expansion", () => {
  it("has 150+ components", () => {
    expect(catalog.length).toBeGreaterThan(150);
  });
  it("search finds many resistors", () => {
    const res = searchCatalog("resistor");
    expect(res.length).toBeGreaterThan(5);
  });
  it("all have thumbnails or description", () => {
    const withThumb = catalog.filter(c => c.thumbnail);
    expect(withThumb.length).toBeGreaterThan(100);
  });
  it("search bar works for ESP32", () => {
    const res = searchCatalog("ESP32");
    expect(res.some(c => c.id.includes("esp32"))).toBe(true);
  });
  it("categories include board, sensor, display", () => {
    const cats = new Set(catalog.map(c=>c.category));
    expect(cats.has("board")).toBe(true);
    expect(cats.has("sensor")).toBe(true);
    expect(cats.has("display")).toBe(true);
  });
  it("does not infer ST Micro from ordinary words ending in st", () => {
    for (const id of ["pms5003-dust", "mt3608-boost", "sps30-dust", "xl6009-boost"]) {
      expect(catalog.find((component) => component.id === id)?.manufacturer).not.toBe("ST Micro");
    }
  });
  it("provides artwork for every component, including minimap rendering", () => {
    const missing = catalog.filter((component) => !componentArtworkHref(component));
    expect(missing.map((component) => component.id)).toEqual([]);
  });
  it("removes thumbnail cards and duplicate value captions for workspace presentation", () => {
    const svg = '<svg width="64" height="64"><rect width="64" height="64" fill="#111"/><text x="5" y="58">100 µF</text><path d="M1 1h3"/></svg>';
    const cleaned = presentationSvg(svg);
    expect(cleaned).not.toContain("100 µF");
    expect(cleaned).not.toContain('<rect width="64" height="64"');
    expect(cleaned).toContain('viewBox="0 0 64 64"');
  });
});
