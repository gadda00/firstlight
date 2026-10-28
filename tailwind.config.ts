import type { Config } from "tailwindcss";

/**
 * Tailwind v4 reads most theme tokens from globals.css (@theme inline);
 * this config keeps the dark-mode class strategy and content globs.
 * Animations are provided by `tw-animate-css` (imported in globals.css).
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;
