import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,   // one shared test database
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
