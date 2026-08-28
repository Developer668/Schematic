/** @type {import('tailwindcss').Config} */
const tailwindConfig = {
  darkMode: "class",
  content: ["./app/**/*.{js,ts,jsx,tsx}", "../frontend/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        accent: "hsl(var(--accent))",
        "accent-soft": "hsl(var(--accent-soft))",
      },
    },
  },
  plugins: [],
};

export default tailwindConfig;
