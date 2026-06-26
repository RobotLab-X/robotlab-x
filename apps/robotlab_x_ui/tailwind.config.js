/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Class-based dark mode: dark variants apply when an ancestor has the
  // `dark` class. Set on <html> in index.html so the whole app is dark
  // regardless of the user's OS theme.
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
}
