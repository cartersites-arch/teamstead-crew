import {createCombinedInvitation} from '@/lib/company-members';
import { db } from '@/lib/chat-db';
import { currentSession,requireRecent,inspectPersonalLink,exchangePersonalLink,newToken,tokenHash,resetPersonalLink,signOut,INVITE_AGE } from '@/lib/access';
import { response,handleError,checkOrigin,required,fail,ChatError } from '@/lib/chat-server';
import { saveConnection,parsePersonalLink } from '@/lib/maintenance-links';
import { securityGate } from '@/lib/security-events';
export const dynamic='force-dynamic';
const accessWindows=new Map<string,{start:number;count:number}>();
function limitExchange(request:Request){const identity=request.headers.get('cf-connecting-ip')||'local';const now=Date.now(),prior=accessWindows.get(identity);if(prior&&now-prior.start<60000){if(++prior.count>120)fail(429,'Too many sign-in attempts. Wait a minute and try again.');}else{if(accessWindows.size>2000)accessWindows.clear();accessWindows.set(identity,{start:now,count:1});}}
export async function GET(){try{const p=await currentSession(true);return response({level:p.auth_level,user:{id:p.id,name:p.name}});}catch(e){if(e instanceof ChatError&&e.status===401)return response({level:'signed_out'});return handleError(e);}}
export async function POST(request:Request){
  try{
    checkOrigin(request);if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'Use a supported sign-in format.');
    const raw=await request.text();if(raw.length>10000)fail(413,'This request is too large.');let data:Record<string,unknown>;try{data=JSON.parse(raw);}catch{fail(400,'Please try again.');}if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'Please try again.');
    if(data.action==='inspect_link'){limitExchange(request);return response(await inspectPersonalLink(data.token));}
    if(data.action==='login'){limitExchange(request);const result=await exchangePersonalLink(data.token);const res=response({ok:true,level:'setup'});res.headers.set('Set-Cookie',result.cookie);return res;}
    if(data.action==='logout'){const cookie=await signOut();const res=response({ok:true});res.headers.set('Set-Cookie',cookie);return res;}
    const me=await requireRecent();if(!['owner','admin'].includes(me.role))fail(403,'Only an owner or admin can manage invitations.');
    if(data.action==='set_member_role'){
      if(me.role!=='owner')fail(403,'Only the owner can grant or remove admin access.');
      const userId=required(data.userId),role=required(data.role,10);
      if(!['member','admin'].includes(role))fail(400,'Choose Member or Admin.');
      if(userId===me.id)fail(400,'The owner must retain owner access.');
      const gate=securityGate(me,'member_role_'+role,userId);
      const result=await db().batch([gate.statement,db().prepare("UPDATE people SET role=? WHERE id=? AND active=1 AND role IN ('member','admin') AND "+gate.condition).bind(role,userId)]);
      if(!result[0].meta.changes)fail(401,'Your session changed. Sign in again.');
      if(!result[1].meta.changes)fail(404,'Choose an active member or admin.');
      return response({ok:true});
    }
    if(me.role==='admin'){
      if(data.combined===true||data.maintenanceLink)fail(403,'Ask the owner to manage Maintenance Hub invitations.');
      if(data.action==='reset_link'){
        const target=await db().prepare('SELECT role FROM people WHERE id=? AND active=1').bind(required(data.userId)).first<{role:string}>();
        if(!target||target.role!=='member')fail(403,'Admins can reset member access only.');
      }
    }
    if(data.action==='create_member'){
      if(data.combined===true)return response(await createCombinedInvitation(me,data),201);
      const name=required(data.name,60),id=crypto.randomUUID(),token=newToken(),now=Date.now(),expiresAt=now+INVITE_AGE;
      const roomIds=Array.isArray(data.roomIds)?Array.from(new Set(data.roomIds.filter((v):v is string=>typeof v==='string'))).slice(0,80):[];
      for(const roomId of roomIds)if(!await db().prepare('SELECT r.id FROM rooms r JOIN room_members rm ON rm.room_id = r.id WHERE r.id = ? AND rm.user_id = ? AND r.kind = ?').bind(roomId,me.id,'channel').first())fail(400,'Choose channels you belong to.');
      if(data.maintenanceLink)parsePersonalLink(data.maintenanceLink);
      const gate=securityGate(me,'invitation_created',id);
      const result=await db().batch([gate.statement,
        db().prepare('INSERT INTO people (id,email,name,role,active,joined_at,auth_version) SELECT ?,?,?,?,1,0,1 WHERE '+gate.condition).bind(id,'',name,'member'),
        db().prepare('INSERT INTO access_tokens (token_hash,user_id,created_at,expires_at,purpose) SELECT ?,?,?,?,? WHERE '+gate.condition).bind(await tokenHash(token),id,now,expiresAt,'invite'),
        db().prepare('INSERT OR IGNORE INTO room_members (room_id,user_id,read_at) SELECT id,?,0 FROM rooms WHERE kind = ? AND visibility = ? AND '+gate.condition).bind(id,'channel','shared'),
        ...roomIds.map(roomId=>db().prepare('INSERT OR IGNORE INTO room_members (room_id,user_id,read_at) SELECT ?,?,0 WHERE '+gate.condition).bind(roomId,id)),
      ]);
      if(!result[0].meta.changes)fail(401,'Your session changed. Sign in again to add a person.');
      let maintenanceConnected=false,maintenanceError:string|null=null;
      if(data.maintenanceLink)try{await requireRecent();await saveConnection(id,data.maintenanceLink,me);maintenanceConnected=true;}catch{maintenanceError='The invitation was created, but the Maintenance link could not be saved. Connect it from Maintenance after sign-in.';}
      return response({id,name,token,expiresAt,maintenanceConnected,maintenanceError},201);
    }
    if(data.action==='reset_link'){
      if(data.confirmRecovery!==true)fail(400,'Confirm that the person requested account recovery before continuing.');
      const userId=required(data.userId);const result=await resetPersonalLink(userId,me);return response({...result,userId});
    }
    fail(400,'Unknown access change.');
  }catch(e){return handleError(e);}
}
