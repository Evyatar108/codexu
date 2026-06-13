// Root-level tests cover codexu consumer tooling. Per-workspace vitest configs
// still run via `pnpm --filter <pkg> test`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'codexu-root',
    environment: 'node',
    include: ['tools/**/*.test.ts', 'tools/**/*.test.mjs'],
    passWithNoTests: true,
  },
});
