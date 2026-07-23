import { Card, SectionTitle, EmptyState } from '@/components/ui';

interface Onboarding {
  id: string;
  distributor_ref: string;
  started_at: string;
  completed_at: string | null;
  progress: Record<string, unknown>;
}

function pct(progress: Record<string, unknown>, completed: boolean): number {
  if (completed) return 100;
  const done = Number((progress as { done?: number }).done ?? 0);
  const total = Number((progress as { total?: number }).total ?? 30);
  if (!total) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

export function OnboardingProgress({ items }: { items: Onboarding[] }) {
  return (
    <Card>
      <SectionTitle title="Onboarding de nuevos distribuidores (Agente 4)" />
      {items.length === 0 ? (
        <EmptyState>Sin distribuidores en onboarding.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {items.map((o) => {
            const p = pct(o.progress ?? {}, !!o.completed_at);
            return (
              <li key={o.id}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">{o.distributor_ref}</span>
                  <span className={p === 100 ? 'text-success' : 'text-muted'}>
                    {p === 100 ? 'Completado' : `${p}%`}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-2">
                  <div
                    className={`h-full rounded-full ${p === 100 ? 'bg-success' : 'bg-accent-2'}`}
                    style={{ width: `${p}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
