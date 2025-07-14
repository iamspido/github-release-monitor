import type {Config} from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        body: ['var(--font-inter)', 'sans-serif'],
        headline: ['var(--font-inter)', 'sans-serif'],
        code: ['monospace'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      typography: ({ theme }: { theme: any }) => ({
        DEFAULT: {
          css: {
            'code:not(pre code)': {
              fontFamily: theme('fontFamily.code').join(', '),
              backgroundColor: 'hsl(var(--muted))',
              padding: '0.2em 0.4em',
              borderRadius: theme('borderRadius.sm'),
              fontWeight: '400',
            },
            'code:not(pre code)::before': {
              content: '""',
            },
            'code:not(pre code)::after': {
              content: '""',
            },
            'thead th:not(:last-child)': {
              borderRightWidth: '1px',
              borderRightColor: 'var(--tw-prose-td-borders)',
            },
            'tbody td:not(:last-child)': {
              borderRightWidth: '1px',
              borderRightColor: 'var(--tw-prose-td-borders)',
            },
          },
        },
        sm: {
           css: {
            'code:not(pre code)': {
              fontFamily: theme('fontFamily.code').join(', '),
              backgroundColor: 'hsl(var(--muted))',
              padding: '0.1em 0.3em',
              borderRadius: theme('borderRadius.sm'),
              fontWeight: '400',
            },
            'code:not(pre code)::before': {
              content: '""',
            },
            'code:not(pre code)::after': {
              content: '""',
            },
            'thead th:not(:last-child)': {
              borderRightWidth: '1px',
              borderRightColor: 'var(--tw-prose-td-borders)',
            },
            'tbody td:not(:last-child)': {
              borderRightWidth: '1px',
              borderRightColor: 'var(--tw-prose-td-borders)',
            },
          },
        }
      }),
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
} satisfies Config;
