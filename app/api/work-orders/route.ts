import {member,roomAccess,messageAccess,messageSelect,enrich,checkOrigin,required,response,handleError,fail} from '@/lib/chat-server';
import {db} from '@/lib/chat-db';
import {assetWords,matchAssets,sourceOperationId} from '@/lib/work-order-match';
import {requireRecent} from '@/lib/access';
import {connectionUrl} from '@/lib/maintenance-links';
import {companyId} from '@/lib/company-context';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function context(roomId:string,userId:string){
 const room=await roomAccess(roomId,userId);
 if(room.kind!=='channel'||room.name.trim().toLowerCase()!=='maintenance')fail(400,'Open the maintenance channel to submit a work order.');
 const link=await connectionUrl(userId);if(!link)fail(400,'Connect your personal Maintenance Hub link in Security & privacy first.');
 const token=new URLSearchParams(new URL(link).hash.slice(1)).get('hub');if(!token)fail(400,'Reconnect your personal Maintenance Hub link.');
 return {token,base:'https://fhqmnlpgqslllzrovxbp.supabase.co/functions/v1/'+(companyId()==='main'?'':'company-hub/'),signal:undefined as AbortSignal|undefined};
}
async function hub(ctx:Awaited<ReturnType<typeof context>>,path:string,init:RequestInit){
 let res:Response;try{res=await fetch(ctx.base+path,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:'Bearer '+ctx.token},redirect:'manual',signal:ctx.signal||AbortSignal.timeout(45000)});}catch{fail(503,'The Hub did not confirm the save. Keep this form open and retry the same request.');}
 if(!res.ok){if(res.status===401||res.status===403)fail(403,'Your personal Hub access does not allow this request. Check your Hub connection.');if(res.status===400||res.status===413||res.status===415)fail(400,'The Hub rejected the details or photo. Check them in your Maintenance Hub before starting another request.');if(res.status===409)fail(409,'Check your Hub for the existing work order before starting another request.');fail(503,'The Hub did not confirm the save. Keep this form open and retry the same request.');}
 return res;
}
async function workflow<T=unknown>(ctx:Awaited<ReturnType<typeof context>>,action:string,data:Record<string,unknown>){return (await hub(ctx,'hub-workflow/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json() as Promise<T>;}
export async function GET(request:Request){try{
 const me=await member(),url=new URL(request.url),ctx=await context(required(url.searchParams.get('roomId'),100),me.id);
 if(url.searchParams.has('messageId')){
  ctx.signal=AbortSignal.timeout(20000);
  const msg=await messageAccess(required(url.searchParams.get('messageId'),80),me.id);
  if(msg.deleted||msg.room_id!==url.searchParams.get('roomId')||msg.user_id!==me.id||msg.parent_id)fail(404,'Open your maintenance issue message.');
  const terms=assetWords(msg.body);let complete=terms.complete;const found:{id:string;name:string;number:string}[]=[];
  for(let i=0;i<terms.queries.length;i+=4){
   const pages=await Promise.all(terms.queries.slice(i,i+4).map(query=>workflow(ctx,'assets',{query})));
   for(const page of pages){if(!Array.isArray(page))fail(503,'Asset lookup is unavailable. Try again.');if(page.length>=20)complete=false;found.push(...page.filter(a=>typeof a.id==='string'&&uuid.test(a.id)&&typeof a.name==='string').map(a=>({id:a.id,name:a.name,number:typeof a.number==='string'?a.number:''})));}
  }
  const row=await db().prepare(messageSelect+'WHERE m.id=?').bind(msg.id).first();
  if(!row)fail(404,'That message is unavailable.');
  return response({matches:matchAssets(msg.body,found),complete,message:(await enrich([row],me.id))[0]});
 }
 const query=(url.searchParams.get('query')||'').trim().slice(0,100);
 const data=await workflow(ctx,'assets',{query});
 if(!Array.isArray(data))fail(503,'Asset lookup is unavailable. Try again.');
 return response({assets:data.filter(a=>typeof a.id==='string'&&uuid.test(a.id)&&typeof a.name==='string').map(a=>({id:a.id,name:a.name,number:typeof a.number==='string'?a.number:''}))});
 }catch(e){return handleError(e);}}
export async function POST(request:Request){try{
 checkOrigin(request);const me=await requireRecent();
 if(!request.headers.get('content-type')?.startsWith('multipart/form-data'))fail(415,'Use the work-order form.');
 const form=await request.formData(),roomId=required(form.get('roomId'),100),ctx=await context(roomId,me.id);
 let id=required(form.get('id'),36),photoId=required(form.get('photoId'),36),publishId=required(form.get('publishId'),36);
 const sourceId=form.get('sourceMessageId');
 if(sourceId){const source=await messageAccess(required(sourceId,80),me.id);if(source.deleted||source.room_id!==roomId)fail(404,'That issue message is unavailable.');const scope=companyId()+':'+me.id+':'+source.id;[id,photoId,publishId]=await Promise.all(['request','photo','publish'].map(label=>sourceOperationId(scope,label)));}
 const asset=required(form.get('asset'),36),description=required(form.get('description'),4000),safety=form.get('safety');
 if(![id,photoId,publishId,asset].every(v=>uuid.test(v))||new Set([id,photoId,publishId]).size!==3||description.length<10||!['true','false'].includes(String(safety)))fail(400,'Choose an asset and describe the issue in at least 10 characters.');
 const photo=form.get('photo');if(!(photo instanceof File)||photo.type!=='image/jpeg'||!photo.size||photo.size>512*1024)fail(400,'Attach a prepared JPG photo of 512 KB or smaller.');
 const bytes=new Uint8Array(await photo.arrayBuffer());if(bytes.length<12||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)fail(400,'Choose a valid photo.');
 // Reuse all operation IDs on retries: create, photo upload, and publish are idempotent in the Hub.
 const created=await workflow<{id:string;number?:string|number}>(ctx,'create',{operation_id:id,id,kind:'requested',asset_id:asset,description,is_safety_critical:safety==='true',is_test:false});
 if(created?.id!==id)fail(503,'The Hub did not confirm your work-order draft. Retry the same form.');
 const stored=await (await hub(ctx,'hub-photo/list',{method:'POST',headers:{'x-work-request-id':id}})).json() as {photos?:{id:string}[]};
 // A successful publish may close uploads before its response reaches the phone.
 // Confirm the existing photo first so that retrying publication never reopens or duplicates it.
 if(!stored?.photos?.some(p=>p.id===photoId))await hub(ctx,'hub-photo/upload',{method:'POST',headers:{'Content-Type':'image/jpeg','x-work-request-id':id,'x-photo-id':photoId},body:bytes});
 const published=await workflow<{id:string;status?:string}>(ctx,'publish',{operation_id:publishId,id});
 if(published?.id!==id)fail(503,'The Hub did not confirm submission. Retry the same form.');
 return response({id,number:created.number??null,status:published.status||'submitted'},201);
 }catch(e){return handleError(e);}}
