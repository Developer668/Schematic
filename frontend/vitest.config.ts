import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // The app intentionally uses BroadcastChannel for same-room cross-tab
    // synchronization. Node's BroadcastChannel crosses Vitest worker threads,
    // so parallel files that all run as the local-development room can mutate
    // each other's project/validation stores. Run files serially while keeping
    // each store's real synchronization behavior intact.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "virtual:schematic-component-metadata": path.resolve(__dirname, "public/components-metadata.json"),
      "@schematic/hardware-graph": path.resolve(__dirname, "../packages/hardware-graph/src"),
      "@schematic/behavior/canonicalize": path.resolve(__dirname, "../packages/behavior/src/canonicalize.ts"),
      "@schematic/behavior": path.resolve(__dirname, "../packages/behavior/src/index.ts"),
      "@schematic/validation": path.resolve(__dirname, "../packages/validation/src"),
      "@schematic/component-format": path.resolve(__dirname, "../packages/component-format/src"),
      "@schematic/firmware-harness": path.resolve(__dirname, "../packages/firmware-harness/src"),
      "@schematic/project-storage": path.resolve(__dirname, "../packages/project-storage/src"),
    },
  },
});
