type Tone = 'neutral' | 'accent' | 'warning' | 'danger' | 'success';

const TONE: Record<Tone, { ring: string; text: string; dot: string }> = {
  neutral: { ring: 'border-border', text: 'text-foreground', dot: 'bg-muted' },
  accent: { ring: 'border-accent/40', text: 'text-accent', dot: 'bg-accent' },
  warning: { ring: 'border-warning/50', text: 'text-warning', dot: 'bg-warning' },
  danger: { ring: 'border-danger/50', text: 'text-danger', dot: 'bg-danger' },
  success: { ring: 'border-success/40', text: 'text-success', dot: 'bg-success' },
};

export function MetricCard({
  label,
  value,
  tone = 'neutral',
  hint,
  attention = false,
}: {
  label: string;
  value: number;
  tone?: Tone;
  hint?: string;
  attention?: boolean;
}) {
  const t = TONE[tone];
  return (
    <div className={`relative rounded-2xl border bg-card p-4 ${t.ring}`}>
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${t.dot} ${attention && value > 0 ? 'animate-pulse-ring' : ''}`}
        />
        <span className="text-xs font-medium text-muted">{label}</span>
      </div>
      <div className={`mt-2 font-display text-3xl font-bold tabular-nums ${value > 0 ? t.text : 'text-foreground'}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
