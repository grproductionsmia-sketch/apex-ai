-- 0003_agent_tables.sql
-- Domain tables for Agentes 0-5 + cross-cutting infra.
-- Every table carries workspace_id (tenant scope) unless noted.

-- ---------- enums ----------
create type lead_source          as enum ('meta_ads', 'organic', 'referral', 'manual', 'landing');
create type lead_classification  as enum ('product_buyer', 'business_interested', 'curious', 'unknown');
create type msg_direction        as enum ('inbound', 'outbound');
create type msg_actor            as enum ('lead', 'agent', 'human');
create type msg_status           as enum ('queued', 'sent', 'delivered', 'read', 'failed');
create type task_status          as enum ('pending', 'processing', 'sent', 'cancelled', 'failed');
create type alert_reason         as enum ('objection', 'close', 'negotiation', 'other');
create type alert_status         as enum ('open', 'ack', 'resolved');
create type topic_category       as enum ('product_benefit', 'testimonial', 'educational');
create type content_type         as enum ('reel_script', 'tiktok_script', 'copy', 'wa_status');
create type content_status       as enum ('draft', 'pending_compliance', 'approved', 'rejected', 'published');
create type compliance_verdict   as enum ('approved', 'rejected');
create type ruleset_owner        as enum ('agency', 'workspace');
create type campaign_status      as enum ('paused', 'active', 'archived');
create type audience_type        as enum ('custom', 'lookalike');
create type activation_action    as enum ('activate_requested', 'activated', 'paused');
create type mlm_company          as enum ('herbalife', 'farmasi', 'other');
create type integration_provider as enum ('meta', 'whatsapp', 'gbp');

