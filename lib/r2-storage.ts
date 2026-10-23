import { companyId } from './company-context';
import { env } from 'cloudflare:workers';
import { db } from './chat-db';
import { fail } from './app-errors';

export function companyObjectKey(key:string){const co=companyId(),prefix='companies/'+co+'/';return co==='main'||key.startsWith(prefix)?key:prefix+key;}
export const R2_APP_LIMIT = 500_000_000;
export async function digest(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
export function r2Bucket(app: 'chat'|'maintenance') { return app==='chat'?env.CHAT_PHOTOS:env.MAINTENANCE_PHOTOS; }
async function operation(kind: 'read'|'write') {
  const day=new Date().toISOString().slice(0,10),limit=kind==='read'?20000:1000;
  const result=await db().prepare('INSERT INTO r2_daily_operations(day,kind,count) VALUES(?,?,1) ON CONFLICT(day,kind) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(day,kind,limit).first();
  if(!result)fail(429,'Today’s photo activity limit has been reached. Please try again tomorrow.');
}
export async function r2Get(app: 'chat'|'maintenance',key: string) {
  key=companyObjectKey(key);
  const bucket=r2Bucket(app);if(!bucket)fail(503,'Photo storage is not connected yet.');
  await operation('read');return bucket.get(key);
}
export async function r2Put(app: 'chat'|'maintenance',key: string,bytes: Uint8Array<ArrayBuffer>,contentType: string) {
  key=companyObjectKey(key);
  const bucket=r2Bucket(app);if(!bucket)fail(503,'Photo storage is not connected yet.');
  const table=app==='maintenance'&&key.startsWith('manuals/')?'r2_manual_objects':'r2_objects';
  const sha=await digest(bytes);
  try {
    await db().prepare(`INSERT OR IGNORE INTO ${table}(app,object_key,size,sha256,created_at) VALUES(?,?,?,?,?)`).bind(app,key,bytes.length,sha,Date.now()).run();
  }catch(e){if(String(e).includes('R2_BUDGET_FULL'))fail(507,'Teamstead’s shared 500 MB file space is full.');throw e;}
  const stored=await db().prepare(`SELECT size,sha256 FROM ${table} WHERE app=? AND object_key=?`).bind(app,key).first<{size:number;sha256:string}>();
  if(!stored||stored.size!==bytes.length||stored.sha256!==sha)fail(409,'This photo key already belongs to another file.');
  await operation('write');
  const result=await bucket.put(key,bytes,{httpMetadata:{contentType},customMetadata:{sha256:sha},onlyIf:{etagDoesNotMatch:'*'}});
  if(!result){const existing=await r2Get(app,key);if(!existing||existing.customMetadata?.sha256!==sha||existing.size!==bytes.length)fail(409,'Photo upload conflict.');}
}
export async function r2Delete(app: 'chat'|'maintenance',key: string) {
  key=companyObjectKey(key);
  const bucket=r2Bucket(app);if(!bucket)fail(503,'Photo storage is not connected yet.');
  await operation('write');await bucket.delete(key);
  const table=app==='maintenance'&&key.startsWith('manuals/')?'r2_manual_objects':'r2_objects';
  await db().prepare(`DELETE FROM ${table} WHERE app=? AND object_key=?`).bind(app,key).run();
}
