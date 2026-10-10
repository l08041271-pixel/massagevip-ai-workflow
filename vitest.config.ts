import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/tests/**/*.test.ts'],
    setupFiles: [],
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
