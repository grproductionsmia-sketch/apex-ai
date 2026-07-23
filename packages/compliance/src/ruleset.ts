import type { SupabaseClient } from '@apex/core';
import { DEFAULT_RULES, mergeRules, PartialRulesSchema, type RulesetRules } from './rules.js';

export interface EffectiveRuleset {
  rulesetId: string | null;
  rules: RulesetRules;
}

/**
 * Resolve the effective compliance ruleset for a workspace:
 *   workspace.compliance_ruleset_id ?? agency.default_compliance_ruleset_id,
 * then walk parent_ruleset_id inheritance and merge (root -> child, child wins).
 * Falls back to DEFAULT_RULES when no ruleset is configured.
 */
export async function resolveEffectiveRuleset(
  db: SupabaseClient,
  workspaceId: string,
): Promise<EffectiveRuleset> {
  const { data: ws, error: wsErr } = await db
    .from('workspaces')
    .select('id, agency_id, compliance_ruleset_id')
    .eq('id', workspaceId)
    .single();
  if (wsErr || !ws) {
    throw new Error(`resolveEffectiveRuleset: workspace ${workspaceId} not found`);
  }

  let rulesetId: string | null = ws.compliance_ruleset_id ?? null;
  if (!rulesetId) {
    const { data: agency } = await db
      .from('agencies')
      .select('default_compliance_ruleset_id')
      .eq('id', ws.agency_id)
      .single();
    rulesetId = agency?.default_compliance_ruleset_id ?? null;
  }

  if (!rulesetId) {
    return { rulesetId: null, rules: DEFAULT_RULES };
  }

  // Collect the chain child-first, guarding against cycles.
  const chain: { rules: unknown }[] = [];
  const seen = new Set<string>();
  let current: string | null = rulesetId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const { data: rs }: { data: { rules: unknown; parent_ruleset_id: string | null } | null } =
      await db
        .from('compliance_rulesets')
        .select('id, rules, parent_ruleset_id')
        .eq('id', current)
        .single();
    if (!rs) break;
    chain.push({ rules: rs.rules });
    current = rs.parent_ruleset_id ?? null;
  }

  // Merge from root (defaults) down to the resolved ruleset.
  let merged: RulesetRules = DEFAULT_RULES;
  for (const link of chain.reverse()) {
    const partial = PartialRulesSchema.safeParse(link.rules);
    merged = mergeRules(merged, partial.success ? partial.data : {});
  }

  return { rulesetId, rules: merged };
}
