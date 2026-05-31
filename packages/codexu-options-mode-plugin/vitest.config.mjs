import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'codexu-options-mode-plugin',
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
  },
});
