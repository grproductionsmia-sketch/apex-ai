import { Card, SectionTitle, EmptyState } from '@/components/ui';

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective: string | null;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'paused') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-warning">
        <span className="h-1.5 w-1.5 animate-pulse-ring rounded-full bg-warning" />
        Pausada — requiere tu aprobación
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-success">
        Activa
      </span>
    );
  }
  return (
    <span className="rounded-md border border-border bg-card-2 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted">
      {status}
    </span>
  );
}

export function CampaignsPanel({ campaigns }: { campaigns: Campaign[] }) {
  const pausedCount = campaigns.filter((c) => c.status === 'paused').length;
  return (
    <Card>
      <SectionTitle
        title="Campañas (Agente 0)"
        hint={pausedCount > 0 ? `${pausedCount} esperan aprobación` : undefined}
      />
      {campaigns.length === 0 ? (
        <EmptyState>Sin campañas todavía.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => (
            <li
              key={c.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                c.status === 'paused' ? 'border-warning/30 bg-warning/5' : 'border-border'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{c.name}</div>
                {c.objective && (
                  <div className="truncate text-[11px] text-muted">{c.objective}</div>
                )}
              </div>
              <StatusBadge status={c.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
