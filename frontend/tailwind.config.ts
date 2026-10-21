import type { Config } from "tailwindcss";

// Pages use `teal-*`, `emerald-*` and `slate-*` utilities. Remapping those scales here
// re-themes the whole app at once: teal = brand (temple-tank teal), slate = sage-tinted neutrals.
const teal = { 50: "#eaf4f3", 100: "#d2e8e6", 200: "#a6d0cc", 300: "#72b2ac", 400: "#3e928b", 500: "#1a7770", 600: "#0f6560", 700: "#0c5450", 800: "#0b4542", 900: "#0a3936", 950: "#062321" };
const slate = { 50: "#f4f7f6", 100: "#e8eeec", 200: "#d6dfdc", 300: "#bcc9c5", 400: "#8c9c98", 500: "#637571", 600: "#4b5c59", 700: "#364543", 800: "#24312f", 900: "#152120", 950: "#0b1514" };

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        teal, emerald: teal, slate,
        ink: "#10282b", chalk: "#f3f5f2", cobalt: teal[600],
        marigold: "#f29f05", amberline: "#f29f05", roseline: "#d6456a", mintline: "#3e9b4f",
      },
      fontFamily: {
        sans: ["Figtree", "system-ui", "Segoe UI", "sans-serif"],
        display: ["'Bricolage Grotesque'", "Figtree", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
