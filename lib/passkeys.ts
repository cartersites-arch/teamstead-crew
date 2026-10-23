import { companyId } from './company-context';
import { env } from 'cloudflare:workers';
import { headers } from './request-context';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON, AuthenticatorTransport } from '@simplewebauthn/server';
import { db } from './chat-db';
import { fail } from './app-errors';
import { currentSession, cookieValue, newToken, tokenHash, toBase64url, fromBase64url, sessionCookie, deviceLabel, SESSION_AGE, RECENT_AGE, type SessionPerson } from './access';

const CHALLENGE_COOKIE='__Host-project_room_challenge';
const CHALLENGE_AGE=5*60*1000;
type Challenge={id:string;challenge:string;purpose:string;browser_hash:string;user_id:string|null;session_hash:string|null;auth_version:number|null;expires_at:number};
type StoredKey={id:string;user_id:string;public_key:string;webauthn_user_id:string;counter:number;transports:string;auth_version:number;active:number};
function config(){
  const rpID=env.WEBAUTHN_RP_ID||process.env.WEBAUTHN_RP_ID||'',origin=env.WEBAUTHN_ORIGIN||process.env.WEBAUTHN_ORIGIN||'';
  let url:URL;try{url=new URL(origin);}catch{fail(503,'Passkey sign-in is not configured yet.');}
  if(!rpID||url.hostname!==rpID||url.origin!==origin||url.protocol!=='https:')fail(503,'Passkey sign-in is not configured yet.');
  return {rpID,origin};
}
function transports(value:string):AuthenticatorTransport[]{try{return JSON.parse(value);}catch{return [];}}
async function createChallenge(challenge:string,purpose:string,person?:SessionPerson){
  const existing=await cookieValue(companyId()==='main'?CHALLENGE_COOKIE:CHALLENGE_COOKIE+'_'+companyId()),browser=/^[A-Za-z0-9_-]{43}$/.test(existing)?existing:newToken(),now=Date.now(),id=crypto.randomUUID();
  await db().batch([
    db().prepare('DELETE FROM passkey_challenges WHERE expires_at <= ?').bind(now),
    db().prepare('INSERT INTO passkey_challenges (id,challenge,purpose,browser_hash,user_id,session_hash,auth_version,expires_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,challenge,purpose,await tokenHash(browser),person?.id||null,person?.session_hash||null,person?.auth_version??null,now+CHALLENGE_AGE),
  ]);
  return {challengeId:id,cookie:(companyId()==='main'?CHALLENGE_COOKIE:CHALLENGE_COOKIE+'_'+companyId())+'='+browser+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300'};
}
async function consumeChallenge(id:unknown,purpose:string,person?:SessionPerson){
  const browser=await cookieValue(companyId()==='main'?CHALLENGE_COOKIE:CHALLENGE_COOKIE+'_'+companyId());if(typeof id!=='string'||id.length>80||!/^[A-Za-z0-9_-]{43}$/.test(browser))fail(400,'This passkey request expired. Try again.');
  // DELETE RETURNING consumes the challenge exactly once, even if verification fails.
  const challenge=await db().prepare('DELETE FROM passkey_challenges WHERE id = ? AND browser_hash = ? AND purpose = ? AND expires_at > ? RETURNING *').bind(id,await tokenHash(browser),purpose,Date.now()).first<Challenge>();
  if(!challenge)fail(400,'This passkey request was used or expired. Try again.');
  if(person&&(challenge.user_id!==person.id||challenge.session_hash!==person.session_hash||challenge.auth_version!==person.auth_version))fail(401,'Your account changed. Start the passkey request again.');
  return challenge;
}
export async function registrationOptions(){
  const person=await currentSession(true);if(person.auth_level==='passkey'&&person.verified_at<Date.now()-RECENT_AGE)fail(428,'Confirm your passkey before adding another.');
  const {rpID}=config();
  const keys=await db().prepare('SELECT id,transports FROM passkeys WHERE user_id = ?').bind(person.id).all<{id:string;transports:string}>();
  if(keys.results.length>=8)fail(400,'You can keep up to eight passkeys. Remove an unused one first.');
  // Stable opaque user handles contain no email address or other identifying data.
  await db().prepare('UPDATE people SET webauthn_user_id = ? WHERE id = ? AND webauthn_user_id IS NULL AND active = 1 AND auth_version = ?').bind(newToken(),person.id,person.auth_version).run();
  const account=await db().prepare('SELECT webauthn_user_id FROM people WHERE id = ? AND active = 1 AND auth_version = ?').bind(person.id,person.auth_version).first<{webauthn_user_id:string}>();
  if(!account?.webauthn_user_id)fail(401,'Your account changed. Start again.');
  const options=await generateRegistrationOptions({rpName:'Teamstead Crew',rpID,userID:fromBase64url(account.webauthn_user_id),userName:person.name,userDisplayName:person.name,attestationType:'none',supportedAlgorithmIDs:[-7,-257],authenticatorSelection:{residentKey:'required',userVerification:'required'},excludeCredentials:keys.results.map(k=>({id:k.id,transports:transports(k.transports)}))});
  return {options,...await createChallenge(options.challenge,'register',person)};
}
export async function registrationVerify(data:Record<string,unknown>){
  const person=await currentSession(true);if(person.auth_level==='passkey'&&person.verified_at<Date.now()-RECENT_AGE)fail(428,'Confirm your existing passkey before adding another.');
  const challenge=await consumeChallenge(data.challengeId,'register',person),{rpID,origin}=config();
  let result;try{result=await verifyRegistrationResponse({response:data.response as RegistrationResponseJSON,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserPresence:true,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});}catch{fail(400,'The passkey could not be verified. Please try again.');}
  if(!result.verified||!result.registrationInfo)fail(400,'The passkey could not be verified. Please try again.');
  const info=result.registrationInfo,key=info.credential,now=Date.now(),setup=person.auth_level==='setup';
  const label=typeof data.name==='string'?data.name.trim().slice(0,60):'';
  const account=await db().prepare('SELECT webauthn_user_id FROM people WHERE id = ?').bind(person.id).first<{webauthn_user_id:string}>();
  if(!account?.webauthn_user_id)fail(401,'Start passkey setup again.');
  const session=newToken(),sessionHash=await tokenHash(session),sessionId=crypto.randomUUID();
  // This conditional insert is the transaction gate. A grant cannot enroll two accounts/devices concurrently.
  const results=await db().batch([
    db().prepare('INSERT INTO passkeys (id,user_id,public_key,webauthn_user_id,counter,transports,device_type,backed_up,name,created_at,last_challenge_id) SELECT ?,p.id,?,?,?,?,?,?,?,?,? FROM people p JOIN sessions s ON s.user_id = p.id WHERE p.id = ? AND p.active = 1 AND p.auth_version = ? AND s.session_hash = ? AND s.auth_version = p.auth_version AND s.expires_at > ? AND (SELECT COUNT(*) FROM passkeys WHERE user_id = p.id) < 8 AND ((s.auth_level = ? AND s.verified_at >= ?) OR (s.auth_level = ? AND EXISTS (SELECT 1 FROM access_tokens t WHERE t.token_hash = s.setup_token_hash AND t.user_id = p.id AND t.used_at = 0 AND t.expires_at > ? AND (p.passkey_enrolled = 0 OR t.purpose = ?))))').bind(key.id,toBase64url(key.publicKey),account.webauthn_user_id,key.counter,JSON.stringify(key.transports||[]),info.credentialDeviceType,info.credentialBackedUp?1:0,label||deviceLabel((await headers()).get('user-agent')||''),now,challenge.id,person.id,person.auth_version,person.session_hash,now,'passkey',now-RECENT_AGE,'setup',now,'recovery'),
    db().prepare('UPDATE access_tokens SET used_at = ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND last_challenge_id = ?)').bind(now,person.id,key.id,challenge.id),
    db().prepare('UPDATE people SET passkey_enrolled = 1, joined_at = CASE WHEN joined_at = 0 THEN ? ELSE joined_at END, auth_version = auth_version + ? WHERE id = ? AND EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND last_challenge_id = ?)').bind(now,setup?1:0,person.id,key.id,challenge.id),
    ...(setup?[
      db().prepare('DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND last_challenge_id = ?)').bind(person.id,key.id,challenge.id),
      db().prepare('DELETE FROM passkey_challenges WHERE user_id = ? AND EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND last_challenge_id = ?)').bind(person.id,key.id,challenge.id),
      db().prepare('INSERT INTO sessions (session_hash,user_id,auth_version,expires_at,id,auth_level,created_at,verified_at,last_seen_at,device_label) SELECT ?,p.id,p.auth_version,?,?,?,?,?,?,? FROM people p WHERE p.id = ? AND p.active = 1 AND EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND last_challenge_id = ?)').bind(sessionHash,now+SESSION_AGE*1000,sessionId,'passkey',now,now,now,deviceLabel((await headers()).get('user-agent')||''),person.id,key.id,challenge.id),
    ]:[]),
    db().prepare('INSERT INTO security_events (id,actor_id,target_id,action,at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND last_challenge_id = ?)').bind(crypto.randomUUID(),person.id,person.id,setup?'passkey_setup_completed':'passkey_added',now,key.id,challenge.id),
  ]);
  if(!results[0].meta.changes)fail(401,'Your setup or account changed. Sign in with your passkey, or ask for a new setup link.');
  return {ok:true,userId:person.id,...(setup?{cookie:sessionCookie(session)}:{})};
}
export async function authenticationOptions(reauth=false){
  const person=reauth?await currentSession():undefined,{rpID}=config();
  const keys=person?await db().prepare('SELECT id,transports FROM passkeys WHERE user_id = ?').bind(person.id).all<{id:string;transports:string}>():null;
  if(person&&!keys?.results.length)fail(401,'No passkey is available. Ask your workspace owner for account recovery.');
  const options=await generateAuthenticationOptions({rpID,userVerification:'required',allowCredentials:keys?.results.map(k=>({id:k.id,transports:transports(k.transports)}))||[]});
  return {options,...await createChallenge(options.challenge,reauth?'reauth':'login',person)};
}
export async function authenticationVerify(data:Record<string,unknown>,reauth=false){
  const person=reauth?await currentSession():undefined,challenge=await consumeChallenge(data.challengeId,reauth?'reauth':'login',person),{rpID,origin}=config();
  const response=data.response as AuthenticationResponseJSON;
  if(!response||typeof response.id!=='string'||response.id.length>2048)fail(400,'The passkey response is incomplete.');
  const stored=await db().prepare('SELECT k.*,p.auth_version,p.active FROM passkeys k JOIN people p ON p.id = k.user_id WHERE k.id = ? AND p.active = 1').bind(response.id).first<StoredKey>();
  if(!stored||(person&&stored.user_id!==person.id))fail(401,'This passkey does not belong to the account being opened.');
  // The library validates the signature but does not associate userHandle with the account.
  if((!reauth&&!response.response?.userHandle)||(response.response?.userHandle&&response.response.userHandle!==stored.webauthn_user_id))fail(401,'This passkey does not match the account.');
  let result;try{result=await verifyAuthenticationResponse({response,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:stored.id,publicKey:fromBase64url(stored.public_key),counter:stored.counter,transports:transports(stored.transports)}});}catch{fail(400,'The passkey could not be verified. Please try again.');}
  if(!result.verified)fail(400,'The passkey could not be verified.');
  const now=Date.now(),session=newToken(),hash=await tokenHash(session),id=crypto.randomUUID(),info=result.authenticationInfo;
  const results=await db().batch([
    db().prepare('UPDATE passkeys SET counter = ?,last_used_at = ?,backed_up = ?,last_challenge_id = ? WHERE id = ? AND counter = ? AND EXISTS (SELECT 1 FROM people WHERE id = passkeys.user_id AND active = 1 AND auth_version = ?)'+(reauth?' AND EXISTS (SELECT 1 FROM sessions WHERE session_hash = ? AND user_id = passkeys.user_id AND auth_level = ? AND expires_at > ? AND auth_version = ?)':'')).bind(info.newCounter,now,info.credentialBackedUp?1:0,challenge.id,stored.id,stored.counter,stored.auth_version,...(reauth?[person!.session_hash,'passkey',now,person!.auth_version]:[])),
    reauth?db().prepare('UPDATE sessions SET verified_at = ?,last_seen_at = ? WHERE session_hash = ? AND EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND last_challenge_id = ?)').bind(now,now,person!.session_hash,stored.id,challenge.id):db().prepare('INSERT INTO sessions (session_hash,user_id,auth_version,expires_at,id,auth_level,created_at,verified_at,last_seen_at,device_label) SELECT ?,p.id,p.auth_version,?,?,?,?,?,?,? FROM people p WHERE p.id = ? AND p.active = 1 AND EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND last_challenge_id = ?)').bind(hash,now+SESSION_AGE*1000,id,'passkey',now,now,now,deviceLabel((await headers()).get('user-agent')||''),stored.user_id,stored.id,challenge.id),
    db().prepare('INSERT INTO security_events (id,actor_id,target_id,action,at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND last_challenge_id = ?)').bind(crypto.randomUUID(),stored.user_id,stored.user_id,reauth?'passkey_confirmed':'signed_in',now,stored.id,challenge.id),
    db().prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
  ]);
  if(!results[0].meta.changes||!results[1].meta.changes)fail(401,'Your account changed during sign-in. Try again.');
  return {ok:true,userId:stored.user_id,...(!reauth?{cookie:sessionCookie(session)}:{})};
}
