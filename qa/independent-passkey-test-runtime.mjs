import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Test boundaries only. Importing this module does not load or execute app code.
export const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCRATCH = path.dirname(fileURLToPath(import.meta.url));
export const hash = value => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
let bundleSequence = 0;

export async function createHarness({ site = SITE, scratch = SCRATCH, origin = 'https://teamstead-crew.pages.dev', environment = {}, beforeMigration, routeFiles = {}, sourceOverrides = {} } = {}) {
  const require = createRequire(path.join(site, 'package.json'));
  const { build } = await import(pathToFileURL(require.resolve('esbuild')).href);
  const sourceHashes = {};
  const requestMetrics = new AsyncLocalStorage();
  const generated = await mkdtemp(path.join(tmpdir(), 'project-room-local-qa-'));
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const migrations = (await readdir(path.join(site, 'drizzle'))).filter(file => file.endsWith('.sql')).sort();
  for (const file of migrations) {
    const sql = await readFile(path.join(site, 'drizzle', file), 'utf8');
    sourceHashes['drizzle/' + file] = hash(sql);
    if (beforeMigration) await beforeMigration({ file, sql, sqlite });
    sqlite.exec(sql);
  }
  const packageJson = await readFile(path.join(site, 'package.json'), 'utf8');
  sourceHashes['package.json'] = hash(packageJson);
  sourceHashes['wrangler.jsonc'] = hash(await readFile(path.join(site, 'wrangler.jsonc')));
  sourceHashes['tsconfig.json'] = hash(await readFile(path.join(site, 'tsconfig.json')));
  const packageVersions = JSON.parse(packageJson).dependencies;
  for (const lockfile of ['pnpm-lock.yaml', 'package-lock.json']) {
    if (existsSync(path.join(site, lockfile))) sourceHashes[lockfile] = hash(await readFile(path.join(site, lockfile)));
  }

  const metrics = { sqlExecutions: 0, maxBindCount: 0, batches: 0, httpCalls: 0, maxRequestSql: 0, assetsCalls: 0, requestSqlOver50: [] };
  const sqlShapes = new Map();
  const row = (sql, ...bindings) => sqlite.prepare(sql).get(...bindings);
  const rows = (sql, ...bindings) => sqlite.prepare(sql).all(...bindings);
  const run = (sql, ...bindings) => sqlite.prepare(sql).run(...bindings);
  const count = (table, where = '', ...bindings) => row('SELECT COUNT(*) AS n FROM ' + table + (where ? ' WHERE ' + where : ''), ...bindings).n;
  let gate = null;
  let fault = null;
  let database;

  async function boundary(phase, kind, sql) {
    if (gate && gate.phase === phase && gate.kind === kind && gate.pattern.test(sql)) {
      const current = gate; gate = null; current.reached(); await current.wait;
    }
    if (fault && fault.phase === phase && fault.kind === kind && fault.pattern.test(sql)) {
      const current = fault; fault = null; throw new Error(current.message);
    }
  }

  class Statement {
    constructor(sql, bindings = []) { this.sql = sql; this.bindings = bindings; }
    bind(...values) {
      assert.ok(values.length <= 100, 'D1 maximum 100 bound parameters exceeded: ' + values.length);
      metrics.maxBindCount = Math.max(metrics.maxBindCount, values.length);
      for (const value of values) assert.ok(value === null || typeof value === 'string' || typeof value === 'number' || value instanceof ArrayBuffer || ArrayBuffer.isView(value), 'Unsupported D1 binding type');
      return new Statement(this.sql, values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value));
    }
    execute(mode) {
      metrics.sqlExecutions++;
      const currentRequest = requestMetrics.getStore(); if(currentRequest) currentRequest.queries++;
      sqlShapes.set(this.sql, (sqlShapes.get(this.sql) || 0) + 1);
      if (/^DELETE FROM photo_objects/.test(this.sql) && (deleteFailures.has(this.bindings[0]) || deleteFailures.has('*'))) throw new Error('Injected D1 photo deletion failure');
      const statement = sqlite.prepare(this.sql);
      if (mode === 'first') return statement.get(...this.bindings) ?? null;
      if (mode === 'all') return statement.all(...this.bindings);
      // D1 batch returns rows from SELECT and RETURNING, unlike the old helper.
      if (statement.columns().length) {
        const results = statement.all(...this.bindings);
        const mutation = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE|WITH)\b/i.test(this.sql);
        return { success: true, results, meta: { changes: mutation ? Number(row('SELECT changes() AS n').n) : 0 } };
      }
      const result = statement.run(...this.bindings);
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    }
    async first(column) {
      await boundary('before', 'first', this.sql);
      const result = this.execute('first');
      await boundary('after', 'first', this.sql);
      return column && result ? result[column] : result;
    }
    async all() {
      await boundary('before', 'all', this.sql);
      const results = this.execute('all');
      await boundary('after', 'all', this.sql);
      return { success: true, results, meta: {} };
    }
    async run() {
      await boundary('before', 'run', this.sql);
      const result = this.execute('run');
      await boundary('after', 'run', this.sql);
      return result;
    }
    async raw(options = {}) {
      const results = await this.all();
      const columns = results.results.length ? Object.keys(results.results[0]) : sqlite.prepare(this.sql).columns().map(item => item.name);
      const values = results.results.map(item => columns.map(column => item[column]));
      return options.columnNames ? [columns, ...values] : values;
    }
  }

  database = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      const sql = statements.map(statement => statement.sql).join('\n');
      await boundary('before', 'batch', sql);
      metrics.batches++;
      sqlite.exec('BEGIN IMMEDIATE');
      let result;
      try {
        result = statements.map(statement => statement.execute('run'));
        if (fault && fault.kind === 'batch' && fault.phase === 'beforeCommit' && fault.pattern.test(sql)) {
          const current = fault; fault = null; throw new Error(current.message);
        }
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      await boundary('after', 'batch', sql);
      return result;
    },
    async exec(sql) { sqlite.exec(sql); return { count: 1, duration: 0 }; },
  };

  const objects = { has: key => !!row('SELECT object_key FROM photo_objects WHERE object_key = ?', key) };
  const deleteFailures = new Set();
  const bootstrapToken = randomToken();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('No network permitted in the integration harness'); };
  const env = {
    DB: database,
    ASSETS: { async fetch(request) { metrics.assetsCalls++; return new Response('<!doctype html><title>Public app fixture</title>', { headers: { 'Content-Type': 'text/html', 'X-Fixture-Path': new URL(request.url).pathname } }); } },
    BOOTSTRAP_ACCESS_HASH: hash(bootstrapToken),
    BOOTSTRAP_ACCESS_EXPIRES_AT: String(Date.now() + 7 * 86400000),
    MAINTENANCE_LINK_KEY: randomBytes(32).toString('base64'),
    ...environment,
  };
  globalThis.__projectRoomPrivacyTest = { env };
  const selected = {
    chat: 'app/api/chat/route.ts',
    access: 'app/api/access/route.ts',
    photo: 'app/api/photos/[id]/route.ts',
    maintenance: 'app/api/maintenance/route.ts',
    maintenanceOpen: 'app/maintenance/open/route.ts',
    passkeys: 'app/api/passkeys/route.ts',
    security: 'app/api/security/route.ts',
    ...routeFiles,
  };
  const available = Object.fromEntries(Object.entries(selected).filter(([, filename]) => existsSync(path.join(site, filename))));
  const outfile = path.join(generated, 'privacy-routes-' + (++bundleSequence) + '.mjs');
  await build({
    absWorkingDir: site,
    stdin: { contents: 'export {default as worker} from "./worker/index.ts"; export * as photoStorage from "./lib/photo-storage.ts"; export * as requestContext from "./lib/request-context.ts";' , resolveDir: site, loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent',
    plugins: [{ name: 'isolated-test-boundaries', setup(builder) {
      builder.onResolve({filter:/^crypto$/},()=>({path:path.join(site,'lib/push-crypto-bridge.ts')}));
      builder.onResolve({ filter: /^cloudflare:workers$/ }, args => ({ path: args.path, namespace: 'test-boundary' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-boundary' }, () => ({ loader: 'js', contents: 'export const env = globalThis.__projectRoomPrivacyTest.env;' }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: path.join(site, args.path.slice(2) + '.ts') }));
      builder.onLoad({ filter: /\.[jt]sx?$/ }, async args => {
        if (path.relative(site,args.path).startsWith('..') || args.path.replaceAll('\\','/').includes('/node_modules/')) return;
        const contents = sourceOverrides[path.relative(site, args.path).replaceAll('\\','/')] ?? await readFile(args.path, 'utf8');
        sourceHashes[path.relative(site, args.path)] = hash(contents);
        return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' };
      });
    } }],
  });
  const routes = await import(pathToFileURL(outfile).href);
  let nextBrowser = 0;
  const browsers = [];
  function browser({ id = null, agent = 'ProjectRoom isolated test browser', cookies } = {}) {
    const instance = { id, agent, ip: '192.0.2.' + (++nextBrowser), cookies: new Map(cookies || []) };
    browsers.push(instance);
    return instance;
  }
  function captureCookies(instance, response) {
    const values = response.headers.getSetCookie?.() || [];
    for (const value of values) {
      const [pair] = value.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index), token = pair.slice(index + 1);
      if (/\bMax-Age=0(?:;|$)/i.test(value) || !token) instance.cookies.delete(name);
      else instance.cookies.set(name, token);
    }
    return values;
  }
  async function request(instance, route, { method = 'GET', pathname, query = {}, body, headers = {}, capture = true, expectedUser = instance?.id } = {}) {

    let requestPath = pathname || '/' + available[route].replace(/^app\//, '').replace(/\/route\.ts$/, '');
    if (route === 'photo') requestPath = pathname || '/api/photos/' + encodeURIComponent(query.id || '');
    const url = new URL(requestPath, origin);
    for (const [key, value] of Object.entries(query)) if (key !== 'id' || route !== 'photo') url.searchParams.set(key, String(value));
    const requestHeaders = new Headers({ 'User-Agent': instance?.agent || 'Anonymous test browser', 'CF-Connecting-IP': instance?.ip || '192.0.2.250', 'Sec-Fetch-Site': 'same-origin' });
    if (instance?.cookies.size) requestHeaders.set('Cookie', Array.from(instance.cookies, ([key, value]) => key + '=' + value).join('; '));
    if (expectedUser) requestHeaders.set('X-Project-User', expectedUser);
    if (method !== 'GET' && method !== 'HEAD') requestHeaders.set('Origin', origin);
    for (const [name, value] of Object.entries(headers)) value === null ? requestHeaders.delete(name) : requestHeaders.set(name, value);
    let requestBody = body;
    if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string' && !(body instanceof Uint8Array) && !(body instanceof ReadableStream)) {
      requestHeaders.set('Content-Type', 'application/json'); requestBody = JSON.stringify(body);
    }
    const input = new Request(url, { method, headers: requestHeaders, ...(requestBody !== undefined ? { body: requestBody, ...(requestBody instanceof ReadableStream ? { duplex: 'half' } : {}) } : {}) });
    metrics.httpCalls++;
    const tracking = { queries: 0, route: requestPath, method };
    const response = await requestMetrics.run(tracking, () => routes.worker.fetch(input, env));
    metrics.maxRequestSql = Math.max(metrics.maxRequestSql, tracking.queries);
    if (tracking.queries > 50) metrics.requestSqlOver50.push(tracking);
    if (instance && capture) captureCookies(instance, response);
    return response;
  }
  function pause({ pattern, kind = 'first', phase = 'after' }) {
    assert.equal(gate, null, 'Only one deliberate SQL gate can be armed');
    let reached, release;
    const started = new Promise(resolve => { reached = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    gate = { pattern, kind, phase, reached, wait };
    return { started, release, cancel() { if (gate?.wait === wait) gate = null; release(); } };
  }
  function inject({ pattern = /.*/, kind = 'batch', phase = 'after', message = 'Injected database transport failure' } = {}) {
    assert.equal(fault, null, 'Only one deliberate database fault can be armed');
    fault = { pattern, kind, phase, message };
  }
  async function report(filename, data) {
    const summary = { ...data, node: process.version, sqlite: row('SELECT sqlite_version() AS v').v, storage: 'Actual Worker router/request context, Node SQLite D1 adapter and actual D1 photo store; real WebAuthn verifier; no network', migrations, packageVersions: { server: packageVersions['@simplewebauthn/server'], browser: packageVersions['@simplewebauthn/browser'] }, metrics, sourceHashes, limitations: ['Local Node/SQLite uses a D1 adapter and an ASSETS fixture; it is not the deployed Cloudflare platform.', 'Real cryptographic passkey verification uses a software authenticator, not a physical phone or browser enrollment.', 'These checks do not establish compliance with the Free Worker 10 ms CPU budget, live rate limits, real network behavior, or a comprehensive security audit.'] };
    await writeFile(path.join(scratch, filename), JSON.stringify(summary, null, 2) + '\n');
    return summary;
  }
  return { site, scratch, origin, routes, env, bootstrapToken, sqlite, database, photoStore: routes.photoStorage.photoStore, objects, deleteFailures, metrics, sourceHashes, migrations, browser, browsers, request, captureCookies, row, rows, run, count, pause, inject, sqlShapes, report,
    close() { void rm(generated, {recursive: true, force: true}); sqlite.close(); globalThis.fetch = originalFetch; delete globalThis.__projectRoomPrivacyTest; } };
}
