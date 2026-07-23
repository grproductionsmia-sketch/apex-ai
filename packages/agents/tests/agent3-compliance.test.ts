// REAL integration tests: exercise the compliance engine and Agente 3 against
// live Claude + Supabase. Requires ANTHROPIC_API_KEY with credit balance and the
// schema applied. Provisions an isolated workspace and cleans up afterward.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getServiceClient } from '@apex/core';
import { runComplianceCheck } from '@apex/compliance';
import { runAgent3 } from '../src/agent3-content.js';

const db = getServiceClient();
const rid = Math.random().toString(36).slice(2, 8);
let agencyId: string;
let wsId: string;

beforeAll(async () => {
  const { data: ag, error: agErr } = await db
    .from('agencies')
    .insert({ name: `agent3-agency-${rid}` })
    .select('id')
    .single();
  if (agErr) throw agErr;
  agencyId = ag.id;

  const { data: ws, error: wsErr } = await db
    .from('workspaces')
    .insert({ agency_id: agencyId, name: `agent3-ws-${rid}`, tier: 'growth' })
    .select('id')
    .single();
  if (wsErr) throw wsErr;
  wsId = ws.id;

  await db.from('brand_profiles').insert({
    workspace_id: wsId,
    story: 'Mama emprendedora que mejoro su energia con habitos de nutricion',
    tone: 'cercano, motivador y honesto',
    region: 'Miami, FL',
    language: 'es',
  });
  await db.from('approved_topics').insert([
    { workspace_id: wsId, title: 'Habitos de hidratacion diaria', category: 'educational' },
    { workspace_id: wsId, title: 'Rutina de desayuno balanceado', category: 'product_benefit' },
  ]);
});

afterAll(async () => {
  if (agencyId) await db.from('agencies').delete().eq('id', agencyId);
});

describe('compliance engine (real Claude)', () => {
  it('rejects an income claim', async () => {
    const body =
      'Unete a mi equipo y gana $10,000 dolares al mes garantizado desde casa, sin esfuerzo.';
    const { data: piece } = await db
      .from('content_pieces')
      .insert({ workspace_id: wsId, type: 'copy', body })
      .select('id')
      .single();
    const res = await runComplianceCheck(db, {
      workspaceId: wsId,
      contentPieceId: piece!.id,
    });
    expect(res.verdict).toBe('rejected');
    expect(res.reasons.length).toBeGreaterThan(0);
  });

  it('rejects a health cure claim', async () => {
    const body = 'Este batido cura la diabetes y reemplaza tus medicamentos en 2 semanas.';
    const { data: piece } = await db
      .from('content_pieces')
      .insert({ workspace_id: wsId, type: 'copy', body })
      .select('id')
      .single();
    const res = await runComplianceCheck(db, {
      workspaceId: wsId,
      contentPieceId: piece!.id,
    });
    expect(res.verdict).toBe('rejected');
  });

  it('approves clean educational content', async () => {
    const body =
      'Tomar agua a lo largo del dia ayuda a sentirte con mas energia. Te comparto como armo mi rutina de hidratacion.';
    const { data: piece } = await db
      .from('content_pieces')
      .insert({ workspace_id: wsId, type: 'wa_status', body })
      .select('id')
      .single();
    const res = await runComplianceCheck(db, {
      workspaceId: wsId,
      contentPieceId: piece!.id,
    });
    expect(res.verdict).toBe('approved');
  });
});

describe('runAgent3 end to end (real Claude)', () => {
  it('generates pieces, each checked; nothing approved without a passing check', async () => {
    const summary = await runAgent3({ workspaceId: wsId, count: 3 }, db);
    expect(summary.generated).toBeGreaterThan(0);
    expect(summary.approved + summary.rejected + summary.pending).toBe(summary.generated);

    const { data: shipped } = await db
      .from('content_pieces')
      .select('id, status')
      .eq('workspace_id', wsId)
      .in('status', ['approved', 'published']);
    for (const p of shipped ?? []) {
      const { data: checks } = await db
        .from('compliance_checks')
        .select('id')
        .eq('content_piece_id', p.id)
        .eq('verdict', 'approved');
      expect((checks ?? []).length).toBeGreaterThan(0);
    }
  });
});
