-- 0004_rls.sql
-- Row Level Security. Isolation predicate = workspace_id must be in the set of
-- workspaces the current user may access. Agency owners see all child workspaces.
--
-- Backend services connect with the Supabase SECRET key (service_role) which
-- BYPASSES RLS by design; the rule enforced in code + QA is that every backend
-- query filters workspace_id explicitly. RLS is the second wall for any
-- authenticated (publishable-key) session.

-- SECURITY DEFINER so it reads membership tables without being re-filtered by
-- their own RLS (prevents recursion and false negatives).
create or replace function auth_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from workspace_members where user_id = auth.uid()
  union
  select w.id
  from workspaces w
  join agency_members am on am.agency_id = w.agency_id
  where am.user_id = auth.uid();
$$;

grant execute on function auth_workspace_ids() to authenticated, anon;

-- ---------- standard workspace-scoped tables: SELECT + full write, tenant-scoped ----------
do $$
declare
  t text;
  std_tables text[] := array[
    'leads','conversations','messages','lead_qualifications',
    'follow_up_sequences','follow_up_tasks','human_alerts',
    'brand_profiles','approved_topics','content_pieces','content_vectors',
    'ad_campaigns','ad_audiences','landing_pages','landing_submissions','referrals',
    'onboarding_checklists','distributor_onboarding','knowledge_documents','knowledge_chunks',
    'insights_reports','workspace_integrations'
  ];
begin
  foreach t in array std_tables loop
    execute 'alter table '||quote_ident(t)||' enable row level security';
    execute 'create policy '||quote_ident(t||'_select')||' on '||quote_ident(t)||
            ' for select using (workspace_id in (select auth_workspace_ids()))';
    execute 'create policy '||quote_ident(t||'_mod')||' on '||quote_ident(t)||
            ' for all using (workspace_id in (select auth_workspace_ids()))'||
            ' with check (workspace_id in (select auth_workspace_ids()))';
  end loop;
end $$;

-- ---------- system-written tables: SELECT scoped, NO user writes (service_role only) ----------
-- compliance_checks is deliberately here: an authenticated user must NOT be able to
-- forge a passing check to bypass the compliance gate.
do $$
declare
  t text;
  ro_tables text[] := array[
    'compliance_checks','campaign_activation_audit','audit_log','usage_counters'
  ];
begin
  foreach t in array ro_tables loop
    execute 'alter table '||quote_ident(t)||' enable row level security';
    execute 'create policy '||quote_ident(t||'_select')||' on '||quote_ident(t)||
            ' for select using (workspace_id in (select auth_workspace_ids()))';
  end loop;
end $$;

-- ---------- no-user-access table (service_role only, RLS on with no policy) ----------
alter table webhook_events enable row level security;

-- ---------- tenancy tables (explicit, non-recursive policies) ----------
alter table agencies enable row level security;
create policy agencies_select on agencies for select using (
  id in (select agency_id from agency_members where user_id = auth.uid())
  or id in (select w.agency_id from workspaces w where w.id in (select auth_workspace_ids()))
);

alter table workspaces enable row level security;
create policy workspaces_select on workspaces for select
  using (id in (select auth_workspace_ids()));
-- only agency owners manage workspaces
create policy workspaces_mod on workspaces for all
  using (agency_id in (select agency_id from agency_members where user_id = auth.uid()))
  with check (agency_id in (select agency_id from agency_members where user_id = auth.uid()));

alter table profiles enable row level security;
create policy profiles_self on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

alter table agency_members enable row level security;
create policy agency_members_select on agency_members for select
  using (user_id = auth.uid());

alter table workspace_members enable row level security;
create policy workspace_members_select on workspace_members for select
  using (user_id = auth.uid() or workspace_id in (select auth_workspace_ids()));

alter table workspace_feature_overrides enable row level security;
create policy wfo_select on workspace_feature_overrides for select
  using (workspace_id in (select auth_workspace_ids()));
