import {currentPerson} from '../lib/access';
import {teamsteadBoundary} from '../lib/product-boundary';
import {db,rawDb} from '../lib/chat-db';
import {companyBillingAccess} from '../lib/company-billing-access';
import {hubBillingAttestation} from '../lib/hub-billing-attestation';
import {companyProducts} from '../lib/company-products';
import * as checkout from '../app/api/checkout/route';
import * as stripeWebhook from '../app/api/stripe-webhook/route';
import * as roster from '../app/api/roster/route';
import {ChatError} from '../lib/app-errors';
import * as signup from '../app/api/signup/route';
import * as platform from '../app/api/platform/route';
import {companyId} from '../lib/company-context';
import * as workspaces from '../app/api/workspaces/route';
import { workspaceAttestation } from '../lib/workspace-attestation';
import * as access from '../app/api/access/route';
import * as passkeys from '../app/api/passkeys/route';
import * as chat from '../app/api/chat/route';
import * as maintenance from '../app/api/maintenance/route';
import * as workOrders from '../app/api/work-orders/route';
import * as security from '../app/api/security/route';
import * as branding from '../app/api/branding/route';
import * as photos from '../app/api/photos/[id]/route';
import * as openMaintenance from '../app/maintenance/open/route';
import * as bots from '../app/api/bots/route';
import * as crewCall from '../app/api/crew-call/route';
import * as partsFinder from '../lib/parts-finder.js';

import { hubR2Bridge } from '../lib/hub-r2-bridge';
import { withRequest } from '../lib/request-context';

type Route = { GET?: (request: Request) => Promise<Response>; POST?: (request: Request) => Promise<Response> };
const routes: Record<string, Route> = {
  '/api/checkout': checkout,
  '/api/hub-billing-access': {POST:hubBillingAttestation},
  '/api/stripe-webhook': stripeWebhook,
  '/api/roster': roster,
  '/api/signup': signup,
  '/api/platform': platform,
  '/api/workspaces': workspaces,
  '/api/workspace-attestation': {POST:workspaceAttestation},
  '/api/access': access,
  '/api/passkeys': passkeys,
  '/api/chat': chat,
  '/api/maintenance': maintenance,
  '/api/work-orders': workOrders,
  '/api/security': security,
  '/api/branding': branding,
  '/api/bots': bots,
  '/api/crew-call': crewCall,
  '/api/parts-prices': {GET:partsFinder.prices},
  '/api/parts-stores': {GET:partsFinder.stores},
  '/api/parts-stock': {GET:partsFinder.stock},
  '/maintenance/open': openMaintenance,
};
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

function jsonError(message: string, status: number, extra: Record<string, string> = {}) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store', ...extra } });
}

