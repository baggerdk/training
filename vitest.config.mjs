import { defineConfig } from 'vitest/config';

// Frontend unit tests. The backend has its own tests in server/api.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
  },
});
