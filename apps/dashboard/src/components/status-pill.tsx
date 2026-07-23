import { contentStatusLabel } from '@/lib/format';

const STYLES: Record<string, string> = {
  draft: 'border-border bg-card-2 text-muted',
  pending_compliance: 'border-warning/40 bg-warning/10 text-warning',
  approved: 'border-success/40 bg-success/10 text-success',
  rejected: 'border-danger/40 bg-danger/10 text-danger',
  published: 'border-accent/40 bg-accent/10 text-accent',
};

export function ContentStatusPill({ status }: { status: string }) {
  const cls = STYLES[status] ?? STYLES.draft;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {contentStatusLabel(status)}
    </span>
  );
}
