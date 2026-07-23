-- 0002_core_tenancy.sql
-- Multi-tenant backbone: agencies -> workspaces -> members.
-- Every business table (0003) carries workspace_id and FKs into here.

create type tier             as enum ('starter', 'growth', 'elite');
create type workspace_status as enum ('trial', 'active', 'suspended');
create type workspace_role   as enum ('leader', 'team_member');

-- Root of the tenant tree. White-label defaults + default compliance ruleset
-- live here so child workspaces can inherit them.
create table agencies (
  id                            uuid primary key default gen_random_uuid(),
  name                          text not null,
  default_branding              jsonb not null default '{}'::jsonb,
  default_compliance_ruleset_id uuid,  -- FK added in 0003 (compliance_rulesets)
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

-- The unit of isolation. One row per direct-sales leader (distribuidor).
create table workspaces (
  id                     uuid primary key default gen_random_uuid(),
  agency_id              uuid not null references agencies(id) on delete cascade,
  name                   text not null,
  tier                   tier not null default 'starter',
  -- branding = { logo_url, display_name, colors:{...}, whatsapp_number }
  branding               jsonb not null default '{}'::jsonb,
  -- null => inherit agency.default_compliance_ruleset_id (resolved in app layer)
  compliance_ruleset_id  uuid,  -- FK added in 0003
  status                 workspace_status not null default 'trial',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index workspaces_agency_idx on workspaces(agency_id);

-- Mirror of auth.users for app-level profile data.
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  locale     text not null default 'es',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Agency owners (top role). Can see all child workspaces.
create table agency_members (
  agency_id  uuid not null references agencies(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'agency_owner',
  created_at timestamptz not null default now(),
  primary key (agency_id, user_id)
);

-- Workspace-level membership: leader (full) or team_member (limited).
create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         workspace_role not null default 'team_member',
  permissions  jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on workspace_members(user_id);

-- Per-workspace exceptions to the tier->feature map (source of truth in packages/shared).
create table workspace_feature_overrides (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  feature_key  text not null,
  enabled      boolean not null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, feature_key)
);

create trigger trg_agencies_updated  before update on agencies  for each row execute function set_updated_at();
create trigger trg_workspaces_updated before update on workspaces for each row execute function set_updated_at();
create trigger trg_profiles_updated   before update on profiles   for each row execute function set_updated_at();
