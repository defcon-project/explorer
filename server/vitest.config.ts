import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/vitest.setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 19,
        branches: 12,
        functions: 20,
        lines: 20,
      },
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/types/**/*.ts',
        'src/models/index.ts',
        'src/routes/index.ts',
        'src/routes/v1/index.ts',
        'src/services/cachePrewarm.service.ts',
      ],
    },
  },
});
