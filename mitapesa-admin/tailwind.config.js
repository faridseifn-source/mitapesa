/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1A1D1C",
        inkSoft: "#4A4F4D",
        inkFaint: "#8A8F8C",
        accent: "#1F6F5C",
        accentSoft: "#E4F1EC",
        gold: "#B8912F",
        goldSoft: "#F5EDD9",
        danger: "#B4453C",
        dangerSoft: "#FBE9E7",
        border: "#E6E4DD",
        bgSoft: "#F6F5F1",
      },
    },
  },
  plugins: [],
};
