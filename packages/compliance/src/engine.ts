import { z } from 'zod';
import { parseStructured, getConfig, logger, type SupabaseClient } from '@apex/core';
import { buildCompliancePrompt, COMPLIANCE_PROMPT_VERSION } from './prompt.js';
import { resolveEffectiveRuleset, type EffectiveRuleset } from './ruleset.js';

export const ComplianceResultSchema = z.object({
  verdict: z.enum(['approved', 'rejected']),
  reasons: z.array(z.string()),
});
export type ComplianceResult = z.infer<typeof ComplianceResultSchema>;

export interface RunComplianceInput {
  workspaceId: string;
  contentPieceId: string;
  body: string;
  type: string;
  /** optional pre-resolved ruleset (avoids re-querying per piece in a batch) */
  ruleset?: EffectiveRuleset;
}

/** Infrastructure/model failure (billing, network, refusal). NEVER means "approved". */
export class ComplianceInfraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComplianceInfraError';
  }
}

/**
 * Second-pass compliance check. Calls the strongest configured model with an
 * independent system prompt, records the verdict in compliance_checks (audit),
 * and returns it. On infra failure it throws ComplianceInfraError so the caller
 * leaves the content in pending_compliance (fail closed) — never approved.
 */
export async function runComplianceCheck(
  db: SupabaseClient,
  input: RunComplianceInput,
): Promise<ComplianceResult> {
  const ruleset = input.ruleset ?? (await resolveEffectiveRuleset(db, input.workspaceId));
  const model = getConfig().ANTHROPIC_COMPLIANCE_MODEL;

  let result: ComplianceResult;
  try {
    result = await parseStructured({
      model,
      system: buildCompliancePrompt(ruleset.rules),
      user: `Tipo de contenido: ${input.type}\n\nCONTENIDO A REVISAR:\n"""\n${input.body}\n"""`,
      schema: ComplianceResultSchema,
      effort: 'high',
      maxTokens: 2048,
    });
  } catch (err) {
    throw new ComplianceInfraError(
      `Compliance model call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { error: insErr } = await db.from('compliance_checks').insert({
    workspace_id: input.workspaceId,
    content_piece_id: input.contentPieceId,
    ruleset_id: ruleset.rulesetId,
    verdict: result.verdict,
    reasons: { items: result.reasons },
    model,
    prompt_version: COMPLIANCE_PROMPT_VERSION,
  });
  if (insErr) {
    throw new ComplianceInfraError(`Failed to record compliance_check: ${insErr.message}`);
  }

  logger.info('compliance.check', {
    workspaceId: input.workspaceId,
    contentPieceId: input.contentPieceId,
    verdict: result.verdict,
  });
  return result;
}
