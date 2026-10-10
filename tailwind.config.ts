import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff', 100: '#d9e6ff', 200: '#bcd3ff', 300: '#8eb5ff',
          400: '#598cff', 500: '#3366ff', 600: '#1f47e6', 700: '#1a37b4',
          800: '#1b3190', 900: '#1b2f72',
        },
      },
    },
  },
  plugins: [],
};
export default config;
