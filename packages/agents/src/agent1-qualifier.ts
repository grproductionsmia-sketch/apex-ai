import { z } from 'zod';
import {
  parseStructured,
  getConfig,
  getServiceClient,
  logger,
  type SupabaseClient,
} from '@apex/core';
import type { InboundMessage, Transport } from '@apex/whatsapp';

const AGENT1_PROMPT_VERSION = 'agent1-v1';
const MAX_QUESTIONS = 5;

const Agent1Schema = z.object({
  reply: z.string().describe('Mensaje breve y cálido para enviar al lead por WhatsApp'),
  classification: z
    .enum(['product_buyer', 'business_interested', 'curious', 'unknown'])
    .nullable(),
  done: z.boolean().describe('true cuando ya hay suficiente info para clasificar'),
  tags: z.array(z.string()),
  intent: z.string(),
  entities: z.record(z.string(), z.string()),
});

const SYSTEM = [
  'Eres el asistente de WhatsApp de un líder de venta directa (MLM) hispanohablante en EE.UU.',
  'Objetivo: en 3 a 5 preguntas CORTAS y conversacionales, descubrir si la persona es:',
  '  - product_buyer (quiere comprar producto),',
  '  - business_interested (le interesa el negocio/oportunidad),',
  '  - curious (solo curiosea, sin intención clara).',
  'Haz UNA sola pregunta por mensaje, tono cercano y humano, sin sonar a bot ni a interrogatorio.',
  'No hagas reclamos de ingresos ni de salud. No inventes precios; si preguntan, ofrece continuar la conversación.',
  'Cuando tengas señal suficiente, pon done=true y la classification. Si aún no, done=false, classification=null y tu reply es la siguiente pregunta.',
  'Devuelve todo en el formato estructurado. En "entities" incluye datos captados (nombre, producto de interés, ciudad, etc.).',
].join('\n');

export interface Agent1Result {
  skipped: boolean;
  reason?: string;
  leadId?: string;
  classification?: string | null;
  done?: boolean;
  reply?: string;
}

export async function resolveWorkspaceByPhoneNumberId(
  db: SupabaseClient,
  phoneNumberId: string,
): Promise<string | null> {
  const { data } = await db
    .from('workspace_integrations')
    .select('workspace_id')
    .eq('provider', 'whatsapp')
    .eq('meta->>phone_number_id', phoneNumberId)
    .maybeSingle();
  return (data?.workspace_id as string | undefined) ?? null;
}

/**
 * Agente 1 — process one inbound WhatsApp message: idempotent, persists the
 * conversation (Coexistence-safe history in `messages`), asks up to 5 qualifying
 * questions via Claude, classifies the lead, and replies through the transport.
 */
