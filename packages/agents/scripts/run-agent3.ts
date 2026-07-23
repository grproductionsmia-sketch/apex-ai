// CLI: pnpm --filter @apex/agents agent3 <workspaceId> [count]
// Loads the repo-root .env, then runs Agente 3 (generate + compliance) for a workspace.
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env') });

const workspaceId = process.argv[2];
if (!workspaceId) {
  console.error('Usage: pnpm --filter @apex/agents agent3 <workspaceId> [count]');
  process.exit(1);
}
const count = process.argv[3] ? Number(process.argv[3]) : undefined;

// Import after env is loaded so config validation sees the vars.
const { runAgent3 } = await import('../src/agent3-content.js');

const summary = await runAgent3({ workspaceId, count });
// summary to stdout (logs go to stderr)
console.log(JSON.stringify(summary, null, 2));
