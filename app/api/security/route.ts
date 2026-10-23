import { db } from '@/lib/chat-db';
import { currentSession,requireRecent } from '@/lib/access';
import { response,handleError,checkOrigin,required,fail } from '@/lib/chat-server';
import { securityGate } from '@/lib/security-events';
import { connectionStatus } from '@/lib/maintenance-links';
import { pendingDeletionCount,retryFileDeletions } from '@/lib/file-deletions';
import { photoStorageUsage } from '@/lib/photo-storage';
export const dynamic='force-dynamic';
export async function GET(){try{
  const me=await currentSession(),now=Date.now();
  const [keys,sessions,events,maintenance,workspace,photosPending]=await Promise.all([
    db().prepare('SELECT id,name,device_type,backed_up,created_at,last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at').bind(me.id).all(),
    db().prepare('SELECT id,device_label,created_at,last_seen_at,expires_at FROM sessions WHERE user_id = ? AND auth_level = ? AND auth_version = ? AND expires_at > ? ORDER BY created_at DESC').bind(me.id,'passkey',me.auth_version,now).all(),
    db().prepare('SELECT e.id,e.action,e.at,actor.name AS actor,target.name AS target FROM security_events e LEFT JOIN people actor ON actor.id = e.actor_id LEFT JOIN people target ON target.id = e.target_id'+(me.role==='owner'?'':' WHERE e.actor_id = ? OR e.target_id = ?')+' ORDER BY e.at DESC LIMIT 50').bind(...(me.role==='owner'?[]:[me.id,me.id])).all(),
    connectionStatus(me.id),db().prepare('SELECT ai_enabled FROM workspace WHERE id = ?').bind('main').first(),pendingDeletionCount(me),
  ]);
  return response({keys:keys.results,sessions:sessions.results.map(s=>({...s,current:s.id===me.session_id})),events:events.results,maintenance,aiEnabled:!!workspace?.ai_enabled,photosPending,photoStorage:await photoStorageUsage()});
}catch(e){return handleError(e);}}
export async function POST(request:Request){try{
  checkOrigin(request);const me=await requireRecent();if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'Use a supported settings format.');
  const raw=await request.text();if(raw.length>8000)fail(413,'This change is too large.');let data:Record<string,unknown>;try{data=JSON.parse(raw);}catch{fail(400,'Please try again.');}if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'Please try again.');
  const action=required(data.action);
  if(action==='retry_deletions')return response({ok:true,photosPending:await retryFileDeletions(me)});
  if(action==='rename_key'){
    const id=required(data.id,2048),name=required(data.name,60),gate=securityGate(me,'passkey_rename_requested',me.id);
    const r=await db().batch([gate.statement,db().prepare('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ? AND '+gate.condition).bind(name,id,me.id)]);if(!r[0].meta.changes)fail(401,'Your session changed. Sign in again.');if(!r[1].meta.changes)fail(404,'This passkey was not found.');return response({ok:true});
  }
  if(action==='remove_key'){
    const id=required(data.id,2048),gate=securityGate(me,'passkey_removal_requested',me.id);
    const r=await db().batch([gate.statement,db().prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ? AND (SELECT COUNT(*) FROM passkeys WHERE user_id = ?) > 1 AND '+gate.condition).bind(id,me.id,me.id)]);if(!r[0].meta.changes)fail(401,'Your session changed. Sign in again.');if(!r[1].meta.changes)fail(400,'Keep at least one passkey. Add a backup before removing your last one.');return response({ok:true});
  }
  if(action==='revoke_session'||action==='revoke_other_sessions'){
    const id=action==='revoke_session'?required(data.id):null;if(id===me.session_id)fail(400,'Use Sign out to close this session.');const gate=securityGate(me,'other_sessions_revocation_requested',me.id);
    const r=await db().batch([gate.statement,db().prepare('DELETE FROM sessions WHERE user_id = ? AND session_hash <> ?'+(id?' AND id = ?':'')+' AND '+gate.condition).bind(me.id,me.session_hash,...(id?[id]:[])),db().prepare('DELETE FROM passkey_challenges WHERE user_id = ? AND session_hash <> ? AND '+gate.condition).bind(me.id,me.session_hash)]);if(!r[0].meta.changes)fail(401,'Your session changed. Sign in again.');return response({ok:true});
  }
  if(action==='ai_permission'){
    if(me.role!=='owner')fail(403,'Only the workspace owner can change app permissions.');if(typeof data.enabled!=='boolean')fail(400,'Choose whether AI shortcuts are enabled.');const gate=securityGate(me,data.enabled?'ai_shortcuts_enabled':'ai_shortcuts_disabled');
    const r=await db().batch([gate.statement,db().prepare('UPDATE workspace SET ai_enabled = ? WHERE id = ? AND '+gate.condition).bind(data.enabled?1:0,'main')]);if(!r[0].meta.changes)fail(401,'Your session changed. Sign in again.');return response({ok:true});
  }
  fail(400,'Unknown security change.');
}catch(e){return handleError(e);}}
