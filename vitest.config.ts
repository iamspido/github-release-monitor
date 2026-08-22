import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['vitest.setup.ts'],
    maxWorkers: '50%',
    testTimeout: 10_000,
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
    sequence: {
      // Global teardown waits for tracked background work before individual
      // test files restore process-wide mocks such as global.fetch.
      hooks: 'list',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname ?? '.', 'src'),
    },
  },
});
