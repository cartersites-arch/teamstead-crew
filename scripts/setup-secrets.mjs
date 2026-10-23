import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';

const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const origin = new URL(config.vars.WEBAUTHN_ORIGIN);
if (origin.protocol !== 'https:' || origin.hostname !== config.vars.WEBAUTHN_RP_ID) throw new Error('Configure the final HTTPS address before creating passkeys.');
await mkdir('.secrets', { mode: 0o700, recursive: true });
let existing;
try {
  existing = await readFile('.secrets/runtime.json', 'utf8');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing !== undefined) {
  let setup;
  try {
    setup = JSON.parse(existing);
    const recordedOrigin = (await readFile('.secrets/origin.txt', 'utf8')).trim();
    const ownerFile = await readFile('.secrets/owner-setup.txt', 'utf8');
    const link = new URL(ownerFile.split('\n').find(line => line.startsWith('https://')));
    const token = new URLSearchParams(link.hash.slice(1)).get('access');
    if (recordedOrigin !== origin.origin || link.origin !== origin.origin || link.pathname !== '/' || link.search ||
        !/^[A-Za-z0-9_-]{43}$/.test(token || '') ||
        createHash('sha256').update(token).digest('hex') !== setup.BOOTSTRAP_ACCESS_HASH ||
        Buffer.from(setup.MAINTENANCE_LINK_KEY || '', 'base64').length !== 32 ||
        !Number.isFinite(Number(setup.BOOTSTRAP_ACCESS_EXPIRES_AT))) throw new Error('Invalid setup');
  } catch {
    throw new Error('The private setup files are incomplete or inconsistent. Keep runtime.json and its encryption key. Recover the missing owner/origin files before deploying; do not silently regenerate an existing workspace key.');
  }
  let alreadyDeployed = false;
  try { await readFile('.secrets/deployed.json'); alreadyDeployed = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!alreadyDeployed && Number(setup.BOOTSTRAP_ACCESS_EXPIRES_AT) <= Date.now()) {
    throw new Error('The first owner setup grant expired before a recorded deployment. Preserve the encryption key and prepare a fresh invitation only after verifying the remote workspace is still uninitialized.');
  }
  console.log('Complete existing private setup files were verified and kept. Do not regenerate the encryption key for an existing workspace.');
  process.exit(0);
}
const token = randomBytes(32).toString('base64url');
const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
const secrets = {
  MAINTENANCE_LINK_KEY: randomBytes(32).toString('base64'),
  BOOTSTRAP_ACCESS_HASH: createHash('sha256').update(token).digest('hex'),
  BOOTSTRAP_ACCESS_EXPIRES_AT: String(expires),
};
await writeFile('.secrets/runtime.json', JSON.stringify(secrets, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
await writeFile('.secrets/owner-setup.txt', `Jerry's private first-time setup link\n\n${origin.origin}/#access=${token}\n\nExpires: ${new Date(expires).toISOString()}\nCreate a passkey, then add a backup passkey. Keep this file private.\n`, { mode: 0o600, flag: 'wx' });
await writeFile('.secrets/origin.txt', origin.origin + '\n', { mode: 0o600, flag: 'wx' });
console.log('Private setup files created under .secrets/. The owner link was not printed to logs. Keep a secure backup of runtime.json.');
