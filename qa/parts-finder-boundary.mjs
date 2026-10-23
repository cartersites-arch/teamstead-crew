import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const worker=await readFile('worker/index.ts','utf8');
const browser=await readFile('public/parts/app.js','utf8');
const page=await readFile('public/parts/index.html','utf8');
const plans=await readFile('lib/product-plans.ts','utf8');
const branding=await readFile('app/api/branding/route.ts','utf8');

assert.match(worker,/!products\.parts&&\(partsAsset\|\|path\.startsWith\('\/api\/parts-'\)\)/);
assert.match(worker,/await currentPerson\(\);const assetUrl/);
assert.match(worker,/companyBillingAccess\(co\)/);
assert.match(worker,/geolocation=\(self\)/);
assert.match(worker,/'\/api\/branding': branding/);
assert.match(browser,/\/api\/parts-\$\{endpoint\}/);
assert.match(browser,/URLSearchParams\(window\.location\.search\)\.get\("company"\)/);
assert.match(browser,/fetch\(teamsteadApi\("\/api\/branding"\)/);
assert.doesNotMatch(browser,/\/api\/(prices|stores|stock)\?/);
assert.match(page,/Teamstead Parts Finder/);
assert.match(page,/id="company-logo"/);
assert.match(plans,/parts:'Parts Finder Only'/);
assert.match(plans,/complete:'Chat \+ Maintenance Hub \+ Parts Finder'/);
assert.match(plans,/chat_parts:'Chat \+ Parts Finder'/);
assert.match(plans,/hub_parts:'Maintenance Hub \+ Parts Finder'/);
assert.match(branding,/const me=await requireRecent\(\)/);
assert.match(branding,/me\.role!=='owner'/);
assert.match(branding,/MAX_LOGO_BYTES=512\*1024/);
assert.match(branding,/LOGO_TYPES=new Set\(\['image\/jpeg','image\/png','image\/webp'\]\)/);

console.log('Parts Finder product, session, subscription, company-scope and GPS boundary checks passed');
