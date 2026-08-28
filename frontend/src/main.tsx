import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initAuth } from "./auth/session.ts";

// Start the single platform-aware session lookup once. Local development is
// deliberately Docker-free; hosted deployments use Cloudflare Access or the
// ChatGPT Sites identity boundary.
initAuth();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
