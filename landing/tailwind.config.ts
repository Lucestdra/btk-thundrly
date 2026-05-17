import type { Config } from "tailwindcss";

const palette = {
  alabasterGrey: "#ccdbdc",
  frostedBlue: "#9ad1d4",
  frostedBlue2: "#80ced7",
  cerulean: "#007ea7",
  deepSpaceBlue: "#003249",
  verdictGreen: "#6d8c4a",
  verdictYellow: "#caa028",
  verdictRed: "#b04a3a",
} as const;

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "alabaster-grey": palette.alabasterGrey,
        "frosted-blue": palette.frostedBlue,
        "frosted-blue-2": palette.frostedBlue2,
        cerulean: palette.cerulean,
        "deep-space-blue": palette.deepSpaceBlue,
        "verdict-green": palette.verdictGreen,
        "verdict-yellow": palette.verdictYellow,
        "verdict-red": palette.verdictRed,
        ink: {
          DEFAULT: palette.deepSpaceBlue,
          soft: "rgba(0, 50, 73, 0.74)",
          muted: "rgba(0, 50, 73, 0.52)",
          faint: "rgba(0, 50, 73, 0.28)",
        },
        bg: {
          primary: palette.alabasterGrey,
          secondary: palette.alabasterGrey,
          tertiary: palette.frostedBlue,
          elevated: palette.alabasterGrey,
        },
        line: {
          DEFAULT: "rgba(0, 50, 73, 0.12)",
          strong: "rgba(0, 50, 73, 0.24)",
        },
        accent: {
          DEFAULT: palette.cerulean,
          soft: palette.frostedBlue2,
          pale: palette.deepSpaceBlue,
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      letterSpacing: {
        tightest: "-0.04em",
        tighter: "-0.02em",
      },
      boxShadow: {
        soft: "0 30px 80px -40px rgba(0, 50, 73, 0.28)",
        line: "0 0 0 1px rgba(0, 50, 73, 0.08)",
      },
      animation: {
        "float-slow": "float 9s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
