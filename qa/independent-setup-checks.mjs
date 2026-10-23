// Local synthetic-file checks only. No real secret files, processes or network.
// Run: node qa/independent-setup-checks.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const setupSource = read('scripts/setup-secrets.mjs');
const deploySource = read('scripts/deploy.mjs');
const withoutImports = source => source.replace(/^import .*;\n/gm, '');
const setupBody = withoutImports(setupSource);
const deployBody = withoutImports(deploySource).split('\nfunction run(')[0];
assert(!/^\s*import /m.test(setupBody + deployBody));
assert(deployBody.includes('const bootstrapExpiry ='), 'Deployment preflight extraction changed.');
const checks = [];
const token = Buffer.alloc(32, 11).toString('base64url');
const key = Buffer.alloc(32, 22).toString('base64');
const config = { name: 'project-room-fixture', account_id: 'a'.repeat(32), d1_databases: [{ binding: 'DB', database_name: 'project-room-fixture', database_id: '11111111-2222-4333-8444-555555555555' }], vars: { WEBAUTHN_ORIGIN: 'https://project.example', WEBAUTHN_RP_ID: 'project.example' } };
function fixture(expiry = Date.now() + 86400000, deployed = false) {
  const runtime = { MAINTENANCE_LINK_KEY: key, BOOTSTRAP_ACCESS_HASH: createHash('sha256').update(token).digest('hex'), BOOTSTRAP_ACCESS_EXPIRES_AT: String(expiry) };
  const files = new Map([
    ['wrangler.jsonc', JSON.stringify(config)],
    ['.secrets/runtime.json', JSON.stringify(runtime)],
    ['.secrets/origin.txt', 'https://project.example\n'],
    ['.secrets/owner-setup.txt', `Fixture setup link\nhttps://project.example/#access=${token}\n`],
  ]);
  if (deployed) files.set('.secrets/deployed.json', JSON.stringify({ account: config.account_id, database: config.d1_databases[0].database_id, origin: config.vars.WEBAUTHN_ORIGIN, keyHash: createHash('sha256').update(key).digest('hex') }));
  return files;
}
async function execute(body, files) {
  const writes = [], messages = [], EXIT = {};
  const context = { URL, URLSearchParams, Buffer, createHash, randomBytes, console: { log(message) { messages.push(message); } }, process: { exit(code) { assert.equal(code, 0); throw EXIT; } }, async mkdir() {}, async readFile(name) { if (!files.has(name)) throw Object.assign(new Error('Fixture file missing'), { code: 'ENOENT' }); return files.get(name); }, async writeFile(name, value, options) { if (options?.flag === 'wx' && files.has(name)) throw Object.assign(new Error('Fixture file exists'), { code: 'EEXIST' }); writes.push({ name, options }); files.set(name, value); }, spawnSync() { throw new Error('No command execution is permitted in this test.'); }, fetch() { throw new Error('No network is permitted in this test.'); } };
  let error;
  try { await vm.runInNewContext('(async()=>{' + body + '\n})()', context); } catch (caught) { if (caught !== EXIT) error = caught; }
  return { files, writes, messages, error };
}
async function check(name, run) { try { await run(); checks.push({ name, status: 'passed' }); } catch (error) { checks.push({ name, status: 'failed', error: error.message }); throw error; } }
async function rejectsWithoutWrites(files, pattern, body = setupBody) {
  const originalRuntime = files.get('.secrets/runtime.json'), result = await execute(body, files);
  assert(result.error, 'Expected failure before writes'); assert.match(result.error.message, pattern);
  assert.equal(result.writes.length, 0); assert.equal(files.get('.secrets/runtime.json'), originalRuntime);
}
let failed;
try {
  await check('setup.complete_unexpired_files_are_kept_without_writes', async () => { const result = await execute(setupBody, fixture()); assert.equal(result.error, undefined); assert.equal(result.writes.length, 0); assert(result.messages.some(message => message.includes('verified and kept'))); });
  for (const missing of ['.secrets/owner-setup.txt', '.secrets/origin.txt']) await check('setup.missing_' + path.basename(missing) + '_fails_without_key_change', async () => { const files = fixture(); files.delete(missing); await rejectsWithoutWrites(files, /incomplete or inconsistent/); });
  for (const [name, change] of [
    ['wrong_recorded_origin', files => files.set('.secrets/origin.txt', 'https://other.example')],
    ['wrong_link_origin', files => files.set('.secrets/owner-setup.txt', `https://other.example/#access=${token}`)],
    ['wrong_link_path', files => files.set('.secrets/owner-setup.txt', `https://project.example/wrong#access=${token}`)],
    ['wrong_link_token', files => files.set('.secrets/owner-setup.txt', 'https://project.example/#access=' + Buffer.alloc(32, 33).toString('base64url'))],
    ['short_key', files => { const runtime = JSON.parse(files.get('.secrets/runtime.json')); runtime.MAINTENANCE_LINK_KEY = Buffer.alloc(4).toString('base64'); files.set('.secrets/runtime.json', JSON.stringify(runtime)); }],
    ['invalid_expiry', files => { const runtime = JSON.parse(files.get('.secrets/runtime.json')); runtime.BOOTSTRAP_ACCESS_EXPIRES_AT = 'invalid'; files.set('.secrets/runtime.json', JSON.stringify(runtime)); }],
  ]) await check('setup.' + name + '_fails_without_key_change', async () => { const files = fixture(); change(files); await rejectsWithoutWrites(files, /incomplete or inconsistent/); });
  await check('setup.expired_first_grant_fails_without_key_change', () => rejectsWithoutWrites(fixture(Date.now() - 86400000), /expired before a recorded deployment/));
  await check('setup.deployed_workspace_may_keep_expired_original_grant', async () => { const result = await execute(setupBody, fixture(Date.now() - 86400000, true)); assert.equal(result.error, undefined); assert.equal(result.writes.length, 0); });
  await check('setup.new_synthetic_files_are_complete_private_and_not_logged', async () => { const files = new Map([['wrangler.jsonc', JSON.stringify(config)]]), first = await execute(setupBody, files); assert.equal(first.error, undefined); assert.equal(first.writes.length, 3); assert(first.writes.every(write => write.options.mode === 0o600 && write.options.flag === 'wx')); const runtime = JSON.parse(files.get('.secrets/runtime.json')); assert(!first.messages.some(message => message.includes(runtime.MAINTENANCE_LINK_KEY))); const second = await execute(setupBody, files); assert.equal(second.error, undefined); assert.equal(second.writes.length, 0); });
  await check('deploy.first_expired_grant_stops_in_local_preflight', () => rejectsWithoutWrites(fixture(Date.now() - 86400000), /missing or expired/, deployBody));
  for (const [name, expiry] of [['zero', 0], ['negative', -1], ['nonnumeric', 'invalid'], ['nonfinite', 'Infinity']]) await check('deploy.' + name + '_expiry_stops_in_local_preflight', () => rejectsWithoutWrites(fixture(expiry), /missing or expired/, deployBody));
  await check('deploy.missing_expiry_stops_in_local_preflight', async () => { const files = fixture(), runtime = JSON.parse(files.get('.secrets/runtime.json')); delete runtime.BOOTSTRAP_ACCESS_EXPIRES_AT; files.set('.secrets/runtime.json', JSON.stringify(runtime)); await rejectsWithoutWrites(files, /missing or expired/, deployBody); });
  await check('deploy.valid_first_grant_passes_local_preflight', async () => { const result = await execute(deployBody, fixture()); assert.equal(result.error, undefined); assert.equal(result.writes.length, 0); });
  await check('deploy.receipted_update_accepts_expired_original_grant', async () => { const result = await execute(deployBody, fixture(Date.now() - 86400000, true)); assert.equal(result.error, undefined); assert.equal(result.writes.length, 0); });
} catch (error) { failed = error; }
const files = ['scripts/setup-secrets.mjs', 'scripts/deploy.mjs', 'qa/independent-setup-checks.mjs'];
const report = { schemaVersion: 1, suite: 'independent-setup-local-regressions', checkedAt: new Date().toISOString(), status: failed ? 'failed' : 'passed', command: 'node qa/independent-setup-checks.mjs', networkUsed: false, cloudflareCommandsRun: false, realSecretFilesRead: false, checks, sourceHashes: Object.fromEntries(files.map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')])), limitations: ['Uses synthetic in-memory files and mocked file/process functions; no private setup files are read or written.', 'Deployment coverage stops at the local secret/fingerprint/expiry preflight before any command invocation; remote deployment behavior is not tested.'] };
fs.writeFileSync(path.join(root, 'qa/independent-setup-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, passed: checks.filter(c => c.status === 'passed').length, failed: checks.filter(c => c.status === 'failed').length, report: 'qa/independent-setup-results.json' }));
if (failed) { console.error(failed.message); process.exitCode = 1; }
