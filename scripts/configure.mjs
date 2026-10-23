import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  account: { type: 'string' }, database: { type: 'string' }, origin: { type: 'string' },
  name: { type: 'string', default: 'project-room-company' },
} });
if (!/^[a-f0-9]{32}$/i.test(values.account || '') || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(values.database || '') || /^0+$/.test((values.database || '').replaceAll('-', ''))) {
  throw new Error('Supply the actual company Cloudflare account ID and the ID of a new dedicated D1 database.');
}
if (!/^project-room(?:-[a-z0-9]+)+$/.test(values.name)) throw new Error('Use a dedicated project-room-… Worker and matching database name.');
const origin = new URL(values.origin);
if (origin.protocol !== 'https:' || origin.origin !== values.origin || origin.username || origin.password || /(^|\.)chatgpt\.(com|site)$/.test(origin.hostname)) {
  throw new Error('Use the exact independent HTTPS origin, without a path, query or fragment.');
}
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
if (config.vars.WEBAUTHN_ORIGIN && config.vars.WEBAUTHN_ORIGIN !== origin.origin) {
  throw new Error('The hostname is already configured. Changing it needs a passkey/data migration; see README.');
}
config.name = values.name;
config.account_id = values.account;
config.d1_databases[0].database_name = values.name;
config.d1_databases[0].database_id = values.database;
config.vars = { WEBAUTHN_RP_ID: origin.hostname, WEBAUTHN_ORIGIN: origin.origin };
await writeFile('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n');
console.log('Independent deployment configured. No resources were changed.');
