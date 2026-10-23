// Local-only checks. Requires the project's existing TypeScript dependency.
// Run: node qa/independent-client-checks.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const checks = [];
async function check(name, run) {
  try { await run(); checks.push({ name, status: 'passed' }); }
  catch (error) { checks.push({ name, status: 'failed', error: error.message }); throw error; }
}

async function photoChecks() {
  const code = ts.transpileModule(read('lib/prepare-photo.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let config, created, revoked, attempts, paints, delayedImages, delayedBlobs;
  const reset = (extra = {}) => { config = { width: 4000, height: 3000, size: (w, h, q) => Math.ceil(w * h * q), ...extra }; created = []; revoked = []; attempts = []; paints = []; delayedImages = []; delayedBlobs = []; };
  class MockImage {
    naturalWidth = 0; naturalHeight = 0;
    set src(value) {
      if (!value) return;
      const done = () => { if (config.decodeError) { this.onerror?.(); return; } this.naturalWidth = config.width; this.naturalHeight = config.height; this.onload?.(); };
      if (config.deferImage) delayedImages.push(done); else queueMicrotask(done);
    }
  }
  const context = { exports: {}, File, Blob, TextDecoder, DOMException, Image: MockImage, URL: { createObjectURL() { const url = 'blob:' + created.length; created.push(url); return url; }, revokeObjectURL(url) { revoked.push(url); } }, document: { createElement() {
    const canvas = { width: 0, height: 0, getContext() { if (config.noContext) return null; return { fillStyle: '', fillRect() { paints.push(['fill', this.fillStyle, canvas.width, canvas.height]); }, drawImage() { paints.push(['draw', canvas.width, canvas.height]); } }; }, toBlob(callback, type, quality) { attempts.push([canvas.width, canvas.height, quality]); const blob = config.nullBlob ? null : new Blob([new Uint8Array(config.size(canvas.width, canvas.height, quality))], { type }); const done = () => callback(blob); if (config.deferBlob) delayedBlobs.push(done); else queueMicrotask(done); } }; return canvas;
  } } };
  vm.runInNewContext(code, context);
  const { preparePhoto, MAX_PHOTO_BYTES } = context.exports;
  const photo = (type = 'image/png', size = 1000) => new File([new Uint8Array(size)], 'camera.' + type.split('/')[1], { type, lastModified: 123 });
  const gif = (size = 40) => new File(['GIF89a', new Uint8Array(size - 6)], 'animation.gif', { type: 'image/gif' });
  const clean = () => assert.deepEqual(revoked, created);
  await check('photo.quality_and_shrink_loops_512k_1600px_white_background', async () => { reset(); const result = await preparePhoto(photo('image/png', 5 * 1024 * 1024)); assert(result.size <= MAX_PHOTO_BYTES); assert.equal(result.type, 'image/jpeg'); assert.equal(result.name, 'camera.jpg'); assert(attempts.length > 4); assert(attempts.every(([w, h]) => w <= 1600 && h <= 1600)); assert.equal(paints[0][1], '#ffffff'); assert(paints.every((row, index) => row[0] === (index % 2 ? 'draw' : 'fill'))); clean(); });
  await check('photo.small_jpeg_reencoded', async () => { reset({ width: 320, height: 200, size: () => 200 }); const original = photo('image/jpeg', 300); assert.notEqual(await preparePhoto(original), original); clean(); });
  await check('photo.small_valid_gif_kept_without_flattening', async () => { reset(); const original = gif(); assert.equal(await preparePhoto(original), original); assert.equal(attempts.length, 0); clean(); });
  for (const [name, file, pattern] of [['large_gif', gif(MAX_PHOTO_BYTES + 1), /GIFs must already/], ['over_5mb', photo('image/png', 5 * 1024 * 1024 + 1), /5 MB/], ['unsupported_type', photo('image/svg+xml'), /Choose JPG/], ['empty_file', photo('image/png', 0), /empty/], ['false_gif_signature', photo('image/gif'), /valid GIF/]]) await check('photo.reject_' + name, async () => { reset(); await assert.rejects(preparePhoto(file), pattern); assert.equal(created.length, 0); });
  await check('photo.decode_failure_releases_object_url', async () => { reset({ decodeError: true }); await assert.rejects(preparePhoto(photo()), /could not be opened/); clean(); });
  await check('photo.missing_canvas_releases_object_url', async () => { reset({ noContext: true }); await assert.rejects(preparePhoto(photo()), /another browser/); clean(); });
  await check('photo.encoder_failure_releases_object_url', async () => { reset({ nullBlob: true }); await assert.rejects(preparePhoto(photo()), /could not prepare/); clean(); });
  await check('photo.uncompressible_output_rejected_after_bounded_attempts', async () => { reset({ size: () => MAX_PHOTO_BYTES + 1 }); await assert.rejects(preparePhoto(photo()), /512 KB upload limit/); assert.equal(attempts.length, 36); clean(); });
  await check('photo.cancel_before_start', async () => { reset(); const controller = new AbortController(); controller.abort(); await assert.rejects(preparePhoto(photo(), controller.signal), { name: 'AbortError' }); assert.equal(created.length, 0); });
  await check('photo.cancel_during_decode_releases_object_url', async () => { reset({ deferImage: true }); const controller = new AbortController(), result = preparePhoto(photo(), controller.signal); controller.abort(); await assert.rejects(result, { name: 'AbortError' }); clean(); });
  await check('photo.cancel_during_encode_releases_object_url', async () => { reset({ deferBlob: true }); const controller = new AbortController(), result = preparePhoto(photo(), controller.signal); await tick(); assert.equal(delayedBlobs.length, 1); controller.abort(); await assert.rejects(result, { name: 'AbortError' }); delayedBlobs[0](); clean(); });
}

async function workerChecks() {
  const workerSource = read('public/sw.js'), offline = read('public/offline.html');
  const handlers = {}, store = new Map(), writes = [], fetches = [], deleted = [];
  let failNetwork = false, badOffline = false, pending;
  const cache = { async put(key, response) { writes.push(key); store.set(key, response); }, async match(key) { return store.get(key)?.clone(); } };
  const self = { location: { origin: 'https://project.example' }, addEventListener(name, fn) { handlers[name] = fn; }, async skipWaiting() {}, clients: { async claim() {} } };
  vm.runInNewContext(workerSource, { self, URL, Response, AbortSignal, caches: { async open() { return cache; }, async keys() { return ['project-room-offline-v0', 'project-room-offline-v1', 'unrelated']; }, async delete(key) { deleted.push(key); } }, async fetch(input, options) { fetches.push([input, options]); if (input === '/offline.html') return new Response(badOffline ? 'PRIVATE HTML' : offline); if (failNetwork) throw Error('offline'); return new Response('PRIVATE APP RESPONSE'); } });
  await check('service_worker.install_caches_only_generic_page_without_credentials', async () => { handlers.install({ waitUntil(p) { pending = p; } }); await pending; assert.deepEqual(writes, []); assert.equal(fetches.length, 0); });
  await check('service_worker.activation_only_removes_old_owned_cache', async () => { handlers.activate({ waitUntil(p) { pending = p; } }); await pending; assert.deepEqual(deleted, ['project-room-offline-v0']); assert.deepEqual(writes, ['/offline.html']); assert.equal(fetches[0][1].credentials, 'omit'); assert.equal(fetches[0][1].redirect, 'error'); });
  const fire = request => { let response; handlers.fetch({ request, respondWith(value) { response = value; } }); return response; };
  const navigation = { method: 'GET', mode: 'navigate', url: 'https://project.example/?private=ignored' };
  await check('service_worker.navigation_never_caches_private_response', async () => { assert.equal(await (await fire(navigation)).text(), 'PRIVATE APP RESPONSE'); assert.equal(fetches.at(-1)[1].cache, 'no-store'); assert.deepEqual(writes, ['/offline.html']); });
  await check('service_worker.offline_navigation_uses_generic_fallback', async () => { failNetwork = true; assert((await (await fire(navigation)).text()).includes('project-room-offline')); assert.deepEqual(writes, ['/offline.html']); });
  await check('service_worker.api_photos_post_subresources_cross_origin_bypass', () => { for (const request of [{ ...navigation, url: 'https://project.example/api/chat' }, { ...navigation, url: 'https://project.example/api/photos/secret' }, { ...navigation, mode: 'cors' }, { ...navigation, method: 'POST' }, { ...navigation, url: 'https://other.example/' }]) assert.equal(fire(request), undefined); });
  await check('service_worker.refuses_non_generic_offline_response', async () => { badOffline = true; handlers.activate({ waitUntil(p) { pending = p; } }); await pending; assert.deepEqual(writes, ['/offline.html']); });
  await check('service_worker.has_no_background_send_handlers', () => assert.equal(handlers.sync, undefined));
}

async function composerChecks() {
  const source = read('app/chat-app.tsx');
  const component = source.slice(source.indexOf('function Composer('), source.indexOf('\nfunction ChannelDialog('));
  const code = ts.transpileModule(component + '\nexports.Composer=Composer;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const sample = (name = 'photo.jpg') => new File([new Uint8Array(200)], name, { type: 'image/jpeg' });
  function harness() {
    const refs = [], effects = [], storage = new Map(), jobs = [], sends = []; let refIndex = 0, stateIndex = 0, effectIndex = 0, queued = [], tree; const states=[];
    const cache = { current: {} };
    class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
    const context = { exports: {}, File, FormData, AbortController, crypto, MAX_PHOTO_INPUT_BYTES: 5 * 1024 * 1024, ApiError, errorText: e => e.message, React: { createElement(type, props, ...children) { return { type, props: { ...props, children } }; } }, sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, useState(value) { const index=stateIndex++; if(!(index in states))states[index]=value; return [states[index],next=>{states[index]=typeof next==='function'?next(states[index]):next;}]; }, requestAnimationFrame(fn){fn();}, Avatar: 'Avatar', useRef(value) { return refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }); }, useEffect(fn, deps) { const index = effectIndex++, previous = effects[index]; if (!previous || deps.some((v, i) => v !== previous.deps[i])) queued.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: fn() }; }); }, preparePhoto(file, signal) { return new Promise((resolve, reject) => jobs.push({ file, signal, resolve, reject })); } };
    for (const name of ['ImageIcon', 'X', 'Paperclip', 'DropdownMenu', 'DropdownMenuTrigger', 'Smile', 'DropdownMenuContent', 'Loader2', 'Send', 'CheckCheck', 'RefreshCw']) context[name] = name;
    vm.runInNewContext(code, context);
    let props = { userId: 'A', roomId: 'one', label: 'room', draftCache: cache, onDraftChange() {}, connected: true, onSend(form) { return new Promise((resolve, reject) => sends.push({ form, resolve, reject })); } };
    function render(update = {}) { props = { ...props, ...update }; refIndex = 0; stateIndex=0; effectIndex = 0; queued = []; tree = context.exports.Composer(props); for (const effect of queued) effect(); return tree; }
    function all(node = tree, result = []) { if (node && typeof node === 'object') { result.push(node); for (const child of node.props?.children || []) { if (Array.isArray(child)) child.forEach(value => all(value, result)); else all(child, result); } } return result; }
    const find = predicate => { const result = all().find(predicate); assert(result, 'Expected rendered control'); return result; };
    const key = () => `project-room:draft:${props.userId}:${props.roomId}:main`;
    const draft = () => cache.current[key()];
    const select = files => find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files, value: 'chosen' } });
    const submit = () => find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    const edit = value => find(n => n.type === 'textarea').props.onChange({ target: { value, selectionStart:value.length } });
    const unmount = () => effects.forEach(effect => effect.cleanup?.());
    render(); return { render, find, draft, select, submit, edit, unmount, key, cache, jobs, sends, storage, ApiError };
  }
  await check('composer.processing_blocks_stale_edits_removal_send_and_additional_files', async () => { const h = harness(); h.edit('Keep this draft'); h.draft().files.push(sample('existing.jpg')); h.render(); const staleText = h.find(n => n.type === 'textarea'), staleRemove = h.find(n => n.props?.['aria-label'] === 'Remove existing.jpg'); h.select([sample('new.jpg')]); assert.equal(h.draft().preparing, true); staleText.props.onChange({ target: { value: 'bad stale edit' } }); staleRemove.props.onClick(); await h.submit(); h.select([sample('second.jpg')]); assert.equal(h.jobs.length, 1); assert.equal(h.sends.length, 0); assert.equal(h.draft().body, 'Keep this draft'); assert.equal(h.draft().files.length, 1); h.render(); assert(h.find(n => n.type === 'textarea').props.disabled); assert(h.find(n => n.type === 'input').props.disabled); assert(h.find(n => n.props?.className === 'send-button').props.disabled); h.jobs[0].resolve(sample('prepared.jpg')); await tick(); assert.equal(h.draft().files.length, 2); assert.equal(h.draft().preparing, false); assert.equal(h.sends.length, 0); assert.deepEqual(Object.keys(JSON.parse(h.storage.get(h.key()))).sort(), ['body', 'hadPhotos', 'nonce', 'pending']); });
  for (const [name, update] of [['room', { roomId: 'two' }], ['account', { userId: 'B' }]]) await check('composer.' + name + '_switch_invalidates_pending_photos', async () => { const h = harness(); h.edit('Original draft'); const oldKey = h.key(); h.select([sample()]); h.render(update); assert.equal(h.jobs[0].signal.aborted, true); h.jobs[0].resolve(sample()); await tick(); assert.equal(h.draft().files.length, 0); assert.equal(h.cache.current[oldKey].files.length, 0); assert.equal(h.cache.current[oldKey].body, 'Original draft'); assert.equal(h.cache.current[oldKey].preparing, false); });
  await check('composer.unmount_invalidates_pending_photos', async () => { const h = harness(); h.edit('Keep on return'); h.select([sample()]); h.unmount(); assert(h.jobs[0].signal.aborted); h.jobs[0].resolve(sample()); await tick(); assert.equal(h.draft().files.length, 0); assert.equal(h.draft().preparing, false); assert.equal(h.draft().body, 'Keep on return'); });
  await check('composer.programmatic_draft_edit_invalidates_pending_photos', async () => { const h = harness(); h.edit('Before'); h.select([sample()]); h.render({ hint: 'Appended', onHintUsed() {} }); assert(h.jobs[0].signal.aborted); h.jobs[0].resolve(sample()); await tick(); assert.equal(h.draft().body, 'Before\nAppended'); assert.equal(h.draft().files.length, 0); assert.equal(h.draft().preparing, false); });
  await check('composer.failed_batch_preserves_existing_text_and_photos_atomically', async () => { const h = harness(); h.edit('Safe text'); h.draft().files.push(sample('existing.jpg')); h.render(); h.select([sample('first.jpg'), sample('bad.jpg')]); h.jobs[0].resolve(sample('prepared.jpg')); await tick(); assert.equal(h.jobs.length, 2); h.jobs[1].reject(Error('Photo invalid')); await tick(); assert.equal(h.draft().body, 'Safe text'); assert.equal(h.draft().files.length, 1); assert.equal(h.draft().files[0].name, 'existing.jpg'); assert.equal(h.draft().preparing, false); assert.equal(h.draft().error, 'Photo invalid'); });
  await check('composer.only_explicit_send_and_same_nonce_retry_send', async () => { const h = harness(); h.edit('Only send on purpose'); h.select([sample()]); h.jobs[0].resolve(sample('prepared.jpg')); await tick(); assert.equal(h.sends.length, 0); h.render(); const first = h.submit(); assert.equal(h.sends.length, 1); const nonce = h.sends[0].form.get('id'); h.sends[0].reject(Error('Connection lost')); await first; assert.equal(h.draft().pending, true); assert.equal(h.draft().files.length, 1); assert.equal(h.draft().body, 'Only send on purpose'); await tick(); assert.equal(h.sends.length, 1); h.render(); const retry = h.submit(); assert.equal(h.sends.length, 2); assert.equal(h.sends[1].form.get('id'), nonce); h.sends[1].resolve(); await retry; assert.equal(h.draft().body, ''); assert.equal(h.draft().files.length, 0); assert.equal(h.draft().pending, false); });
  await check('composer.mention_picker_selects_member_without_sending',()=>{const h=harness();h.render({members:[{id:'B',name:'Derek Bowen'}]});h.edit('Hello @De');h.render();const choice=h.find(n=>n.props?.role==='option');choice.props.onClick();assert.equal(h.draft().body,'Hello @Derek Bowen ');assert.equal(h.sends.length,0);});
  await check('composer.pdf_keeps_bytes_and_rejects_oversize',async()=>{const h=harness();const pdf=new File(['%PDF-1.4'],'manual.pdf',{type:'application/pdf'});h.select([pdf]);await tick();assert.equal(h.jobs.length,0);assert.equal(h.draft().files[0],pdf);assert.equal(h.sends.length,0);h.select([new File([new Uint8Array(512*1024+1)],'big.pdf',{type:'application/pdf'})]);assert.match(h.draft().error,/PDFs of 512 KB/);assert.equal(h.draft().files.length,1);});
  await check('composer.rejects_over_three_photos_and_over_5mb_originals', () => { const h = harness(); h.edit('Keep'); h.select([sample(), sample(), sample(), sample()]); assert.equal(h.jobs.length, 0); assert.match(h.draft().error, /up to 3/); assert.equal(h.draft().body, 'Keep'); h.select([new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' })]); assert.equal(h.jobs.length, 0); assert.match(h.draft().error, /5 MB/); });
}

let failed;
try {
  await photoChecks();
  await workerChecks();
  await composerChecks();
  await check('install.manifest_and_icon_references', () => { const manifest = JSON.parse(read('public/manifest.webmanifest')); assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/'); assert(manifest.icons.length); for (const icon of manifest.icons) assert(fs.existsSync(path.join(root, 'public', icon.src))); const html = read('index.html'); assert(html.includes('/manifest.webmanifest')); assert(html.includes('/app-icon.svg')); });
  await check('typescript.no_emit', () => { const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--incremental', 'false', '--pretty', 'false'], { cwd: root, encoding: 'utf8' }); if (result.error) throw result.error; assert.equal(result.status, 0, (result.stdout + result.stderr).trim()); });
} catch (error) { failed = error; }
const sourceFiles = ['lib/prepare-photo.ts', 'app/chat-app.tsx', 'public/manifest.webmanifest', 'public/sw.js', 'public/offline.html', 'public/app-icon.svg', 'index.html', 'qa/independent-client-checks.mjs'];
const report = {
  schemaVersion: 1,
  suite: 'independent-client',
  status: failed ? 'failed' : 'passed',
  checkedAt: new Date().toISOString(),
  runtime: { node: process.version, typescript: ts.version },
  command: 'node qa/independent-client-checks.mjs',
  networkUsed: false,
  cloudflareCommandsRun: false,
  checks,
  sourceHashes: Object.fromEntries(sourceFiles.map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')])),
  limitations: [
    'Image decoding and canvas encoding use mocked browser APIs; real image fidelity, orientation, performance and native codec behavior have not been exercised.',
    'Composer checks invoke transpiled handlers with a minimal hook/element harness; these are not real React DOM, browser rendering or physical-device tests.',
    'Service-worker fetch/cache/lifecycle use in-memory mocks; installation, offline browser behavior and platform icon support have not been tested on actual devices.',
    'No native passkey, Cloudflare account, deployment, remote migration, billing or network checks run in this suite.'
  ]
};
fs.writeFileSync(path.join(root, 'qa/independent-client-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, passed: checks.filter(c => c.status === 'passed').length, failed: checks.filter(c => c.status === 'failed').length, report: 'qa/independent-client-results.json' }));
if (failed) { console.error(failed.message); process.exitCode = 1; }
