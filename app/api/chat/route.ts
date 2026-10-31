import {removeCompanyPerson} from '@/lib/member-removal';
import {companyProducts} from '@/lib/company-products';
import {revokeCombinedMember} from '@/lib/company-members';
import { companyPath,companyId } from '@/lib/company-context';
import { env } from 'cloudflare:workers';
import { r2Put } from '@/lib/r2-storage';
import { db,rawDb } from '@/lib/chat-db';
import { member,roomAccess,messageAccess,messageSelect,enrich,sendMessage,response,handleError,checkOrigin,required,str,fail } from '@/lib/chat-server';
import { requireRecent,currentSession } from '@/lib/access';
import { securityGate } from '@/lib/security-events';
import { deleteMessage } from '@/lib/file-deletions';
import { sanitizeForAi } from '@/lib/ai-privacy';
import { notificationStatus,updateNotifications } from '@/lib/chat-notifications';
import { subscribe,unsubscribe } from '@/lib/maintenance-bots';
export const dynamic='force-dynamic';

export async function GET(request:Request) {
  try {
    const me=await member(), database=db(), url=new URL(request.url), action=url.searchParams.get('action')||'state';
    if(action==='notification_settings')return response(await notificationStatus(me.id));
    if(action==='state') {
      const [workspace,members,rooms,memberships,invitations]=await Promise.all([
        database.prepare("SELECT id,name,owner_id,ai_enabled,(logo_data IS NOT NULL AND logo_data <> '') AS has_logo FROM workspace WHERE id = ?").bind('main').first(),
        database.prepare('SELECT id,name,role,active,joined_at'+(me.role==='owner'?',email':'')+' FROM people WHERE active = 1 ORDER BY joined_at,id').all(),
        database.prepare('SELECT r.*, (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id AND m.created_at > rm.read_at AND m.user_id <> ? AND m.deleted = 0) AS unread,(SELECT MAX(created_at) FROM messages m WHERE m.room_id = r.id) AS last_at FROM rooms r JOIN room_members rm ON rm.room_id = r.id WHERE rm.user_id = ? ORDER BY r.created_at,r.name').bind(me.id,me.id).all(),
        database.prepare('SELECT other.room_id,other.user_id FROM room_members other JOIN room_members mine ON mine.room_id = other.room_id WHERE mine.user_id = ?').bind(me.id).all(),
        me.role==='owner'?database.prepare('SELECT email,name,room_ids FROM invitations ORDER BY created_at').all():Promise.resolve({results:[]}),
      ]);
      const prefs=await database.prepare('SELECT * FROM conversation_preferences WHERE user_id=?').bind(me.id).all();
      const profiles=await database.prepare("SELECT user_id,job_title,updated_at,(photo IS NOT NULL OR r2_key IS NOT NULL) AS has_photo FROM crew_profiles").all();
      const statuses=await database.prepare('SELECT s.user_id,s.status,s.expires_at FROM employee_status s JOIN people p ON p.id=s.user_id WHERE p.active=1 AND s.auth_version=p.auth_version AND s.expires_at>?').bind(Date.now()).all<{user_id:string;status:string;expires_at:number}>();
      const withStatus=(person:any)=>{const s=statuses.results.find(s=>s.user_id===person.id);const p=profiles.results.find(p=>p.user_id===person.id);return {...person,job_title:p?.job_title||'',photo_url:p?.has_photo?companyPath('/api/photos/avatar-'+person.id+'?v='+p.updated_at):'',status:s?.status||null,status_expires_at:s?.expires_at||0};};
      const registry=/^c_/.test(companyId())?await rawDb().prepare('SELECT hub_ready FROM company_registry WHERE id=?').bind(companyId()).first<{hub_ready:number}>():null;
      const products=await companyProducts();return response({products,companyReady:registry?(products.hub?!!registry.hub_ready:(await rawDb().prepare('SELECT status FROM company_registry WHERE id=?').bind(companyId()).first<{status:string}>())?.status==='active'):true,me:withStatus(me),workspace,members:members.results.map(withStatus),rooms:rooms.results.map(r=>({...r,...(prefs.results.find(p=>p.room_id===r.id)||{}),memberIds:memberships.results.filter(x=>x.room_id===r.id).map(x=>x.user_id)})),invitations:invitations.results});
    }
    if(action==='ai_permission'){const w=await database.prepare('SELECT ai_enabled FROM workspace WHERE id = ?').bind('main').first<{ai_enabled:number}>();return response({enabled:!!w?.ai_enabled});}
    if(action==='ai_context'){
      const enabled=await database.prepare('SELECT ai_enabled FROM workspace WHERE id = ?').bind('main').first<{ai_enabled:number}>();if(!enabled?.ai_enabled)fail(403,'AI shortcuts are disabled for this workspace.');
      const msg=await messageAccess(required(url.searchParams.get('id')),me.id);if(msg.deleted)fail(404,'That message has been removed.');return response(sanitizeForAi(msg.body));
    }
    if(action==='messages') {
      const roomId=required(url.searchParams.get('roomId')); await roomAccess(roomId,me.id);
      const parentId=url.searchParams.get('parentId'),before=url.searchParams.get('before');
      let parent=null;
      if(parentId) {const p=await messageAccess(parentId,me.id);if(p.room_id!==roomId||p.parent_id)fail(404,'Thread unavailable.');parent=await database.prepare(messageSelect+'WHERE m.id = ?').bind(parentId).first();}
      const params:(string|number)[]=[roomId];let where='WHERE m.room_id = ? AND m.parent_id '+(parentId?'= ?':'IS NULL'); if(parentId)params.push(parentId);
      if(before) { const split=before.indexOf(':');const at=Number(before.slice(0,split));const id=before.slice(split+1);if(split<1||!Number.isFinite(at)||!id)fail(400,'Invalid message page.');where+=' AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))';params.push(at,at,id); }
      const list=await database.prepare(messageSelect+where+' ORDER BY m.created_at DESC,m.id DESC LIMIT 81').bind(...params).all();
      const hasMore=list.results.length>80,rows=list.results.slice(0,80).reverse();
      const messages=await enrich(rows,me.id);
      return response({messages,parent:parent?(await enrich([parent],me.id))[0]:null,hasMore,serverTime:Date.now()});
    }
    if(action==='search'||action==='files'||action==='pins'||action==='saved') {
      const roomId=url.searchParams.get('roomId'); const q=str(url.searchParams.get('q')||'',200);
      if(action==='search'&&q.length<2)return response({messages:[]});
      const params:(string|number)[]=[me.id];let where='JOIN room_members rm ON rm.room_id = m.room_id WHERE rm.user_id = ? AND m.deleted = 0';
      if(roomId) { await roomAccess(roomId,me.id);where+=' AND m.room_id = ?';params.push(roomId); }
      if(action==='search'){where+=' AND instr(lower(m.body),lower(?)) > 0';params.push(q);}
      if(action==='files')where+=' AND EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)';
      if(action==='pins')where+=' AND m.pinned = 1';
      if(action==='saved'){where+=' AND EXISTS (SELECT 1 FROM saved_messages sm WHERE sm.message_id=m.id AND sm.user_id=?)';params.push(me.id);}
      const rows=await database.prepare(messageSelect+where+' ORDER BY m.created_at DESC,m.id DESC LIMIT 100').bind(...params).all();
      return response({messages:await enrich(rows.results,me.id)});
    }
    fail(400,'Unknown request.');
  }catch(e){return handleError(e);}
}

