import { z } from 'zod';
import {
  parseStructured,
  getConfig,
  getServiceClient,
  logger,
  type SupabaseClient,
} from '@apex/core';
import {
  runComplianceCheck,
  ComplianceInfraError,
  resolveEffectiveRuleset,
} from '@apex/compliance';
import { assertFeature, type Tier, type FeatureKey } from '@apex/shared';

const GEN_PROMPT_VERSION = 'agent3-gen-v1';

const ContentTypeEnum = z.enum(['reel_script', 'tiktok_script', 'copy', 'wa_status']);

const GeneratedPieceSchema = z.object({
  topicTitle: z.string(),
  type: ContentTypeEnum,
  body: z.string(),
});
const GenerationSchema = z.object({ pieces: z.array(GeneratedPieceSchema) });

interface BrandProfile {
  story: string | null;
  tone: string | null;
  region: string | null;
  language: string;
}
interface Topic {
  id: string;
  title: string;
  category: string;
  evidence_url: string | null;
}

export interface RunAgent3Input {
  workspaceId: string;
  count?: number;
  /** content calendar day these pieces belong to (YYYY-MM-DD). Defaults to today. */
  targetDate?: string;
  /** regenerate even if pieces already exist for targetDate (default false). */
  force?: boolean;
}
export interface RunAgent3Summary {
  generated: number;
  approved: number;
  rejected: number;
  pending: number;
  /** pieces dropped because the model returned a topic outside approved_topics */
  skipped: number;
  targetDate: string;
  /** true when a run already existed for targetDate and we skipped (idempotency) */
  idempotentSkip: boolean;
}

const MAX_COUNT = 20;

function normalizeCount(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 5;
  return Math.max(1, Math.min(MAX_COUNT, Math.floor(raw)));
}

function buildGenerationPrompt(brand: BrandProfile, topics: Topic[]): string {
  const topicLines = topics
    .map((t) => `- [${t.category}] "${t.title}"${t.evidence_url ? ` (respaldo: ${t.evidence_url})` : ''}`)
    .join('\n');
  return [
    'Eres el generador de contenido de marca personal para un lider de venta directa (MLM) hispanohablante en EE.UU.',
    'Escribes en el idioma y tono de la marca. Produces guiones de Reels/TikTok, copy y textos de WhatsApp Status.',
    '',
    'PERFIL DE MARCA:',
    `- Historia: ${brand.story ?? '(no especificada)'}`,
    `- Tono: ${brand.tone ?? '(no especificado)'}`,
    `- Region: ${brand.region ?? '(no especificada)'}`,
    `- Idioma: ${brand.language}`,
    '',
    'TEMAS APROBADOS (usa SOLO estos; cada pieza cita un topicTitle exacto):',
    topicLines,
    '',
    'REGLAS DE CONTENIDO (obligatorias):',
    '- NUNCA cifras de ingreso ni promesas de ganancias sin respaldo documentado oficial.',
    '- NUNCA afirmar que un producto cura, previene o trata enfermedades, ni prometer perdida de peso especifica.',
    '- Beneficios generales y educativos; testimonios solo si son reales y no prometen resultados.',
    'Un segundo revisor de compliance validara cada pieza y puede rechazarla, asi que se conservador.',
  ].join('\n');
}

/**
 * Agente 3 end to end:
 *   pass 1 -> generate drafts from brand profile + approved topics (draft in DB)
 *   pass 2 -> mandatory compliance check per piece; approved/rejected/pending.
 * Content is inserted as 'pending_compliance' and only moves to 'approved' after
 * a passing check (also enforced by the DB trigger). Infra failure -> stays pending.
 */
