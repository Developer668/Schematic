import { describe, it, expect } from "vitest";
import { catalog, searchCatalog } from "../data/catalog";

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
});
