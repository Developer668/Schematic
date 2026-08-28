import path from "node:path";
import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";

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
  // The ChatGPT Site owns the identity/session issuer. Its same code-base
  // frontend sends authenticated API calls to the canonical Pages Functions
  // deployment, whose shared signing secret verifies the token. Override this
  // for local end-to-end checks with VITE_BACKEND_URL=http://127.0.0.1:8788.
  const apiOrigin = process.env.VITE_BACKEND_URL?.trim() || process.env.SCHEMATIC_API_ORIGIN?.trim() || "https://schematic-webmcp-studio.pages.dev";
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    root: path.resolve(__dirname),
    publicDir: path.resolve(__dirname, "../frontend/public"),
    resolve: {
      alias: {
        "@": path.resolve(__dirname),
        "@schematic/hardware-graph": path.resolve(__dirname, "../packages/hardware-graph/src"),
        "@schematic/validation": path.resolve(__dirname, "../packages/validation/src"),
        "@schematic/component-format": path.resolve(__dirname, "../packages/component-format/src"),
        "@schematic/session": path.resolve(__dirname, "../functions/_auth.ts"),
      },
    },
    define: {
      "import.meta.env.VITE_BACKEND_URL": JSON.stringify(apiOrigin.replace(/\/+$/, "")),
    },
    server: { fs: { allow: [path.resolve(__dirname, ".."), path.resolve(__dirname)] } },
    plugins: [
      vinext(),
      sites(),
      cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] }, config: localBindingConfig }),
    ],
  };
});
