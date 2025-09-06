import path from 'node:path';

export default {
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['vitest.setup.ts'],
    include: [
      'tests/unit/**/*.{test,spec}.{ts,tsx,js,jsx}',
    ],
    exclude: [
      'node_modules',
      'dist',
      '.next',
      '.git',
      'tests/e2e',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
};
