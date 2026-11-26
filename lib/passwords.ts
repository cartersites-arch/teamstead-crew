import { headers } from './request-context';
import { db } from './chat-db';
import { fail } from './app-errors';
import { currentSession, newToken, tokenHash, toBase64url, fromBase64url, sessionCookie, deviceLabel, SESSION_AGE, RECENT_AGE } from './access';

// Password sign-in is an alternative credential alongside passkeys. A password
// is stored only as a PBKDF2-SHA256 hash (WebCrypto, available in the Workers
// runtime) in the format: pbkdf2-sha256$<iterations>$<salt>$<derived key>,
// with salt and derived key base64url-encoded. Plaintext passwords are never
// stored or logged.
const ITERATIONS = 210000;
const KEY_BITS = 256;
const FORMAT = 'pbkdf2-sha256';
// A well-formed hash of a throwaway value, used so sign-in attempts for an
// unknown email cost the same PBKDF2 work as attempts for a real account.
const DUMMY_HASH = FORMAT + '$' + ITERATIONS + '$' + 'AAAAAAAAAAAAAAAAAAAAAA' + '$' + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') fail(400, 'Enter your email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
  return email;
}
export function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) fail(400, 'Choose a password of 10 to 128 characters.');
  return value;
}
async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derive(password, salt, ITERATIONS);
  return FORMAT + '$' + ITERATIONS + '$' + toBase64url(salt) + '$' + toBase64url(derived);
}
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== FORMAT) return false;
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 1000000) return false;
  let salt: Uint8Array<ArrayBuffer>, expected: Uint8Array;
  try { salt = fromBase64url(parts[2]); expected = fromBase64url(parts[3]); } catch { return false; }
  const derived = await derive(password, salt, iterations);
  return timingSafeEqual(derived, expected);
}
async function createPasswordSession(userId: string, storedHash: string, action: string) {
  const now = Date.now(), session = newToken(), sessionHash = await tokenHash(session), sessionId = crypto.randomUUID();
  const results = await db().batch([
    db().prepare('INSERT INTO sessions (session_hash,user_id,auth_version,expires_at,id,auth_level,created_at,verified_at,last_seen_at,device_label) SELECT ?,p.id,p.auth_version,?,?,?,?,?,?,? FROM people p WHERE p.id = ? AND p.active = 1 AND p.password_hash = ?').bind(sessionHash, now + SESSION_AGE * 1000, sessionId, 'password', now, now, now, deviceLabel((await headers()).get('user-agent') || ''), userId, storedHash),
    db().prepare('INSERT INTO security_events (id,actor_id,target_id,action,at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sessions WHERE session_hash = ?)').bind(crypto.randomUUID(), userId, userId, action, now, sessionHash),
    db().prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
  ]);
  if (!results[0].meta.changes) fail(401, 'Your account changed during sign-in. Try again.');
  return { ok: true, userId, cookie: sessionCookie(session) };
}

// Sign in with email + password. Issues the same 7-day session a passkey
// sign-in issues, recorded with auth_level 'password'.
export async function passwordSignIn(data: Record<string, unknown>) {
  const email = normalizeEmail(data.email), password = validatePassword(data.password);
  const person = await db().prepare('SELECT id,password_hash FROM people WHERE lower(email) = ? AND active = 1').bind(email).first<{ id: string; password_hash: string | null }>();
  const stored = person?.password_hash || DUMMY_HASH;
  const valid = await verifyPassword(password, stored);
  if (!person?.password_hash || !valid) fail(401, 'That email or password is not correct. Check both and try again.');
  return createPasswordSession(person.id, person.password_hash, 'password_signed_in');
}

