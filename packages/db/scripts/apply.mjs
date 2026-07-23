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

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

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
