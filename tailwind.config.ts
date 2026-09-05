import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        parchment: "#F5F1E8",
        panel: "#FDFBF6",
        ink: "#1A1614",
        gold: {
          DEFAULT: "#B08D3F",
          light: "#C9A961",
          pale: "rgba(176,141,63,0.14)",
        },
        line: "rgba(26,22,20,0.12)",
        rule: "rgba(176,141,63,0.45)",
        muted: "rgba(26,22,20,0.58)",
        success: "#4A7C59",
        warning: "#B07C3F",
        danger: "#9B3D2E",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: { card: "4px", chip: "999px" },
      boxShadow: {
        page: "0 1px 2px rgba(26,22,20,0.04), 0 8px 24px -12px rgba(26,22,20,0.12)",
      },
    },
  },
  plugins: [],
};
export default config;
