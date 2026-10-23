import { companyPath,companyId } from './company-context';
import {env} from 'cloudflare:workers';
import {pushRequest} from './web-push-request';
import {db} from './chat-db';
import {connectionUrl} from './maintenance-links';
import {fail} from './app-errors';
import {tokenHash,type SessionPerson} from './access';
import {securityGate} from './security-events';
import {scopedJobs,changes,openJob,jobLine,type Job} from './maintenance-bot-rules';

type Preference={user_id:string;enabled:number;auth_version:number;connection_iv:string;room_id:string;actor_id:string|null;snapshot:string;last_checked:number;last_error:string;lease_until:number;lease_token:string;enabled_at:number};
const valid="bp.enabled = 1 AND p.active = 1 AND p.auth_version = bp.auth_version AND ml.iv = bp.connection_iv";
const join='FROM bot_preferences bp JOIN people p ON p.id = bp.user_id JOIN maintenance_links ml ON ml.user_id = p.id';
function guard(userId:string){return db().prepare('SELECT bp.* '+join+' WHERE '+valid+' AND bp.user_id = ?').bind(userId).first<Preference>();}
export async function botStatus(userId:string){
 const p=await guard(userId);const devices=await db().prepare('SELECT COUNT(*) AS n FROM push_devices d JOIN people p ON p.id = d.user_id WHERE d.user_id = ? AND d.auth_version = p.auth_version AND p.active = 1').bind(userId).first<{n:number}>();
 return {enabled:!!p,roomId:p?.room_id,lastChecked:p?.last_checked||0,error:p?.last_error||'',pushReady:!!env.VAPID_PUBLIC_KEY&&!!env.VAPID_PRIVATE_KEY,publicKey:env.VAPID_PUBLIC_KEY||'',deviceCount:devices?.n||0,backgroundReady:!!env.BOT_RUNNER_TOKEN_HASH};
}
export async function enableBot(me:SessionPerson,enabled:boolean){
 const link=await db().prepare('SELECT iv FROM maintenance_links WHERE user_id = ?').bind(me.id).first<{iv:string}>();if(enabled&&!link)fail(400,'Connect your own Maintenance Hub link first.');
 const room='maintenance-'+me.id,gate=securityGate(me,enabled?'maintenance_bots_enabled':'maintenance_bots_disabled',me.id),now=Date.now();
 const results=await db().batch([gate.statement,
 db().prepare("INSERT OR IGNORE INTO rooms (id,name,description,kind,visibility,created_by,created_at) SELECT ?,'My Maintenance Bot','Your private job updates. Type /my-jobs to see your current jobs.','bot','private',?,? WHERE "+gate.condition).bind(room,me.id,now),
 db().prepare('INSERT OR IGNORE INTO room_members (room_id,user_id,read_at) SELECT ?,?,0 WHERE '+gate.condition).bind(room,me.id),
 db().prepare('INSERT INTO bot_preferences (user_id,enabled,auth_version,connection_iv,room_id,enabled_at) SELECT ?,?,?,?,?,? WHERE '+gate.condition+' ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,auth_version=excluded.auth_version,connection_iv=excluded.connection_iv,actor_id=NULL,snapshot=\'[]\',last_checked=0,last_error=\'\',enabled_at=excluded.enabled_at').bind(me.id,enabled?1:0,me.auth_version,link?.iv||'',room,now),
 db().prepare('DELETE FROM push_devices WHERE user_id = ? AND NOT EXISTS(SELECT 1 FROM chat_notification_preferences cn WHERE cn.user_id=push_devices.user_id AND cn.enabled=1 AND cn.auth_version=push_devices.auth_version) AND '+gate.condition).bind(me.id)]);
 if(!results[0].meta.changes)fail(401,'Your account changed. Sign in again.');return botStatus(me.id);
}
export function validateSubscription(value:any){
 if(!value||typeof value.endpoint!=='string'||value.endpoint.length>2048)fail(400,'Invalid phone notification subscription.');
 let url:URL;try{url=new URL(value.endpoint);}catch{fail(400,'Invalid notification address.');}
 const host=url.hostname;const allowed=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.apple.com')||host==='web.push.apple.com'||host.endsWith('.notify.windows.com');
 if(url.protocol!=='https:'||!allowed||url.port||url.username||url.password||url.hash)fail(400,'This notification provider is not supported.');
 const key=value.keys?.p256dh,auth=value.keys?.auth;
 if(typeof key!=='string'||!/^[-_A-Za-z0-9]{87}={0,2}$/.test(key)||typeof auth!=='string'||!/^[-_A-Za-z0-9]{22}={0,2}$/.test(auth))fail(400,'Invalid notification keys.');
 return {endpoint:url.href,keys:{p256dh:key,auth}};
}
export async function subscribe(me:SessionPerson,value:unknown,chat=false){
 if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY)fail(503,'Phone notifications are still being configured.');
 if(chat){const {notificationStatus}=await import('./chat-notifications');if(!(await notificationStatus(me.id)).enabled)fail(400,'Enable your chat alerts first.');}else if(!await guard(me.id))fail(400,'Enable your Maintenance bots first.');const sub=validateSubscription(value),id=await tokenHash(sub.endpoint),gate=securityGate(me,'phone_notifications_enabled',me.id);
 const existing=await db().prepare('SELECT user_id FROM push_devices WHERE id = ?').bind(id).first<{user_id:string}>();if(existing&&existing.user_id!==me.id)fail(409,'Turn off phone notifications in the previous account before enabling them here.');
 const count=await db().prepare('SELECT COUNT(*) AS n FROM push_devices WHERE user_id = ?').bind(me.id).first<{n:number}>();if(!existing&&(count?.n||0)>=5)fail(400,'You have five notification devices. Remove one before adding another.');
 const r=await db().batch([gate.statement,db().prepare('INSERT INTO push_devices (id,user_id,auth_version,subscription,created_at) SELECT ?,?,?,?,? WHERE '+gate.condition+' ON CONFLICT(id) DO UPDATE SET auth_version=excluded.auth_version,subscription=excluded.subscription,created_at=excluded.created_at').bind(id,me.id,me.auth_version,JSON.stringify(sub),Date.now())]);if(!r[0].meta.changes)fail(401,'Sign in again.');return {id};
}
export async function unsubscribe(me:SessionPerson,id:unknown){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail(400,'Choose your notification device.');const gate=securityGate(me,'phone_notifications_disabled',me.id);const r=await db().batch([gate.statement,db().prepare('DELETE FROM push_devices WHERE id = ? AND user_id = ? AND '+gate.condition).bind(id,me.id)]);if(!r[0].meta.changes)fail(401,'Sign in again.');return {ok:true};}

