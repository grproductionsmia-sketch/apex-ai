-- 0001_extensions.sql
-- Extensions and generic helpers. No table dependencies here.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "vector";     -- pgvector (Agente 3 content bank + Agente 4 RAG)

-- Generic updated_at maintainer (attached per-table in later migrations).
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
