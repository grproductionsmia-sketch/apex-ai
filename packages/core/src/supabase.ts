import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './env.js';

let client: SupabaseClient | null = null;

/**
 * Server-side Supabase client using the SECRET key (service_role).
 *
 * WARNING: this client BYPASSES Row Level Security. Every query MUST filter by
 * workspace_id explicitly — RLS is the second wall, not the first, on this path.
 * Never expose this client or the secret key to the browser.
 */
export function getServiceClient(): SupabaseClient {
  if (!client) {
    const cfg = getConfig();
    client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

export type { SupabaseClient };
