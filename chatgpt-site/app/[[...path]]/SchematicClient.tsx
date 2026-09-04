"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { ensureWebMCPRegistration } from "../../../frontend/src/webmcp/tools";

let siteWebMCPBootstrapStarted = false;

function bootstrapSiteWebMCP() {
  if (typeof document === "undefined" || siteWebMCPBootstrapStarted) return;
  siteWebMCPBootstrapStarted = true;
  void ensureWebMCPRegistration().catch((error) => {
    siteWebMCPBootstrapStarted = false;
    console.error("[WebMCP] Site-shell registration failed", error);
  });
}

// Start WebMCP from the outer ChatGPT Site client chunk, before the much
// larger SPA is lazy-loaded. Site-tool discovery can happen during hydration,
// so deferring registration until App.tsx arrives creates a race where the
// host legitimately observes zero tools.
bootstrapSiteWebMCP();

const SchematicApp = dynamic(() => import("../../../frontend/src/App"), {
  ssr: false,
  loading: () => <main>Loading Schematic…</main>,
});

export default function SchematicClient() {
  useEffect(() => {
    bootstrapSiteWebMCP();
  }, []);
  return <SchematicApp />;
}
