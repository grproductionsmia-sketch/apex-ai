'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ACTIVE_WS_COOKIE } from '@/lib/constants';

interface Props {
  workspaces: { id: string; name: string; tier: string }[];
  activeId: string;
}

export function WorkspaceSwitcher({ workspaces, activeId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setPending(true);
    // 180 days
    document.cookie = `${ACTIVE_WS_COOKIE}=${id}; path=/; max-age=${60 * 60 * 24 * 180}`;
    router.refresh();
    setTimeout(() => setPending(false), 400);
  }

  if (workspaces.length <= 1) {
    const only = workspaces[0];
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-accent" />
        <span className="text-sm font-medium">{only?.name ?? 'Workspace'}</span>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
      <span className={`h-2 w-2 rounded-full bg-accent ${pending ? 'animate-pulse-ring' : ''}`} />
      <select
        value={activeId}
        onChange={onChange}
        className="cursor-pointer appearance-none bg-transparent pr-4 text-sm font-medium outline-none"
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id} className="bg-card text-foreground">
            {w.name}
          </option>
        ))}
      </select>
    </div>
  );
}
