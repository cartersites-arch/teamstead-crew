// Exercises the extracted Worker identity guard with mocked command results only.
// This script never invokes Wrangler, a deployment helper, or a network API.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const scriptPath = 'scripts/deploy.mjs';
const source = fs.readFileSync(path.join(root, scriptPath), 'utf8');
const start = source.indexOf('function workerExists()');
const end = source.indexOf('\nconst wrangler =', start);
const gateStart = source.indexOf('const exists = workerExists();', end);
const gateEnd = source.indexOf('\nconst tables =', gateStart);
assert(start >= 0 && end > start && gateStart > end && gateEnd > gateStart, 'Guard extraction boundaries changed; review the test.');
const guardSource = source.slice(start, end), gateSource = source.slice(gateStart, gateEnd);
const config = { name: 'project-room-fixture', account_id: 'a'.repeat(32) };
const endpoint = `/accounts/${config.account_id}/workers/scripts/${config.name}/deployments`;
const checks = [];
const success = stdout => ({ status: 0, stdout, stderr: '' });
const missing = { status: 1, stdout: '', stderr: `API request ${endpoint} failed [code: 10007]` };
function execute(result, receipt, useGate = false) {
  const calls = [];
  const context = { config, deployed: receipt, process: { execPath: 'mock-node', env: {} }, spawnSync(...args) { calls.push(args); return result; } };
  const answer = vm.runInNewContext(guardSource + '\n' + (useGate ? gateSource : 'workerExists();'), context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'mock-node');
  assert.equal(JSON.stringify(calls[0][1]), JSON.stringify(['node_modules/wrangler/bin/wrangler.js', 'deployments', 'list', '--name', config.name, '--json']));
  return answer;
}
function check(name, run) {
  try { run(); checks.push({ name, status: 'passed' }); }
  catch (error) { checks.push({ name, status: 'failed', error: error.message }); throw error; }
}
let failed;
try {
  check('empty_deployment_array_still_means_worker_exists', () => assert.equal(execute(success('[]')), true));
  check('nonempty_deployment_array_means_worker_exists', () => assert.equal(execute(success('[{"id":"fixture"}]')), true));
  check('exact_worker_endpoint_and_10007_means_absent', () => assert.equal(execute(missing), false));
  check('wrong_endpoint_10007_fails_closed', () => assert.throws(() => execute({ ...missing, stderr: '/accounts/other/workers/scripts/other/deployments [code: 10007]' }), /Could not verify/));
  check('authorization_failure_fails_closed', () => assert.throws(() => execute({ ...missing, stderr: endpoint + ' [code: 10000]' }), /Could not verify/));
  check('spawn_error_fails_closed_even_with_not_found_text', () => assert.throws(() => execute({ ...missing, error: Error('spawn failed') }), /Could not verify/));
  check('missing_exit_status_fails_closed', () => assert.throws(() => execute({ ...missing, status: null }), /Could not verify/));
  check('malformed_success_json_fails_closed', () => assert.throws(() => execute(success('not JSON'))));
  check('nonarray_success_json_fails_closed', () => assert.throws(() => execute(success('{}')), /unexpected result/));
  check('existing_worker_without_receipt_is_refused', () => assert.throws(() => execute(success('[]'), undefined, true), /already uses this name/));
  check('missing_worker_with_prior_receipt_is_refused', () => assert.throws(() => execute(missing, { verified: true }, true), /previously deployed Worker is missing/));
  check('new_worker_without_receipt_can_pass_identity_gate', () => execute(missing, undefined, true));
  check('existing_worker_with_receipt_can_pass_identity_gate', () => execute(success('[]'), { verified: true }, true));
} catch (error) { failed = error; }
const report = {
  schemaVersion: 1,
  suite: 'independent-deploy-worker-identity-guard',
  checkedAt: new Date().toISOString(),
  status: failed ? 'failed' : 'passed',
  command: 'node qa/independent-deploy-guard-checks.mjs',
  networkUsed: false,
  cloudflareCommandsRun: false,
  checks,
  sourceHashes: Object.fromEntries([scriptPath, 'qa/independent-deploy-guard-checks.mjs'].map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')])),
  limitations: ['Tests only the extracted Worker existence function and its first-deployment/receipt gate with mocked child-process results.', 'Does not execute the deployment helper, validate live CLI/API output, or test remote account, secrets, migration, billing or deployment behavior.']
};
fs.writeFileSync(path.join(root, 'qa/independent-deploy-guard-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, passed: checks.filter(c => c.status === 'passed').length, failed: checks.filter(c => c.status === 'failed').length, report: 'qa/independent-deploy-guard-results.json' }));
if (failed) { console.error(failed.message); process.exitCode = 1; }
