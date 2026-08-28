/** @type {import('tailwindcss').Config} */
const tailwindConfig = {
  darkMode: "class",
  content: ["./app/**/*.{js,ts,jsx,tsx}", "../frontend/src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
};

export default tailwindConfig;
