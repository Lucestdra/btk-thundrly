/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "alabaster-grey": "#ccdbdc",
        "frosted-blue": "#9ad1d4",
        "frosted-blue-2": "#80ced7",
        cerulean: "#007ea7",
        "deep-space-blue": "#003249",
        "verdict-green": "#6d8c4a",
        "verdict-yellow": "#caa028",
        "verdict-red": "#b04a3a",
        bg: { primary: "#003249", secondary: "#001e2d" },
        accent: {
          DEFAULT: "#007ea7",
          soft: "#80ced7",
          pale: "#9ad1d4",
        },
      },
    },
  },
  corePlugins: { preflight: false },
  plugins: [],
};