export async function runAgent3(
  input: RunAgent3Input,
  db: SupabaseClient = getServiceClient(),
): Promise<RunAgent3Summary> {
  const count = normalizeCount(input.count);
  const targetDate = input.targetDate ?? new Date().toISOString().slice(0, 10);
  const empty: RunAgent3Summary = {
    generated: 0,
    approved: 0,
    rejected: 0,
    pending: 0,
    skipped: 0,
    targetDate,
    idempotentSkip: false,
  };

  // --- idempotency guard: don't regenerate a day that already has content ---
  if (!input.force) {
    const { data: existing } = await db
      .from('content_pieces')
      .select('id')
      .eq('workspace_id', input.workspaceId)
      .eq('scheduled_for', targetDate)
      .limit(1);
    if (existing && existing.length > 0) {
      logger.info('agent3.idempotent_skip', { workspaceId: input.workspaceId, targetDate });
      return { ...empty, idempotentSkip: true };
    }
  }

  // --- tier feature guard ---
  const { data: ws, error: wsErr } = await db
    .from('workspaces')
    .select('tier')
    .eq('id', input.workspaceId)
    .single();
  if (wsErr || !ws) throw new Error(`runAgent3: workspace ${input.workspaceId} not found`);

  const { data: overrideRows } = await db
    .from('workspace_feature_overrides')
    .select('feature_key, enabled')
    .eq('workspace_id', input.workspaceId);
  const overrides: Partial<Record<FeatureKey, boolean>> = {};
  for (const r of overrideRows ?? []) overrides[r.feature_key as FeatureKey] = r.enabled as boolean;
  assertFeature({ tier: ws.tier as Tier, overrides }, 'agent3_content');

  // --- brand profile (required) ---
  const { data: brand } = await db
    .from('brand_profiles')
    .select('story, tone, region, language')
    .eq('workspace_id', input.workspaceId)
    .single();
  if (!brand) {
    throw new Error('runAgent3: workspace has no brand_profile. Capture it before generating content.');
  }

  // --- approved topics (the ONLY source allowed) ---
  const { data: topics } = await db
    .from('approved_topics')
    .select('id, title, category, evidence_url')
    .eq('workspace_id', input.workspaceId)
    .eq('active', true);
  if (!topics || topics.length === 0) {
    throw new Error('runAgent3: no active approved_topics. Nothing safe to generate from.');
  }

  // resolve compliance ruleset once and reuse per piece
  const ruleset = await resolveEffectiveRuleset(db, input.workspaceId);

  // --- pass 1: generate drafts ---
  const generated = await parseStructured({
    model: getConfig().ANTHROPIC_MODEL,
    system: buildGenerationPrompt(brand as BrandProfile, topics as Topic[]),
    user: `Genera ${count} piezas variadas (reel_script, tiktok_script, copy, wa_status) usando SOLO los temas aprobados. Cada pieza debe citar un topicTitle EXACTO de la lista.`,
    schema: GenerationSchema,
    effort: 'medium',
    maxTokens: Math.min(16000, 2000 + count * 700),
  });

  const topicIdByTitle = new Map(topics.map((t) => [t.title.trim().toLowerCase(), t.id]));
  const summary: RunAgent3Summary = { ...empty };

  for (const piece of generated.pieces) {
    // Enforce "approved topics only": drop any piece whose topic is not in the
    // approved list (guards against a hallucinated topicTitle).
    const topicId = topicIdByTitle.get(piece.topicTitle.trim().toLowerCase());
    if (topicId === undefined) {
      logger.warn('agent3.unknown_topic_skipped', {
        workspaceId: input.workspaceId,
        topicTitle: piece.topicTitle,
      });
      summary.skipped++;
      continue;
    }

    const { data: inserted, error: insErr } = await db
      .from('content_pieces')
      .insert({
        workspace_id: input.workspaceId,
        topic_id: topicId,
        type: piece.type,
        body: piece.body,
        status: 'pending_compliance',
        scheduled_for: targetDate,
        generated_by: `${getConfig().ANTHROPIC_MODEL}/${GEN_PROMPT_VERSION}`,
      })
      .select('id')
      .single();
    if (insErr || !inserted) {
      logger.error('agent3.insert_failed', { error: insErr?.message });
      continue;
    }
    summary.generated++;

    // --- pass 2: mandatory compliance ---
    try {
      const result = await runComplianceCheck(db, {
        workspaceId: input.workspaceId,
        contentPieceId: inserted.id,
        ruleset,
      });

      if (result.verdict === 'approved') {
        const { error } = await db
          .from('content_pieces')
          .update({ status: 'approved' })
          .eq('id', inserted.id);
        if (error) {
          logger.error('agent3.approve_update_failed', { id: inserted.id, error: error.message });
          summary.pending++;
        } else {
          summary.approved++;
        }
      } else {
        await db.from('content_pieces').update({ status: 'rejected' }).eq('id', inserted.id);
        summary.rejected++;
      }
    } catch (err) {
      if (err instanceof ComplianceInfraError) {
        // fail closed: leave as pending_compliance, never publish unchecked content
        logger.warn('agent3.compliance_pending', { id: inserted.id, error: err.message });
        summary.pending++;
      } else {
        throw err;
      }
    }
  }

  logger.info('agent3.done', { workspaceId: input.workspaceId, ...summary });
  return summary;
}
