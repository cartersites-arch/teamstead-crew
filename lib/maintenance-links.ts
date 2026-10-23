import {validCompany} from './company-context';
import { companyId } from './company-context';
import { env } from 'cloudflare:workers';
import { db } from './chat-db';
import { fail } from './app-errors';
import { securityGate } from './security-events';
import type { SessionPerson } from './access';

export const hubOrigins={test:'https://pms-maintenance-hub-test.pages.dev',live:'https://pms-company-hub.pages.dev'} as const;
type StoredLink={user_id:string;environment:'test'|'live';ciphertext:string;iv:string;connected_at:number};

function base64(bytes:Uint8Array):string{return btoa(String.fromCharCode(...bytes));}
function unbase64(value:string):Uint8Array<ArrayBuffer>{return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
async function key(){const value=env.MAINTENANCE_LINK_KEY||process.env.MAINTENANCE_LINK_KEY;if(!value)fail(503,'Private maintenance connections are not configured yet.');let bytes:Uint8Array<ArrayBuffer>;try{bytes=unbase64(value);}catch{fail(503,'Private maintenance connections are unavailable.');}if(bytes.length!==32)fail(503,'Private maintenance connections are unavailable.');return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);}

export function parsePersonalLink(value:unknown){
  if(typeof value!=='string'||value.length>4096)fail(400,'Paste your complete personal Maintenance Hub link.');
  let url:URL;try{url=new URL(value.trim());}catch{fail(400,'Paste your complete personal Maintenance Hub link.');}
  const environment=url.origin===hubOrigins.live?'live':url.origin===hubOrigins.test?'test':null;
  if(url.origin!==hubOrigins.live||url.username||url.password)fail(400,'Use your company’s complete Maintenance Hub link.');
  const token=new URLSearchParams(url.hash.slice(1)).get('hub');
  if(!token||token.length<12||token.length>2048||/\s/.test(token))fail(400,'That link does not include personal access. Use the complete link you were given, including the part after #hub=.');
  return {environment:environment||'live' as const,url:(url.origin==='https://pms-company-hub.pages.dev'?url.origin:hubOrigins[environment!])+'/#hub='+encodeURIComponent(token)};
}
export async function connectionStatus(userId:string){
  const row=await db().prepare('SELECT environment,connected_at FROM maintenance_links WHERE user_id = ?').bind(userId).first<Pick<StoredLink,'environment'|'connected_at'>>();
  return row?{connected:true,environment:row.environment,connectedAt:row.connected_at}:{connected:false};
}
export async function saveConnection(userId:string,value:unknown,actor:SessionPerson){
  const parsed=parsePersonalLink(value),iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('maintenance-link:'+userId+(companyId()==='main'?'':':'+companyId()))},await key(),new TextEncoder().encode(parsed.url));
  const gate=securityGate(actor,'maintenance_link_connected',userId);
  const result=await db().batch([gate.statement,db().prepare('INSERT INTO maintenance_links (user_id,environment,ciphertext,iv,connected_at) SELECT id,?,?,?,? FROM people WHERE id = ? AND active = 1 AND '+gate.condition+' ON CONFLICT(user_id) DO UPDATE SET environment=excluded.environment,ciphertext=excluded.ciphertext,iv=excluded.iv,connected_at=excluded.connected_at').bind(parsed.environment,base64(new Uint8Array(ciphertext)),base64(iv),Date.now(),userId)]);if(!result[0].meta.changes||!result[1].meta.changes)fail(401,'Your account changed before the connection was saved.');
  return connectionStatus(userId);
}
export async function disconnect(userId:string,actor:SessionPerson){const gate=securityGate(actor,'maintenance_link_disconnected',userId);const r=await db().batch([gate.statement,db().prepare('DELETE FROM maintenance_links WHERE user_id = ? AND '+gate.condition).bind(userId)]);if(!r[0].meta.changes)fail(401,'Your account changed. Sign in again.');}
export async function connectionUrl(userId:string){
  const row=await db().prepare('SELECT * FROM maintenance_links WHERE user_id = ?').bind(userId).first<StoredLink>();if(!row)return null;
  let plaintext:ArrayBuffer;try{plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(row.iv),additionalData:new TextEncoder().encode('maintenance-link:'+userId+(companyId()==='main'?'':':'+companyId()))},await key(),unbase64(row.ciphertext));}catch{fail(503,'Your saved maintenance connection could not be opened. Please reconnect your personal link.');}
  const parsed=parsePersonalLink(new TextDecoder().decode(plaintext));if(parsed.environment!==row.environment)fail(503,'Please reconnect your personal Maintenance Hub link.');return parsed.url;
}

export async function encryptCompanyConnection(userId:string,url:string,company:string){if(!validCompany(company)||!url.startsWith((company==='main'?'https://pms-company-hub.pages.dev':'https://pms-company-hub.pages.dev')+'/#hub='))fail(400,'Company connection unavailable.');const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('maintenance-link:'+userId+(company==='main'?'':':'+company))},await key(),new TextEncoder().encode(url));return {iv:base64(iv),ciphertext:base64(new Uint8Array(ciphertext))};}
