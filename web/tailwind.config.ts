import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        accent: "var(--accent)",
        "accent-deep": "var(--accent-deep)",
        wash: "var(--wash)",
        paper: "var(--paper)",
        line: "var(--line)",
        patient: "var(--patient)",
        agent: "var(--agent)",
        fail: "var(--fail)",
        pass: "var(--pass)",
        warn: "var(--warn)",
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["Source Sans 3", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        soft: "0 10px 40px rgba(20, 36, 51, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