export async function POST(request:Request) {
  try {
    checkOrigin(request);const me=await member(),database=db();
    if(request.headers.get('content-type')?.startsWith('multipart/form-data')){
      if(new URL(request.url).searchParams.get('action')==='profile_photo'){
        const data=await request.formData(),file=data.get('photo');if(!file||typeof file==='string'||file.size>512*1024)fail(413,'Choose a profile photo of 512 KB or smaller.');
        const bytes=new Uint8Array(await file.arrayBuffer());if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)fail(415,'Choose a JPG profile photo.');
        if(env.CHAT_PHOTOS){const now=Date.now(),key='profiles/'+encodeURIComponent(me.id)+'/'+crypto.randomUUID()+'.jpg';await r2Put('chat',key,bytes,'image/jpeg');await database.prepare("INSERT INTO crew_profiles(user_id,r2_key,photo_mime,updated_at) VALUES(?,?,'image/jpeg',?) ON CONFLICT(user_id) DO UPDATE SET r2_key=excluded.r2_key,photo_mime=excluded.photo_mime,updated_at=excluded.updated_at").bind(me.id,key,now).run();return response({ok:true});}
        await database.prepare("INSERT INTO crew_profiles (user_id,photo,photo_mime,updated_at) VALUES (?,?,'image/jpeg',?) ON CONFLICT(user_id) DO UPDATE SET photo=excluded.photo,photo_mime=excluded.photo_mime,updated_at=excluded.updated_at").bind(me.id,bytes,Date.now()).run();return response({ok:true});
      }return await sendMessage(request,me);
    }
    if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'Use a supported message format.');
    const raw=await request.text();if(raw.length>32000)fail(413,'This change is too large.');
    let data:Record<string,unknown>;try{data=JSON.parse(raw);}catch{fail(400,'Please try that again.');}
    if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'Please try that again.');
    const action=required(data.action);
    if(action==='set_status'){
      const statusActor=await currentSession();if(statusActor.id!==me.id)fail(401,'Sign in again.');
      const status=required(data.status,20),hours=Number(data.hours);
      if(!['available','working','away','driving','clear'].includes(status)||![1,4,8].includes(hours))fail(400,'Choose a status and duration.');
      if(status==='clear')await database.prepare('DELETE FROM employee_status WHERE user_id=?').bind(me.id).run();
      else await database.prepare('INSERT INTO employee_status (user_id,status,expires_at,auth_version) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM people WHERE id=? AND active=1 AND auth_version=?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,expires_at=excluded.expires_at,auth_version=excluded.auth_version').bind(me.id,status,Date.now()+hours*3600000,statusActor.auth_version,me.id,statusActor.auth_version).run();
      return response({ok:true});
    }
    if(action==='notification_settings')return response(await updateNotifications(await requireRecent(),data));
    if(action==='notification_subscribe')return response(await subscribe(await requireRecent(),data.subscription,true));
    if(action==='notification_unsubscribe')return response(await unsubscribe(await requireRecent(),data.id));
    if(action==='read') {
      const roomId=required(data.roomId);await roomAccess(roomId,me.id);
      const through=Number(data.through);if(!Number.isFinite(through)||through<0)fail(400,'Invalid read time.');
      await database.prepare('UPDATE room_members SET read_at = MAX(read_at,?) WHERE room_id = ? AND user_id = ?').bind(Math.min(through,Date.now()),roomId,me.id).run();return response({ok:true});
    }
    if(action==='conversation_preferences'){
      const roomId=required(data.roomId);await roomAccess(roomId,me.id);
      if(typeof data.favorite!=='boolean'||!['all','mentions','muted'].includes(String(data.notification)))fail(400,'Choose valid conversation settings.');
      const section=str(data.section||'',40);
      await database.prepare('INSERT INTO conversation_preferences (user_id,room_id,favorite,section,notification) VALUES (?,?,?,?,?) ON CONFLICT(user_id,room_id) DO UPDATE SET favorite=excluded.favorite,section=excluded.section,notification=excluded.notification').bind(me.id,roomId,data.favorite?1:0,section,data.notification).run();return response({ok:true});
    }
    if(action==='save_message'){
      const id=required(data.id),msg=await messageAccess(id,me.id);if(msg.deleted)fail(404,'This message was removed.');
      if(data.saved===false)await database.prepare('DELETE FROM saved_messages WHERE user_id=? AND message_id=?').bind(me.id,id).run();
      else await database.prepare('INSERT OR IGNORE INTO saved_messages (user_id,message_id,saved_at) VALUES (?,?,?)').bind(me.id,id,Date.now()).run();return response({ok:true});
    }
    if(action==='profile_details'){
      const jobTitle=str(data.jobTitle||'',60);await database.prepare('INSERT INTO crew_profiles (user_id,job_title) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET job_title=excluded.job_title').bind(me.id,jobTitle).run();return response({ok:true});
    }
    if(action==='profile') {
      const name=required(data.name,60);await database.prepare('UPDATE people SET name = ? WHERE id = ?').bind(name,me.id).run();return response({ok:true});
    }
    if(action==='rename_workspace') {
      if(me.role!=='owner')fail(403,'Only the workspace owner can change its name.');
      const name=required(data.name,60);await database.prepare('UPDATE workspace SET name = ? WHERE id = ?').bind(name,'main').run();return response({ok:true});
    }
    if(action==='create_channel') {
      if(!['owner','admin'].includes(me.role))fail(403,'Only an owner or manager can create channels.');
      const name=required(data.name,45).toLowerCase().replace(/\s+/g,'-'); if(!/^[a-z0-9][a-z0-9_-]*$/.test(name))fail(400,'Use letters, numbers, hyphens, or underscores for the channel name.');
      const description=str(data.description||'',250),visibility=data.visibility==='shared'?'shared':'private',id=crypto.randomUUID(),verified=await requireRecent(),gate=securityGate(verified,'channel_created',me.id);
      const selected=await selectedPeople(data.memberIds,me.id);
      const result=await database.batch([gate.statement,
        database.prepare('INSERT INTO rooms (id,name,description,kind,visibility,created_by,created_at) SELECT ?,?,?, ?,?,?,? WHERE '+gate.condition).bind(id,name,description,'channel',visibility,me.id,Date.now()),
        ...(visibility==='shared'?[database.prepare('INSERT INTO room_members (room_id,user_id,read_at) SELECT ?,id,0 FROM people WHERE active = 1 AND '+gate.condition).bind(id)]:selected.map(userId=>database.prepare('INSERT INTO room_members (room_id,user_id,read_at) SELECT ?,?,0 WHERE '+gate.condition).bind(id,userId))),
      ]);if(!result[0].meta.changes)fail(401,'Your session changed. Sign in again.');return response({id},201);
    }
    if(action==='update_channel') {
      const roomId=required(data.roomId),room=await roomAccess(roomId,me.id);
      if(room.kind!=='channel'||!['owner','admin'].includes(me.role))fail(403,'Only an owner or manager can edit channels.');
      const name=required(data.name,45).toLowerCase().replace(/\s+/g,'-');if(!/^[a-z0-9][a-z0-9_-]*$/.test(name))fail(400,'Use letters, numbers, hyphens, or underscores for the channel name.');
      const description=str(data.description||'',250),visibility=data.visibility==='shared'?'shared':'private', selected=await selectedPeople(data.memberIds,me.id);
      // Keep the caller in the channel; choose the entire audience explicitly for a private channel.
      const verified=await requireRecent(),gate=securityGate(verified,'channel_permissions_changed',me.id);
      const result=await database.batch([gate.statement,
        database.prepare('UPDATE rooms SET name = ?,description = ?,visibility = ? WHERE id = ? AND '+gate.condition).bind(name,description,visibility,roomId),
        database.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id NOT IN ('+(visibility==='shared'?'SELECT id FROM people WHERE active = 1':selected.map(()=>'?').join(','))+') AND '+gate.condition).bind(roomId,...(visibility==='shared'?[]:selected)),
        ...(visibility==='shared'?[database.prepare('INSERT OR IGNORE INTO room_members (room_id,user_id,read_at) SELECT ?,id,0 FROM people WHERE active = 1 AND '+gate.condition).bind(roomId)]:selected.map(id=>database.prepare('INSERT OR IGNORE INTO room_members (room_id,user_id,read_at) SELECT ?,?,0 WHERE '+gate.condition).bind(roomId,id))),
      ]);if(!result[0].meta.changes)fail(401,'Your session changed. Sign in again.');return response({ok:true});
    }
    if(action==='dm') {
      const other=required(data.userId);if(other===me.id)fail(400,'Choose another person.');
      if(!await database.prepare('SELECT id FROM people WHERE id = ? AND active = 1').bind(other).first())fail(404,'This person has not joined the workspace.');
      const pair=[me.id,other].sort(),key=JSON.stringify(pair),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)),id='dm-'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      await database.batch([
        database.prepare('INSERT OR IGNORE INTO rooms (id,name,description,kind,visibility,dm_key,created_by,created_at) VALUES (?, ?,?, ?,?,?,?,?)').bind(id,'Direct message','Private to the two members in the app. Workspace operators can access stored data.','dm','private',key,me.id,Date.now()),
        ...pair.map(userId=>database.prepare('INSERT OR IGNORE INTO room_members (room_id,user_id,read_at) VALUES (?,?,0)').bind(id,userId)),
      ]);return response({id});
    }
    if(['edit','delete','pin','react'].includes(action)) {
      const id=required(data.id),msg=await messageAccess(id,me.id);
      if(action==='edit'||action==='delete') {
        if(msg.user_id!==me.id)fail(403,'You can only change your own messages.');
        if(action==='delete')return response(await deleteMessage(id,me));
        if(msg.deleted)fail(400,'This message was removed.');
        const body=str(data.body);if(!body&&!await database.prepare('SELECT id FROM attachments WHERE message_id = ?').bind(id).first())fail(400,'A message needs text or a photo.');
        await database.prepare('UPDATE messages SET body = ?,edited_at = ? WHERE id = ?').bind(body,Date.now(),id).run();return response({ok:true});
      }
      if(msg.deleted)fail(400,'This message was removed.');
      if(action==='pin'){await database.prepare('UPDATE messages SET pinned = ? WHERE id = ?').bind(data.pinned?1:0,id).run();return response({ok:true});}
      const emoji=required(data.emoji,12);if(!['👍','❤️','✅','🎉','👀'].includes(emoji))fail(400,'Choose an available reaction.');
      if(data.active===false)await database.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').bind(id,me.id,emoji).run();
      else await database.prepare('INSERT OR IGNORE INTO reactions (message_id,user_id,emoji) VALUES (?,?,?)').bind(id,me.id,emoji).run();return response({ok:true});
    }
    if(action==='remove_member') {
      return response(await removeCompanyPerson(await requireRecent(),data));
    }
    fail(400,'Unknown change.');
  }catch(e){return handleError(e);}
}
async function selectedPeople(value:unknown,me:string):Promise<string[]> {
  const ids=Array.isArray(value)?value.filter((v):v is string=>typeof v==='string').slice(0,80):[];const result=Array.from(new Set([me,...ids]));
  for(const id of result)if(!await db().prepare('SELECT id FROM people WHERE id = ? AND active = 1').bind(id).first())fail(400,'Choose people who have joined the workspace.');return result;
}