// Re-confirm the signed-in person's password, refreshing the session's
// recent-verification timestamp used by security changes (the password
// equivalent of a passkey reauth).
export async function passwordReauth(data: Record<string, unknown>) {
  const person = await currentSession();
  const password = validatePassword(data.password);
  const row = await db().prepare('SELECT password_hash FROM people WHERE id = ? AND active = 1').bind(person.id).first<{ password_hash: string | null }>();
  if (!row?.password_hash || !(await verifyPassword(password, row.password_hash))) fail(401, 'That password is not correct. Check it and try again.');
  const now = Date.now();
  await db().batch([
    db().prepare('UPDATE sessions SET verified_at = ?,last_seen_at = ? WHERE session_hash = ? AND user_id = ?').bind(now, now, person.session_hash, person.id),
    db().prepare('INSERT INTO security_events (id,actor_id,target_id,action,at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), person.id, person.id, 'password_confirmed', now),
  ]);
  return { ok: true, userId: person.id };
}

// Set or change the signed-in person's password.
// - From a setup session (personal setup/recovery link): completes enrollment
//   exactly like passkey setup does — the link is consumed, the setup session
//   is replaced with a full session, and auth_version is bumped. A recovery
//   link may reset an existing password; a first-time invite may only set a
//   password when the account has no credential yet.
// - From a full session (passkey or password): requires a recent verification,
//   matching the gate for adding another passkey.
export async function setPassword(data: Record<string, unknown>) {
  const person = await currentSession(true);
  const password = validatePassword(data.password), email = normalizeEmail(data.email);
  const clash = await db().prepare('SELECT id FROM people WHERE lower(email) = ? AND id <> ? AND active = 1').bind(email, person.id).first<{ id: string }>();
  if (clash) fail(409, 'That email is already used by another account in this workspace. Use a different email.');
  const hash = await hashPassword(password), now = Date.now();
  if (person.auth_level === 'setup') {
    const session = newToken(), sessionHash = await tokenHash(session), sessionId = crypto.randomUUID();
    const results = await db().batch([
      db().prepare('UPDATE people SET password_hash = ?, email = ?, joined_at = CASE WHEN joined_at = 0 THEN ? ELSE joined_at END, auth_version = auth_version + 1 WHERE id = ? AND active = 1 AND auth_version = ? AND EXISTS (SELECT 1 FROM access_tokens t WHERE t.token_hash = ? AND t.user_id = people.id AND t.used_at = 0 AND t.expires_at > ? AND ((people.passkey_enrolled = 0 AND people.password_hash IS NULL) OR t.purpose = ?)) AND NOT EXISTS (SELECT 1 FROM people other WHERE lower(other.email) = ? AND other.id <> people.id AND other.active = 1)').bind(hash, email, now, person.id, person.auth_version, person.setup_token_hash, now, 'recovery', email),
      db().prepare('UPDATE access_tokens SET used_at = ? WHERE token_hash = ? AND user_id = ? AND EXISTS (SELECT 1 FROM people WHERE id = ? AND password_hash = ?)').bind(now, person.setup_token_hash, person.id, person.id, hash),
      db().prepare('DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM people WHERE id = ? AND password_hash = ?)').bind(person.id, person.id, hash),
      db().prepare('DELETE FROM passkey_challenges WHERE user_id = ? AND EXISTS (SELECT 1 FROM people WHERE id = ? AND password_hash = ?)').bind(person.id, person.id, hash),
      db().prepare('INSERT INTO sessions (session_hash,user_id,auth_version,expires_at,id,auth_level,created_at,verified_at,last_seen_at,device_label) SELECT ?,p.id,p.auth_version,?,?,?,?,?,?,? FROM people p WHERE p.id = ? AND p.active = 1 AND p.password_hash = ?').bind(sessionHash, now + SESSION_AGE * 1000, sessionId, 'password', now, now, now, deviceLabel((await headers()).get('user-agent') || ''), person.id, hash),
      db().prepare('INSERT INTO security_events (id,actor_id,target_id,action,at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sessions WHERE session_hash = ?)').bind(crypto.randomUUID(), person.id, person.id, 'password_setup_completed', now, sessionHash),
    ]);
    if (!results[0].meta.changes || !results[4].meta.changes) fail(401, 'Your setup or account changed. Sign in with your passkey or password, or ask for a new setup link.');
    return { ok: true, userId: person.id, cookie: sessionCookie(session) };
  }
  if (person.verified_at < Date.now() - RECENT_AGE) fail(428, 'Confirm your passkey or password before setting a password.');
  const existing = await db().prepare('SELECT password_hash FROM people WHERE id = ? AND active = 1 AND auth_version = ?').bind(person.id, person.auth_version).first<{ password_hash: string | null }>();
  if (!existing) fail(401, 'Your account changed. Start again.');
  const results = await db().batch([
    db().prepare('UPDATE people SET password_hash = ?, email = ? WHERE id = ? AND active = 1 AND auth_version = ? AND NOT EXISTS (SELECT 1 FROM people other WHERE lower(other.email) = ? AND other.id <> people.id AND other.active = 1)').bind(hash, email, person.id, person.auth_version, email),
    db().prepare('INSERT INTO security_events (id,actor_id,target_id,action,at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM people WHERE id = ? AND password_hash = ?)').bind(crypto.randomUUID(), person.id, person.id, existing.password_hash ? 'password_changed' : 'password_added', now, person.id, hash),
  ]);
  if (!results[0].meta.changes) fail(409, 'Your account changed, or that email is used by another account. Start again.');
  return { ok: true, userId: person.id };
}
