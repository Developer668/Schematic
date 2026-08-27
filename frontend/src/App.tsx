import { BrowserRouter, Routes, Route } from "react-router-dom";
import StudioPage from "./pages/StudioPage.tsx";
import SettingsPage from "./pages/SettingsPage.tsx";
import LandingPage from "./pages/LandingPage.tsx";
import { registerWebMCPTools } from "./webmcp/tools.ts";
import { useEffect } from "react";
import "./store/useThemeStore.ts";

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
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/studio" element={<StudioPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
