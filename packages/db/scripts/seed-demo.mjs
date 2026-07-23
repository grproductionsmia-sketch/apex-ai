// Seeds a demo agency/workspace/user with realistic data so the dashboard renders
// live. Idempotent: wipes the previous demo agency + user and recreates.
//   Login:  demo@apexai.test  /  apexdemo1234
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env') });

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}

const db = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

const DEMO_EMAIL = 'demo@apexai.test';
const DEMO_PASSWORD = 'apexdemo1234';
const AGENCY_NAME = 'Demo Agency (apexai)';

async function wipe() {
  await db.from('agencies').delete().eq('name', AGENCY_NAME);
  // remove prior demo user
  let page = 1;
  for (;;) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    const found = users.find((u) => u.email === DEMO_EMAIL);
    if (found) {
      await db.auth.admin.deleteUser(found.id);
      break;
    }
    if (users.length < 200) break;
    page++;
  }
}

async function main() {
  await wipe();

  const { data: user, error: uErr } = await db.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (uErr) throw uErr;
  const userId = user.user.id;

  const { data: agency } = await db
    .from('agencies')
    .insert({ name: AGENCY_NAME })
    .select('id')
    .single();

  const { data: ws } = await db
    .from('workspaces')
    .insert({
      agency_id: agency.id,
      name: 'María González — Nutrición',
      tier: 'elite',
      branding: { display_name: 'María González', colors: { accent: '#4de3c1' } },
    })
    .select('id')
    .single();
  const wsId = ws.id;

  await db.from('profiles').upsert({ id: userId, full_name: 'María González' });
  await db.from('workspace_members').insert({ workspace_id: wsId, user_id: userId, role: 'leader' });
  await db.from('brand_profiles').insert({
    workspace_id: wsId,
    story: 'Mamá emprendedora que transformó su energía con nutrición',
    tone: 'cercano y motivador',
    region: 'Miami, FL',
    language: 'es',
  });

  // leads across classifications
  const leads = [
    { name: 'Laura Pérez', classification: 'product_buyer', source: 'meta_ads' },
    { name: 'Carlos Ruiz', classification: 'product_buyer', source: 'referral' },
    { name: 'Ana Torres', classification: 'business_interested', source: 'organic' },
    { name: 'José Marín', classification: 'business_interested', source: 'meta_ads' },
    { name: 'Sofía Díaz', classification: 'curious', source: 'landing' },
    { name: 'Pedro Gómez', classification: 'curious', source: 'organic' },
    { name: 'Rosa Vega', classification: 'unknown', source: 'manual' },
  ].map((l) => ({ ...l, workspace_id: wsId, status: 'new' }));
  const { data: insertedLeads } = await db.from('leads').insert(leads).select('id, name');

  // an open human alert on the first business-interested lead
  const alertLead = insertedLeads.find((l) => l.name === 'Ana Torres');
  await db.from('human_alerts').insert({
    workspace_id: wsId,
    lead_id: alertLead.id,
    reason: 'negotiation',
    context: { note: 'Pide precios de kit inicial' },
    status: 'open',
  });

  // a pending follow-up task (due)
  await db.from('follow_up_tasks').insert({
    workspace_id: wsId,
    lead_id: insertedLeads[0].id,
    step_index: 1,
    run_at: new Date(Date.now() - 3600_000).toISOString(),
    status: 'pending',
    idempotency_key: `demo-${wsId}-followup-1`,
  });

  // campaigns: one PAUSED (needs approval) + one active (with audit)
  const { data: paused } = await db
    .from('ad_campaigns')
    .insert({ workspace_id: wsId, name: 'Lookalike compradores — Miami', objective: 'leads', status: 'paused' })
    .select('id')
    .single();
  const { data: activeCamp } = await db
    .from('ad_campaigns')
    .insert({ workspace_id: wsId, name: 'Retargeting web', objective: 'conversions' })
    .select('id')
    .single();
  await db.from('campaign_activation_audit').insert({
    workspace_id: wsId,
    campaign_id: activeCamp.id,
    action: 'activated',
    actor_user_id: userId,
  });
  await db
    .from('ad_campaigns')
    .update({ status: 'active', activated_by: userId, activated_at: new Date().toISOString() })
    .eq('id', activeCamp.id);
  void paused;

  // content: approved + published require a passing compliance check (trigger)
  const today = new Date().toISOString().slice(0, 10);
  async function piece(type, body, status) {
    const { data: p } = await db
      .from('content_pieces')
      .insert({ workspace_id: wsId, type, body, status: 'pending_compliance', scheduled_for: today })
      .select('id')
      .single();
    if (status === 'approved' || status === 'published') {
      await db.from('compliance_checks').insert({
        workspace_id: wsId,
        content_piece_id: p.id,
        verdict: 'approved',
        model: 'seed',
      });
      await db.from('content_pieces').update({ status }).eq('id', p.id);
    } else if (status !== 'pending_compliance') {
      await db.from('content_pieces').update({ status }).eq('id', p.id);
    }
  }
  await piece('reel_script', 'Guion Reel: 3 hábitos de hidratación que cambiaron mi energía.', 'published');
  await piece('copy', 'Copy: cómo armo mi desayuno balanceado en 5 minutos.', 'approved');
  await piece('wa_status', 'WA Status: tip de agua a lo largo del día.', 'pending_compliance');
  await piece('tiktok_script', 'Guion TikTok: mi rutina de mañana.', 'pending_compliance');

  // onboarding in progress
  await db.from('distributor_onboarding').insert({
    workspace_id: wsId,
    distributor_ref: 'Nueva: Valentina R.',
    progress: { done: 12, total: 30 },
  });

  console.log('\nDemo seeded.');
  console.log(`  Login:      ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}`);
  console.log(`  Workspace:  ${wsId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
