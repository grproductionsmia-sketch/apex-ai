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

const LEAD_CLASSES = ['product_buyer', 'business_interested', 'curious', 'unknown'] as const;

/** Workspaces the current user can access (RLS returns only theirs). Throws on query error. */
export async function getUserWorkspaces(db: SupabaseClient): Promise<WorkspaceLite[]> {
  const { data, error } = await db
    .from('workspaces')
    .select('id, name, tier, branding')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getUserWorkspaces: ${error.message}`);
  return (data ?? []) as WorkspaceLite[];
}

// count() that FAILS LOUD — a command center must never render "0 alerts" because a
// query silently errored. Errors bubble to the route error boundary instead.
async function reqCount(
  db: SupabaseClient,
  table: string,
  build: (q: any) => any,
): Promise<number> {
  const { count, error } = await build(
    db.from(table).select('*', { count: 'exact', head: true }),
  );
  if (error) throw new Error(`count(${table}): ${error.message}`);
  return count ?? 0;
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
    classCounts,
    campaignsRes,
    contentRes,
    alertsRes,
    onboardingRes,
  ] = await Promise.all([
    reqCount(db, 'leads', (q) => q.eq('workspace_id', ws).neq('status', 'lost')),
    reqCount(db, 'follow_up_tasks', (q) =>
      q.eq('workspace_id', ws).eq('status', 'pending').lte('run_at', nowIso),
    ),
    reqCount(db, 'human_alerts', (q) => q.eq('workspace_id', ws).eq('status', 'open')),
    reqCount(db, 'content_pieces', (q) =>
      q.eq('workspace_id', ws).eq('status', 'pending_compliance'),
    ),
    reqCount(db, 'ad_campaigns', (q) => q.eq('workspace_id', ws).eq('status', 'paused')),
    reqCount(db, 'distributor_onboarding', (q) =>
      q.eq('workspace_id', ws).is('completed_at', null),
    ),
    // exact per-classification counts (no row-limit aggregation)
    Promise.all(
      LEAD_CLASSES.map((c) =>
        reqCount(db, 'leads', (q) => q.eq('workspace_id', ws).eq('classification', c)),
      ),
    ),
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

  for (const [name, res] of Object.entries({ campaignsRes, contentRes, alertsRes, onboardingRes })) {
    if ((res as { error: unknown }).error) {
      throw new Error(`getDashboardData ${name}: ${String((res as { error: { message?: string } }).error.message)}`);
    }
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
    leadsByClassification: LEAD_CLASSES.map((classification, i) => ({
      classification,
      count: classCounts[i]!,
    })).filter((d) => d.count > 0),
    campaigns: (campaignsRes.data ?? []) as DashboardData['campaigns'],
    content: (contentRes.data ?? []) as DashboardData['content'],
    alerts,
    onboarding: (onboardingRes.data ?? []) as DashboardData['onboarding'],
  };
}
