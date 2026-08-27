import { BrowserRouter, Routes, Route } from "react-router-dom";
import StudioPage from "./pages/StudioPage.tsx";
import { lazy, Suspense, useEffect } from "react";
import { registerWebMCPTools } from "./webmcp/tools.ts";
import "./store/useThemeStore.ts";

const LandingPage = lazy(() => import("./pages/LandingPage.tsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.tsx"));
const PartsPage = lazy(() => import("./pages/PartsPage.tsx"));

export default function App() {
  useEffect(() => {
    registerWebMCPTools();
    // theme already applied via store import; ensure dark is default if no preference
    if (!localStorage.getItem("schematic-theme")) {
      document.documentElement.classList.add("dark");
    }
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="min-h-screen bg-background" />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/parts" element={<PartsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
