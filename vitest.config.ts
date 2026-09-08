import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/test/**/*.test.ts',
      'apps/**/test/**/*.test.ts',
      // Repository-level checks: the config files nothing else validates.
      'test/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 15_000,
  },
});
