import { currentPerson } from './access';
import { ChatError,fail } from './app-errors';
export { ChatError,fail } from './app-errors';
import { db, bucket } from './chat-db';
import { queueDeletion,retryFileDeletions } from './file-deletions';
import type { Person } from './chat-types';

export function str(value:unknown,max=10000):string { if(typeof value!=='string'||value.length>max) fail(400,'Please check the text and try again.'); return value.trim(); }
export function required(value:unknown,max=100):string { const s=str(value,max); if(!s) fail(400,'Please fill in the required field.'); return s; }
export function response(data:unknown,status=200) { return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}); }
export function handleError(e:unknown) { if(e instanceof ChatError) return response({error:e.message},e.status); console.error('Teamstead Crew request failed', e instanceof Error?e.message:'Unknown error'); return response({error:'We could not reach your workspace. Your draft is safe. Please try again.'},503); }
export function checkOrigin(request:Request) {const origin=request.headers.get('origin');let source=origin; if(!source){const ref=request.headers.get('referer');try{source=ref?new URL(ref).origin:null;}catch{source=null;}}if(!source||source==='null'||source!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')fail(403,'Please open Teamstead Crew to make this change.');}

export async function member():Promise<Person>{return currentPerson();}

export async function roomAccess(id:string,userId:string) {
  const room=await db().prepare('SELECT r.* FROM rooms r JOIN room_members rm ON rm.room_id = r.id WHERE r.id = ? AND rm.user_id = ?').bind(id,userId).first<{id:string;name:string;kind:string;visibility:string;created_by:string}>();
  if(!room) fail(404,'That conversation is not available to you.'); return room;
}
export async function messageAccess(id:string,userId:string) {
  const msg=await db().prepare('SELECT m.* FROM messages m JOIN room_members rm ON rm.room_id = m.room_id WHERE m.id = ? AND rm.user_id = ?').bind(id,userId).first<{id:string;room_id:string;user_id:string;body:string;parent_id:string|null;deleted:number}>();
  if(!msg) fail(404,'That message is not available to you.'); return msg;
}
export async function enrich(rows:Record<string,unknown>[],userId:string):Promise<Record<string,unknown>[]> {
  if(!rows.length) return [];
  if(rows.length>80) { const chunks=[];for(let i=0;i<rows.length;i+=80) chunks.push(await enrich(rows.slice(i,i+80),userId));return chunks.flat(); }
  const ids=rows.map(x=>String(x.id)); const placeholders=ids.map(()=>'?').join(',');
  const [files,reacts,saved]=await Promise.all([
    db().prepare('SELECT a.id,a.message_id,a.name,a.mime,a.size FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.deleted = 0 AND a.message_id IN ('+placeholders+')').bind(...ids).all(),
    db().prepare('SELECT message_id,emoji,COUNT(*) AS count,MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine FROM reactions WHERE message_id IN ('+placeholders+') GROUP BY message_id,emoji').bind(userId,...ids).all(),
    db().prepare('SELECT message_id FROM saved_messages WHERE user_id=? AND message_id IN ('+placeholders+')').bind(userId,...ids).all(),
  ]);
  return rows.map(m=>({...m,saved:!m.deleted&&saved.results.some(s=>s.message_id===m.id)?1:0,attachments:files.results.filter(a=>a.message_id===m.id),reactions:m.deleted?[]:reacts.results.filter(a=>a.message_id===m.id)}));
}
export const messageSelect='SELECT m.*,p.name AS author,(SELECT COUNT(*) FROM messages reply WHERE reply.parent_id = m.id) AS reply_count FROM messages m LEFT JOIN people p ON p.id = m.user_id ';

export async function sendMessage(request:Request,person:Person) {
  if(Number(request.headers.get('content-length')||0)>2*1024*1024) fail(413,'Choose up to 3 photos or PDFs through the app.');
  const data=await request.formData();
  const id=required(data.get('id'),80), roomId=required(data.get('roomId'),100), body=str(data.get('body')||''), parentId=str(data.get('parentId')||'',100)||null;
  if(!/^[a-zA-Z0-9_-]{12,80}$/.test(id)) fail(400,'The message could not be identified. Please try again.');
  const room=await roomAccess(roomId,person.id);
  const existing=await db().prepare('SELECT id,user_id,room_id FROM messages WHERE id = ?').bind(id).first<{id:string;user_id:string;room_id:string}>();
  if(existing) { if(existing.user_id!==person.id||existing.room_id!==roomId) fail(409,'Please send this as a new message.'); return response({id:existing.id}); }
  if(room.kind==='dm') {
    const n=await db().prepare('SELECT COUNT(*) AS count FROM room_members rm JOIN people p ON p.id = rm.user_id WHERE rm.room_id = ? AND p.active = 1').bind(roomId).first<{count:number}>();
    if((n?.count||0)<2) fail(409,'This person is no longer in the workspace.');
  }
  if(parentId) { const parent=await messageAccess(parentId,person.id); if(parent.room_id!==roomId||parent.parent_id||parent.deleted) fail(400,'Reply to an available message in this conversation.'); }
  const files=data.getAll('files').filter((v):v is File=>typeof v!=='string'&&v.size>0);
  if(room.kind==='bot'){
    if(files.length||parentId||!['/my-jobs','show my jobs','my jobs'].includes(body.toLowerCase()))fail(400,'Type /my-jobs or show my jobs in your Maintenance Bot conversation.');
    const {checkJobs}=await import('./maintenance-bots');await checkJobs(person.id,true,id);return response({id});
  }
  if(!body&&!files.length) fail(400,'Write a message or choose a file.');
  if(files.length>3||files.some(f=>f.size>512*1024)) fail(413,'Choose up to 3 files. Stored photos and PDFs must be 512 KB or smaller.');
  const uploaded:{id:string;key:string;name:string;mime:string;size:number}[]=[];
  try {
    for(const file of files) {
      const bytes=new Uint8Array(await file.arrayBuffer());
      const mime=imageType(bytes)||(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'?'application/pdf':null); if(!mime) fail(415,'Use a JPG, PNG, GIF, WebP or PDF file.');
      const attachmentId=crypto.randomUUID(),key='conversations/'+encodeURIComponent(roomId)+'/'+new Date().toISOString().slice(0,7).replace('-','/')+'/'+attachmentId;
      uploaded.push({id:attachmentId,key,name:file.name.slice(0,180),mime,size:file.size});
      await bucket().put(key,bytes,{httpMetadata:{contentType:mime}});
    }
    const now=Date.now();
    await db().batch([
      db().prepare('INSERT INTO messages (id,room_id,user_id,parent_id,body,created_at) VALUES (?,?,?,?,?,?)').bind(id,roomId,person.id,parentId,body,now),
      ...uploaded.map(f=>db().prepare('INSERT INTO attachments (id,message_id,object_key,name,mime,size) VALUES (?,?,?,?,?,?)').bind(f.id,id,f.key,f.name,f.mime,f.size)),
    ]);
    return response({id,created_at:now},201);
  } catch(e) {
    // A transport failure can follow a committed transaction. Reconcile before deleting bytes.
    let committed:unknown=null;
    let referencedKeys:string[]=[];
    let checked=false;
    try {
      committed=await db().prepare('SELECT id FROM messages WHERE id = ? AND user_id = ? AND room_id = ?').bind(id,person.id,roomId).first();
      const saved=await db().prepare('SELECT object_key FROM attachments WHERE message_id = ?').bind(id).all<{object_key:string}>();
      referencedKeys=saved.results.map(f=>f.object_key);checked=true;
    } catch { /* Retain uploads when the database cannot confirm their status. */ }
    if(checked&&uploaded.length){const orphans=uploaded.filter(f=>!referencedKeys.includes(f.key));if(orphans.length)try{await db().batch(orphans.map(f=>queueDeletion(f.key,person.id,null)));await retryFileDeletions(person);}catch{/* Keep the original send result if cleanup cannot be recorded. */}}
    if(committed)return response({id});
    throw e;
  }
}
function imageType(b:Uint8Array):string|null {
  if(b.length<12) return null;
  if(b[0]===255&&b[1]===216&&b[2]===255) return 'image/jpeg';
  if([137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n)) return 'image/png';
  const first=String.fromCharCode(...b.slice(0,12));
  if(first.startsWith('GIF87a')||first.startsWith('GIF89a')) return 'image/gif';
  if(first.startsWith('RIFF')&&first.slice(8)==='WEBP') return 'image/webp';
  return null;
}
