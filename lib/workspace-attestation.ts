import {validCompany} from './company-context';
import { BRIDGE_PUBLIC_KEY } from './r2-bridge-public';
import { currentSession } from './access';
import { db } from './chat-db';
import { companyId } from './company-context';
import { response,fail,handleError } from './chat-server';
export async function workspaceAttestation(request:Request){try{
 const at=request.headers.get('x-signed-at')||'',sig=request.headers.get('x-signature')||'';
 if(!/^\d{13}$/.test(at)||Math.abs(Date.now()-Number(at))>60000||!/^[A-Za-z0-9_-]{86}$/.test(sig))fail(401,'Access denied.');
 const body=await request.text();if(body.length>12000)fail(413,'Request too large.');
 const hex=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
 const signed=new TextEncoder().encode(['pms-company-v1',at,await hex(request.headers.get('cookie')||''),await hex(body)].join('\n'));
 const key=await crypto.subtle.importKey('jwk',BRIDGE_PUBLIC_KEY,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,Uint8Array.from(atob(sig.replace(/-/g,'+').replace(/_/g,'/')+'=='),x=>x.charCodeAt(0)),signed))fail(401,'Access denied.');
 const data=JSON.parse(body),me=await currentSession(),scope=companyId();
 if(me.verified_at<Date.now()-300000)fail(428,'Confirm your passkey to continue.');
 const owner=await db().prepare('SELECT owner_id FROM workspace WHERE id=?').bind('main').first<{owner_id:string}>();
 if(me.role!=='owner'||owner?.owner_id!==me.id||!validCompany(data.company)||(scope!=='main'&&scope!==data.company))fail(403,'Only this company’s owner can manage its setup.');
 return response({ok:true,company:data.company,actor:{id:me.id,name:me.name},scope,platform:scope==='main'});
 }catch(e){return handleError(e);}}
