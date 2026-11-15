import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
