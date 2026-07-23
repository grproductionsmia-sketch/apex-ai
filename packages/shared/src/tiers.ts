// Source of truth for tier -> feature mapping. Per-workspace exceptions live in
// the DB table `workspace_feature_overrides` and are merged on top of this at runtime.
//
// NON-NEGOTIABLE from the business spec: Starter does NOT include Agente 0 (paid ads).

export type Tier = 'starter' | 'growth' | 'elite';

export type FeatureKey =
  | 'agent0_ads'
  | 'agent1_qualifier'
  | 'agent2_followup'
  | 'agent3_content'
  | 'agent4_onboarding'
  | 'agent5_dashboard'
  | 'agency_view'
  | 'white_label';

export const TIER_FEATURES: Record<Tier, Record<FeatureKey, boolean>> = {
  starter: {
    agent0_ads: false, // <- Starter never gets paid-ads agent
    agent1_qualifier: true,
    agent2_followup: true,
    agent3_content: true,
    agent4_onboarding: false,
    agent5_dashboard: true,
    agency_view: false,
    white_label: false,
  },
  growth: {
    agent0_ads: true,
    agent1_qualifier: true,
    agent2_followup: true,
    agent3_content: true,
    agent4_onboarding: true,
    agent5_dashboard: true,
    agency_view: false,
    white_label: true,
  },
  elite: {
    agent0_ads: true,
    agent1_qualifier: true,
    agent2_followup: true,
    agent3_content: true,
    agent4_onboarding: true,
    agent5_dashboard: true,
    agency_view: true,
    white_label: true,
  },
};

export interface FeatureContext {
  tier: Tier;
  overrides?: Partial<Record<FeatureKey, boolean>>;
}

/** Resolve whether a feature is enabled for a workspace, applying overrides. */
export function hasFeature(ctx: FeatureContext, key: FeatureKey): boolean {
  if (ctx.overrides && key in ctx.overrides && ctx.overrides[key] !== undefined) {
    return ctx.overrides[key] as boolean;
  }
  return TIER_FEATURES[ctx.tier][key];
}

/** Throws if a feature is not enabled — use as a guard at the top of agent entrypoints. */
export function assertFeature(ctx: FeatureContext, key: FeatureKey): void {
  if (!hasFeature(ctx, key)) {
    throw new Error(`Feature "${key}" is not available on tier "${ctx.tier}"`);
  }
}
