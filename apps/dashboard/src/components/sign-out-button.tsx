'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.push('/login');
    router.refresh();
  }
  return (
    <button
      onClick={signOut}
      className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm text-muted transition hover:text-danger"
    >
      Salir
    </button>
  );
}
