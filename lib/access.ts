import { companyId } from './company-context';
import { env } from 'cloudflare:workers';
import { headers } from './request-context';
import { db } from './chat-db';
import { fail } from './app-errors';
import { auditStatement,securityGate } from './security-events';
import type { Person } from './chat-types';

export const SESSION_COOKIE='__Host-project_room_session';
export const SESSION_AGE=7*24*60*60;
export const SETUP_AGE=15*60;
export const INVITE_AGE=7*24*60*60*1000;
export const RECENT_AGE=5*60*1000;
const personFields='p.id,p.email,p.name,p.role,p.active,p.joined_at';
export type SessionPerson=Person&{auth_version:number;passkey_enrolled:number;webauthn_user_id:string|null;session_hash:string;session_id:string;auth_level:'setup'|'passkey';setup_token_hash:string|null;verified_at:number;last_seen_at:number};
export function newToken(){return toBase64url(crypto.getRandomValues(new Uint8Array(32)));}
export function toBase64url(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
export function fromBase64url(value:string):Uint8Array<ArrayBuffer>{return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
export async function tokenHash(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
function constantEquals(a:string,b:string){if(a.length!==64||b.length!==64)return false;let n=0;for(let i=0;i<64;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
export async function cookieValue(name:string){const value=(await headers()).get('cookie')||'';return value.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';}
export function sessionCookie(value:string,clear=false,maxAge=SESSION_AGE){return (companyId()==='main'?SESSION_COOKIE:SESSION_COOKIE+'_'+companyId())+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+(clear?0:maxAge);}
export function deviceLabel(agent:string){if(/iPad/i.test(agent))return 'iPad';if(/iPhone/i.test(agent))return 'iPhone';if(/Android/i.test(agent))return 'Android';if(/Windows/i.test(agent))return 'Windows browser';if(/Macintosh|Mac OS/i.test(agent))return 'Mac browser';if(/Linux/i.test(agent))return 'Linux browser';return 'Browser';}
export async function currentSession(allowSetup=false):Promise<SessionPerson>{
  const token=await cookieValue(companyId()==='main'?SESSION_COOKIE:SESSION_COOKIE+'_'+companyId());if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail(401,'Sign in with your passkey to open Teamstead Crew.');
  const person=await db().prepare('SELECT '+personFields+',p.auth_version,p.passkey_enrolled,p.webauthn_user_id,s.session_hash,s.id AS session_id,s.auth_level,s.setup_token_hash,s.verified_at,s.last_seen_at FROM sessions s JOIN people p ON p.id = s.user_id WHERE s.session_hash = ? AND s.expires_at > ? AND s.auth_version = p.auth_version AND p.active = 1').bind(await tokenHash(token),Date.now()).first<SessionPerson>();
  if(!person||!['setup','passkey'].includes(person.auth_level))fail(401,'Sign in with your passkey to continue.');
  const expected=(await headers()).get('X-Project-User');if(expected&&expected!==person.id)fail(401,'Your account changed on this device. Open Teamstead Crew again.');
  if(person.auth_level!=='passkey'){
    if(!allowSetup)fail(401,'Finish setting up your passkey to open Teamstead Crew.');
    const grant=await db().prepare('SELECT purpose FROM access_tokens WHERE token_hash = ? AND user_id = ? AND used_at = 0 AND expires_at > ?').bind(person.setup_token_hash,person.id,Date.now()).first<{purpose:string}>();
    if(!grant||(person.passkey_enrolled&&grant.purpose!=='recovery'))fail(401,'This setup link has been used or has expired. Sign in with your passkey.');
  }
  if(person.auth_level==='passkey'&&person.last_seen_at<Date.now()-300000)await db().prepare('UPDATE sessions SET last_seen_at = ? WHERE session_hash = ?').bind(Date.now(),person.session_hash).run();
  return person;
}
export async function currentPerson():Promise<Person>{const p=await currentSession();return {id:p.id,email:p.email,name:p.name,role:p.role,active:p.active,joined_at:p.joined_at};}
export async function requireRecent(){const person=await currentSession();if(person.verified_at<Date.now()-RECENT_AGE)fail(428,'Confirm your passkey to make this security change.');return person;}
function bootstrapValid(hash:string){const expected=env.BOOTSTRAP_ACCESS_HASH||process.env.BOOTSTRAP_ACCESS_HASH||'',expires=Number(env.BOOTSTRAP_ACCESS_EXPIRES_AT||process.env.BOOTSTRAP_ACCESS_EXPIRES_AT||0);return constantEquals(hash,expected)&&expires>Date.now();}
async function bootstrap(hash:string){
  if(companyId()!=='main')return;
  const existing=await db().prepare('SELECT owner_id,access_bootstrapped FROM workspace WHERE id = ?').bind('main').first<{owner_id:string;access_bootstrapped:number}>();if(existing?.access_bootstrapped||!bootstrapValid(hash))return;
  const now=Date.now(),id=existing?.owner_id||'owner';
  await db().batch([
    db().prepare('INSERT OR IGNORE INTO workspace (id,name,owner_id,created_at) VALUES (?,?,?,?)').bind('main','Teamstead Crew',id,now),
    db().prepare('INSERT OR IGNORE INTO people (id,email,name,role,active,joined_at,auth_version) VALUES (?,?,?, ?,1,0,1)').bind(id,'','Jerry','owner'),
    db().prepare('INSERT OR IGNORE INTO access_tokens (token_hash,user_id,created_at,expires_at,purpose) SELECT ?,owner_id,?,?,? FROM workspace WHERE id = ? AND access_bootstrapped = 0 AND NOT EXISTS (SELECT 1 FROM access_tokens WHERE user_id = workspace.owner_id)').bind(hash,now,now+INVITE_AGE,'invite','main'),
    db().prepare('UPDATE workspace SET access_bootstrapped = 1 WHERE id = ? AND EXISTS (SELECT 1 FROM access_tokens WHERE user_id = workspace.owner_id)').bind('main'),
    ...[['general','The everyday conversation. Updates, questions, and quick hellos.'],['projects','Keep the work moving. Share progress, questions, and the next step.'],['ideas','A little room for the next big thing.']].flatMap(([name,description])=>[
      db().prepare('INSERT OR IGNORE INTO rooms (id,name,description,kind,visibility,created_by,created_at) VALUES (?,?,?,?,?,?,?)').bind('room-'+name,name,description,'channel','private',id,now),
      db().prepare('INSERT OR IGNORE INTO room_members (room_id,user_id,read_at) VALUES (?,?,0)').bind('room-'+name,id),
    ]),
  ]);
}
export async function inspectPersonalLink(value:unknown){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))fail(401,'That personal link is incomplete or invalid.');const hash=await tokenHash(value);
  const person=await db().prepare('SELECT p.id,p.name,p.passkey_enrolled,t.used_at,t.expires_at,t.purpose FROM access_tokens t JOIN people p ON p.id = t.user_id WHERE t.token_hash = ? AND p.active = 1').bind(hash).first<{id:string;name:string;passkey_enrolled:number;used_at:number;expires_at:number;purpose:string}>();
  if(person){if(person.used_at||(person.passkey_enrolled&&person.purpose!=='recovery'))return {id:person.id,name:person.name,mode:'passkey' as const};if(person.expires_at<=Date.now())fail(401,'That setup link expired. Ask the workspace owner for a replacement.');return {id:person.id,name:person.name,mode:'enroll' as const};}
  if(bootstrapValid(hash)){const workspace=await db().prepare('SELECT owner_id,access_bootstrapped FROM workspace WHERE id = ?').bind('main').first<{owner_id:string;access_bootstrapped:number}>();if(!workspace)return {id:'owner',name:'Jerry',mode:'enroll' as const};if(!workspace.access_bootstrapped){const owner=await db().prepare('SELECT id,name FROM people WHERE id = ? AND active = 1').bind(workspace.owner_id).first<{id:string;name:string}>();if(owner)return {...owner,mode:'enroll' as const};}}
  fail(401,'That link is inactive. Use your passkey, or ask the workspace owner for help.');
}
export async function exchangePersonalLink(value:unknown){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))fail(401,'Use the full personal setup link you were given.');const hash=await tokenHash(value);await bootstrap(hash);
  const actor=await db().prepare('SELECT p.id,p.auth_version FROM access_tokens t JOIN people p ON p.id = t.user_id WHERE t.token_hash = ? AND t.used_at = 0 AND t.expires_at > ? AND p.active = 1 AND (p.passkey_enrolled = 0 OR t.purpose = ?)').bind(hash,Date.now(),'recovery').first<{id:string;auth_version:number}>();
  if(!actor)fail(401,'Use your passkey. This link cannot sign you in on its own.');
  const session=newToken(),now=Date.now();
  const created=await db().prepare('INSERT INTO sessions (session_hash,user_id,auth_version,expires_at,id,auth_level,setup_token_hash,created_at,device_label) SELECT ?,p.id,p.auth_version,?,?,?,t.token_hash,?,? FROM access_tokens t JOIN people p ON p.id = t.user_id WHERE t.token_hash = ? AND t.used_at = 0 AND t.expires_at > ? AND p.id = ? AND p.active = 1 AND p.auth_version = ? AND (p.passkey_enrolled = 0 OR t.purpose = ?)').bind(await tokenHash(session),now+SETUP_AGE*1000,crypto.randomUUID(),'setup',now,deviceLabel((await headers()).get('user-agent')||''),hash,now,actor.id,actor.auth_version,'recovery').run();
  if(!created.meta.changes)fail(401,'That setup link changed. Ask for the latest link.');
  return {cookie:sessionCookie(session,false,SETUP_AGE),userId:actor.id};
}
export async function signOut(){const token=await cookieValue(companyId()==='main'?SESSION_COOKIE:SESSION_COOKIE+'_'+companyId());if(token){const hash=await tokenHash(token),row=await db().prepare('SELECT user_id FROM sessions WHERE session_hash = ?').bind(hash).first<{user_id:string}>();const expected=(await headers()).get('X-Project-User');if(row&&expected&&row.user_id!==expected)fail(401,'Your account changed on this device. Open Teamstead Crew again.');if(row)await db().batch([db().prepare('DELETE FROM sessions WHERE session_hash = ?').bind(hash),auditStatement(row.user_id,'signed_out',row.user_id)]);}return sessionCookie('',true);}
export async function resetPersonalLink(userId:string,actor:SessionPerson){
  const actorId=actor.id;
  if(userId===actorId)fail(400,'Add a backup passkey in Security before removing an old one. You cannot reset your own account from People.');
  const target=await db().prepare('SELECT passkey_enrolled FROM people WHERE id = ? AND active = 1').bind(userId).first<{passkey_enrolled:number}>();if(!target)fail(404,'This person is no longer in the workspace.');
  const token=newToken(),now=Date.now();
  const gate=securityGate(actor,'account_access_reset',userId);
  const results=await db().batch([gate.statement,
    db().prepare('UPDATE people SET auth_version = auth_version + 1 WHERE id = ? AND active = 1 AND '+gate.condition).bind(userId),
    db().prepare('DELETE FROM sessions WHERE user_id = ? AND '+gate.condition).bind(userId),
    db().prepare('DELETE FROM passkeys WHERE user_id = ? AND '+gate.condition).bind(userId),
    db().prepare('DELETE FROM passkey_challenges WHERE user_id = ? AND '+gate.condition).bind(userId),
    db().prepare('DELETE FROM access_tokens WHERE user_id = ? AND '+gate.condition).bind(userId),
    db().prepare('INSERT INTO access_tokens (token_hash,user_id,created_at,expires_at,purpose) SELECT ?,id,?,CASE WHEN passkey_enrolled = 1 THEN ? ELSE ? END,CASE WHEN passkey_enrolled = 1 THEN ? ELSE ? END FROM people WHERE id = ? AND active = 1 AND '+gate.condition).bind(await tokenHash(token),now,now+24*60*60*1000,now+INVITE_AGE,'recovery','invite',userId),
  ]);if(!results[0].meta.changes)fail(401,'Your session changed. Sign in again before managing access.');const grant=await db().prepare('SELECT expires_at FROM access_tokens WHERE token_hash = ?').bind(await tokenHash(token)).first<{expires_at:number}>();if(!grant)fail(409,'The invitation changed again. Ask for the latest link.');return {token,expiresAt:grant.expires_at};
}
