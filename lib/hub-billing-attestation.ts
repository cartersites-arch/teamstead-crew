import {BRIDGE_PUBLIC_KEY} from './r2-bridge-public';
import {companyBillingAccess} from './company-billing-access';
import {rawDb} from './chat-db';
import {response,fail,handleError} from './chat-server';
export async function hubBillingAttestation(request:Request){try{
  const at=request.headers.get('x-signed-at')||'',sig=request.headers.get('x-signature')||'';
  if(request.headers.get('origin')||!/^\d{13}$/.test(at)||Math.abs(Date.now()-Number(at))>60000||!/^[A-Za-z0-9_-]{86}$/.test(sig))fail(401,'Access denied.');
  const body=await request.text();if(body.length>200)fail(413,'Request too large.');
  const key=await crypto.subtle.importKey('jwk',BRIDGE_PUBLIC_KEY,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const bytes=Uint8Array.from(atob(sig.replace(/-/g,'+').replace(/_/g,'/')+'=='),x=>x.charCodeAt(0));
  if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,bytes,new TextEncoder().encode(['pms-billing-v1',at,body].join('\n'))))fail(401,'Access denied.');
  const data=JSON.parse(body);if(!/^c_[a-f0-9]{16}$/.test(data.company))fail(400,'Invalid company.');
  const company=await rawDb().prepare('SELECT COALESCE(product_package,product_bundle) AS selected_plan FROM company_registry WHERE id=?').bind(data.company).first<{selected_plan:string}>();
  if(!company||!['hub','combined','hub_parts','complete'].includes(company.selected_plan))return response({allowed:false});
  return response(await companyBillingAccess(data.company));
}catch(error){return handleError(error);}}
