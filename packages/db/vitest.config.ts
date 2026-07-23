import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load repo-root .env so tests get Supabase credentials.
config({ path: resolve(process.cwd(), '../../.env') });

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    // integration tests hit a shared real DB; do not parallelize files
    fileParallelism: false,
  },
});
