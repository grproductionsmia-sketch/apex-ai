// REAL integration test: Agente 1 against live Claude + Supabase, using the mock
// WhatsApp transport (no Meta dependency). Verifies lead creation, persistence,
// webhook idempotency, and classification across a short conversation.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getServiceClient } from '@apex/core';
import { MockTransport, type InboundMessage } from '@apex/whatsapp';
import { runAgent1OnInbound } from '../src/agent1-qualifier.js';

const db = getServiceClient();
const rid = Math.random().toString(36).slice(2, 8);
const FROM = '15550001111';
const PHONE_NUMBER_ID = `pn-${rid}`;
let agencyId: string;
let wsId: string;

function inbound(text: string, id: string): InboundMessage {
  return {
    waMessageId: id,
    from: FROM,
    phoneNumberId: PHONE_NUMBER_ID,
    text,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

beforeAll(async () => {
  const { data: ag, error: agErr } = await db
    .from('agencies')
    .insert({ name: `agent1-agency-${rid}` })
    .select('id')
    .single();
  if (agErr) throw agErr;
  agencyId = ag.id;
  const { data: ws, error: wsErr } = await db
    .from('workspaces')
    .insert({ agency_id: agencyId, name: `agent1-ws-${rid}`, tier: 'growth' })
    .select('id')
    .single();
  if (wsErr) throw wsErr;
  wsId = ws.id;
});

afterAll(async () => {
  if (agencyId) await db.from('agencies').delete().eq('id', agencyId);
});

describe('Agente 1 — inbound qualifier (real Claude, mock WhatsApp)', () => {
  it('first inbound creates a lead, replies, and persists the conversation', async () => {
    const t = new MockTransport();
    const r = await runAgent1OnInbound(inbound('Hola, vi tu anuncio en Instagram', `m1-${rid}`), t, {
      workspaceId: wsId,
      db,
    });
    expect(r.skipped).toBe(false);
    expect(r.leadId).toBeTruthy();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.to).toBe(FROM);
    expect(t.sent[0]!.body.length).toBeGreaterThan(0);

    const { data: lead } = await db
      .from('leads')
      .select('id, wa_id')
      .eq('workspace_id', wsId)
      .eq('wa_id', FROM)
      .single();
    expect(lead).toBeTruthy();

    const { count } = await db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', wsId);
    expect(count ?? 0).toBeGreaterThanOrEqual(2); // 1 inbound + 1 outbound
  });

  it('is idempotent when Meta redelivers the same message', async () => {
    const t = new MockTransport();
    const r = await runAgent1OnInbound(inbound('Hola, vi tu anuncio en Instagram', `m1-${rid}`), t, {
      workspaceId: wsId,
      db,
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('duplicate');
    expect(t.sent).toHaveLength(0);
  });

  it('classifies a clear business-interested lead across a short conversation', async () => {
    const t = new MockTransport();
    await runAgent1OnInbound(
      inbound('Me interesa unirme a tu equipo y generar ingresos con el negocio', `mb1-${rid}`),
      t,
      { workspaceId: wsId, db },
    );
    await runAgent1OnInbound(
      inbound('Quiero la oportunidad de negocio, tengo tiempo en las tardes y experiencia en ventas', `mb2-${rid}`),
      t,
      { workspaceId: wsId, db },
    );
    await runAgent1OnInbound(
      inbound('Sí, quiero empezar cuanto antes a construir el negocio contigo', `mb3-${rid}`),
      t,
      { workspaceId: wsId, db },
    );

    expect(t.sent).toHaveLength(3);
    const { data: lead } = await db
      .from('leads')
      .select('classification, status')
      .eq('workspace_id', wsId)
      .eq('wa_id', FROM)
      .single();
    expect(lead!.classification).toBe('business_interested');
  });
});
