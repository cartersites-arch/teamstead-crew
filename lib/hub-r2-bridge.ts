import { BRIDGE_PUBLIC_KEY } from './r2-bridge-public';
import { digest,r2Get,r2Put } from './r2-storage';
import { ChatError } from './app-errors';

const encoder=new TextEncoder();
export async function hubR2Bridge(request: Request) {
  const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
  const error=(status:number)=>new Response(null,{status,headers});
  try {
    if(!['GET','PUT'].includes(request.method)||new URL(request.url).search)return error(400);
    const key=request.headers.get('x-object-key')||'',timestamp=request.headers.get('x-signed-at')||'',signature=request.headers.get('x-signature')||'';
    const manual=/^manuals\/rides\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/.test(key);
    if((!manual&&!/^(work-orders\/[0-9a-f-]{36}\/(problem|completion)|parts\/[0-9a-f-]{36})\/[0-9a-f-]{36}\.jpg$/.test(key))||!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>60000||!/^[A-Za-z0-9_-]{86}$/.test(signature))return error(401);
    const limit=manual?20971520:5242880,contentType=manual?'application/pdf':'image/jpeg';
    if(Number(request.headers.get('content-length')||0)>limit)return error(413);
    const chunks:Uint8Array[]=[];let length=0;
    if(request.body){const reader=request.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();return error(413);}chunks.push(value);}}finally{reader.releaseLock();}}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if(request.method==='GET'&&length)return error(400);
    const signed=encoder.encode(['pms-hub-r2-v1',request.method,key,timestamp,await digest(bytes)].join('\n'));
    const publicKey=await crypto.subtle.importKey('jwk',BRIDGE_PUBLIC_KEY,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    const sig=Uint8Array.from(atob(signature.replace(/-/g,'+').replace(/_/g,'/')+'=='),x=>x.charCodeAt(0));
    if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,sig,signed))return error(401);
    if(request.method==='GET'){const object=await r2Get('maintenance',key);return object?new Response(object.body,{headers:{...headers,'Content-Type':contentType}}):error(404);}
    if(!length||request.headers.get('content-type')!==contentType)return error(415);
    if(manual&&new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')return error(415);
    await r2Put('maintenance',key,bytes,contentType);return error(201);
  }catch(e){return error(e instanceof ChatError?e.status:503);}
}

