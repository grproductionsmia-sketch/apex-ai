// Applies SQL migrations in supabase/migrations in order, tracked in schema_migrations.
// Safe to re-run: already-applied files are skipped. Each file runs in its own tx.
//
// Requires SUPABASE_DB_URL (direct Postgres connection) in the repo-root .env.
import { config } from 'dotenv';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });

const migrationsDir = resolve(__dirname, '../../../supabase/migrations');
const dbUrl = process.env.SUPABASE_DB_URL;

if (!dbUrl) {
  console.error(
    'ERROR: SUPABASE_DB_URL is not set in .env.\n' +
    'Get it from Supabase: Settings > Database > Connection string > URI.'
  );
  process.exit(1);
}

// TLS: verify the server cert when a CA is provided (recommended). Supabase publishes
// its CA at Settings > Database > SSL configuration; point SUPABASE_DB_CA at the .crt file.
// Without it we fall back to an unverified connection and warn loudly.
const caPath = process.env.SUPABASE_DB_CA;
let ssl;
if (caPath) {
  ssl = { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
} else {
  console.warn(
    'WARN: SUPABASE_DB_CA not set — the migration connection will NOT verify the server ' +
    'TLS certificate (MITM risk on a connection carrying the DB password + all DDL).\n' +
    '      Download the CA from Supabase (Settings > Database > SSL) and set SUPABASE_DB_CA.'
  );
  ssl = { rejectUnauthorized: false };
}

// Parse by splitting on the LAST '@' so passwords containing '@' (or ':', '/') work
// without requiring percent-encoding in .env. Falls back to the raw string.
function parsePgUrl(raw) {
  const withoutScheme = raw.replace(/^postgres(?:ql)?:\/\//, '');
  const lastAt = withoutScheme.lastIndexOf('@');
  if (lastAt === -1) return null;
  const creds = withoutScheme.slice(0, lastAt);
  const hostPart = withoutScheme.slice(lastAt + 1);
  const firstColon = creds.indexOf(':');
  const user = firstColon === -1 ? creds : creds.slice(0, firstColon);
  const password = firstColon === -1 ? undefined : creds.slice(firstColon + 1);
  const hostMatch = hostPart.match(/^([^:/]+)(?::(\d+))?\/([^?]+)/);
  if (!hostMatch) return null;
  const [, host, port, database] = hostMatch;
  return { user, password, host, port: port ? Number(port) : 5432, database };
}

const parsed = parsePgUrl(dbUrl);
const client = new pg.Client(parsed ? { ...parsed, ssl } : { connectionString: dbUrl, ssl });

async function main() {
  await client.connect();
  await client.query(
    `create table if not exists schema_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`
  );

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;

  for (const file of files) {
    const { rows } = await client.query('select 1 from schema_migrations where name = $1', [file]);
    if (rows.length) {
      console.log(`skip    ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    process.stdout.write(`apply   ${file} ... `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations(name) values ($1)', [file]);
      await client.query('commit');
      console.log('ok');
      applied++;
    } catch (err) {
      await client.query('rollback');
      console.log('FAILED');
      console.error(`\n${file} failed:\n${err.message}\n`);
      process.exitCode = 1;
      break;
    }
  }

  await client.end();
  if (process.exitCode !== 1) {
    console.log(`\nDone. ${applied} migration(s) applied.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
