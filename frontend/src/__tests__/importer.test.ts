import { describe, it, expect } from "vitest";
import { detectFileType, chooseEnginesForFiles } from "@schematic/component-format";

describe("component-format importer", () => {
  it("detects SPICE lib", () => {
    expect(detectFileType("mymodel.lib")?.engine).toBe("ngspice");
  });
  it("detects S-param", () => {
    expect(detectFileType("filter.s2p")?.engine).toBe("scikit-rf");
  });
  it("chooses engines", () => {
    const e = chooseEnginesForFiles(["a.lib", "b.svd", "c.step"]);
    expect(e).toContain("ngspice");
    expect(e).toContain("renode");
    expect(e).toContain("opencascade");
  });
  it("unknown returns null", () => {
    expect(detectFileType("readme.txt")).toBeNull();
  });
});
