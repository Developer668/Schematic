import { create } from "zustand";

type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

function applyTheme(t: Theme) {
  const el = document.documentElement;
  el.classList.remove("dark", "light");
  el.classList.add(t);
  // Tailwind expects .dark on html
  try { localStorage.setItem("schematic-theme", t); } catch {}
}

function initialTheme(): Theme {
  try {
    const s = localStorage.getItem("schematic-theme") as Theme | null;
    if (s === "light" || s === "dark") return s;
  } catch {}
  // Default dark black as requested
  return "dark";
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme(),
  setTheme(t) {
    applyTheme(t);
    set({ theme: t });
  },
  toggle() {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(next);
    set({ theme: next });
  },
}));

// initialize on import
if (typeof document !== "undefined") {
  applyTheme(initialTheme());
  // ensure meta theme-color
  const existing = document.querySelector('meta[name="theme-color"]');
  if (!existing) {
    const m = document.createElement("meta");
    m.name = "theme-color";
    m.content = "#0a0a0a";
    document.head.appendChild(m);
  }
}
