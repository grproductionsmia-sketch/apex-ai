import { Card, SectionTitle, EmptyState } from '@/components/ui';
import { ContentStatusPill } from '@/components/status-pill';

interface Piece {
  id: string;
  type: string;
  status: string;
  scheduled_for: string | null;
  body: string;
}

const TYPE_LABEL: Record<string, string> = {
  reel_script: 'Reel',
  tiktok_script: 'TikTok',
  copy: 'Copy',
  wa_status: 'WA Status',
};

export function ContentCalendar({ content }: { content: Piece[] }) {
  const pending = content.filter((c) => c.status === 'pending_compliance').length;
  return (
    <Card>
      <SectionTitle
        title="Calendario de contenido (Agente 3)"
        hint={pending > 0 ? `${pending} en compliance` : undefined}
      />
      {content.length === 0 ? (
        <EmptyState>Aún no hay contenido generado.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {content.map((c) => (
            <li key={c.id} className="rounded-lg border border-border p-3">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="rounded bg-card-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                  {TYPE_LABEL[c.type] ?? c.type}
                </span>
                {c.scheduled_for && (
                  <span className="text-[11px] text-muted">{c.scheduled_for}</span>
                )}
                <span className="ml-auto">
                  <ContentStatusPill status={c.status} />
                </span>
              </div>
              <p className="line-clamp-2 text-xs text-muted">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
