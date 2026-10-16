/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        theme: {
          bg: '#FAFAFA',
          panel: '#FFFFFF',
          text: '#0A0A0A',
          secondary: '#525252',
          muted: '#737373',
          border: '#E5E5E5',
          hover: '#F5F5F5',
          accent: '#111111',
          success: '#166534',
          warning: '#B45309',
          error: '#B91C1C',
          ring: '#A3A3A3',
        },
        neutral: {
          50: '#FAFAFA',
          100: '#F5F5F5',
          200: '#E5E5E5',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#111111',
          950: '#0A0A0A',
        },
        brand: {
          success: '#166534',
          warning: '#B45309',
          error: '#B91C1C',
          ring: '#A3A3A3',
        }
      },
      boxShadow: {
        'subtle': '0 1px 2px 0 rgba(10, 10, 10, 0.04)',
        'card': '0 1px 3px 0 rgba(10, 10, 10, 0.04), 0 1px 2px -1px rgba(10, 10, 10, 0.02)',
        'card-hover': '0 10px 25px -5px rgba(10, 10, 10, 0.06), 0 8px 10px -6px rgba(10, 10, 10, 0.03)',
        'dropdown': '0 20px 40px -15px rgba(10, 10, 10, 0.08), 0 0 0 1px #E5E5E5',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-down': 'slideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-up': 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'scale-in': 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.98)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      }
    },
  },
  plugins: [],
};
