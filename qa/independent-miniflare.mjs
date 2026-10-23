/**
 * Focused, local-only photo storage verification against real Miniflare D1.
 * Run: node qa/independent-miniflare.mjs
 *
 * This script never imports Wrangler, reads its configuration, authenticates,
 * or deploys. Wrangler's package.json is resolved ONLY to locate its already
 * installed Miniflare dependency. All Worker outbound fetches are rejected by
 * Miniflare's outboundService; cf:false disables the separate metadata fetch.
 * No remote bindings are configured. Test-only storage is removed on exit.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const qaDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(qaDir);
const require = createRequire(join(root, 'package.json'));
const dependencyRequire = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare, Response: MiniflareResponse, Log, LogLevel } = dependencyRequire('miniflare');
const { build } = require('esbuild');
const resultsPath = join(qaDir, 'independent-miniflare-results.json');
const began = Date.now();
const results = {
  status: 'running',
  startedAt: new Date(began).toISOString(),
  scope: 'Actual lib/photo-storage.ts API and actual migrations in local Miniflare D1; no auth/router coverage',
  limitations: [
    'Local workerd/Miniflare verification only; no deployed Cloudflare requests, account access, or production data.',
    'Does not establish deployed Cloudflare CPU time, free-tier capacity, latency, or production quota behavior.',
    'Quota contention uses the actual triggers with a reduced isolated test budget; it does not fill 64 MiB.',
    'No browser, authentication, authorization, full application router, or complete security audit coverage.',
  ],
  runtime: { node: process.version, miniflare: '4.20260515.0', esbuild: require('esbuild').version },
  network: {
    outboundService: 'Reject every Worker outbound request locally with HTTP 503',
    cf: false,
    remoteBindings: false,
    wranglerInvoked: false,
    outboundAttempts: [],
  },
  assertions: 0,
  requestCount: 0,
  migrations: [],
  sourceHashes: {},
  groups: [],
};

function equal(actual, expected, label) {
  results.assertions++;
  assert.deepEqual(actual, expected, label);
}
function ok(value, label) {
  results.assertions++;
  assert.ok(value, label);
}
async function group(name, fn) {
  const start = Date.now();
  const assertionStart = results.assertions;
  try {
    await fn();
    results.groups.push({ name, status: 'passed', assertions: results.assertions - assertionStart, ms: Date.now() - start });
  } catch (error) {
    results.groups.push({ name, status: 'failed', assertions: results.assertions - assertionStart, ms: Date.now() - start, error: error.stack || String(error) });
    throw error;
  }
}

// esbuild uses the real source files; cloudflare:workers remains a runtime
// module, so db() obtains the actual Miniflare D1 binding through env.DB.
const workerSource = `
import { photoStore, photoStorageUsage, MAX_PHOTO_BYTES, PHOTO_BUDGET_BYTES } from '../lib/photo-storage.ts';
export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/usage') return Response.json(await photoStorageUsage());
      if (url.pathname === '/constants') return Response.json({ maxPhotoBytes: MAX_PHOTO_BYTES, budgetBytes: PHOTO_BUDGET_BYTES });
      if (url.pathname === '/network-probe') {
        const blocked = await fetch(url.searchParams.get('url'));
        return Response.json({ status: blocked.status, body: await blocked.text() });
      }
      if (url.pathname.startsWith('/photo/')) {
        const key = decodeURIComponent(url.pathname.slice(7));
        if (request.method === 'PUT') {
          await photoStore.put(key, new Uint8Array(await request.arrayBuffer()), { httpMetadata: { contentType: 'image/png' } });
          return new Response(null, { status: 201 });
        }
        if (request.method === 'GET') {
          const object = await photoStore.get(key);
          if (!object) return new Response(null, { status: 404 });
          return new Response(object.body, { headers: { 'content-type': 'application/octet-stream', 'x-object-size': String(object.size) } });
        }
        if (request.method === 'DELETE') {
          await photoStore.delete(key);
          return new Response(null, { status: 204 });
        }
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      return Response.json({ error: String(error.message || error) }, { status: Number.isInteger(error.status) ? error.status : 500 });
    }
  }
};
`;

let mf;
let stateDir;
try {
  const built = await build({
    stdin: { contents: workerSource, resolveDir: qaDir, sourcefile: 'independent-miniflare-worker.ts', loader: 'ts' },
    absWorkingDir: root,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    external: ['cloudflare:workers'],
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  results.workerInputs = Object.keys(built.metafile.inputs);
  for (const name of ['lib/photo-storage.ts', 'lib/chat-db.ts', 'lib/app-errors.ts']) {
    results.sourceHashes[name] = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
  }
  results.bundleHash = createHash('sha256').update(built.outputFiles[0].contents).digest('hex');
  stateDir = await mkdtemp(join(qaDir, 'independent-miniflare-state-'));
  mf = new Miniflare({
    name: 'independent-photo-storage-check',
    rootPath: qaDir,
    modules: true,
    script: built.outputFiles[0].text,
    compatibilityDate: '2026-05-15',
    compatibilityFlags: ['nodejs_compat'],
    host: '127.0.0.1',
    port: 0,
    cf: false,
    d1Databases: { DB: 'independent-local-photo-test' },
    d1Persist: join(stateDir, 'd1'),
    cachePersist: join(stateDir, 'cache'),
    durableObjectsPersist: join(stateDir, 'durable-objects'),
    log: new Log(LogLevel.ERROR),
    outboundService(request) {
      results.network.outboundAttempts.push(request.url);
      return new MiniflareResponse('OUTBOUND_NETWORK_DISABLED', { status: 503 });
    },
  });
  await mf.ready;

  async function request(path, init = {}) {
    results.requestCount++;
    return mf.dispatchFetch(`https://local-photo-test.invalid${path}`, init);
  }
  async function usage() {
    const response = await request('/usage');
    equal(response.status, 200, 'usage endpoint succeeds');
    return response.json();
  }
  const db = await mf.getD1Database('DB');
  async function budget() {
    return db.prepare('SELECT used_bytes,limit_bytes FROM photo_budget WHERE id=1').first();
  }
  async function objectCount() {
    return (await db.prepare('SELECT COUNT(*) AS count FROM photo_objects').first()).count;
  }
  async function put(key, value) {
    return request(`/photo/${encodeURIComponent(key)}`, { method: 'PUT', body: value });
  }
  async function remove(key) {
    return request(`/photo/${encodeURIComponent(key)}`, { method: 'DELETE' });
  }

  await group('Outbound network is intercepted and rejected before storage testing', async () => {
    for (const target of ['https://outside.invalid/probe', 'http://203.0.113.10/probe', 'http://127.0.0.1:1/probe']) {
      const response = await request(`/network-probe?url=${encodeURIComponent(target)}`);
      equal(response.status, 200, 'probe endpoint responded locally');
      equal(await response.json(), { status: 503, body: 'OUTBOUND_NETWORK_DISABLED' }, 'all outbound destinations rejected');
    }
    equal(results.network.outboundAttempts.length, 3, 'each attempted request reached the denying handler');
  });

  await group('Apply every actual migration to fresh local D1', async () => {
    const files = (await readdir(join(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort();
    for (const name of files) {
      const sql = await readFile(join(root, 'drizzle', name), 'utf8');
      const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
      for (const statement of statements) await db.prepare(statement).run();
      results.migrations.push({ path: `drizzle/${name}`, sha256: createHash('sha256').update(sql).digest('hex'), statements: statements.length });
    }
    equal(files.length, 6, 'all six current migrations applied');
    equal(await usage(), { usedBytes: 0, limitBytes: 67108864, maxPhotoBytes: 524288 }, 'configured 64 MiB quota and 512 KiB photo maximum');
    const constants = await (await request('/constants')).json();
    equal(constants, { maxPhotoBytes: 524288, budgetBytes: 67108864 }, 'actual module constants');
  });

  await group('Actual D1 BLOB put/get/delete roundtrip and byte accounting', async () => {
    const body = Uint8Array.from({ length: 8193 }, (_, i) => (i * 197 + Math.floor(i / 256)) % 256);
    equal((await put('roundtrip-binary', body)).status, 201, 'binary object accepted');
    const row = await db.prepare("SELECT size,length(body) AS length,typeof(body) AS type FROM photo_objects WHERE object_key=?").bind('roundtrip-binary').first();
    equal(row, { size: 8193, length: 8193, type: 'blob' }, 'D1 stores actual binary BLOB');
    equal((await usage()).usedBytes, body.length, 'insertion adds exact byte count');
    const response = await request('/photo/roundtrip-binary');
    equal(response.status, 200, 'stored object can be fetched');
    equal(response.headers.get('x-object-size'), String(body.length), 'size preserved');
    equal(new Uint8Array(await response.arrayBuffer()), body, 'all byte values survive actual D1 and Worker Response');
    equal((await remove('roundtrip-binary')).status, 204, 'object deleted');
    equal((await request('/photo/roundtrip-binary')).status, 404, 'deleted object no longer accessible');
    equal(await objectCount(), 0, 'BLOB row physically deleted');
    equal((await usage()).usedBytes, 0, 'deletion releases quota');
    equal((await remove('roundtrip-binary')).status, 204, 'repeat deletion remains idempotent');
    equal((await usage()).usedBytes, 0, 'repeat deletion does not subtract quota twice');
  });

  await group('512 KiB boundary, empty/oversize rejection, and database validation', async () => {
    const maximum = Uint8Array.from({ length: 524288 }, (_, i) => i % 251);
    equal((await put('maximum', maximum)).status, 201, 'exact 512 KiB object accepted');
    const got = await request('/photo/maximum');
    equal(got.status, 200, 'maximum object retrievable');
    equal(new Uint8Array(await got.arrayBuffer()), maximum, 'maximum BLOB roundtrips exactly');
    equal((await put('oversize', new Uint8Array(524289))).status, 413, 'maximum plus one byte rejected');
    equal((await put('empty', new Uint8Array(0))).status, 413, 'empty object rejected');
    equal(await objectCount(), 1, 'rejected inserts create no rows');
    equal((await usage()).usedBytes, maximum.length, 'rejected inserts do not reserve bytes');
    let mismatchError;
    try {
      await db.prepare('INSERT INTO photo_objects(object_key,size,body,created_at) VALUES(?,?,?,?)').bind('bad-size', 1, new Uint8Array([1,2]).buffer, Date.now()).run();
    } catch (error) { mismatchError = String(error); }
    ok(mismatchError?.includes('PHOTO_SIZE_INVALID'), 'actual migration trigger rejects size/BLOB mismatch');
    let updateError;
    try {
      await db.prepare('UPDATE photo_objects SET body=? WHERE object_key=?').bind(new Uint8Array([1]).buffer, 'maximum').run();
    } catch (error) { updateError = String(error); }
    ok(updateError?.includes('PHOTO_REPLACEMENT_NOT_ALLOWED'), 'actual migration trigger prevents bypass through update');
    equal(await objectCount(), 1, 'failed direct operations preserve row count');
    equal((await budget()).used_bytes, maximum.length, 'failed direct operations preserve budget');
    equal((await remove('maximum')).status, 204, 'maximum object deleted');
    equal((await usage()).usedBytes, 0, 'maximum object bytes reclaimed');
  });

  await group('Quota exact-fit rejection and freed-space reuse in real transactions', async () => {
    // Reduce only this isolated test database's budget to avoid writing 64 MiB.
    await db.prepare('UPDATE photo_budget SET limit_bytes=20 WHERE id=1').run();
    equal((await put('quota-a', new Uint8Array(12))).status, 201, 'first quota object accepted');
    equal((await put('quota-b', new Uint8Array(8))).status, 201, 'exact remaining space accepted');
    const full = await put('quota-overflow', new Uint8Array(1));
    equal(full.status, 507, 'trigger quota error mapped to app 507');
    ok((await full.json()).error.includes('photo space is full'), 'app quota explanation returned');
    equal(await budget(), { used_bytes: 20, limit_bytes: 20 }, 'overflow does not change exact-fit accounting');
    equal(await objectCount(), 2, 'overflow row rolled back');
    equal((await remove('quota-a')).status, 204, 'delete releases space');
    equal((await budget()).used_bytes, 8, 'remaining object accounted for');
    equal((await put('quota-reuse', new Uint8Array(12))).status, 201, 'reclaimed bytes usable');
    equal((await budget()).used_bytes, 20, 'reused capacity accounted once');
    equal((await remove('quota-b')).status, 204, 'second quota object removed');
    equal((await remove('quota-reuse')).status, 204, 'replacement quota object removed');
    equal((await budget()).used_bytes, 0, 'all quota bytes released');
  });

  await group('Competing insertions cannot overbook the remaining byte quota', async () => {
    await db.prepare('UPDATE photo_budget SET limit_bytes=25 WHERE id=1').run();
    const responses = await Promise.all([
      put('race-a', new Uint8Array(16)),
      put('race-b', new Uint8Array(16)),
    ]);
    equal(responses.map(r => r.status).sort(), [201, 507], 'exactly one competing upload fits');
    equal(await objectCount(), 1, 'only the committed object remains');
    equal(await budget(), { used_bytes: 16, limit_bytes: 25 }, 'concurrent quota accounting remains correct');
    await Promise.all([remove('race-a'), remove('race-b')]);
    equal(await objectCount(), 0, 'race fixture rows removed');
    equal((await budget()).used_bytes, 0, 'race quota fully reclaimed');
    await db.prepare('UPDATE photo_budget SET limit_bytes=67108864 WHERE id=1').run();
    equal(await usage(), { usedBytes: 0, limitBytes: 67108864, maxPhotoBytes: 524288 }, 'default quota restored');
    equal(results.network.outboundAttempts.length, 3, 'storage API made no network attempts');
  });

  results.status = 'passed';
} catch (error) {
  results.status = 'failed';
  results.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  try {
    if (mf) await mf.dispose();
    if (stateDir) await rm(stateDir, { recursive: true, force: true });
    results.cleanup = 'Miniflare disposed and isolated local D1 state removed';
  } catch (error) {
    results.cleanup = String(error);
    results.status = 'failed';
    process.exitCode = 1;
  }
  results.completedAt = new Date().toISOString();
  results.elapsedMs = Date.now() - began;
  await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: results.status, groups: results.groups.length, assertions: results.assertions, requestCount: results.requestCount, elapsedMs: results.elapsedMs, results: relative(root, resultsPath), error: results.error })}\n`);
}
