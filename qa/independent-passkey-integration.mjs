import assert from 'node:assert/strict';
import { workerCases } from './independent-worker-cases.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHarness, hash, randomToken } from './independent-passkey-test-runtime.mjs';
import { SoftwareAuthenticator } from './independent-software-authenticator.mjs';

// Pure local integration: test fixtures only; the harness rejects outbound fetches.
const origin = 'https://project-room.test';
const h = await createHarness({ origin, environment: { WEBAUTHN_RP_ID: 'project-room.test', WEBAUTHN_ORIGIN: origin } });
const results = [];
let assertions = 0;
const eq = (actual, expected, why = '') => { assertions++; assert.equal(actual, expected, why); };
const ok = (actual, why = '') => { assertions++; assert.ok(actual, why); };
const same = (actual, expected, why = '') => { assertions++; assert.deepEqual(actual, expected, why); };
const SESSION = '__Host-project_room_session';
const CHALLENGE = '__Host-project_room_challenge';
const devices = new Map();
let owner, ownerKey, derek, derekKey, third, thirdKey, dmId;

async function json(response, expected = 200) {
  let body; try { body = await response.json(); } catch { body = {}; }
  eq(response.status, expected, 'HTTP ' + response.status + ': ' + (body.error || 'unexpected response'));
  return body;
}
async function status(browser) { return json(await h.request(browser, 'access')); }
const post = (browser, route, body, extra = {}) => h.request(browser, route, { method: 'POST', body, ...extra });
const access = (browser, body, extra = {}) => post(browser, 'access', body, extra);
const pass = (browser, body, extra = {}) => post(browser, 'passkeys', body, extra);
const security = (browser, body, extra = {}) => body === undefined ? h.request(browser, 'security', extra) : post(browser, 'security', body, extra);
const chat = (browser, body, extra = {}) => body === undefined ? h.request(browser, 'chat', extra) : post(browser, 'chat', body, extra);
const sessionHash = browser => hash(browser.cookies.get(SESSION) || '');
const currentSessionRow = browser => h.row('SELECT * FROM sessions WHERE session_hash = ?', sessionHash(browser));
const newDevice = () => new SoftwareAuthenticator({ origin });

