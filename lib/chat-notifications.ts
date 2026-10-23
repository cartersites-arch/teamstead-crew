import {companyPath} from './company-context';
import {env} from 'cloudflare:workers';
import {db} from './chat-db';
import {fail} from './app-errors';
import {type SessionPerson} from './access';
import {securityGate} from './security-events';
import {pushRequest} from './web-push-request';
import {validateSubscription} from './maintenance-bots';
import {quietNow,mentions} from './chat-notification-rules';
type Preference={user_id:string;auth_version:number;enabled:number;enabled_at:number;quiet_start:number;quiet_end:number;quiet_enabled:number;timezone:string;muted_rooms:string;name:string};
async function driving(userId:string,version:number){return !!await db().prepare('SELECT user_id FROM employee_status WHERE user_id=? AND auth_version=? AND status=? AND expires_at>?').bind(userId,version,'driving',Date.now()).first();}
export async function notificationStatus(userId:string){
 const p=await db().prepare('SELECT cn.* FROM chat_notification_preferences cn JOIN people p ON p.id=cn.user_id WHERE cn.user_id=? AND cn.auth_version=p.auth_version AND p.active=1').bind(userId).first<Preference>();
 return {enabled:!!p?.enabled,quietEnabled:!!p?.quiet_enabled,quietStart:p?.quiet_start??1320,quietEnd:p?.quiet_end??420,timezone:p?.timezone||'UTC',mutedRooms:JSON.parse(p?.muted_rooms||'[]'),pushReady:!!env.VAPID_PUBLIC_KEY&&!!env.VAPID_PRIVATE_KEY,publicKey:env.VAPID_PUBLIC_KEY||'',backgroundReady:!!env.BOT_RUNNER_TOKEN_HASH};
}
export async function updateNotifications(me:SessionPerson,data:Record<string,unknown>){
 if(typeof data.enabled!=='boolean'||typeof data.quietEnabled!=='boolean')fail(400,'Choose your notification settings.');
 const start=Number(data.quietStart),end=Number(data.quietEnd),zone=String(data.timezone||'');
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||start>1439||end<0||end>1439||zone.length>80)fail(400,'Choose valid quiet hours.');
 try{new Intl.DateTimeFormat('en',{timeZone:zone}).format();}catch{fail(400,'Choose a valid time zone.');}
 if(!Array.isArray(data.mutedRooms)||data.mutedRooms.length>100||data.mutedRooms.some(x=>typeof x!=='string'||x.length>100))fail(400,'Choose conversations to mute.');
 const rooms=await db().prepare('SELECT room_id FROM room_members WHERE user_id=?').bind(me.id).all<{room_id:string}>();
 if(data.mutedRooms.some(x=>!rooms.results.some(r=>r.room_id===x)))fail(400,'You can only mute your own conversations.');
 const gate=securityGate(me,'chat_notifications_updated',me.id);
 const results=await db().batch([gate.statement,db().prepare('INSERT INTO chat_notification_preferences (user_id,auth_version,enabled,enabled_at,quiet_start,quiet_end,quiet_enabled,timezone,muted_rooms) SELECT ?,?,?,?,?,?,?,?,? WHERE '+gate.condition+' ON CONFLICT(user_id) DO UPDATE SET enabled_at=CASE WHEN chat_notification_preferences.enabled=0 OR chat_notification_preferences.auth_version<>excluded.auth_version THEN excluded.enabled_at ELSE chat_notification_preferences.enabled_at END,auth_version=excluded.auth_version,enabled=excluded.enabled,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,quiet_enabled=excluded.quiet_enabled,timezone=excluded.timezone,muted_rooms=excluded.muted_rooms').bind(me.id,me.auth_version,data.enabled?1:0,Date.now(),start,end,data.quietEnabled?1:0,zone,JSON.stringify(data.mutedRooms))]);
 if(!results[0].meta.changes)fail(401,'Your account changed. Sign in again.');return notificationStatus(me.id);
}
export async function runChatNotifications(){
 if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY)return {chatChecked:0};
 const now=Date.now(),token=crypto.randomUUID();
 const p=await db().prepare('SELECT cn.*,p.name FROM chat_notification_preferences cn JOIN people p ON p.id=cn.user_id WHERE cn.enabled=1 AND p.active=1 AND p.auth_version=cn.auth_version AND cn.lease_until<? AND cn.last_attempt<? ORDER BY cn.last_attempt LIMIT 1').bind(now,now-60000).first<Preference>();
 if(!p)return {chatChecked:0};
 const lease=await db().prepare('UPDATE chat_notification_preferences SET lease_until=?,lease_token=?,last_attempt=? WHERE user_id=? AND lease_until<? AND enabled=1 AND auth_version=?').bind(now+55000,token,now,p.user_id,now,p.auth_version).run();
 if(!lease.meta.changes)return {chatChecked:0};
 try{
  if((p.quiet_enabled&&quietNow(p.quiet_start,p.quiet_end,p.timezone))||await driving(p.user_id,p.auth_version))return {chatChecked:1};
  const devices=await db().prepare('SELECT id,subscription FROM push_devices WHERE user_id=? AND auth_version=? LIMIT 5').bind(p.user_id,p.auth_version).all<{id:string;subscription:string}>();
  const muted=JSON.parse(p.muted_rooms) as string[];
  for(const device of devices.results){
   const rows=await db().prepare('SELECT m.id,m.room_id,m.body,r.kind,COALESCE(cp.notification,\'mentions\') AS notification FROM messages m JOIN rooms r ON r.id=m.room_id JOIN room_members rm ON rm.room_id=m.room_id JOIN people sender ON sender.id=m.user_id LEFT JOIN conversation_preferences cp ON cp.room_id=m.room_id AND cp.user_id=rm.user_id WHERE rm.user_id=? AND m.user_id<>? AND sender.role<>? AND m.deleted=0 AND m.created_at>rm.read_at AND m.created_at>? AND r.kind IN (?,?) AND NOT EXISTS(SELECT 1 FROM chat_push_receipts cr WHERE cr.device_id=? AND cr.message_id=m.id) ORDER BY m.created_at DESC,m.id DESC LIMIT 80').bind(p.user_id,p.user_id,'bot',Math.max(p.enabled_at,now-86400000),'dm','channel',device.id).all<{id:string;room_id:string;body:string;kind:string;notification:string}>();
   const eligible=rows.results.filter(m=>!muted.includes(m.room_id)&&m.notification!=='muted'&&(m.notification==='all'||m.kind==='dm'||mentions(m.body,p.name)));
   if(!eligible.length)continue;const message=eligible[0];
   // Recheck account, membership and preferences immediately before contacting the provider.
   const current=await db().prepare('SELECT cn.* FROM chat_notification_preferences cn JOIN people p ON p.id=cn.user_id JOIN room_members rm ON rm.user_id=p.id WHERE cn.user_id=? AND cn.enabled=1 AND cn.auth_version=? AND p.auth_version=cn.auth_version AND p.active=1 AND rm.room_id=?').bind(p.user_id,p.auth_version,message.room_id).first<Preference>();
   if(!current||JSON.parse(current.muted_rooms).includes(message.room_id)||(current.quiet_enabled&&quietNow(current.quiet_start,current.quiet_end,current.timezone)))continue;
   const roomPref=await db().prepare('SELECT notification FROM conversation_preferences WHERE user_id=? AND room_id=?').bind(p.user_id,message.room_id).first<{notification:string}>();if(roomPref?.notification==='muted')continue;
   if(roomPref?.notification!=='all'&&message.kind!=='dm'&&!mentions(message.body,p.name))continue;
   if(await driving(p.user_id,p.auth_version))continue;
   const request=await pushRequest(validateSubscription(JSON.parse(device.subscription)),JSON.stringify({title:'Teamstead Crew',body:'You have a new chat message.',url:companyPath('/?room='+encodeURIComponent(message.room_id)),kind:'chat'}),env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
   const response=await fetch(request.endpoint,{method:'POST',headers:request.headers,body:new Uint8Array(request.body),redirect:'manual',signal:AbortSignal.timeout(8000)});
   if(response.status===404||response.status===410){await db().prepare('DELETE FROM push_devices WHERE id=? AND user_id=?').bind(device.id,p.user_id).run();continue;}
   if(!response.ok)continue;
   const ids=eligible.filter(m=>m.room_id===message.room_id).map(m=>m.id);
   await db().prepare('INSERT OR IGNORE INTO chat_push_receipts (device_id,message_id,created_at) SELECT ?,value,? FROM json_each(?)').bind(device.id,now,JSON.stringify(ids)).run();
  }
  await db().prepare('DELETE FROM chat_push_receipts WHERE created_at<?').bind(now-172800000).run();
  return {chatChecked:1};
 }finally{await db().prepare('UPDATE chat_notification_preferences SET lease_until=0,lease_token=? WHERE user_id=? AND lease_token=?').bind('',p.user_id,token).run();}
}
