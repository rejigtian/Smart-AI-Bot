/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Electric-cyan primary (signature color event)
        primary: {
          DEFAULT: '#06B6D4',
          deep: '#0891B2',
          soft: '#ECFEFF',
          bright: '#22D3EE', // dark-block highlight only
        },
        // Cool near-black ink scale
        ink: {
          DEFAULT: '#0F172A',
          secondary: '#334155',
          mute: '#64748B',
          faint: '#94A3B8',
        },
        // Surfaces
        canvas: {
          DEFAULT: '#FFFFFF',
          soft: '#F8FAFC',
          cool: '#F1F5F9',
        },
        hairline: {
          DEFAULT: '#E2E8F0',
          strong: '#CBD5E1',
        },
        // Dark terminal block (logs / code / commands)
        terminal: {
          DEFAULT: '#0B1120',
          line: '#1E293B',
          text: '#E2E8F0',
          mute: '#94A3B8',
        },
        // Status
        ok: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'JetBrains Mono', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      // Plain `border` defaults to the hairline color so every card is consistent.
      borderColor: {
        DEFAULT: '#E2E8F0',
      },
      boxShadow: {
        card: '0 1px 3px rgba(15,23,42,0.06)',
        pop: '0 4px 16px rgba(15,23,42,0.08)',
      },
    },
  },
  plugins: [],
}
