import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initSuperTokens } from "./auth/supertokens.ts";

// SuperTokens core: https://github.com/supertokens/supertokens-core
// Gives each user a room stored on their own device (localStorage keyed by userId)
// so WebMCP mutates only your room, never global state.
initSuperTokens();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
