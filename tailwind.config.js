/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    fontFamily: {
      sans: ['var(--app-font-ui)'],
      mono: ['var(--app-font-mono)'],
    },
    fontSize: {
      micro: ['var(--app-font-micro)', { lineHeight: 'var(--app-line-micro)' }],
      caption: ['var(--app-font-caption)', { lineHeight: 'var(--app-line-caption)' }],
      xs: ['var(--app-font-label)', { lineHeight: 'var(--app-line-label)' }],
      sm: ['var(--app-font-ui-size)', { lineHeight: 'var(--app-line-ui)' }],
      base: ['var(--app-font-prose)', { lineHeight: 'var(--app-line-prose)' }],
      lg: ['var(--app-font-title)', { lineHeight: 'var(--app-line-title)' }],
      xl: ['var(--app-font-display)', { lineHeight: 'var(--app-line-display)' }],
      code: ['var(--app-code-font-size)', { lineHeight: '1.55' }],
    },
    extend: {
      colors: {
        app: {
          bg: 'rgb(var(--app-bg-rgb) / <alpha-value>)',
          surface: 'rgb(var(--app-surface-rgb) / <alpha-value>)',
          'surface-2': 'rgb(var(--app-surface-2-rgb) / <alpha-value>)',
          elevated: 'rgb(var(--app-elevated-rgb) / <alpha-value>)',
          border: 'rgb(var(--app-border-rgb) / <alpha-value>)',
          'border-strong': 'rgb(var(--app-border-strong-rgb) / <alpha-value>)',
          text: 'rgb(var(--app-text-rgb) / <alpha-value>)',
          'text-muted': 'rgb(var(--app-text-muted-rgb) / <alpha-value>)',
          'text-subtle': 'rgb(var(--app-text-subtle-rgb) / <alpha-value>)',
          accent: 'rgb(var(--app-accent-rgb) / <alpha-value>)',
          'accent-contrast': 'rgb(var(--app-accent-contrast-rgb) / <alpha-value>)',
          success: 'rgb(var(--app-success-rgb) / <alpha-value>)',
          warning: 'rgb(var(--app-warning-rgb) / <alpha-value>)',
          info: 'rgb(var(--app-info-rgb) / <alpha-value>)',
          danger: 'rgb(var(--app-danger-rgb) / <alpha-value>)',
          mention: 'rgb(var(--app-mention-rgb) / <alpha-value>)',
        },
      },
      borderRadius: {
        DEFAULT: 'var(--app-radius-control)',
        md: 'var(--app-radius-control)',
        lg: 'var(--app-radius-panel)',
        xl: 'var(--app-radius-panel)',
      },
      boxShadow: {
        xl: 'var(--app-shadow-float)',
        '2xl': 'var(--app-shadow-overlay)',
      },
      transitionDuration: {
        fast: 'var(--app-transition-fast)',
        normal: 'var(--app-transition-normal)',
      },
      transitionTimingFunction: {
        standard: 'var(--app-ease-standard)',
      },
    },
  },
  plugins: [],
}
