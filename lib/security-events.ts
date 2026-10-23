import { db } from './chat-db';
export function auditStatement(actorId:string,action:string,targetId:string|null=null){return db().prepare('INSERT INTO security_events (id,actor_id,target_id,action,at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actorId,targetId,action,Date.now());}
export async function audit(actorId:string,action:string,targetId:string|null=null){await auditStatement(actorId,action,targetId).run();}

import type { SessionPerson } from './access';
// Gates every statement in a security-changing D1 batch on the same live session.
export function securityGate(person:SessionPerson,action:string,targetId:string|null=null,guard?:{sql:string;values:unknown[]}){
  const id=crypto.randomUUID(),now=Date.now();
  const memberTarget=person.role==='admin'&&action==='account_access_reset';
  const targetGuard=(guard?' AND ('+guard.sql+')':'')+(memberTarget?" AND EXISTS (SELECT 1 FROM people target WHERE target.id=? AND target.active=1 AND target.role='member')":'');
  return {id,condition:"EXISTS (SELECT 1 FROM security_events WHERE id = '"+id+"')",statement:db().prepare('INSERT INTO security_events (id,actor_id,target_id,action,at) SELECT ?,p.id,?,?,? FROM sessions s JOIN people p ON p.id = s.user_id WHERE s.session_hash = ? AND s.user_id = ? AND s.auth_level = ? AND s.expires_at > ? AND s.verified_at >= ? AND p.active = 1 AND p.auth_version = s.auth_version AND p.auth_version = ? AND p.role = ?'+targetGuard).bind(id,targetId,action,now,person.session_hash,person.id,'passkey',now,now-5*60*1000,person.auth_version,person.role,...(guard?.values||[]),...(memberTarget?[targetId]:[]))};
}
