import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Cada archivo arranca su propio Postgres (PGlite) con migraciones y semilla
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