export async function runAgent1OnInbound(
  inbound: InboundMessage,
  transport: Transport,
  opts: { workspaceId?: string; db?: SupabaseClient } = {},
): Promise<Agent1Result> {
  const db = opts.db ?? getServiceClient();

  const workspaceId =
    opts.workspaceId ?? (await resolveWorkspaceByPhoneNumberId(db, inbound.phoneNumberId));
  if (!workspaceId) {
    logger.warn('agent1.no_workspace', { phoneNumberId: inbound.phoneNumberId });
    return { skipped: true, reason: 'no_workspace_for_phone_number_id' };
  }

  // --- idempotency: Meta redelivers webhooks; dedupe on the wa message id ---
  const { error: weErr } = await db.from('webhook_events').insert({
    provider: 'whatsapp',
    external_id: inbound.waMessageId,
    workspace_id: workspaceId,
    payload: { from: inbound.from, text: inbound.text, ts: inbound.timestamp },
  });
  if (weErr) {
    if (weErr.code === '23505') return { skipped: true, reason: 'duplicate' };
    throw new Error(`webhook_events insert failed: ${weErr.message}`);
  }

  const nowIso = new Date().toISOString();

  // --- find or create the lead (scoped to workspace) ---
  let { data: lead } = await db
    .from('leads')
    .select('id, classification')
    .eq('workspace_id', workspaceId)
    .eq('wa_id', inbound.from)
    .maybeSingle();
  if (!lead) {
    const { data: created, error } = await db
      .from('leads')
      .insert({
        workspace_id: workspaceId,
        wa_id: inbound.from,
        phone_e164: `+${inbound.from}`,
        source: 'organic',
        status: 'new',
      })
      .select('id, classification')
      .single();
    if (error || !created) throw new Error(`agent1: create lead failed: ${error?.message}`);
    lead = created;
  }

  // --- find or create the conversation ---
  let { data: convo } = await db
    .from('conversations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('lead_id', lead.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!convo) {
    const { data: created } = await db
      .from('conversations')
      .insert({
        workspace_id: workspaceId,
        lead_id: lead.id,
        channel: 'whatsapp',
        last_inbound_at: nowIso,
        within_24h_window: true,
      })
      .select('id')
      .single();
    convo = created;
  } else {
    await db
      .from('conversations')
      .update({ last_inbound_at: nowIso, within_24h_window: true })
      .eq('id', convo.id);
  }

  // --- persist inbound message ---
  await db.from('messages').insert({
    workspace_id: workspaceId,
    conversation_id: convo!.id,
    direction: 'inbound',
    actor: 'lead',
    wa_message_id: inbound.waMessageId,
    body: inbound.text,
    status: 'delivered',
  });

  // --- load history (includes the message just inserted) ---
  const { data: history } = await db
    .from('messages')
    .select('actor, direction, body')
    .eq('conversation_id', convo!.id)
    .order('created_at', { ascending: true })
    .limit(30);
  const rows = history ?? [];
  const questionsAsked = rows.filter((m) => m.direction === 'outbound' && m.actor === 'agent').length;
  const transcript = rows
    .map((m) => `${m.actor === 'lead' ? 'Lead' : 'Asistente'}: ${m.body}`)
    .join('\n');
  const forceClose = questionsAsked >= MAX_QUESTIONS;

  // --- Claude: decide reply + classification ---
  const result = await parseStructured({
    model: getConfig().ANTHROPIC_MODEL,
    system: SYSTEM,
    user:
      `Conversación hasta ahora:\n${transcript}\n\n` +
      `Preguntas ya hechas por el asistente: ${questionsAsked}.` +
      (forceClose
        ? ' Alcanzaste el máximo de preguntas: DEBES clasificar ahora (done=true) con tu mejor estimación.'
        : ''),
    schema: Agent1Schema,
    effort: 'low',
    maxTokens: 1024,
  });

  // --- send reply and persist outbound ---
  const send = await transport.sendText(inbound.from, result.reply);
  await db.from('messages').insert({
    workspace_id: workspaceId,
    conversation_id: convo!.id,
    direction: 'outbound',
    actor: 'agent',
    agent_key: 'agent1',
    wa_message_id: send.waMessageId,
    body: result.reply,
    status: 'sent',
  });

  // --- update classification / qualification ---
  const leadUpdate: Record<string, unknown> = { last_contact_at: nowIso };
  if (result.classification) {
    leadUpdate.classification = result.classification;
    leadUpdate.tags = result.tags;
  }
  if (result.done) leadUpdate.status = 'qualified';
  await db.from('leads').update(leadUpdate).eq('id', lead.id);

  if (result.done) {
    await db.from('lead_qualifications').insert({
      workspace_id: workspaceId,
      lead_id: lead.id,
      answers: { transcript },
      intent: { text: result.intent },
      entities: result.entities,
      model: getConfig().ANTHROPIC_MODEL,
      prompt_version: AGENT1_PROMPT_VERSION,
    });
  }

  await db
    .from('webhook_events')
    .update({ processed: true })
    .eq('provider', 'whatsapp')
    .eq('external_id', inbound.waMessageId);

  logger.info('agent1.processed', {
    workspaceId,
    leadId: lead.id,
    classification: result.classification,
    done: result.done,
    questionsAsked: questionsAsked + 1,
  });

  return {
    skipped: false,
    leadId: lead.id,
    classification: result.classification,
    done: result.done,
    reply: result.reply,
  };
}