async function hubJobs(userId:string){
 const link=await connectionUrl(userId);if(!link)fail(400,'Reconnect your personal Hub link.');const token=new URLSearchParams(new URL(link).hash.slice(1)).get('hub');
 const jobs=new Map<string,Job>();let cursor:any=null,actor='';
 for(let page=0;page<10;page++){
  const res=await fetch('https://fhqmnlpgqslllzrovxbp.supabase.co/functions/v1/'+(companyId()==='main'?'hub-read':'company-hub/hub-read'),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(cursor?{cursor}:{}),redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!res.ok)fail(503,res.status===401||res.status===403?'The Hub needs a fresh personal link or manager verification. Open your Hub, then reconnect if needed.':'Maintenance Hub is unavailable. Try again later.');
  const raw=await res.text();if(raw.length>8*1024*1024)fail(503,'The Hub response is too large.');let data:any;try{data=JSON.parse(raw);}catch{fail(503,'The Hub response was unavailable.');}
  const id=data?.employee?.id;if(typeof id!=='string'||(actor&&actor!==id))fail(503,'Your Hub identity changed. Reconnect your link.');actor=id;
  for(const job of scopedJobs(data))jobs.set(job.id,job);
  if(jobs.size>1000)fail(503,'Too many personal jobs to check safely. Open your Hub for the full list.');if(!data.has_more)return {actor,jobs:[...jobs.values()]};
  if(!data.next_cursor||JSON.stringify(cursor)===JSON.stringify(data.next_cursor))fail(503,'Your Hub jobs could not be fully loaded.');cursor=data.next_cursor;
 }
 fail(503,'Too many Hub pages to check safely. Ask your administrator to narrow your Hub access.');
}
async function emit(p:Preference,key:string,body:string){
 const id=await tokenHash(`${p.user_id}:${p.enabled_at}:${key}`),now=Date.now();
 const condition='EXISTS (SELECT 1 '+join+' WHERE '+valid+' AND bp.user_id = ? AND bp.enabled_at = ? AND bp.connection_iv = ? AND bp.auth_version = ? AND EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = bp.room_id AND rm.user_id = bp.user_id))';
 await db().batch([db().prepare('INSERT OR IGNORE INTO messages (id,room_id,user_id,body,created_at) SELECT ?,?,\'maintenance-bot\',?,? WHERE '+condition).bind(id,p.room_id,body.slice(0,9500),now,p.user_id,p.enabled_at,p.connection_iv,p.auth_version),db().prepare('INSERT OR IGNORE INTO bot_events (id,user_id,message_id,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM messages WHERE id = ?)').bind(id,p.user_id,id,now,id)]);
}
export async function checkJobs(userId:string,command=false,commandId:string=crypto.randomUUID()){
 const p=await guard(userId);if(!p)fail(400,'Enable your Maintenance bots and reconnect your personal Hub if needed.');
 const now=Date.now(),lease=crypto.randomUUID();const claim=await db().prepare('UPDATE bot_preferences SET last_attempt = ?, lease_until = ?, lease_token = ? WHERE user_id = ? AND enabled = 1 AND lease_until < ?').bind(now,now+180000,lease,userId,now).run();if(!claim.meta.changes)fail(409,'Your Maintenance bot is checking jobs. Try again shortly.');
 try{
  const snapshot=await hubJobs(userId);if(p.actor_id&&p.actor_id!==snapshot.actor)fail(400,'Your personal Hub identity changed. Reconnect and enable the bot again.');
  const current=await guard(userId);if(!current||current.enabled_at!==p.enabled_at||current.connection_iv!==p.connection_iv||current.auth_version!==p.auth_version)fail(409,'Your Hub connection changed during the check.');
  const old=new Map((JSON.parse(p.snapshot) as Job[]).map(j=>[j.id,j]));const day=new Date(now).toISOString().slice(0,10);
  const groups=new Map<string,{key:string;body:string}[]>();
  for(const job of snapshot.jobs)for(const event of changes(job,old.get(job.id),day,!p.last_checked)){const type=event.key.split(':')[0];groups.set(type,[...(groups.get(type)||[]),event]);}
  for(const [type,events] of groups){const key=type+':'+await tokenHash(events.map(e=>e.key).sort().join('|'));await emit(p,key,events.slice(0,15).map(e=>e.body).join('\n\n')+(events.length>15?'\n\nMore updates are available in your Maintenance Hub.':''));}
  if(command){const active=snapshot.jobs.filter(openJob);await emit(p,'command:'+commandId,active.length?'Your jobs ('+active.length+')\n\n'+active.slice(0,20).map(jobLine).join('\n\n')+(active.length>20?'\n\nOpen your Maintenance Hub for the full list.':''):'You have no open jobs requested by or assigned to you.');}
  const condition='EXISTS (SELECT 1 '+join+' WHERE '+valid+' AND bp.user_id = ? AND bp.enabled_at = ? AND bp.lease_token = ?)';
  await db().prepare('UPDATE bot_preferences SET snapshot = ?,actor_id = ?,last_checked = ?,last_error = \'\' WHERE user_id = ? AND '+condition).bind(JSON.stringify(snapshot.jobs),snapshot.actor,now,userId,userId,p.enabled_at,lease).run();return {roomId:p.room_id,count:snapshot.jobs.filter(openJob).length};
 }catch(e){await db().prepare("UPDATE bot_preferences SET last_error = 'The Hub check needs attention. Open your Hub or refresh your connection.' WHERE user_id = ? AND lease_token = ?").bind(userId,lease).run();throw e;}
 finally{await db().prepare('UPDATE bot_preferences SET lease_until = 0,lease_token = \'\' WHERE user_id = ? AND lease_token = ?').bind(userId,lease).run();}
}
export async function sendPush(userId:string,test=false,through=Date.now()){
 if(!env.VAPID_PRIVATE_KEY||!env.VAPID_PUBLIC_KEY)fail(503,'Phone notifications are still being configured.');const p=await guard(userId);if(!p)return;
 const devices=await db().prepare('SELECT id,subscription,last_sent FROM push_devices WHERE user_id = ? AND auth_version = ?').bind(userId,p.auth_version).all<{id:string;subscription:string;last_sent:number}>();
 for(const device of devices.results){
  if(!test&&device.last_sent>=through)continue;
  const sub=validateSubscription(JSON.parse(device.subscription));
  const details=await pushRequest(sub,JSON.stringify({title:'Teamstead Crew',body:test?'Your phone notification test is ready.':'You have a new Maintenance update.',url:companyPath('/?room='+encodeURIComponent(p.room_id))}),env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
  const res=await fetch(details.endpoint,{method:'POST',headers:details.headers as Record<string,string>,body:new Uint8Array(details.body!),redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(res.status===404||res.status===410)await db().prepare('DELETE FROM push_devices WHERE id = ? AND user_id = ?').bind(device.id,userId).run();
  else if(!res.ok)fail(503,'Your phone notification provider could not accept this alert. Try again later.');
  else await db().prepare('UPDATE push_devices SET last_sent = ? WHERE id = ?').bind(through,device.id).run();
 }
}
export async function runBots(){
 const {runChatNotifications}=await import('./chat-notifications');let chat={chatChecked:0};try{chat=await runChatNotifications();}catch{/* A chat-provider failure must not interrupt maintenance reminders. */}
 const candidates=await db().prepare('SELECT bp.user_id '+join+' WHERE '+valid+' AND bp.last_attempt < ? AND bp.lease_until < ? ORDER BY bp.last_attempt LIMIT 1').bind(Date.now()-240000,Date.now()).all<{user_id:string}>();let checked=0;
 for(const row of candidates.results){try{await checkJobs(row.user_id);checked++;}catch{/* Record only generic status in the user's settings; never log private jobs or tokens. */}}
 const pending=await db().prepare('SELECT user_id,MAX(created_at) AS through FROM bot_events WHERE push_done = 0 AND created_at > ? GROUP BY user_id LIMIT 1').bind(Date.now()-3600000).all<{user_id:string;through:number}>();
 for(const row of pending.results){const through=row.through;try{await sendPush(row.user_id,false,through);await db().prepare('UPDATE bot_events SET push_done = 1 WHERE user_id = ? AND created_at <= ?').bind(row.user_id,through).run();}catch{/* Retry recent alerts next tick without sending job details to the push provider. */}}
 return {checked,...chat};
}
