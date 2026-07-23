import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getUserWorkspaces, type WorkspaceLite } from '@/lib/queries';
import { ACTIVE_WS_COOKIE } from '@/lib/constants';

export async function resolveWorkspaces(): Promise<{
  workspaces: WorkspaceLite[];
  active: WorkspaceLite | null;
}> {
  const db = await createClient();
  const workspaces = await getUserWorkspaces(db);
  const cookieStore = await cookies();
  const wsId = cookieStore.get(ACTIVE_WS_COOKIE)?.value;
  const active = workspaces.find((w) => w.id === wsId) ?? workspaces[0] ?? null;
  return { workspaces, active };
}
