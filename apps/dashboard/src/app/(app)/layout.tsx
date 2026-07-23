import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveWorkspaces } from '@/lib/workspace';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { SignOutButton } from '@/components/sign-out-button';

export const dynamic = 'force-dynamic';

const NAV = [
  { label: 'Command Center', icon: '◈', active: true },
  { label: 'Leads', icon: '◉', active: false },
  { label: 'Contenido', icon: '✦', active: false },
  { label: 'Campañas', icon: '❐', active: false },
  { label: 'Onboarding', icon: '⚑', active: false },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');

  const { workspaces, active } = await resolveWorkspaces();

  if (!active) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          <h1 className="font-display text-lg font-semibold">Sin workspace asignado</h1>
          <p className="mt-2 text-sm text-muted">
            Tu cuenta no pertenece a ningún workspace todavía. Contacta al administrador de tu
            agencia.
          </p>
          <div className="mt-6">
            <SignOutButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card md:flex md:flex-col">
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card-2">
            <span className="font-display text-sm font-bold text-accent">A</span>
          </div>
          <span className="font-display text-base font-bold">Apex AI</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV.map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                item.active
                  ? 'bg-card-2 font-medium text-foreground'
                  : 'text-muted/70'
              }`}
            >
              <span className="w-4 text-center">{item.icon}</span>
              <span>{item.label}</span>
              {!item.active && (
                <span className="ml-auto rounded bg-card-2 px-1.5 py-0.5 text-[10px] text-muted">
                  pronto
                </span>
              )}
            </div>
          ))}
        </nav>
        <div className="border-t border-border p-3 text-[11px] text-muted">
          {user.email}
        </div>
      </aside>

      {/* main column */}
      <div className="cc-grid flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-border px-5">
          <WorkspaceSwitcher
            workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, tier: w.tier }))}
            activeId={active.id}
          />
          <span className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-accent-2">
            {active.tier}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-5 lg:p-7">{children}</main>
      </div>
    </div>
  );
}
