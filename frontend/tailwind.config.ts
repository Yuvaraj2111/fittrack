import type { Config } from "tailwindcss";

// The existing pages use `teal-*` and `emerald-*` utility classes as the brand colour.
// Remapping those scales here re-themes every page at once without touching markup.
const cobalt = { 50: "#eef1fd", 100: "#dde3fb", 200: "#bcc7f6", 300: "#93a3ef", 400: "#6a7ee6", 500: "#4a61df", 600: "#2f4bd8", 700: "#2539b0", 800: "#1e2e8a", 900: "#1a296e", 950: "#111a45" };

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        teal: cobalt,
        emerald: { ...cobalt, 100: "#d9e0ea", 200: "#b8c3d3", 900: "#2a3546" },
        ink: "#18212e", chalk: "#eef1f4", cobalt: cobalt[600],
        amberline: "#f0a202", roseline: "#e0445a", mintline: "#1fa37a",
      },
      fontFamily: {
        sans: ["Barlow", "system-ui", "Segoe UI", "sans-serif"],
        display: ["'Barlow Condensed'", "Barlow", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
