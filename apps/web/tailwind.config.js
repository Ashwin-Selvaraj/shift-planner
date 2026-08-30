/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Shift colours are shared by the roster grid, the legend and the
        // charts, so they are defined once here.
        s1: { DEFAULT: '#0e7490', soft: '#cffafe' },
        s2: { DEFAULT: '#b45309', soft: '#fef3c7' },
        s3: { DEFAULT: '#4c1d95', soft: '#ede9fe' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
