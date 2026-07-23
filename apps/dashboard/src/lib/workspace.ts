import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getUserWorkspaces, type WorkspaceLite } from '@/lib/queries';
import { ACTIVE_WS_COOKIE } from '@/lib/constants';

// cache() dedupes this within a single request (layout + page both call it).
export const resolveWorkspaces = cache(async function resolveWorkspaces(): Promise<{
  workspaces: WorkspaceLite[];
  active: WorkspaceLite | null;
}> {
  const db = await createClient();
  const workspaces = await getUserWorkspaces(db);
  const cookieStore = await cookies();
  const wsId = cookieStore.get(ACTIVE_WS_COOKIE)?.value;
  // The cookie only *selects* among workspaces the user already sees (RLS-scoped);
  // an unknown/foreign id falls back to the user's first workspace — never authorizes.
  const active = workspaces.find((w) => w.id === wsId) ?? workspaces[0] ?? null;
  return { workspaces, active };
});