async function setup(token, browser = h.browser()) {
  await json(await access(browser, { action: 'login', token }));
  const state = await status(browser); eq(state.level, 'setup'); browser.id = state.user.id;
  return browser;
}
async function registerOptions(browser) { return json(await pass(browser, { action: 'register_options' })); }
async function authOptions(browser, reauth = false) { return json(await pass(browser, { action: 'auth_options', ...(reauth ? { purpose: 'reauth' } : {}) })); }
function registrationBody(options, device, overrides = {}) { return { action: 'register_verify', challengeId: options.challengeId, response: device.register(options.options, overrides), name: 'Fixture passkey' }; }
function authenticationBody(options, device, overrides = {}, reauth = false) { return { action: 'auth_verify', challengeId: options.challengeId, response: device.authenticate(options.options, overrides), ...(reauth ? { purpose: 'reauth' } : {}) }; }
async function enroll(browser, device = newDevice()) {
  const options = await registerOptions(browser);
  const result = await json(await pass(browser, registrationBody(options, device)));
  eq(result.userId, browser.id); eq((await status(browser)).level, 'passkey'); devices.set(browser.id, device);
  return device;
}
async function login(device, browser = h.browser()) {
  const options = await authOptions(browser);
  const result = await json(await pass(browser, authenticationBody(options, device)));
  browser.id = result.userId; eq((await status(browser)).level, 'passkey'); return browser;
}
async function reauth(browser, device) {
  const options = await authOptions(browser, true);
  await json(await pass(browser, authenticationBody(options, device, {}, true)));
}
async function invitation(name) { return json(await access(owner, { action: 'create_member', name, roomIds: ['room-general'], role: 'owner', email: 'untrusted@example.test' }), 201); }
async function person(name) {
  const invite = await invitation(name), browser = await setup(invite.token), key = await enroll(browser);
  return { invite, browser, key };
}
async function test(name, fn, critical = false) {
  const started = performance.now(), before = assertions;
  try { await fn(); results.push({ name, status: 'PASS', assertions: assertions - before, milliseconds: Math.round(performance.now() - started) }); }
  catch (error) {
    results.push({ name, status: 'FAIL', assertions: assertions - before, error: error.stack });
    process.stdout.write('FAIL ' + name + '\n' + error.stack + '\n');
    if (critical) throw error;
    return;
  }
  process.stdout.write('PASS ' + name + ' (' + (assertions - before) + ' assertions)\n');
}
async function reached(gate) {
  let timer;
  try { await Promise.race([gate.started, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SQL race gate was not reached')), 8000); })]); }
  catch (error) { gate.cancel(); throw error; }
  finally { clearTimeout(timer); }
}
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
async function sendPhoto(browser, roomId = dmId, body = 'Private fixture photo') {
  const id = crypto.randomUUID(), form = new FormData();
  form.set('id', id); form.set('roomId', roomId); form.set('body', body); form.append('files', new File([png], 'fixture.png', { type: 'image/png' }));
  await json(await post(browser, 'chat', form), 201);
  return { id, attachment: h.row('SELECT * FROM attachments WHERE message_id = ?', id) };
}

try {
  await test('Bootstrap expiry, inspection and setup-only scope fail closed', async () => {
    const anonymous = h.browser(); eq((await status(anonymous)).level, 'signed_out');
    await json(await access(anonymous, { action: 'inspect_link', token: randomToken() }), 401); eq(h.count('workspace'), 0);
    const expiry = h.env.BOOTSTRAP_ACCESS_EXPIRES_AT; h.env.BOOTSTRAP_ACCESS_EXPIRES_AT = '0';
    try { await json(await access(anonymous, { action: 'login', token: h.bootstrapToken }), 401); eq(h.count('workspace'), 0); }
    finally { h.env.BOOTSTRAP_ACCESS_EXPIRES_AT = expiry; }
    const preview = await json(await access(anonymous, { action: 'inspect_link', token: h.bootstrapToken }));
    eq(preview.mode, 'enroll'); eq(h.count('sessions'), 0); eq(h.count('workspace'), 0);
    owner = await setup(h.bootstrapToken); eq(owner.id, 'owner');
    const cookie = owner.cookies.get(SESSION); ok(cookie && cookie.length === 43); eq(currentSessionRow(owner).auth_level, 'setup');
    for (const route of ['chat', 'security', 'maintenance', 'photo']) await json(await h.request(owner, route, route === 'photo' ? { query: { id: 'missing' } } : {}), 401);
    await json(await chat(owner, { action: 'create_channel', name: 'forbidden' }), 401);
    await json(await access(owner, { action: 'create_member', name: 'Forbidden' }), 401);
    await json(await security(owner, { action: 'ai_permission', enabled: false }), 401);
    const redirect = await h.request(owner, 'maintenanceOpen'); eq(redirect.status, 303); eq(redirect.headers.get('Location'), '/?section=maintenance');
  }, true);

  await test('Registration requires correct origin, RP, challenge, ceremony, presence and verification', async () => {
    const variants = [{ origin: 'https://other.test' }, { rpId: 'other.test' }, { challenge: randomToken() }, { type: 'webauthn.get' }, { uv: false }, { up: false }];
    for (const variant of variants) {
      const options = await registerOptions(owner);
      eq(options.options.rp.id, 'project-room.test'); eq(options.options.authenticatorSelection.userVerification, 'required'); eq(options.options.authenticatorSelection.residentKey, 'required');
      const body = registrationBody(options, newDevice(), variant);
      await json(await pass(owner, body), 400); eq(h.count('passkeys'), 0); eq(h.count('passkey_challenges', 'id = ?', options.challengeId), 0);
      await json(await pass(owner, body), 400);
    }
    const oldSetup = h.browser({ id: owner.id, cookies: owner.cookies });
    ownerKey = await enroll(owner); eq(h.count('passkeys', 'user_id = ?', owner.id), 1); eq(h.row('SELECT passkey_enrolled FROM people WHERE id = ?', owner.id).passkey_enrolled, 1);
    eq((await status(oldSetup)).level, 'signed_out'); await json(await chat(oldSetup), 401);
    eq((await json(await access(h.browser(), { action: 'inspect_link', token: h.bootstrapToken }))).mode, 'passkey');
    await json(await access(h.browser(), { action: 'login', token: h.bootstrapToken }), 401);
    eq(h.count('sessions', 'auth_level = ?', 'setup'), 0);
  }, true);

  await test('Legacy cookies, tampering, expiry and stale viewer headers do not authenticate', async () => {
    const actor = h.row('SELECT auth_version FROM people WHERE id = ?', owner.id), token = randomToken(), legacy = h.browser({ id: owner.id });
    legacy.cookies.set(SESSION, token);
    h.run('INSERT INTO sessions (session_hash,user_id,auth_version,expires_at,id,auth_level) VALUES (?,?,?,?,?,?)', hash(token), owner.id, actor.auth_version, Date.now() + 60000, crypto.randomUUID(), 'legacy');
    eq((await status(legacy)).level, 'signed_out'); await json(await chat(legacy), 401);
    const tampered = h.browser({ id: owner.id, cookies: owner.cookies }); tampered.cookies.set(SESSION, randomToken()); await json(await chat(tampered), 401);
    h.run('UPDATE sessions SET auth_level = ?,expires_at = 0 WHERE session_hash = ?', 'passkey', hash(token)); await json(await chat(legacy), 401);
    await json(await chat(owner, undefined, { expectedUser: 'another-person' }), 401); await json(await chat(owner));
    await json(await access(owner, { action: 'logout' }, { expectedUser: 'another-person' }), 401); await json(await chat(owner));
    await json(await chat(h.browser(), undefined, { headers: { 'X-OpenAI-User-Id': owner.id, 'X-OpenAI-User-Email': 'owner@example.test' } }), 401);
  });

  await test('Real discoverable authentication stores verified session state without exposing credentials', async () => {
    const browser = h.browser(), options = await authOptions(browser); eq(options.options.userVerification, 'required'); same(options.options.allowCredentials, []);
    const body = { ...authenticationBody(options, ownerKey), userId: 'untrusted-selected-user' };
    const response = await pass(browser, body), cookies = response.headers.getSetCookie();
    const data = await json(response); eq(data.userId, owner.id); browser.id = data.userId;
    ok(cookies.some(value => value.includes('HttpOnly') && value.includes('Secure') && value.includes('SameSite=Lax') && value.includes('Max-Age=604800')));
    eq(currentSessionRow(browser).auth_level, 'passkey'); ok(currentSessionRow(browser).verified_at > 0);
    const key = h.row('SELECT * FROM passkeys WHERE id = ?', ownerKey.id); eq(key.public_key, Buffer.from(ownerKey.publicKey).toString('base64url')); eq(key.counter, ownerKey.counter);
    const settings = await json(await security(browser));
    for (const entry of settings.keys) { ok(!('public_key' in entry)); ok(!('webauthn_user_id' in entry)); }
    for (const entry of settings.sessions) { ok(!('session_hash' in entry)); ok(!('setup_token_hash' in entry)); }
    const payload = JSON.stringify(settings); ok(!payload.includes(h.bootstrapToken)); ok(!payload.includes(browser.cookies.get(SESSION))); ok(!payload.includes(key.public_key));
  });

  await test('Authentication rejects wrong origin/RP/challenge/signature/UV/userHandle and consumes failed challenges', async () => {
    const browser = h.browser(), initialSessions = h.count('sessions'), initialCounter = h.row('SELECT counter FROM passkeys WHERE id = ?', ownerKey.id).counter;
    const variants = [
      [{ origin: 'https://other.test' }, 400], [{ rpId: 'other.test' }, 400], [{ challenge: randomToken() }, 400],
      [{ type: 'webauthn.create' }, 400], [{ signatureTamper: true }, 400], [{ uv: false }, 400], [{ up: false }, 400],
      [{ userHandle: randomToken() }, 401], [{ userHandle: null }, 401], [{ credentialId: randomToken() }, 401],
    ];
    for (const [variant, expected] of variants) {
      const options = await authOptions(browser), body = authenticationBody(options, ownerKey, variant);
      await json(await pass(browser, body), expected); eq(h.count('passkey_challenges', 'id = ?', options.challengeId), 0);
      await json(await pass(browser, body), 400);
    }
    eq(h.count('sessions'), initialSessions); eq(h.row('SELECT counter FROM passkeys WHERE id = ?', ownerKey.id).counter, initialCounter);
  });

  await test('Challenges bind browser/purpose, expire server-side and permit one concurrent completion', async () => {
    const a = h.browser(), b = h.browser(), options = await authOptions(a), body = authenticationBody(options, ownerKey);
    await authOptions(b); await json(await pass(b, body), 400); eq(h.count('passkey_challenges', 'id = ?', options.challengeId), 1);
    await json(await pass(a, body)); await json(await pass(a, body), 400);
    const expired = await authOptions(b); h.run('UPDATE passkey_challenges SET expires_at = 0 WHERE id = ?', expired.challengeId);
    await json(await pass(b, authenticationBody(expired, ownerKey)), 400);
    const wrongPurpose = await registerOptions(owner);
    await json(await pass(owner, { action: 'auth_verify', challengeId: wrongPurpose.challengeId, response: {} }), 400);
    eq(h.count('passkey_challenges', 'id = ?', wrongPurpose.challengeId), 1);
    const racing = h.browser(), concurrent = await authOptions(racing), responseBody = authenticationBody(concurrent, ownerKey), before = h.count('sessions');
    const responses = await Promise.all([pass(racing, responseBody, { capture: false }), pass(racing, responseBody, { capture: false })]);
    same(responses.map(value => value.status).sort(), [200, 400]); eq(h.count('sessions'), before + 1);
  });

  await test('Competing setup browsers can register only one initial passkey and share a stable opaque user handle', async () => {
    const invite = await invitation('Derek Test'), a = await setup(invite.token), b = await setup(invite.token), keyA = newDevice(), keyB = newDevice();
    const optionsA = await registerOptions(a), optionsB = await registerOptions(b); eq(optionsA.options.user.id, optionsB.options.user.id); ok(!optionsA.options.user.id.includes(invite.name));
    const responseA = registrationBody(optionsA, keyA), responseB = registrationBody(optionsB, keyB);
    const responses = await Promise.all([pass(a, responseA), pass(b, responseB)]), winner = responses.findIndex(value => value.status === 200);
    ok(winner >= 0); ok([400, 401].includes(responses[1 - winner].status)); eq(h.count('passkeys', 'user_id = ?', invite.id), 1);
    eq(h.count('sessions', 'user_id = ? AND auth_level = ?', invite.id, 'setup'), 0); ok(h.row('SELECT used_at FROM access_tokens WHERE user_id = ?', invite.id).used_at > 0);
    derek = winner === 0 ? a : b; derekKey = winner === 0 ? keyA : keyB; devices.set(derek.id, derekKey);
    eq((await status(derek)).level, 'passkey'); await json(await access(h.browser(), { action: 'login', token: invite.token }), 401);
    const losingBrowser = h.browser(), losingOptions = await authOptions(losingBrowser);
    await json(await pass(losingBrowser, authenticationBody(losingOptions, winner === 0 ? keyB : keyA)), 401);
    const stored = h.row('SELECT role,email FROM people WHERE id = ?', invite.id); eq(stored.role, 'member'); eq(stored.email, '');
  }, true);

  await test('Invitation expiry after setup issuance denies registration and setup status', async () => {
    const invite = await invitation('Expired Test'), browser = await setup(invite.token), options = await registerOptions(browser), key = newDevice();
    h.run('UPDATE access_tokens SET expires_at = 0 WHERE user_id = ?', invite.id);
    await json(await pass(browser, registrationBody(options, key)), 401); eq(h.count('passkeys', 'user_id = ?', invite.id), 0); eq((await status(browser)).level, 'signed_out');
    await json(await access(h.browser(), { action: 'login', token: invite.token }), 401);
  });

  await test('Reauthentication is account/session-bound and required for security changes', async () => {
    ({ browser: third, key: thirdKey } = await person('Third Test'));
    const otherOwnerSession = await login(ownerKey);
    h.run('UPDATE sessions SET verified_at = ? WHERE user_id = ?', Date.now() - 360000, owner.id);
    await json(await access(owner, { action: 'create_member', name: 'Forbidden stale action' }), 428);
    await json(await security(owner, { action: 'ai_permission', enabled: false }), 428);
    await json(await chat(owner, { action: 'create_channel', name: 'stale-permission', visibility: 'shared', memberIds: [] }), 428);
    await json(await chat(owner, { action: 'update_channel', roomId: 'room-general', name: 'general', visibility: 'shared', memberIds: [] }), 428);
    await json(await post(owner, 'maintenance', { action: 'disconnect' }), 428);
    await json(await pass(owner, { action: 'register_options' }), 428);
    const challenge = await authOptions(owner, true);
    await json(await pass(owner, authenticationBody(challenge, derekKey, {}, true)), 401);
    await reauth(owner, ownerKey);
    await json(await security(otherOwnerSession, { action: 'ai_permission', enabled: false }), 428);
    await json(await security(owner, { action: 'ai_permission', enabled: true }));
    await json(await security(third, { action: 'ai_permission', enabled: false }), 403);
    await json(await access(third, { action: 'create_member', name: 'Forbidden member action' }), 403);
  }, true);

  await test('Backup passkeys can be managed only by their person; the last passkey cannot be removed', async () => {
    await json(await security(owner, { action: 'remove_key', id: ownerKey.id }), 400);
    const backup = newDevice(), options = await registerOptions(owner); ok(options.options.excludeCredentials.some(key => key.id === ownerKey.id));
    const sessionBefore = owner.cookies.get(SESSION); await json(await pass(owner, registrationBody(options, backup))); eq(owner.cookies.get(SESSION), sessionBefore);
    eq(h.count('passkeys', 'user_id = ?', owner.id), 2);
    await json(await security(owner, { action: 'rename_key', id: derekKey.id, name: 'Not allowed' }), 404);
    await json(await security(owner, { action: 'remove_key', id: derekKey.id }), 400); eq(h.count('passkeys', 'id = ?', derekKey.id), 1);
    await json(await security(owner, { action: 'rename_key', id: backup.id, name: 'Backup fixture' }));
    await json(await security(owner, { action: 'remove_key', id: backup.id })); eq(h.count('passkeys', 'id = ?', backup.id), 0);
    await json(await security(owner, { action: 'remove_key', id: ownerKey.id }), 400);
    eq(h.row('SELECT passkey_enrolled FROM people WHERE id = ?', owner.id).passkey_enrolled, 1);
    await json(await access(owner, { action: 'reset_link', userId: owner.id, confirmRecovery: true }), 400);
  });

  await test('Device revocation is person-scoped and preserves the calling session', async () => {
    const extra = await login(ownerKey), extraId = currentSessionRow(extra).id, ownId = currentSessionRow(owner).id, derekId = currentSessionRow(derek).id;
    await json(await security(owner, { action: 'revoke_session', id: ownId }), 400);
    await json(await security(owner, { action: 'revoke_session', id: derekId })); await json(await chat(derek));
    await json(await security(owner, { action: 'revoke_session', id: extraId })); await json(await chat(extra), 401); await json(await chat(owner));
    const more = await login(ownerKey); await json(await security(owner, { action: 'revoke_other_sessions' })); await json(await chat(more), 401); await json(await chat(owner));
  });

  await test('Owner recovery racing login revokes old keys/sessions and cannot restore stale access', async () => {
    const target = await person('Recovery Test'), visitor = h.browser(), options = await authOptions(visitor), body = authenticationBody(options, target.key);
    const gate = h.pause({ pattern: /^SELECT k\.\*,p\.auth_version,p\.active FROM passkeys/ });
    const pending = pass(visitor, body); let recovered;
    try { await reached(gate); recovered = await json(await access(owner, { action: 'reset_link', userId: target.browser.id, confirmRecovery: true })); }
    finally { gate.release(); }
    await json(await pending, 401); eq(h.count('passkeys', 'user_id = ?', target.browser.id), 0); eq(h.count('sessions', 'user_id = ?', target.browser.id), 0);
    await json(await chat(target.browser), 401); await json(await access(h.browser(), { action: 'login', token: target.invite.token }), 401);
    eq(h.row('SELECT purpose FROM access_tokens WHERE user_id = ?', target.browser.id).purpose, 'recovery');
    const browser = await setup(recovered.token); await json(await h.request(browser, 'maintenance'), 401); const key = await enroll(browser);
    await json(await chat(browser)); eq(h.row('SELECT passkey_enrolled FROM people WHERE id = ?', browser.id).passkey_enrolled, 1);
    const oldOptions = await authOptions(visitor); await json(await pass(visitor, authenticationBody(oldOptions, target.key)), 401);
    const fresh = await login(key); eq(fresh.id, browser.id);
  });

  await test('Replacing recovery revokes its pending setup session and registration challenge', async () => {
    const target = await person('Replacement Recovery Test');
    const first = await json(await access(owner, { action: 'reset_link', userId: target.browser.id, confirmRecovery: true }));
    const stale = await setup(first.token), staleOptions = await registerOptions(stale), staleBody = registrationBody(staleOptions, newDevice());
    const second = await json(await access(owner, { action: 'reset_link', userId: target.browser.id, confirmRecovery: true }));
    await json(await pass(stale, staleBody), 401); await json(await access(h.browser(), { action: 'login', token: first.token }), 401);
    const current = await setup(second.token); await enroll(current); await json(await chat(current));
  });

  await test('Reset racing initial enrollment derives recovery purpose from committed account state', async () => {
    const invite = await invitation('Enrollment Reset Race'), browser = await setup(invite.token), options = await registerOptions(browser), body = registrationBody(options, newDevice());
    const gate = h.pause({ pattern: /^SELECT passkey_enrolled FROM people/ });
    const resetting = access(owner, { action: 'reset_link', userId: browser.id, confirmRecovery: true }); let recovery;
    try { await reached(gate); await json(await pass(browser, body)); }
    finally { gate.release(); }
    recovery = await json(await resetting);
    eq(h.row('SELECT purpose FROM access_tokens WHERE user_id = ?', browser.id).purpose, 'recovery');
    eq(h.row('SELECT passkey_enrolled FROM people WHERE id = ?', browser.id).passkey_enrolled, 1);
    const replacement = await setup(recovery.token); await enroll(replacement); await json(await chat(replacement));
  });

  await test('Enrollment remains recoverable after a committed response is lost; pre-commit failure grants no access', async () => {
    for (const phase of ['beforeCommit', 'after']) {
      const invite = await invitation('Enrollment Transport ' + phase), browser = await setup(invite.token), device = newDevice(), options = await registerOptions(browser);
      h.inject({ phase, kind: 'batch', pattern: /INSERT INTO passkeys/ });
      await json(await pass(browser, registrationBody(options, device)), 503);
      if (phase === 'after') {
        eq(h.count('passkeys', 'user_id = ?', browser.id), 1); eq((await status(browser)).level, 'signed_out');
        const recovered = await login(device); eq(recovered.id, browser.id); await json(await chat(recovered));
        await json(await access(h.browser(), { action: 'login', token: invite.token }), 401);
      } else {
        eq(h.count('passkeys', 'user_id = ?', browser.id), 0); eq((await status(browser)).level, 'setup');
        await enroll(browser, device); await json(await chat(browser));
      }
    }
  });

  await test('A revoked owner session cannot commit an already-started security change', async () => {
    const survivor = await login(ownerKey), victimSessionId = currentSessionRow(owner).id, beforePeople = h.count('people');
    const gate = h.pause({ pattern: /INSERT INTO people/, kind: 'batch', phase: 'before' });
    const pending = access(owner, { action: 'create_member', name: 'Must not be inserted' });
    try { await reached(gate); await json(await security(survivor, { action: 'revoke_session', id: victimSessionId })); }
    finally { gate.release(); }
    await json(await pending, 401); eq(h.count('people'), beforePeople); await json(await chat(owner), 401); owner = survivor; await json(await chat(owner));
  }, true);

  await test('Private room/DM/search/photo boundaries still hold for verified members', async () => {
    dmId = (await json(await chat(owner, { action: 'dm', userId: derek.id }))).id;
    ok(dmId, 'DM endpoint must identify its room');
    const photo = await sendPhoto(owner, dmId, 'PrivatePasskeyBoundaryFixture');
    await json(await h.request(owner, 'chat', { query: { action: 'messages', roomId: dmId } }));
    await json(await h.request(derek, 'chat', { query: { action: 'messages', roomId: dmId } }));
    await json(await h.request(third, 'chat', { query: { action: 'messages', roomId: dmId } }), 404);
    const search = await json(await h.request(third, 'chat', { query: { action: 'search', q: 'PrivatePasskeyBoundaryFixture' } })); eq(search.messages.length, 0);
    await json(await h.request(third, 'photo', { query: { id: photo.attachment.id } }), 404);
    const image = await h.request(derek, 'photo', { query: { id: photo.attachment.id } }); eq(image.status, 200); ok(image.headers.get('Cache-Control').includes('no-store'));
    await json(await chat(derek, { action: 'delete', id: photo.id }), 403);
    await json(await chat(owner, { action: 'delete', id: photo.id })); eq(h.objects.has(photo.attachment.object_key), false);
  }, true);

  await test('Message deletion removes photo bytes/metadata, blanks content and is retryable', async () => {
    const photo = await sendPhoto(owner);
    await json(await chat(derek, { action: 'react', id: photo.id, emoji: '👍', active: true }));
    const deleted = await json(await chat(owner, { action: 'delete', id: photo.id })); eq(deleted.photosPending, 0);
    eq(h.row('SELECT deleted,body FROM messages WHERE id = ?', photo.id).deleted, 1); eq(h.row('SELECT body FROM messages WHERE id = ?', photo.id).body, '');
    eq(h.count('attachments', 'message_id = ?', photo.id), 0); eq(h.count('reactions', 'message_id = ?', photo.id), 0); eq(h.objects.has(photo.attachment.object_key), false);
    await json(await h.request(derek, 'photo', { query: { id: photo.attachment.id } }), 404);
    eq((await json(await chat(owner, { action: 'delete', id: photo.id }))).photosPending, 0);
  });

  await test('Failed D1 photo cleanup remains queued, inaccessible and visible only to its requester or owner', async () => {
    const photo = await sendPhoto(derek); h.deleteFailures.add(photo.attachment.object_key);
    try {
      const deleted = await json(await chat(derek, { action: 'delete', id: photo.id })); eq(deleted.photosPending, 1); eq(h.objects.has(photo.attachment.object_key), true);
      eq(h.count('attachments', 'message_id = ?', photo.id), 0); ok(h.row('SELECT attempts FROM file_deletions WHERE object_key = ?', photo.attachment.object_key).attempts >= 1);
      await json(await h.request(derek, 'photo', { query: { id: photo.attachment.id } }), 404);
      eq((await json(await security(third))).photosPending, 0); eq((await json(await security(derek))).photosPending, 1); eq((await json(await security(owner))).photosPending, 1);
      eq((await json(await security(third, { action: 'retry_deletions' }))).photosPending, 0); eq(h.count('file_deletions', 'object_key = ?', photo.attachment.object_key), 1);
    } finally { h.deleteFailures.delete(photo.attachment.object_key); }
    eq((await json(await security(derek, { action: 'retry_deletions' }))).photosPending, 0); eq(h.objects.has(photo.attachment.object_key), false); eq(h.count('file_deletions', 'object_key = ?', photo.attachment.object_key), 0);
  });

  await test('Delete pre/post-commit transport failures preserve a correct durable cleanup state', async () => {
    for (const phase of ['beforeCommit', 'after']) {
      const photo = await sendPhoto(owner); h.inject({ phase, kind: 'batch', pattern: /INSERT OR IGNORE INTO file_deletions/ });
      await json(await chat(owner, { action: 'delete', id: photo.id }), 503);
      eq(h.objects.has(photo.attachment.object_key), true);
      eq(h.count('attachments', 'message_id = ?', photo.id), phase === 'after' ? 0 : 1);
      eq(h.count('file_deletions', 'object_key = ?', photo.attachment.object_key), phase === 'after' ? 1 : 0);
      await json(await chat(owner, { action: 'delete', id: photo.id })); eq(h.objects.has(photo.attachment.object_key), false);
    }
  });

  await test('Member removal revokes passkeys, setup grants, sessions and protected Hub access', async () => {
    const target = await person('Removed Test');
    const link = 'https://pms-company-hub.pages.dev/#hub=fixture-removal-private-credential';
    await json(await post(target.browser, 'maintenance', { action: 'connect', link }));
    const visitor = h.browser(), options = await authOptions(visitor), body = authenticationBody(options, target.key), gate = h.pause({ pattern: /^SELECT k\.\*,p\.auth_version,p\.active FROM passkeys/ });
    const pending = pass(visitor, body);
    try { await reached(gate); await json(await chat(owner, { action: 'remove_member', userId: target.browser.id })); }
    finally { gate.release(); }
    await json(await pending, 401); await json(await chat(target.browser), 401);
    for (const table of ['passkeys', 'sessions', 'access_tokens', 'passkey_challenges', 'maintenance_links', 'room_members']) eq(h.count(table, 'user_id = ?', target.browser.id), 0, table + ' must be revoked');
    eq(h.row('SELECT active FROM people WHERE id = ?', target.browser.id).active, 0);
    const redirect = await h.request(target.browser, 'maintenanceOpen', { query: { viewer: target.browser.id } }); eq(redirect.status, 303); eq(redirect.headers.get('Location'), '/?section=maintenance');
  });

  await test('Audit and session listings disclose scoped metadata, not tokens, hashes or stored Hub URLs', async () => {
    const own = await json(await security(owner)), limited = await json(await security(third));
    ok(own.events.some(event => event.action === 'account_access_reset')); ok(own.events.some(event => event.action === 'passkey_setup_completed'));
    const thirdEvents = new Set(h.rows('SELECT id FROM security_events WHERE actor_id = ? OR target_id = ?', third.id, third.id).map(event => event.id));
    for (const event of limited.events) ok(thirdEvents.has(event.id));
    for (const session of limited.sessions) ok(h.row('SELECT user_id FROM sessions WHERE id = ?', session.id).user_id === third.id);
    const serialized = JSON.stringify({ own, limited });
    for (const value of [h.bootstrapToken, h.env.MAINTENANCE_LINK_KEY, owner.cookies.get(SESSION), sessionHash(owner)]) ok(!serialized.includes(value));
    for (const field of ['session_hash', 'token_hash', 'public_key', 'webauthn_user_id', 'ciphertext', 'setup_token_hash']) ok(!serialized.includes('"' + field + '"'));
    await json(await security(owner, { action: 'ai_permission', enabled: false })); eq((await json(await security(third))).aiEnabled, false);
    await json(await security(owner, { action: 'ai_permission', enabled: true }));
  });

  await test('AI copy context enforces membership and workspace permission and omits common credential formats', async () => {
    const privateToken = randomToken(), hubToken = 'fixture-ai-secret-hub-token';
    const photo = await sendPhoto(owner, dmId, 'Safe work note. https://project-room.test/#access=' + privateToken + ' https://pms-company-hub.pages.dev/#hub=' + hubToken + ' Bearer fixtureApiCredential123 api_key=fixtureOtherCredential');
    const context = await json(await h.request(owner, 'chat', { query: { action: 'ai_context', id: photo.id } }));
    ok(context.text.includes('Safe work note.')); ok(context.redactions >= 4); ok(!context.text.includes(privateToken)); ok(!context.text.includes(hubToken)); ok(!context.text.includes('fixtureApiCredential123')); ok(!('attachments' in context));
    await json(await h.request(third, 'chat', { query: { action: 'ai_context', id: photo.id } }), 404);
    await json(await h.request(h.browser(), 'chat', { query: { action: 'ai_permission' } }), 401);
    await json(await security(owner, { action: 'ai_permission', enabled: false }));
    eq((await json(await h.request(derek, 'chat', { query: { action: 'ai_permission' } }))).enabled, false);
    await json(await h.request(owner, 'chat', { query: { action: 'ai_context', id: photo.id } }), 403);
    await json(await security(owner, { action: 'ai_permission', enabled: true }));
    await json(await chat(owner, { action: 'delete', id: photo.id }));
    await json(await h.request(owner, 'chat', { query: { action: 'ai_context', id: photo.id } }), 404);
  });

  await workerCases({h,test,eq,ok,same,json,owner,derek,third,dmId,chat,security,post,sendPhoto,reached});

  await test('Actual migration preserves owner/history, removes legacy sessions and queues earlier deleted photos', async () => {
    const legacy = new DatabaseSync(':memory:'); legacy.exec('PRAGMA foreign_keys = ON'); const now = Date.now(), originalToken = randomToken();
    try {
      for (const filename of h.migrations) {
        if (filename.startsWith('0004_')) {
          legacy.prepare('INSERT INTO workspace (id,name,owner_id,created_at,access_bootstrapped) VALUES (?,?,?,?,1)').run('main', 'Legacy Project Room', 'existing-owner-id', now);
          legacy.prepare('INSERT INTO people (id,email,name,role,active,joined_at,auth_version) VALUES (?,?,?,?,1,?,1)').run('existing-owner-id', 'legacy@example.test', 'Existing Owner', 'owner', now);
          legacy.prepare('INSERT INTO access_tokens (token_hash,user_id,created_at) VALUES (?,?,?)').run(hash(originalToken), 'existing-owner-id', now);
          legacy.prepare('INSERT INTO sessions (session_hash,user_id,auth_version,expires_at) VALUES (?,?,1,?)').run(hash(randomToken()), 'existing-owner-id', now + 86400000);
          legacy.prepare('INSERT INTO rooms (id,name,kind,visibility,created_by,created_at) VALUES (?,?,?,?,?,?)').run('legacy-room', 'Legacy room', 'channel', 'private', 'existing-owner-id', now);
          legacy.prepare('INSERT INTO messages (id,room_id,user_id,body,created_at,deleted) VALUES (?,?,?,?,?,1)').run('legacy-deleted', 'legacy-room', 'existing-owner-id', '', now);
          legacy.prepare('INSERT INTO attachments (id,message_id,object_key,name,mime,size) VALUES (?,?,?,?,?,?)').run('legacy-photo', 'legacy-deleted', 'photos/legacy-deleted', 'old.png', 'image/png', 12);
        }
        legacy.exec(await readFile(path.join(h.site, 'drizzle', filename), 'utf8'));
      }
      eq(legacy.prepare('SELECT owner_id FROM workspace').get().owner_id, 'existing-owner-id'); eq(legacy.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
      eq(legacy.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0); eq(legacy.prepare('SELECT expires_at FROM access_tokens').get().expires_at, now + 604800000);
      eq(legacy.prepare('SELECT COUNT(*) AS n FROM attachments').get().n, 0); eq(legacy.prepare('SELECT object_key FROM file_deletions').get().object_key, 'photos/legacy-deleted');
      eq(legacy.prepare('SELECT passkey_enrolled FROM people').get().passkey_enrolled, 0);
    } finally { legacy.close(); }
  });
} catch (error) {
  process.stdout.write('Stopped after a required fixture failed: ' + error.message + '\n');
} finally {
  const changedDuringRun = [];
  for (const [filename, before] of Object.entries(h.sourceHashes)) if (hash(await readFile(path.join(h.site, filename))) !== before) changedDuringRun.push(filename);
  const summary = await h.report('independent-results.json', { suite: 'Independent pilot: real WebAuthn + actual Worker/request context + SQLite-backed actual D1 photo store', groups: results.length, passed: results.filter(result => result.status === 'PASS').length, failed: results.filter(result => result.status === 'FAIL').length, assertions, changedDuringRun, results });
  process.stdout.write(JSON.stringify({ groups: summary.groups, passed: summary.passed, failed: summary.failed, assertions, metrics: summary.metrics, changedDuringRun }) + '\n');
  if (summary.failed || changedDuringRun.length) process.exitCode = 1;
  h.close();
}
