import path from "node:path";
import fs from "node:fs";
import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";

const componentMetadataId = "virtual:schematic-component-metadata";
const resolvedComponentMetadataId = `\0${componentMetadataId}`;

const { d1, r2 } = hostingConfig;
const SITE_CREATOR_PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

const localBindingConfig = {
  main: "vinext/server/app-router-entry",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1 ? [{ binding: d1, database_name: "site-creator-d1", database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID }] : [],
  r2_buckets: r2 ? [{ binding: r2, bucket_name: "site-creator-r2" }] : [],
};

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  // The ChatGPT Site owns the API boundary as well as the identity/session
  // issuer. Keep the default same-origin so a deployed Site never silently
  // sends workspace data to a different deployment. A remote origin is an
  // explicit local/integration-test override only.
  const apiOrigin = process.env.VITE_BACKEND_URL?.trim() || process.env.SCHEMATIC_API_ORIGIN?.trim() || "";
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    root: path.resolve(__dirname),
    publicDir: path.resolve(__dirname, "../frontend/public"),
    assetsInclude: ["**/*.wasm"],
    resolve: {
      alias: {
        "@": path.resolve(__dirname),
        "@schematic/behavior/canonicalize": path.resolve(__dirname, "../packages/behavior/src/canonicalize.ts"),
        "@schematic/behavior": path.resolve(__dirname, "../packages/behavior/src/index.ts"),
        "@schematic/hardware-graph": path.resolve(__dirname, "../packages/hardware-graph/src"),
        "@schematic/validation": path.resolve(__dirname, "../packages/validation/src"),
        "@schematic/component-format": path.resolve(__dirname, "../packages/component-format/src"),
        "@schematic/project-storage": path.resolve(__dirname, "../packages/project-storage/src"),
        "@schematic/session": path.resolve(__dirname, "../functions/_auth.ts"),
      },
    },
    define: {
      "import.meta.env.VITE_BACKEND_URL": JSON.stringify(apiOrigin.replace(/\/+$/, "")),
    },
    build: { assetsInlineLimit: 0 },
    server: { fs: { allow: [path.resolve(__dirname, ".."), path.resolve(__dirname)] } },
    plugins: [
      {
        name: "schematic-component-metadata",
        enforce: "pre",
        resolveId(source: string) {
          return source === componentMetadataId ? resolvedComponentMetadataId : null;
        },
        load(id: string) {
          if (id !== resolvedComponentMetadataId) return null;
          const metadataPath = path.resolve(__dirname, "../frontend/public/components-metadata.json");
          const metadata = fs.readFileSync(metadataPath, "utf8");
          return `export default ${metadata};`;
        },
      },
      vinext(),
      sites(),
      cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] }, config: localBindingConfig }),
    ],
  };
});
