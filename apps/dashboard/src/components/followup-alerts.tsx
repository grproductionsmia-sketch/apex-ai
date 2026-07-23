import { Card, SectionTitle, EmptyState } from '@/components/ui';
import { timeAgo, initials } from '@/lib/format';

interface Alert {
  id: string;
  reason: string;
  created_at: string;
  leadName: string | null;
}

const REASON_LABEL: Record<string, string> = {
  objection: 'Objeción',
  close: 'Cierre',
  negotiation: 'Negociación',
  other: 'Atención',
};

export function FollowupAlerts({ alerts }: { alerts: Alert[] }) {
  return (
    <Card>
      <SectionTitle
        title="Requieren tu intervención (Agente 2)"
        hint={alerts.length > 0 ? `${alerts.length} abiertas` : undefined}
      />
      {alerts.length === 0 ? (
        <EmptyState>Todo bajo control. Sin alertas abiertas.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2.5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card-2 text-[11px] font-semibold text-muted">
                {initials(a.leadName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{a.leadName ?? 'Lead'}</div>
                <div className="text-[11px] text-danger">{REASON_LABEL[a.reason] ?? a.reason}</div>
              </div>
              <span className="shrink-0 text-[11px] text-muted">{timeAgo(a.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
