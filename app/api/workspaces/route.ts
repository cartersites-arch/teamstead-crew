import {companyProducts} from '@/lib/company-products';
import {validCompany} from '@/lib/company-context';
import { rawDb,db } from '@/lib/chat-db';
import { requireRecent,currentPerson,newToken,tokenHash,INVITE_AGE } from '@/lib/access';
import { securityGate } from '@/lib/security-events';
import { companyId } from '@/lib/company-context';
import { response,handleError,checkOrigin,required,fail } from '@/lib/chat-server';
import { headers } from '@/lib/request-context';
import { encryptCompanyConnection } from '@/lib/maintenance-links';
const endpoint='https://fhqmnlpgqslllzrovxbp.supabase.co/functions/v1/company-setup';
export async function companySetup(data:Record<string,unknown>){
 const h=await headers(),scope=companyId();const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,scope,cookie:h.get('cookie')||'',viewer:h.get('X-Project-User')||''}),signal:AbortSignal.timeout(30000)});
 const result=await r.json() as Record<string,any>;if(!r.ok)fail(r.status,String(result.error||'Company setup is unavailable.'));return result;
}
export async function GET(){try{const me=await currentPerson();if(me.role!=='owner')fail(403,'Only the owner can manage company setup.');const row=await db().prepare('SELECT name,owner_id FROM workspace WHERE id=?').bind('main').first<{name:string;owner_id:string}>();if(row?.owner_id!==me.id)fail(403,'Owner access required.');return response({companies:[{id:companyId(),name:row.name,kind:'Your company',ready:true}],scope:companyId()});}catch(e){return handleError(e);}}
export async function POST(request:Request){try{
 checkOrigin(request);const me=await requireRecent(),scope=companyId();if(me.role!=='owner')fail(403,'Only the company owner can manage setup.');
 const owner=await db().prepare('SELECT owner_id FROM workspace WHERE id=?').bind('main').first<{owner_id:string}>();if(owner?.owner_id!==me.id)fail(403,'Owner access required.');
 const data=await request.json() as Record<string,unknown>;if(!data||Array.isArray(data))fail(400,'Check the company information.');const co=required(data.company,18);if(!validCompany(co)||(scope!=='main'&&scope!==co))fail(403,'Company unavailable.');
 const registry=await rawDb().prepare('SELECT status FROM company_registry WHERE id=?').bind(co).first<{status:string}>();if(registry&&['deleting','archived'].includes(registry.status))fail(403,'Company access is blocked. Restore an archived company from Platform Administration.');
 const action=required(data.action,30);const products=await companyProducts();if(!products.hub&&['assets','save_assets'].includes(action))fail(403,'Maintenance Hub is not included in your plan.');
 if(action==='finish_signup'){
  if(scope!==co||!/^c_[a-f0-9]{16}$/.test(co))fail(403,'Open your company workspace.');const workspace=await db().prepare('SELECT name FROM workspace WHERE id=?').bind('main').first<{name:string}>();
  if(!products.hub){await rawDb().prepare("UPDATE company_registry SET status='active' WHERE id=? AND owner_id=? AND status='owner_setup'").bind(co,me.id).run();return response({ok:true});}
  const result=await companySetup({action:'provision',company:co,name:workspace!.name,ownerName:me.name,ownerChatId:me.id});await requireRecent();const encrypted=await encryptCompanyConnection(me.id,result.url,co);
  await db().prepare('INSERT INTO maintenance_links(user_id,environment,ciphertext,iv,connected_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,connected_at=excluded.connected_at').bind(me.id,'live',encrypted.ciphertext,encrypted.iv,Date.now()).run();
  await rawDb().prepare("UPDATE company_registry SET status='active',hub_ready=1 WHERE id=? AND owner_id=? AND status NOT IN ('suspended','archived','deleting')").bind(co,me.id).run();return response({ok:true});
 }
 if(action==='company_name'){
  if(scope!==co)fail(403,'Open your company administration.');const name=required(data.name,60);
  if(co!=='main'&&products.hub){await companySetup({action:'provision',company:co,name,ownerName:me.name,ownerChatId:me.id});}
  await db().prepare('UPDATE workspace SET name=? WHERE id=? AND owner_id=?').bind(name,'main',me.id).run();await rawDb().prepare('UPDATE company_registry SET name=? WHERE id=? AND owner_id=?').bind(name,co,me.id).run();return response({ok:true});
 }
 if(co==='main')fail(400,'PMS assets are managed in the live Maintenance Hub.');
 if(action==='activate'){
  if(scope!=='main'||!['demo','pilot'].includes(co))fail(403,'Only Demo and Pilot use platform owner setup.');const name=required(data.name,60),prefix=co+'_',now=Date.now();
  const existing=await rawDb().prepare('SELECT owner_id FROM '+prefix+'workspace WHERE id=?').bind('main').first<{owner_id:string}>(),ownerId=existing?.owner_id||crypto.randomUUID(),token=newToken(),gate=securityGate(me,'company_activated',ownerId);
  // Each workspace has its own invitation, passkeys, sessions, and revocation history.
  const batch=await rawDb().batch([gate.statement,
   
   rawDb().prepare('INSERT INTO '+prefix+'workspace (id,name,owner_id,created_at,access_bootstrapped,ai_enabled) SELECT ?,?,?,?,1,0 WHERE '+gate.condition+' ON CONFLICT(id) DO UPDATE SET name=excluded.name').bind('main',name,ownerId,now),
   rawDb().prepare('INSERT OR IGNORE INTO '+prefix+'people (id,email,name,role,active,joined_at,auth_version) SELECT owner_id,?,?,?,1,0,1 FROM '+prefix+'workspace WHERE id=? AND owner_id=? AND '+gate.condition).bind('',me.name,'owner','main',ownerId),
   rawDb().prepare('INSERT INTO '+prefix+'access_tokens (token_hash,user_id,created_at,expires_at,purpose) SELECT ?,id,?,?,? FROM '+prefix+'people WHERE id=? AND passkey_enrolled=0 AND '+gate.condition+' ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at,expires_at=excluded.expires_at,purpose=excluded.purpose,used_at=0').bind(await tokenHash(token),now,now+INVITE_AGE,'invite',ownerId),
   ...['general','maintenance','announcements'].flatMap(n=>[rawDb().prepare('INSERT OR IGNORE INTO '+prefix+'rooms (id,name,description,kind,visibility,created_by,created_at) SELECT ?,?,?,?,?,?,? WHERE '+gate.condition).bind('room-'+n,n,'Your company’s '+n+' conversation.','channel','shared',ownerId,now),rawDb().prepare('INSERT OR IGNORE INTO '+prefix+'room_members (room_id,user_id,read_at) SELECT ?,?,0 WHERE '+gate.condition).bind('room-'+n,ownerId)]),
  ]);if(!batch[0].meta.changes)fail(401,'Your owner session changed. Sign in again.');
  const claimed=await rawDb().prepare('SELECT owner_id FROM '+prefix+'workspace WHERE id=?').bind('main').first<{owner_id:string}>();if(claimed?.owner_id!==ownerId)fail(409,'Company setup started in another window. Retry.');
  const result=await companySetup({action:'provision',company:co,name,ownerName:me.name,ownerChatId:ownerId});
  await requireRecent();
  const encrypted=await encryptCompanyConnection(ownerId,result.url,co);
  await rawDb().prepare('INSERT INTO '+prefix+'maintenance_links (user_id,environment,ciphertext,iv,connected_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,connected_at=excluded.connected_at').bind(ownerId,'live',encrypted.ciphertext,encrypted.iv,now).run();
  await rawDb().prepare("INSERT INTO company_registry(id,name,owner_id,status,created_at,hub_ready) VALUES(?,?,?,'active',?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,hub_ready=1").bind(co,name,ownerId,now).run();
  const enrolled=await rawDb().prepare('SELECT passkey_enrolled FROM '+prefix+'people WHERE id=?').bind(ownerId).first<{passkey_enrolled:number}>();
  return response({ok:true,url:'/?company='+co+(enrolled?.passkey_enrolled?'':'#access='+token),name,needsPasskey:!enrolled?.passkey_enrolled});
 }
 if(action==='assets')return response(await companySetup({action:'assets',company:co}));
 if(action==='save_assets'){
  if(!Array.isArray(data.assets)||data.assets.length<1||data.assets.length>100)fail(400,'Add between 1 and 100 assets.');
  return response(await companySetup({action:'save_assets',company:co,assets:data.assets}));
 }
 fail(400,'Unknown company setup action.');
 }catch(e){return handleError(e);}}
