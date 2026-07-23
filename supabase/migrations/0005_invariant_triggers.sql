-- 0005_invariant_triggers.sql
-- The two NON-NEGOTIABLE business invariants, enforced at the DB layer so that
-- NO application code path (or manual query) can violate them.
--
-- Both functions are SECURITY DEFINER so the existence checks are authoritative
-- and not filtered by the caller's RLS.

-- ---------- INVARIANT 1: Meta Ads campaigns can never auto-activate ----------
-- A campaign may only be 'active' if (a) activated_by is a real human user and
-- (b) a matching 'activated' audit row exists for that campaign + actor.
create or replace function enforce_campaign_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' then
    if new.activated_by is null then
      raise exception 'Apex invariant: campaign % cannot be active without activated_by (explicit human action required)', new.id
        using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE' then
      -- reactivation must have a FRESH approval: an audit row newer than the
      -- campaign's last state change (prevents reusing a pre-pause audit row).
      if not exists (
        select 1 from campaign_activation_audit
        where campaign_id = new.id
          and action = 'activated'
          and actor_user_id = new.activated_by
          and created_at >= old.updated_at
      ) then
        raise exception 'Apex invariant: campaign % activation requires a fresh audit record (newer than the last state change)', new.id
          using errcode = 'check_violation';
      end if;
    else
      if not exists (
        select 1 from campaign_activation_audit
        where campaign_id = new.id
          and action = 'activated'
          and actor_user_id = new.activated_by
      ) then
        raise exception 'Apex invariant: campaign % activation requires a matching audit record (action=activated by the same actor)', new.id
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger trg_campaign_activation
  before insert or update on ad_campaigns
  for each row execute function enforce_campaign_activation();

-- ---------- INVARIANT 2: Agente 3 content cannot ship without passing compliance ----------
-- content_pieces.status can only reach approved/published if a compliance_checks
-- row with verdict='approved' exists for that piece. Users cannot write
-- compliance_checks (RLS in 0004), so approval can only come from the backend's
-- second-pass compliance engine.
create or replace function enforce_compliance_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Track the current body version. Editing the body invalidates prior approvals.
  if tg_op = 'INSERT' or new.body is distinct from old.body then
    new.body_updated_at := now();
  else
    new.body_updated_at := old.body_updated_at;
  end if;

  if new.status in ('approved','published') then
    -- The passing check must be for the CURRENT body (created at/after the last body change),
    -- so content edited after approval cannot stay approved/published on a stale check.
    if not exists (
      select 1 from compliance_checks
      where content_piece_id = new.id
        and verdict = 'approved'
        and created_at >= new.body_updated_at
    ) then
      raise exception 'Apex invariant: content % cannot be approved/published without a passing compliance check for the current body', new.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger trg_compliance_gate
  before insert or update on content_pieces
  for each row execute function enforce_compliance_gate();
