import {env} from 'cloudflare:workers';
import {rawDb} from './chat-db';import {validCompany} from './company-context';import {companyTemplate} from './company-template';import {fail} from './app-errors';import {companySetup} from '../app/api/workspaces/route';
const tableSql=companyTemplate.filter(s=>s.startsWith('CREATE TABLE'));
const remaining=tableSql.map(sql=>({name:sql.match(/__CO___([a-z_]+)/)![1],parents:[...sql.matchAll(/REFERENCES\s+`?__CO___([a-z_]+)/g)].map(m=>m[1])}));
export const deletionOrder:string[]=[];
while(remaining.length){const i=remaining.findIndex(t=>!remaining.some(child=>child.name!==t.name&&child.parents.includes(t.name)));if(i<0)throw Error('Company table dependency cycle');deletionOrder.push(remaining.splice(i,1)[0].name);}
export async function deleteCompany(co:string,confirmName:unknown,confirmed:unknown){
 if(!validCompany(co)||co==='main')fail(400,'PMS cannot be deleted.');
 const database=rawDb(),row=await database.prepare('SELECT name,status,hub_ready,setup_cursor FROM company_registry WHERE id=?').bind(co).first<{name:string;status:string;hub_ready:number;setup_cursor:number}>();
 if(!row)fail(404,'Company not found.');if(confirmName!==row.name||confirmed!==true)fail(400,'Confirm permanent deletion with the company name.');
 if(!['archived','deleting'].includes(row.status))fail(409,'Archive the company before permanently deleting it.');
 const billing=await database.prepare('SELECT subscription_id,status FROM company_billing WHERE company_id=?').bind(co).first<{subscription_id:string|null;status:string}>();if(billing?.subscription_id&&!['canceled','incomplete_expired'].includes(billing.status))fail(409,'Cancel the company subscription before deleting it.');
 const lease=crypto.randomUUID();const lock=await database.prepare("UPDATE company_registry SET setup_hash=?,setup_expires=?,setup_cursor=CASE WHEN status='archived' THEN 0 ELSE setup_cursor END,status='deleting' WHERE id=? AND (status='archived' OR setup_expires<?) RETURNING id").bind(lease,Date.now()+120000,co,Date.now()).first();if(!lock)fail(409,'Company deletion is already running. Wait before resuming.');
 try{
 await companySetup({action:'delete_begin',company:co});if(row.status==='archived')row.setup_cursor=0;
 const prefix='companies/'+co+'/';
 for(const bucket of [env.CHAT_PHOTOS,env.MAINTENANCE_PHOTOS]){if(!bucket)fail(503,'File storage is unavailable. Retry deletion later.');const page=await bucket.list({prefix,limit:100});if(page.objects.length){const keys=page.objects.map(o=>o.key);if(keys.some(k=>!k.startsWith(prefix)))fail(500,'Company file boundary error.');await bucket.delete(keys);await removeLedger(keys);return {done:false};}}
 {const result=await companySetup({action:'delete_files',company:co,offset:row.setup_cursor});const keys=result.files as string[];if(!Array.isArray(keys)||keys.length>100||keys.some(k=>typeof k!=='string'||!(/^(work-orders\/[0-9a-f-]{36}\/(problem|completion)|parts\/[0-9a-f-]{36})\/[0-9a-f-]{36}\.jpg$/.test(k)||/^manuals\/rides\/[0-9a-f-]{36}\.pdf$/.test(k))))fail(500,'Company maintenance file boundary error.');if(keys.length){await env.MAINTENANCE_PHOTOS!.delete(keys);await removeLedger(keys);await database.prepare("UPDATE company_registry SET setup_cursor=setup_cursor+? WHERE id=? AND status='deleting'").bind(keys.length,co).run();return {done:false};}await companySetup({action:'delete_records',company:co});}
 const tables=await database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,?)=?").bind(co.length+1,co+'_').all<{name:string}>();
 const present=new Set(tables.results.map(t=>t.name));const allowed=new Set(deletionOrder.map(t=>co+'_'+t));if([...present].some(t=>!allowed.has(t)))fail(409,'An unknown company table needs review before deletion.');
 await database.batch([...deletionOrder.filter(t=>present.has(co+'_'+t)).map(t=>database.prepare('DROP TABLE "'+co+'_'+t+'"')),database.prepare('DELETE FROM company_member_links WHERE company=?').bind(co),database.prepare('DELETE FROM stripe_billing_events WHERE company_id=?').bind(co),database.prepare('DELETE FROM company_billing WHERE company_id=?').bind(co),database.prepare('DELETE FROM company_registry WHERE id=?').bind(co)]);
 return {done:true};
 }finally{await database.prepare('UPDATE company_registry SET setup_expires=0 WHERE id=? AND setup_hash=?').bind(co,lease).run();}
}
async function removeLedger(keys:string[]){const database=rawDb();for(const table of ['r2_objects','r2_manual_objects'])await database.prepare('DELETE FROM '+table+' WHERE object_key IN ('+keys.map(()=>'?').join(',')+')').bind(...keys).run();}
