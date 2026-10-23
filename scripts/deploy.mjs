import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const database = config.d1_databases?.[0];
if (!/^project-room(?:-[a-z0-9]+)+$/.test(config.name) || database?.database_name !== config.name || database?.binding !== 'DB' ||
    !/^[a-f0-9]{32}$/i.test(config.account_id || '') || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(database?.database_id || '') || /^0+$/.test(database.database_id.replaceAll('-', ''))) {
  throw new Error('Configure a verified company account and a new dedicated Project Room database first. No deployment was attempted.');
}
if (config.r2_buckets?.length || config.ai || config.services?.length) throw new Error('This free-pilot deployment does not enable paid storage, AI or external service bindings.');
const origin = new URL(config.vars.WEBAUTHN_ORIGIN);
if (origin.protocol !== 'https:' || origin.hostname !== config.vars.WEBAUTHN_RP_ID || origin.origin !== config.vars.WEBAUTHN_ORIGIN) throw new Error('The canonical passkey origin is invalid.');
const rawSecrets = await readFile('.secrets/runtime.json', 'utf8');
const secrets = JSON.parse(rawSecrets);
if (Buffer.from(secrets.MAINTENANCE_LINK_KEY || '', 'base64').length !== 32 || !/^[a-f0-9]{64}$/.test(secrets.BOOTSTRAP_ACCESS_HASH || '')) throw new Error('The private runtime setup is incomplete.');
if ((await readFile('.secrets/origin.txt', 'utf8')).trim() !== origin.origin) throw new Error('These setup files belong to a different hostname.');
const fingerprint = { account: config.account_id, database: database.database_id, origin: origin.origin, keyHash: createHash('sha256').update(secrets.MAINTENANCE_LINK_KEY).digest('hex') };
let deployed;
try { deployed = JSON.parse(await readFile('.secrets/deployed.json', 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (deployed && Object.keys(fingerprint).some(key => deployed[key] !== fingerprint[key])) throw new Error('The destination or encryption key changed. Complete the documented migration before deploying.');
const bootstrapExpiry = Number(secrets.BOOTSTRAP_ACCESS_EXPIRES_AT);
if (!Number.isFinite(bootstrapExpiry) || bootstrapExpiry <= 0 || (!deployed && bootstrapExpiry <= Date.now())) {
  throw new Error('The first owner setup grant is missing or expired. Preserve the encryption key and prepare a fresh grant after verifying that the remote workspace is uninitialized. No remote deployment steps were run.');
}

function run(script, args, capture = false) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.status !== 0 || result.error) throw new Error(`The ${script.includes('wrangler') ? 'Cloudflare' : 'build'} step failed. No later deployment steps were run.${capture ? ' Check the account connection and its permissions.' : ''}`);
  return capture ? JSON.parse(result.stdout.trim()) : undefined;
}
function workerExists() {
  // This is a read-only, named-Worker preflight. An empty deployment list still
  // means a Worker exists. Only the specific API not-found response is treated
  // as absence; auth/network/parse errors stop the deployment.
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deployments', 'list', '--name', config.name, '--json'], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
  });
  if (result.status === 0 && !result.error) {
    if (!Array.isArray(JSON.parse(result.stdout.trim()))) throw new Error('The Worker identity check returned an unexpected result.');
    return true;
  }
  const output = String(result.stderr || '') + String(result.stdout || '');
  const endpoint = `/accounts/${config.account_id}/workers/scripts/${config.name}/deployments`;
  if (!result.error && result.status !== null && output.includes(endpoint) && /\[code: 10007\]/.test(output)) return false;
  throw new Error('Could not verify whether this Worker name is unused. Check the intended account and permissions; no deployment writes were attempted.');
}
const wrangler = 'node_modules/wrangler/bin/wrangler.js';
run('node_modules/typescript/bin/tsc', ['--noEmit']);
run('node_modules/vite/bin/vite.js', ['build']);
const info = run(wrangler, ['d1', 'info', 'DB', '--json'], true);
if (info.uuid !== database.database_id || info.name !== database.database_name) throw new Error('The remote database identity did not match. No database writes were attempted.');
const exists = workerExists();
if (exists && !deployed) throw new Error('A Worker already uses this name, and this copy has no verified deployment record. Choose a new name or complete an explicit migration; its code and secrets were not changed.');
if (!exists && deployed) throw new Error('The previously deployed Worker is missing. Verify the destination before recreating it.');
const tables = run(wrangler, ['d1', 'execute', 'DB', '--remote', '--json', '--command', "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace'"], true);
if (!Array.isArray(tables) || !Array.isArray(tables[0]?.results)) throw new Error('Could not verify whether the destination is a new workspace.');
if (!deployed && tables[0].results.length) {
  const rows = run(wrangler, ['d1', 'execute', 'DB', '--remote', '--json', '--command', 'SELECT COUNT(*) AS count FROM workspace'], true);
  if (!Array.isArray(rows) || !Array.isArray(rows[0]?.results) || rows[0].results[0]?.count !== 0) {
    throw new Error('This database already contains a workspace. Preserve its key and perform an explicit origin/data migration; do not create a replacement owner or overwrite it.');
  }
}
run(wrangler, ['d1', 'export', 'DB', '--remote', '--output', `.secrets/predeploy-${Date.now()}.sql`]);
run(wrangler, ['d1', 'migrations', 'apply', 'DB', '--remote']);
run(wrangler, ['secret', 'bulk', '.secrets/runtime.json']);
run(wrangler, ['deploy']);
await writeFile('.secrets/deployed.json', JSON.stringify(fingerprint, null, 2) + '\n', { mode: 0o600 });
console.log('Deployment finished. Open the actual URL reported by Cloudflare and privately use .secrets/owner-setup.txt for first enrollment.');