async function boundedRequest(request: Request): Promise<Request | Response> {
  if (!request.body) return request;
  if (Number(request.headers.get('content-length') || 0) > MAX_REQUEST_BYTES) {
    return jsonError('This upload is too large. Choose up to three photos or PDFs through the app.', 413);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return jsonError('This upload is too large for the free pilot.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request, { body: bytes });
}

function protect(response: Response) {
  const result = new Response(response.body, response);
  result.headers.set('Cache-Control', 'private, no-store');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('Referrer-Policy', 'no-referrer');
  result.headers.set('X-Frame-Options', 'DENY');
  result.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return result;
}

function protectParts(response: Response) {
  const result=protect(response);
  result.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(self)');
  return result;
}

import {companyInstallManifest} from '../lib/company-install-manifest';
export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    if (!await teamsteadBoundary(request, env.DB)) return protect(jsonError('Teamstead is not ready. Please use your current company link.', 503));
    const path = new URL(request.url).pathname;
    if(path==='/manifest.webmanifest')return companyInstallManifest(request);

    if(path==='/api/hub-photo-storage')return protect(await hubR2Bridge(request));
    const route = routes[path];
    const photo = /^\/api\/photos\/([^/]+)$/.exec(path);
    const partsAsset=path==='/parts'||path.startsWith('/parts/');
    if (!route && !photo && !partsAsset) {
      if (path === '/api' || path.startsWith('/api/') || path.startsWith('/maintenance/open/')) {
        return protect(jsonError('This action is not available.', 404));
      }
      return env.ASSETS.fetch(request);
    }
    const method = request.method;
    if(partsAsset&&!['GET','HEAD'].includes(method))return protect(jsonError('Method not allowed.',405,{Allow:'GET, HEAD'}));
    if (photo && method !== 'GET') return protect(jsonError('Method not allowed.', 405, { Allow: 'GET' }));
    const handler = route?.[method as keyof Route];
    if (!partsAsset && !photo && !handler) return protect(jsonError('Method not allowed.', 405, { Allow: Object.keys(route).filter(key => key === 'GET' || key === 'POST').join(', ') }));
    try {
      const bounded = method === 'POST' ? await boundedRequest(request) : request;
      if (bounded instanceof Response) return protect(bounded);
      return await withRequest(bounded, async () => {
        const co=companyId();if(co!=='main'){const registry=await env.DB!.prepare('SELECT status FROM company_registry WHERE id=?').bind(co).first<{status:string}>();if(['suspended','archived','deleting'].includes(registry?.status||''))return protect(jsonError('This company’s access is paused. Contact its owner.',403));if(/^c_/.test(co)&&(!registry||registry.status==='building'))return protect(jsonError('Company setup is not ready.',404));}
        const products=await companyProducts();const action=method==='POST'?await bounded.clone().json().then((d:any)=>d.action).catch(()=>null):new URL(bounded.url).searchParams.get('action')||'state';
        if(!products.hub&&['/api/maintenance','/api/work-orders','/maintenance/open','/api/bots','/api/roster'].includes(path))return protect(jsonError('Maintenance Hub is not included in your plan.',403));
        if(!products.hub&&path==='/api/access'&&method==='POST'){const data=await bounded.clone().json().catch(()=>({})) as Record<string,unknown>;if(data.maintenanceLink)return protect(jsonError('Maintenance Hub is not included in your plan.',403));}
        if(!products.parts&&(partsAsset||path.startsWith('/api/parts-')))return protect(jsonError('Parts Finder is not included in your plan.',403));
        if(['/api/crew-call','/api/chat','/api/maintenance','/api/work-orders','/maintenance/open','/api/bots','/api/roster','/api/parts-prices','/api/parts-stores','/api/parts-stock'].includes(path)||photo||partsAsset){const billing=await companyBillingAccess(co);if(!billing.allowed&&path==='/api/chat'&&method==='GET'&&action==='state'){const me=await currentPerson(),workspace=await db().prepare('SELECT id,name,owner_id,ai_enabled FROM workspace WHERE id=?').bind('main').first(),registry=await rawDb().prepare('SELECT hub_ready,status FROM company_registry WHERE id=?').bind(co).first<{hub_ready:number;status:string}>();return protect(Response.json({billingRequired:true,products,companyReady:products.hub?!!registry?.hub_ready:registry?.status==='active',me,workspace,members:[],rooms:[],invitations:[]}));}if(!billing.allowed)return protect(jsonError('Your company subscription needs attention. The owner can open Billing to restore access.',402));}
        const directoryActions=['update_status','update_profile','remove_member'];
        if(!products.chat&&((path==='/api/chat'&&!(method==='GET'&&action==='state')&&!directoryActions.includes(action))||path==='/api/bots'||path==='/api/work-orders'||path==='/api/crew-call'||(photo&&!photo[1].startsWith('avatar-'))))return protect(jsonError('Chat is not included in your plan.',403));
        if(partsAsset){await currentPerson();const assetUrl=new URL(bounded.url);if(assetUrl.pathname==='/parts')assetUrl.pathname='/parts/';const response=await env.ASSETS.fetch(new Request(assetUrl,bounded));return protectParts(response);}
        const response = photo
          ? await photos.GET(bounded, { params: Promise.resolve({ id: decodeURIComponent(photo[1]) }) })
          : await handler!(bounded);
        return protect(response);
      });
    } catch (error) {
      if (partsAsset && error instanceof ChatError && error.status === 401) {
        const signIn = new URL('/', request.url);
        const company = new URL(request.url).searchParams.get('company');
        if (company && company !== 'main') signIn.searchParams.set('company', company);
        return protect(Response.redirect(signIn.toString(), 303));
      }
      if(error instanceof ChatError)return protect(jsonError(error.message,error.status));
      // Do not include credentials, cookies, request bodies or SQL in responses.
      return protect(jsonError('PMS Crew could not complete this request. Please try again.', 500));
    }
  },
} satisfies ExportedHandler<Cloudflare.Env>;
