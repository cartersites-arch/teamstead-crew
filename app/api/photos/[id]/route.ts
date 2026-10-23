import { env } from 'cloudflare:workers';
import { r2Get } from '@/lib/r2-storage';
import { db,bucket } from '@/lib/chat-db';
import { member,fail,handleError } from '@/lib/chat-server';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const me=await member(),{id}=await params;
    if(id.startsWith('avatar-')){
      const profile=await db().prepare('SELECT cp.photo,cp.photo_mime,cp.r2_key FROM crew_profiles cp JOIN people p ON p.id=cp.user_id WHERE cp.user_id=? AND p.active=1 AND (cp.photo IS NOT NULL OR cp.r2_key IS NOT NULL)').bind(id.slice(7)).first<{photo:ArrayBuffer;photo_mime:string;r2_key:string|null}>();
      if(!profile)fail(404,'Profile photo unavailable.');if(profile.r2_key){if(!env.CHAT_PHOTOS)fail(503,'Profile photo temporarily unavailable.');const object=await r2Get('chat',profile.r2_key);if(!object)fail(503,'Profile photo temporarily unavailable.');return new Response(object.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}return new Response(new Uint8Array(profile.photo),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    const file=await db().prepare('SELECT a.object_key,a.mime,a.name FROM attachments a JOIN messages m ON m.id = a.message_id JOIN room_members rm ON rm.room_id = m.room_id WHERE a.id = ? AND rm.user_id = ? AND m.deleted = 0').bind(id,me.id).first<{object_key:string;mime:string;name:string}>();
    if(!file)fail(404,'Photo not available.');const object=await bucket().get(file.object_key);if(!object)fail(404,'Photo not found.');
    return new Response(object.body,{headers:{'Content-Type':file.mime,'Content-Length':String(object.size),'Content-Disposition':file.mime==='application/pdf'&&new URL(request.url).searchParams.get('download')==='1'?'attachment; filename*=UTF-8\'\''+encodeURIComponent(file.name.replace(/[\r\n]/g,'')):'inline','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
  }catch(e){return handleError(e);}
}
