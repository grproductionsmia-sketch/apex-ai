// REAL integration tests against the live Supabase project.
// Provisions two isolated workspaces + two users, then asserts:
//   1. No data leaks across workspaces (RLS read + write isolation).
//   2. Meta Ads campaigns cannot auto-activate (DB invariant trigger).
//   3. Agente 3 content cannot ship without a passing compliance check (DB invariant trigger).
//
// Requires the schema to be applied first (`pnpm db:apply`) and .env populated.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const pub = process.env.SUPABASE_PUBLISHABLE_KEY;
const sec = process.env.SUPABASE_SECRET_KEY;

if (!url || !pub || !sec) {
  throw new Error('Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY in .env');
}

// service-role client: bypasses RLS (but NOT triggers) — used for provisioning + invariant tests
const admin = createClient(url, sec, { auth: { autoRefreshToken: false, persistSession: false } });

const rid = Math.random().toString(36).slice(2, 8);
const emailA = `apex_test_a_${rid}@example.com`;
const emailB = `apex_test_b_${rid}@example.com`;
const password = `Test-${rid}-Pass!1`;

let agencyId: string;
let wsA: string;
let wsB: string;
let userA: string;
let userB: string;
let leadA: string;
let leadB: string;
let clientA: SupabaseClient;
let clientB: SupabaseClient;

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return data.user!.id;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(url!, pub!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

beforeAll(async () => {
  const { data: ag, error: agErr } = await admin
    .from('agencies')
    .insert({ name: `test-agency-${rid}` })
    .select('id')
    .single();
  if (agErr) throw agErr;
  agencyId = ag.id;

  const { data: ws, error: wsErr } = await admin
    .from('workspaces')
    .insert([
      { agency_id: agencyId, name: `ws-A-${rid}`, tier: 'growth' },
      { agency_id: agencyId, name: `ws-B-${rid}`, tier: 'growth' },
    ])
    .select('id, name');
  if (wsErr) throw wsErr;
  wsA = ws.find((w) => w.name === `ws-A-${rid}`)!.id;
  wsB = ws.find((w) => w.name === `ws-B-${rid}`)!.id;

  userA = await createUser(emailA);
  userB = await createUser(emailB);

  await admin.from('profiles').upsert([
    { id: userA, full_name: 'User A' },
    { id: userB, full_name: 'User B' },
  ]);

  const { error: mErr } = await admin.from('workspace_members').insert([
    { workspace_id: wsA, user_id: userA, role: 'leader' },
    { workspace_id: wsB, user_id: userB, role: 'leader' },
  ]);
  if (mErr) throw mErr;

  const { data: lA, error: lAErr } = await admin
    .from('leads')
    .insert({ workspace_id: wsA, name: 'lead-A', source: 'manual' })
    .select('id')
    .single();
  if (lAErr) throw lAErr;
  leadA = lA.id;

  const { data: lB, error: lBErr } = await admin
    .from('leads')
    .insert({ workspace_id: wsB, name: 'lead-B', source: 'manual' })
    .select('id')
    .single();
  if (lBErr) throw lBErr;
  leadB = lB.id;

  clientA = await signIn(emailA);
  clientB = await signIn(emailB);
});

afterAll(async () => {
  if (agencyId) await admin.from('agencies').delete().eq('id', agencyId);
  if (userA) await admin.auth.admin.deleteUser(userA);
  if (userB) await admin.auth.admin.deleteUser(userB);
});

describe('RLS multi-tenant isolation', () => {
  it('user A sees only workspace A leads', async () => {
    const { data, error } = await clientA.from('leads').select('id, workspace_id');
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(leadA);
    expect(ids).not.toContain(leadB);
    expect((data ?? []).every((r) => r.workspace_id === wsA)).toBe(true);
  });

  it('user B sees only workspace B leads', async () => {
    const { data } = await clientB.from('leads').select('id, workspace_id');
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(leadB);
    expect(ids).not.toContain(leadA);
  });

  it('user A cannot read workspace B lead by id (returns empty)', async () => {
    const { data } = await clientA.from('leads').select('id').eq('id', leadB);
    expect(data ?? []).toHaveLength(0);
  });

  it('user A cannot INSERT a lead into workspace B', async () => {
    const { data, error } = await clientA
      .from('leads')
      .insert({ workspace_id: wsB, name: 'evil' })
      .select('id');
    // RLS may reject with an error OR silently return no rows — either is acceptable,
    // as long as nothing persisted in workspace B.
    if (error) {
      expect(error).toBeTruthy();
    } else {
      expect(data ?? []).toHaveLength(0);
    }
    const { data: check } = await admin
      .from('leads')
      .select('id')
      .eq('workspace_id', wsB)
      .eq('name', 'evil');
    expect(check ?? []).toHaveLength(0);
  });

  it('user A cannot UPDATE workspace B lead', async () => {
    const { data } = await clientA
      .from('leads')
      .update({ name: 'hacked' })
      .eq('id', leadB)
      .select('id');
    expect(data ?? []).toHaveLength(0);
    const { data: still } = await admin.from('leads').select('name').eq('id', leadB).single();
    expect(still!.name).toBe('lead-B');
  });

  it('anonymous session sees no leads', async () => {
    const anon = createClient(url!, pub!, { auth: { persistSession: false } });
    const { data } = await anon.from('leads').select('id');
    expect(data ?? []).toHaveLength(0);
  });
});

describe('Invariant: Meta Ads campaigns cannot auto-activate', () => {
  it('inserting an already-active campaign without activated_by fails', async () => {
    const { error } = await admin
      .from('ad_campaigns')
      .insert({ workspace_id: wsA, name: 'c-active-insert', status: 'active' });
    expect(error).toBeTruthy();
  });

  it('new campaigns default to paused', async () => {
    const { data, error } = await admin
      .from('ad_campaigns')
      .insert({ workspace_id: wsA, name: 'c-default' })
      .select('status')
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe('paused');
  });

  it('cannot flip to active without an audit row, can with one', async () => {
    const { data: camp } = await admin
      .from('ad_campaigns')
      .insert({ workspace_id: wsA, name: 'c-activate' })
      .select('id')
      .single();

    const { error: noAuditErr } = await admin
      .from('ad_campaigns')
      .update({ status: 'active', activated_by: userA })
      .eq('id', camp!.id);
    expect(noAuditErr).toBeTruthy();

    await admin.from('campaign_activation_audit').insert({
      workspace_id: wsA,
      campaign_id: camp!.id,
      action: 'activated',
      actor_user_id: userA,
    });

    const { error: okErr } = await admin
      .from('ad_campaigns')
      .update({ status: 'active', activated_by: userA, activated_at: new Date().toISOString() })
      .eq('id', camp!.id);
    expect(okErr).toBeNull();
  });
});

describe('Invariant: Agente 3 content needs passing compliance', () => {
  it('content cannot be approved without a passing check, can after', async () => {
    const { data: piece } = await admin
      .from('content_pieces')
      .insert({ workspace_id: wsA, type: 'copy', body: 'hola equipo' })
      .select('id')
      .single();

    const { error: badErr } = await admin
      .from('content_pieces')
      .update({ status: 'approved' })
      .eq('id', piece!.id);
    expect(badErr).toBeTruthy();

    await admin.from('compliance_checks').insert({
      workspace_id: wsA,
      content_piece_id: piece!.id,
      verdict: 'approved',
      model: 'test',
    });

    const { error: okErr } = await admin
      .from('content_pieces')
      .update({ status: 'approved' })
      .eq('id', piece!.id);
    expect(okErr).toBeNull();
  });

  it('content with only a rejected check still cannot be approved', async () => {
    const { data: piece } = await admin
      .from('content_pieces')
      .insert({ workspace_id: wsA, type: 'copy', body: 'gana $10k al mes' })
      .select('id')
      .single();

    await admin.from('compliance_checks').insert({
      workspace_id: wsA,
      content_piece_id: piece!.id,
      verdict: 'rejected',
      model: 'test',
    });

    const { error } = await admin
      .from('content_pieces')
      .update({ status: 'approved' })
      .eq('id', piece!.id);
    expect(error).toBeTruthy();
  });
});
