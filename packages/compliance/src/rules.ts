import { z } from 'zod';

// Shape of the JSONB stored in compliance_rulesets.rules. All fields optional in
// storage; DEFAULT_RULES fills the gaps and agency->workspace inheritance merges.
export const RulesetRulesSchema = z.object({
  bannedClaims: z.array(z.string()).default([]),
  requiredDisclaimers: z.array(z.string()).default([]),
  incomeClaimsPolicy: z.string(),
  healthClaimsPolicy: z.string(),
  extraGuidance: z.string().optional(),
});
export type RulesetRules = z.infer<typeof RulesetRulesSchema>;

export const PartialRulesSchema = RulesetRulesSchema.partial();

// Safe MLM defaults (Herbalife / Farmasi style policy). Agencies/workspaces can
// extend or override these via their own ruleset rows.
export const DEFAULT_RULES: RulesetRules = {
  bannedClaims: [
    'ingresos garantizados',
    'hazte rico',
    'gana $X al mes',
    'ganancias sin esfuerzo',
    'libertad financiera garantizada',
    'cura',
    'trata enfermedades',
    'pierde X libras en Y dias',
    'reemplaza tus medicamentos',
  ],
  requiredDisclaimers: [],
  incomeClaimsPolicy:
    'Prohibido afirmar o insinuar montos de ingreso, ganancias tipicas o resultados financieros ' +
    'sin respaldo documentado oficial de la compania. Nada de "gana $X", "ingresos garantizados", ' +
    'estilos de vida de lujo atribuidos al negocio, ni promesas de libertad financiera.',
  healthClaimsPolicy:
    'Prohibido afirmar que un producto cura, previene, diagnostica o trata cualquier enfermedad o ' +
    'condicion. Prohibido prometer perdida de peso especifica o rapida. Los beneficios deben ser ' +
    'generales y consistentes con etiquetas aprobadas; nunca consejo medico.',
};

/** Merge a child ruleset's (partial) rules on top of a parent's resolved rules. */
export function mergeRules(parent: RulesetRules, child: Partial<RulesetRules>): RulesetRules {
  return {
    bannedClaims: Array.from(new Set([...parent.bannedClaims, ...(child.bannedClaims ?? [])])),
    requiredDisclaimers: Array.from(
      new Set([...parent.requiredDisclaimers, ...(child.requiredDisclaimers ?? [])]),
    ),
    incomeClaimsPolicy: child.incomeClaimsPolicy ?? parent.incomeClaimsPolicy,
    healthClaimsPolicy: child.healthClaimsPolicy ?? parent.healthClaimsPolicy,
    extraGuidance:
      [parent.extraGuidance, child.extraGuidance].filter(Boolean).join('\n') || undefined,
  };
}
