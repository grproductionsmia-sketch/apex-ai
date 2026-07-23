import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load repo-root .env so tests get Supabase + Anthropic credentials.
config({ path: resolve(process.cwd(), '../../.env') });

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // LLM calls are slow; allow generous timeouts.
    testTimeout: 180000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
});
