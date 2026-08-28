"use client";

import dynamic from "next/dynamic";

const SchematicApp = dynamic(() => import("../../../frontend/src/App"), {
  ssr: false,
  loading: () => <main>Loading Schematic…</main>,
});

export default function SchematicClient() {
  return <SchematicApp />;
}
