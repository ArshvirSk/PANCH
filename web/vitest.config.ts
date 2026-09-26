import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'out'],
    setupFiles: ['./test/setup.ts'],
    // Library tests run in node; component tests opt into jsdom with a file comment.
    environment: 'node',
    restoreMocks: true,
  },
});
