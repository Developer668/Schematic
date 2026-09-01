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
  it("matches multi-term and punctuation-separated part queries", () => {
    const res = searchCatalog("esp 32 devkit");
    expect(res.some((component) => component.id === "esp32-devkit-v1")).toBe(true);
    expect(res[0]?.id).toBe("esp32-devkit-v1");
  });
  it("maps common visible-output parts to exact typed outcome profiles", () => {
    const byId = new Map(catalog.map((component) => [component.id, component]));
    expect(byId.get("ssd1306-i2c-4pin")?.behavior?.profileId).toBe("text-display");
    expect(byId.get("servo-9g-sg90")?.behavior?.profileId).toBe("rotary-actuator");
    expect(byId.get("relay-1ch")?.behavior?.profileId).toBe("relay");
    expect(byId.get("fan-5v-30mm")?.behavior).toEqual({ profileId: "motor", profileVersion: 1, variant: "fan" });
    expect(byId.get("vibration-motor-1027")?.behavior).toEqual({ profileId: "motor", profileVersion: 1, variant: "vibration" });
    for (const id of ["active-buzzer", "buzzer-5v-active", "buzzer-active-3v"]) {
      expect(byId.get(id)?.behavior?.profileId).toBe("buzzer");
    }
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
