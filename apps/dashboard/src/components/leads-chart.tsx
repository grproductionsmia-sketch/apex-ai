'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { classificationLabel } from '@/lib/format';

const COLORS: Record<string, string> = {
  product_buyer: '#3fd07f',
  business_interested: '#5b9dff',
  curious: '#f5a524',
  unknown: '#8b97a8',
};

interface Datum {
  classification: string;
  count: number;
}

export function LeadsChart({ data }: { data: Datum[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted">
        Sin leads todavía.
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: classificationLabel(d.classification),
    value: d.count,
    color: COLORS[d.classification] ?? '#8b97a8',
  }));

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={58}
              outerRadius={80}
              paddingAngle={2}
              stroke="none"
            >
              {chartData.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--foreground)',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-bold tabular-nums">{total}</span>
          <span className="text-[11px] text-muted">leads</span>
        </div>
      </div>
      <ul className="flex-1 space-y-1.5">
        {chartData.map((d) => (
          <li key={d.name} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
            <span className="flex-1 text-muted">{d.name}</span>
            <span className="font-medium tabular-nums">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
