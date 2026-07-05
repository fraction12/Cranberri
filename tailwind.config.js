/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        app: {
          bg: 'var(--app-bg)',
          surface: 'var(--app-surface)',
          'surface-2': 'var(--app-surface-2)',
          border: 'var(--app-border)',
          text: 'var(--app-text)',
          'text-muted': 'var(--app-text-muted)',
          accent: 'var(--app-accent)',
          danger: 'var(--app-danger)',
        },
      },
    },
  },
  plugins: [],
}
