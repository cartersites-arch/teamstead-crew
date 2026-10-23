import { db } from './chat-db';
import { BRIDGE_PUBLIC_KEY } from './r2-bridge-public';
import { r2Put,r2Get,digest } from './r2-storage';
export async function copyChatPhotos(request: Request) {
 const timestamp=request.headers.get('x-signed-at')||'',signature=request.headers.get('x-signature')||'';
 if(request.method!=='POST'||Math.abs(Date.now()-Number(timestamp))>60000||!/^\d{13}$/.test(timestamp)||!/^[A-Za-z0-9_-]{86}$/.test(signature))return new Response(null,{status:401});
 const publicKey=await crypto.subtle.importKey('jwk',BRIDGE_PUBLIC_KEY,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const sig=Uint8Array.from(atob(signature.replace(/-/g,'+').replace(/_/g,'/')+'=='),x=>x.charCodeAt(0));
 if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,sig,new TextEncoder().encode('pms-r2-copy-chat-v1\n'+timestamp)))return new Response(null,{status:401});
 const rows=await db().prepare('SELECT po.*,a.mime,m.room_id,m.created_at AS message_at FROM photo_objects po LEFT JOIN attachments a ON a.object_key=po.object_key LEFT JOIN messages m ON m.id=a.message_id ORDER BY po.object_key').all<{object_key:string;body:ArrayBuffer;size:number;created_at:number;mime:string;room_id:string;message_at:number}>();
 let copied=0,profiles=0,total=0;
 for(const row of rows.results){
  const date=new Date(row.message_at||row.created_at).toISOString().slice(0,7).replace('-','/');
  const key=row.room_id?'conversations/'+encodeURIComponent(row.room_id)+'/'+date+'/'+row.object_key.split('/').at(-1):'archive/'+row.object_key;
  const bytes=new Uint8Array(row.body);await r2Put('chat',key,bytes,row.mime||'application/octet-stream');
  const saved=await r2Get('chat',key);if(!saved||await digest(new Uint8Array(await saved.arrayBuffer()))!==await digest(bytes))throw Error('Copy verification failed');
  await db().prepare('INSERT OR IGNORE INTO r2_aliases(legacy_key,object_key) VALUES(?,?)').bind(row.object_key,key).run();copied++;total+=row.size;
 }
 const people=await db().prepare('SELECT user_id,photo,updated_at,r2_key FROM crew_profiles WHERE photo IS NOT NULL').all<{user_id:string;photo:ArrayBuffer;updated_at:number;r2_key:string|null}>();
 for(const row of people.results){
  const bytes=new Uint8Array(row.photo),key='profiles/'+encodeURIComponent(row.user_id)+'/legacy-'+row.updated_at+'.jpg';
  await r2Put('chat',key,bytes,'image/jpeg');const saved=await r2Get('chat',key);if(!saved||await digest(new Uint8Array(await saved.arrayBuffer()))!==await digest(bytes))throw Error('Profile copy verification failed');
  // Keep a newer profile if someone uploads one during the copy.
  await db().prepare('UPDATE crew_profiles SET r2_key=? WHERE user_id=? AND updated_at=? AND r2_key IS NULL').bind(key,row.user_id,row.updated_at).run();profiles++;total+=bytes.length;
 }
 return Response.json({copied,profiles,bytes:total,originalsRetained:true});
}
