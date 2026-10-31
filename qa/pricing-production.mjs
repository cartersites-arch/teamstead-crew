import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {tmpdir} from 'node:os';

const audit = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(process.argv[2] || path.join(audit, '..'));
const baseline = path.join(site,'qa/stripe-checkout.mjs');
const prices = {
  chat: ['price_1UOCm8F4XZKyCDNwA18W0pGX','price_1UOCm8F4XZKyCDNwToTYl1VI'],
  hub: ['price_1UOCm8F4XZKyCDNwtQtIoudV','price_1UOCm8F4XZKyCDNwvaXKm4pN'],
  parts: ['price_1UTPR1F4XZKyCDNw1q16W44H','price_1UTPRPF4XZKyCDNwdSA8l3qG'],
  combined: ['price_1UOCmDF4XZKyCDNwULoIReRh','price_1UOCmCF4XZKyCDNwoSCnEhVy'],
  chat_parts: ['price_1UWPdyF4XZKyCDNw40TlAMR8','price_1UTPU7F4XZKyCDNwvVz1oxMq','price_1UTPRrF4XZKyCDNwXPz2x2fx'],
  hub_parts: ['price_1UWPe3F4XZKyCDNwhCrV364H','price_1UTPWJF4XZKyCDNwY8nEDYk4','price_1UTPVXF4XZKyCDNwSp497Rkj'],
  complete: ['price_1UWPe8F4XZKyCDNw1u1ORCHn','price_1UTPXmF4XZKyCDNwEM4CekqO','price_1UTPWtF4XZKyCDNwycv5278Y'],
};
const productionEnv = {};
for (const [plan, [month, year, legacy]] of Object.entries(prices)) {
  productionEnv[`STRIPE_PRICE_${plan.toUpperCase()}_MONTH`] = month;
  productionEnv[`STRIPE_PRICE_${plan.toUpperCase()}_YEAR`] = year;
  if (legacy) productionEnv[`STRIPE_PRICE_${plan.toUpperCase()}_MONTH_LEGACY`] = legacy;
}
let source = await readFile(baseline, 'utf8');
// The baseline suite keeps its independent rotation test. This generated case
// replaces that scenario with exact current, legacy, cross-plan and annual IDs.
const start=source.indexOf(' // Rotating a checkout price');
const end=source.indexOf(" subscription.status='past_due';",start);
assert.ok(start>=0 && end>start,'Baseline rotation test not found');
source=source.slice(0,start)+source.slice(end);
source=source.replace("eq(h.count('stripe_billing_events'),5)","eq(h.count('stripe_billing_events'),3)");
source = source.replace("'./independent-software-authenticator.mjs'", JSON.stringify(pathToFileURL(path.join(site, 'qa/independent-software-authenticator.mjs')).href));
source = source.replace("'./independent-passkey-test-runtime.mjs'", JSON.stringify(pathToFileURL(path.join(site, 'qa/independent-passkey-test-runtime.mjs')).href));
source = source.replace('const bridgePair=', `const prices=${JSON.stringify(prices)};const productionEnv=${JSON.stringify(productionEnv)};const [monthly,annual,legacy]=prices[plan];let acceptedExtra=0;\nconst bridgePair=`);
source = source.replace('createHarness({origin:', `createHarness({site:${JSON.stringify(site)},origin:`);
source = source.replace('environment:{WEBAUTHN_RP_ID:', 'environment:{...productionEnv,WEBAUTHN_RP_ID:');
source = source.replaceAll("'price_month'", 'monthly').replaceAll("'price_year'", 'annual');
const marker = "subscription.status='past_due';";
assert.ok(source.includes(marker));
source = source.replace(marker, `
 // Verify exact production IDs through the signed webhook and selected company plan.
 if(legacy){subscription.items.data[0].price.id=legacy;eq((await deliver('evt_legacyprice',stamp+1)).status,200);acceptedExtra++;eq(h.row('SELECT price_id FROM company_billing WHERE company_id=?',co).price_id,legacy);}
 subscription.items.data[0].price.id='price_unknown';eq((await deliver('evt_unknownprice',stamp+2)).status,409);
 subscription.items.data[0].price.id=prices[plan==='chat'?'complete':'chat'][0];eq((await deliver('evt_crossplan',stamp+3)).status,409);
 subscription.items.data[0].price.id=monthly;subscription.items.data[0].price.recurring.interval='year';eq((await deliver('evt_badinterval',stamp+4)).status,409);
 subscription.items.data[0].price.recurring.interval='month';eq((await deliver('evt_canonicalprice',stamp+6)).status,200);acceptedExtra++;eq(h.row('SELECT price_id FROM company_billing WHERE company_id=?',co).price_id,monthly);
 subscription.status='past_due';`);
source = source.replace("eq(h.count('stripe_billing_events'),3)", "eq(h.count('stripe_billing_events'),3+acceptedExtra)");
const annualMarker = "async function hubPolicy";
assert.ok(source.includes(annualMarker));
source = source.replace(annualMarker, `
 subscription.status='active';subscription.items.data[0].price.id=annual;subscription.items.data[0].price.recurring.interval='year';
 eq((await deliver('evt_annual',stamp+40)).status,200);eq(h.row('SELECT price_id FROM company_billing WHERE company_id=?',co).price_id,annual);eq(h.row('SELECT billing_interval FROM company_billing WHERE company_id=?',co).billing_interval,'year');
 async function hubPolicy`);
source = source.replace("scope:'Actual auth/database routes:", "monthlyPrice:monthly,annualPrice:annual,legacyPrice:legacy||null,firstTrialDays:30,scope:'Exact production prices; cross-plan and interval rejection; annual signed webhook; Actual auth/database routes:");
const scratch=await mkdtemp(path.join(tmpdir(),'teamstead-pricing-'));
const fixture = path.join(scratch, 'pricing-case.mjs');
await writeFile(fixture, source);
const results = [];
try {
  for (const plan of Object.keys(prices)) {
    const run = spawnSync(process.execPath, [fixture, plan, 'live'], {cwd:site, encoding:'utf8', timeout:120000, windowsHide:true});
    if (run.status !== 0) throw Error(`${plan}: ${run.error || ''}\n${run.stdout}\n${run.stderr}`);
    const result = run.stdout.trim().split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).at(-1);
    assert.equal(result?.passed, true);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const sourceHashes = {};
  for(const file of ['lib/product-plans.ts','lib/stripe-billing.ts','lib/stripe-checkout.ts','app/api/checkout/route.ts','app/api/stripe-webhook/route.ts']) sourceHashes[file]=createHash('sha256').update(await readFile(path.join(site,file))).digest('hex');
  const summary={passed:true,checkedAt:new Date().toISOString(),site,checks:results.reduce((n,r)=>n+r.checks,0),plans:results,sourceHashes,realNetwork:false,liveSubscriptionsCreated:0,liveChargesCreated:0};
  console.log(JSON.stringify(summary));
  console.log(JSON.stringify({passed:true,checks:summary.checks,plans:results.length,realNetwork:false}));
} finally {
  await rm(scratch,{recursive:true,force:true});
}