-- ---------- compliance rulesets (needed early for FKs) ----------
-- Polymorphic owner (agency|workspace); parent_ruleset_id enables inheritance.
create table compliance_rulesets (
  id                uuid primary key default gen_random_uuid(),
  owner_type        ruleset_owner not null,
  owner_id          uuid not null,             -- agency_id or workspace_id (no hard FK: polymorphic)
  name              text not null,
  rules             jsonb not null default '{}'::jsonb,
  parent_ruleset_id uuid references compliance_rulesets(id) on delete set null,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index compliance_rulesets_owner_idx on compliance_rulesets(owner_type, owner_id);

-- close the tenancy FKs now that compliance_rulesets exists
alter table agencies   add constraint agencies_default_ruleset_fk
  foreign key (default_compliance_ruleset_id) references compliance_rulesets(id) on delete set null;
alter table workspaces add constraint workspaces_ruleset_fk
  foreign key (compliance_ruleset_id)         references compliance_rulesets(id) on delete set null;

-- ========== AGENTE 1 — leads / CRM ==========
create table leads (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  source          lead_source not null default 'manual',
  phone_e164      text,
  wa_id           text,
  name            text,
  classification  lead_classification not null default 'unknown',
  status          text not null default 'new',
  tags            text[] not null default '{}',
  score           int,
  assigned_to     uuid references auth.users(id) on delete set null,
  last_contact_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index leads_workspace_idx        on leads(workspace_id);
create index leads_workspace_class_idx  on leads(workspace_id, classification);

create table conversations (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  lead_id            uuid not null references leads(id) on delete cascade,
  channel            text not null default 'whatsapp',
  wa_conversation_ref text,
  last_inbound_at    timestamptz,
  within_24h_window  boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index conversations_workspace_idx on conversations(workspace_id);
create index conversations_lead_idx      on conversations(lead_id);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction       msg_direction not null,
  actor           msg_actor not null,
  agent_key       text,                    -- which agent produced it (agent1..agent2), null if human
  wa_message_id   text,
  template_name   text,                    -- set when using a pre-approved WA template
  body            text,
  media           jsonb,
  status          msg_status not null default 'queued',
  created_at      timestamptz not null default now()
);
create index messages_workspace_idx    on messages(workspace_id);
create index messages_conversation_idx on messages(conversation_id);

create table lead_qualifications (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  lead_id        uuid not null references leads(id) on delete cascade,
  answers        jsonb not null default '{}'::jsonb,
  intent         jsonb,
  entities       jsonb,
  model          text,
  prompt_version text,
  created_at     timestamptz not null default now()
);
create index lead_qualifications_workspace_idx on lead_qualifications(workspace_id);

-- ========== AGENTE 2 — follow-up ==========
-- workspace_id null => global template usable by any workspace.
create table follow_up_sequences (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid references workspaces(id) on delete cascade,
  classification lead_classification not null,
  definition     jsonb not null,          -- ordered steps: day offsets + message/template refs
  version        int not null default 1,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index follow_up_sequences_workspace_idx on follow_up_sequences(workspace_id);

-- Durable outbox / source of truth for scheduled sends. BullMQ jobs reference these rows.
-- idempotency_key UNIQUE prevents duplicate sends across retries.
create table follow_up_tasks (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  lead_id         uuid not null references leads(id) on delete cascade,
  sequence_id     uuid references follow_up_sequences(id) on delete set null,
  step_index      int not null default 0,
  run_at          timestamptz not null,
  status          task_status not null default 'pending',
  idempotency_key text not null unique,
  attempts        int not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index follow_up_tasks_due_idx       on follow_up_tasks(status, run_at);
create index follow_up_tasks_workspace_idx on follow_up_tasks(workspace_id);

create table human_alerts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id      uuid not null references leads(id) on delete cascade,
  reason       alert_reason not null,
  context      jsonb not null default '{}'::jsonb,
  status       alert_status not null default 'open',
  ack_by       uuid references auth.users(id) on delete set null,
  ack_at       timestamptz,
  created_at   timestamptz not null default now()
);
create index human_alerts_workspace_idx on human_alerts(workspace_id, status);

-- ========== AGENTE 3 — content + compliance ==========
create table brand_profiles (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references workspaces(id) on delete cascade,
  story        text,
  tone         text,
  region       text,
  language     text not null default 'es',
  extra        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table approved_topics (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title        text not null,
  category     topic_category not null,
  evidence_url text,                       -- documented backing (no unsupported income claims)
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index approved_topics_workspace_idx on approved_topics(workspace_id);

create table content_pieces (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  topic_id      uuid references approved_topics(id) on delete set null,
  type          content_type not null,
  body          text not null,
  -- bumped whenever body changes; an approved compliance_check must be newer than this (0005 trigger)
  body_updated_at timestamptz not null default now(),
  -- status can only reach approved/published via the compliance gate (0005 trigger)
  status        content_status not null default 'draft',
  scheduled_for date,
  generated_by  text,                      -- model / prompt version of pass 1
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index content_pieces_workspace_idx on content_pieces(workspace_id, status);

-- Audit log of the mandatory 2nd pass. A row with verdict='approved' is REQUIRED
-- before content_pieces.status can become approved/published (enforced in 0005).
create table compliance_checks (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  content_piece_id uuid not null references content_pieces(id) on delete cascade,
  ruleset_id       uuid references compliance_rulesets(id) on delete set null,
  verdict          compliance_verdict not null,
  reasons          jsonb not null default '{}'::jsonb,
  model            text,
  prompt_version   text,
  created_at       timestamptz not null default now()
);
create index compliance_checks_piece_idx     on compliance_checks(content_piece_id);
create index compliance_checks_workspace_idx on compliance_checks(workspace_id);

-- pgvector store for brand-consistency retrieval.
-- NOTE: 1536 dims = default; must match the chosen embedding model.
create table content_vectors (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  content_piece_id uuid references content_pieces(id) on delete cascade,
  embedding        vector(1536),
  text             text not null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index content_vectors_workspace_idx on content_vectors(workspace_id);
create index content_vectors_embedding_idx on content_vectors using hnsw (embedding vector_cosine_ops);

-- ========== AGENTE 0 — ads / lead gen ==========
-- INVARIANT: rows are created 'paused'. Activation requires activated_by + audit (0005 trigger).
create table ad_campaigns (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  meta_campaign_id text,
  name            text not null,
  objective       text,
  status          campaign_status not null default 'paused',
  activated_at    timestamptz,
  activated_by    uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index ad_campaigns_workspace_idx on ad_campaigns(workspace_id);

create table ad_audiences (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  meta_audience_id text,
  type            audience_type not null,
  seed_source     text,                    -- real customers seed (not "opportunity" curious)
  created_at      timestamptz not null default now()
);
create index ad_audiences_workspace_idx on ad_audiences(workspace_id);

-- Immutable audit trail of activation actions (append-only via app).
create table campaign_activation_audit (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  campaign_id   uuid not null references ad_campaigns(id) on delete cascade,
  action        activation_action not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  ip            text,
  user_agent    text,
  note          text,
  created_at    timestamptz not null default now()
);
create index campaign_activation_audit_campaign_idx on campaign_activation_audit(campaign_id);

create table landing_pages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  slug         text not null,
  config       jsonb not null default '{}'::jsonb,
  published    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table landing_submissions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  landing_page_id uuid not null references landing_pages(id) on delete cascade,
  data            jsonb not null,          -- validated by our own form (no 3rd-party for sensitive data)
  lead_id         uuid references leads(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index landing_submissions_workspace_idx on landing_submissions(workspace_id);

create table referrals (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  referrer_lead_id   uuid references leads(id) on delete set null,
  referred_phone     text,
  status             text not null default 'pending',
  wa_template_sent_at timestamptz,
  created_at         timestamptz not null default now()
);
create index referrals_workspace_idx on referrals(workspace_id);

-- ========== AGENTE 4 — onboarding / RAG ==========
create table onboarding_checklists (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,  -- null => global template
  company      mlm_company not null default 'other',
  version      int not null default 1,
  steps        jsonb not null,             -- structured 30-day checklist
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index onboarding_checklists_workspace_idx on onboarding_checklists(workspace_id);

create table distributor_onboarding (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  distributor_ref text not null,           -- lead id / user id / phone of the new distributor
  checklist_id    uuid references onboarding_checklists(id) on delete set null,
  progress        jsonb not null default '{}'::jsonb,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index distributor_onboarding_workspace_idx on distributor_onboarding(workspace_id);

create table knowledge_documents (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,  -- null => agency/global manual
  title        text not null,
  source       text,
  created_at   timestamptz not null default now()
);

create table knowledge_chunks (
  id          uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  embedding   vector(1536),
  text        text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index knowledge_chunks_workspace_idx on knowledge_chunks(workspace_id);
create index knowledge_chunks_embedding_idx on knowledge_chunks using hnsw (embedding vector_cosine_ops);

-- ========== AGENTE 5 + cross-cutting ==========
create table insights_reports (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  period            text not null,
  metrics           jsonb not null default '{}'::jsonb,
  summary_text      text,
  delivered_channels text[] not null default '{}',
  created_at        timestamptz not null default now()
);
create index insights_reports_workspace_idx on insights_reports(workspace_id);

-- Per-tenant integration credentials. The actual secret lives in Supabase Vault;
-- we only store the vault reference here, never plaintext tokens.
create table workspace_integrations (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  provider       integration_provider not null,
  vault_secret_id uuid,                    -- reference into Supabase Vault
  meta           jsonb not null default '{}'::jsonb,
  status         text not null default 'disconnected',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, provider)
);

-- Idempotent webhook intake (Meta/WhatsApp redeliver). Provider-level, service-role only.
create table webhook_events (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null,
  external_id text not null unique,
  workspace_id uuid references workspaces(id) on delete set null,
  payload     jsonb not null,
  processed   boolean not null default false,
  received_at timestamptz not null default now()
);

create table usage_counters (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  metric       text not null,
  period       text not null,             -- e.g. '2026-07'
  count        bigint not null default 0,
  primary key (workspace_id, metric, period)
);

create table audit_log (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action        text not null,
  entity_type   text,
  entity_id     uuid,
  metadata      jsonb not null default '{}'::jsonb,
  ip            text,
  created_at    timestamptz not null default now()
);
create index audit_log_workspace_idx on audit_log(workspace_id);

-- updated_at triggers
create trigger trg_compliance_rulesets_updated before update on compliance_rulesets for each row execute function set_updated_at();
create trigger trg_leads_updated               before update on leads               for each row execute function set_updated_at();
create trigger trg_conversations_updated       before update on conversations       for each row execute function set_updated_at();
create trigger trg_follow_up_sequences_updated before update on follow_up_sequences for each row execute function set_updated_at();
create trigger trg_follow_up_tasks_updated     before update on follow_up_tasks     for each row execute function set_updated_at();
create trigger trg_brand_profiles_updated      before update on brand_profiles      for each row execute function set_updated_at();
create trigger trg_approved_topics_updated     before update on approved_topics     for each row execute function set_updated_at();
create trigger trg_content_pieces_updated      before update on content_pieces      for each row execute function set_updated_at();
create trigger trg_ad_campaigns_updated        before update on ad_campaigns        for each row execute function set_updated_at();
create trigger trg_landing_pages_updated       before update on landing_pages       for each row execute function set_updated_at();
create trigger trg_onboarding_checklists_updated before update on onboarding_checklists for each row execute function set_updated_at();
create trigger trg_workspace_integrations_updated before update on workspace_integrations for each row execute function set_updated_at();
