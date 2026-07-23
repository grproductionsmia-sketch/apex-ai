import type { SupabaseClient } from '@supabase/supabase-js';

export interface WorkspaceLite {
  id: string;
  name: string;
  tier: string;
  branding: Record<string, unknown>;
}

export interface DashboardData {
  workspace: WorkspaceLite;
  metrics: {
    activeLeads: number;
    pendingFollowups: number;
    openAlerts: number;
    pendingCompliance: number;
    pausedCampaigns: number;
    onboardingActive: number;
  };
  leadsByClassification: { classification: string; count: number }[];
  campaigns: { id: string; name: string; status: string; objective: string | null }[];
  content: {
    id: string;
    type: string;
    status: string;
    scheduled_for: string | null;
    body: string;
  }[];
  alerts: { id: string; reason: string; created_at: string; leadName: string | null }[];
  onboarding: {
    id: string;
    distributor_ref: string;
    started_at: string;
    completed_at: string | null;
    progress: Record<string, unknown>;
  }[];
}

/** Workspaces the current user can access (RLS returns only theirs). */
export async function getUserWorkspaces(db: SupabaseClient): Promise<WorkspaceLite[]> {
  const { data } = await db
    .from('workspaces')
    .select('id, name, tier, branding')
    .order('created_at', { ascending: true });
  return (data ?? []) as WorkspaceLite[];
}

async function count(
  db: SupabaseClient,
  table: string,
  build: (q: any) => any,
): Promise<number> {
  const { count: c } = await build(
    db.from(table).select('*', { count: 'exact', head: true }),
  );
  return c ?? 0;
}

export async function getDashboardData(
  db: SupabaseClient,
  workspace: WorkspaceLite,
): Promise<DashboardData> {
  const ws = workspace.id;
  const nowIso = new Date().toISOString();

  const [
    activeLeads,
    pendingFollowups,
    openAlerts,
    pendingCompliance,
    pausedCampaigns,
    onboardingActive,
    leadsRes,
    campaignsRes,
    contentRes,
    alertsRes,
    onboardingRes,
  ] = await Promise.all([
    count(db, 'leads', (q) => q.eq('workspace_id', ws).neq('status', 'lost')),
    count(db, 'follow_up_tasks', (q) =>
      q.eq('workspace_id', ws).eq('status', 'pending').lte('run_at', nowIso),
    ),
    count(db, 'human_alerts', (q) => q.eq('workspace_id', ws).eq('status', 'open')),
    count(db, 'content_pieces', (q) =>
      q.eq('workspace_id', ws).eq('status', 'pending_compliance'),
    ),
    count(db, 'ad_campaigns', (q) => q.eq('workspace_id', ws).eq('status', 'paused')),
    count(db, 'distributor_onboarding', (q) =>
      q.eq('workspace_id', ws).is('completed_at', null),
    ),
    db.from('leads').select('classification').eq('workspace_id', ws).limit(1000),
    db
      .from('ad_campaigns')
      .select('id, name, status, objective')
      .eq('workspace_id', ws)
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('content_pieces')
      .select('id, type, status, scheduled_for, body')
      .eq('workspace_id', ws)
      .order('scheduled_for', { ascending: true, nullsFirst: false })
      .limit(14),
    db
      .from('human_alerts')
      .select('id, reason, created_at, lead:leads(name)')
      .eq('workspace_id', ws)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(8),
    db
      .from('distributor_onboarding')
      .select('id, distributor_ref, started_at, completed_at, progress')
      .eq('workspace_id', ws)
      .order('started_at', { ascending: false })
      .limit(6),
  ]);

  const byClass = new Map<string, number>();
  for (const row of (leadsRes.data ?? []) as { classification: string }[]) {
    byClass.set(row.classification, (byClass.get(row.classification) ?? 0) + 1);
  }

  const alerts = ((alertsRes.data ?? []) as any[]).map((a) => ({
    id: a.id as string,
    reason: a.reason as string,
    created_at: a.created_at as string,
    leadName: (Array.isArray(a.lead) ? a.lead[0]?.name : a.lead?.name) ?? null,
  }));

  return {
    workspace,
    metrics: {
      activeLeads,
      pendingFollowups,
      openAlerts,
      pendingCompliance,
      pausedCampaigns,
      onboardingActive,
    },
    leadsByClassification: [...byClass.entries()].map(([classification, c]) => ({
      classification,
      count: c,
    })),
    campaigns: (campaignsRes.data ?? []) as DashboardData['campaigns'],
    content: (contentRes.data ?? []) as DashboardData['content'],
    alerts,
    onboarding: (onboardingRes.data ?? []) as DashboardData['onboarding'],
  };
}
