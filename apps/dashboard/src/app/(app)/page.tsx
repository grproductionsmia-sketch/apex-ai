import { createClient } from '@/lib/supabase/server';
import { resolveWorkspaces } from '@/lib/workspace';
import { getDashboardData } from '@/lib/queries';
import { MetricCard } from '@/components/metric-card';
import { CampaignsPanel } from '@/components/campaigns-panel';
import { ContentCalendar } from '@/components/content-calendar';
import { FollowupAlerts } from '@/components/followup-alerts';
import { OnboardingProgress } from '@/components/onboarding-progress';
import { LeadsChart } from '@/components/leads-chart';
import { Card, SectionTitle } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { active } = await resolveWorkspaces();
  if (!active) return null; // layout already handles the no-workspace case

  const db = await createClient();
  const data = await getDashboardData(db, active);
  const { metrics } = data;

  const today = new Date().toLocaleDateString('es-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">{active.name}</h1>
        <p className="mt-0.5 text-sm capitalize text-muted">{today}</p>
      </div>

      {/* metrics — attention items pulse when > 0 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Leads activos" value={metrics.activeLeads} tone="accent" />
        <MetricCard
          label="Seguimiento pendiente"
          value={metrics.pendingFollowups}
          tone="warning"
          attention
        />
        <MetricCard label="Alertas abiertas" value={metrics.openAlerts} tone="danger" attention />
        <MetricCard
          label="Pendiente compliance"
          value={metrics.pendingCompliance}
          tone="warning"
        />
        <MetricCard
          label="Campañas pausadas"
          value={metrics.pausedCampaigns}
          tone="danger"
          attention
          hint="requieren tu aprobación"
        />
        <MetricCard label="Onboarding activo" value={metrics.onboardingActive} tone="accent" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <CampaignsPanel campaigns={data.campaigns} />
          <ContentCalendar content={data.content} />
        </div>
        <div className="space-y-5">
          <Card>
            <SectionTitle title="Leads por clasificación (Agente 1)" />
            <LeadsChart data={data.leadsByClassification} />
          </Card>
          <FollowupAlerts alerts={data.alerts} />
          <OnboardingProgress items={data.onboarding} />
        </div>
      </div>
    </div>
  );
}
