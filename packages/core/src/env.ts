import { z } from 'zod';

// Validated runtime config. Entrypoints (scripts/tests/servers) must load the
// .env file (via dotenv) BEFORE calling getConfig().
const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  ANTHROPIC_COMPLIANCE_MODEL: z.string().default('claude-opus-4-6'),
});

export type ApexConfig = z.infer<typeof EnvSchema>;

let cached: ApexConfig | null = null;

export function getConfig(): ApexConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: reset the memoized config (e.g. after mutating process.env). */
export function resetConfigCache(): void {
  cached = null;
}
