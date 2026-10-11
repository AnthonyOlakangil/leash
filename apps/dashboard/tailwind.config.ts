import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#111214", surface: "#17181b", elevated: "#1c1d21", line: "rgba(255,255,255,0.06)",
        fg: "#e6e6e9", fg2: "#9b9ca3", fg3: "#6b6c73", accent: "#7c83db",
        paid: "#4fae7c", blocked: "#d9675f", warn: "#d4a24c", paused: "#6b6c73",
      },
    },
  },
  plugins: [],
} satisfies Config;
