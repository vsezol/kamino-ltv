import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0b0f19",
        foreground: "#e2e8f0",
        muted: "#111827",
        accent: "#7c3aed"
      },
      boxShadow: {
        glow: "0 0 40px rgba(124, 58, 237, 0.35)"
      }
    }
  },
  plugins: []
} satisfies Config;
