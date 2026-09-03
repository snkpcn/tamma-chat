import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: {
          DEFAULT: "#FAF6EE",
          50: "#FFFEFC",
          100: "#FAF6EE",
          200: "#F3ECD9",
        },
        forest: {
          DEFAULT: "#1F4D3A",
          50: "#E8F0EB",
          100: "#C9DDD0",
          400: "#2E6B4F",
          500: "#1F4D3A",
          600: "#173B2C",
          700: "#102A1F",
        },
        gold: {
          DEFAULT: "#B8974E",
          100: "#F1E6CC",
          300: "#D9BC80",
          500: "#B8974E",
          600: "#96793B",
        },
        ink: {
          DEFAULT: "#26241F",
          light: "#605C50",
        },
        line: "#E4DCC8",
      },
      fontFamily: {
        thai: ["var(--font-thai)", "Noto Sans Thai", "Sarabun", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(38, 36, 31, 0.06), 0 1px 8px rgba(38, 36, 31, 0.04)",
      },
      borderRadius: {
        card: "12px",
      },
    },
  },
  plugins: [],
};

export default config;
