import {rawDb,db} from '@/lib/chat-db';
import {companyId} from '@/lib/company-context';
import {currentSession} from '@/lib/access';
import {roomAccess,checkOrigin,response,handleError,required,fail} from '@/lib/chat-server';
const LEASE=45000, MAX_DURATION=2*60*60*1000;
type Peer={user_id:string;peer_id:string;auth_version:number;seen_at:number;joined_at:number};
async function context(roomId:string,testLimit=0){const me=await currentSession(),room=await roomAccess(roomId,me.id);if(room.kind==='bot')fail(400,'Open a person or team conversation for Crew Call.');return {me,co:companyId()+([10,40].includes(testLimit)?`:crew-call-test-${testLimit}`:''),limit:[10,40].includes(testLimit)?testLimit:14,roomId,database:rawDb()};}
async function visiblePeers(co:string,roomId:string,now:number){
 const [peers,members]=await Promise.all([
  rawDb().prepare('SELECT * FROM crew_call_peers WHERE company_id=? AND room_id=? AND seen_at>? AND joined_at>?').bind(co,roomId,now-LEASE,now-MAX_DURATION).all<Peer>(),
  db().prepare('SELECT p.id,p.name,p.auth_version FROM people p JOIN room_members rm ON rm.user_id=p.id WHERE rm.room_id=? AND p.active=1').bind(roomId).all<{id:string;name:string;auth_version:number}>()
 ]);
 return peers.results.flatMap(p=>{const m=members.results.find(m=>m.id===p.user_id&&m.auth_version===p.auth_version);return m?[{peerId:p.peer_id,userId:m.id,name:m.name}]:[];});
}
export async function GET(request:Request){try{
 const u=new URL(request.url),roomId=required(u.searchParams.get('roomId')),ctx=await context(roomId,Number(u.searchParams.get('test'))),now=Date.now();
 const peers=await visiblePeers(ctx.co,roomId,now),peerId=u.searchParams.get('peerId');
 if(!peerId)return response({peers});
 if(!peers.some(p=>p.peerId===peerId&&p.userId===ctx.me.id))fail(409,'Your call ended. Join again to reconnect.');
 const since=Number(u.searchParams.get('since')||0);if(!Number.isSafeInteger(since)||since<0)fail(400,'Invalid call cursor.');
 const signals=await ctx.database.prepare('SELECT id,sender,payload FROM crew_call_signals WHERE company_id=? AND room_id=? AND target=? AND id>? AND created_at>? ORDER BY id LIMIT 100').bind(ctx.co,roomId,peerId,since,now-120000).all<{id:number;sender:string;payload:string}>();
 return response({peers,signals:signals.results.map(s=>({...s,payload:JSON.parse(s.payload)}))});
 }catch(e){return handleError(e);}}
export async function POST(request:Request){try{
 checkOrigin(request);const text=await request.text();if(text.length>65000)fail(413,'Call update too large.');
 let data:Record<string,unknown>;try{data=JSON.parse(text);}catch{fail(400,'Invalid call update.');}if(!data||Array.isArray(data))fail(400,'Invalid call update.');
 const roomId=required(data.roomId),peerId=required(data.peerId),action=required(data.action),ctx=await context(roomId,Number(data.test)),{database,co,me,limit}=ctx,now=Date.now();
 if(!/^[a-f0-9-]{36}$/.test(peerId))fail(400,'Invalid call identifier.');
 if(action==='join'){
  await database.batch([
   database.prepare('DELETE FROM crew_call_peers WHERE company_id=? AND room_id=? AND (seen_at<=? OR joined_at<=?)').bind(co,roomId,now-LEASE,now-MAX_DURATION),
   database.prepare('DELETE FROM crew_call_signals WHERE created_at<?').bind(now-120000),
   database.prepare('INSERT INTO crew_call_peers(company_id,room_id,user_id,peer_id,auth_version,joined_at,seen_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM crew_call_peers WHERE company_id=? AND room_id=?)<? ON CONFLICT(company_id,room_id,user_id) DO UPDATE SET seen_at=excluded.seen_at WHERE crew_call_peers.peer_id=excluded.peer_id AND crew_call_peers.auth_version=excluded.auth_version').bind(co,roomId,me.id,peerId,me.auth_version,now,now,co,roomId,limit)
  ]);
  const own=await database.prepare('SELECT peer_id FROM crew_call_peers WHERE company_id=? AND room_id=? AND user_id=?').bind(co,roomId,me.id).first<{peer_id:string}>();
  if(own?.peer_id!==peerId)fail(409,`This call is full (${limit} people), or you already joined on another device.`);
  return response({peers:await visiblePeers(co,roomId,now)});
 }
 if(action==='leave'){
  await database.batch([database.prepare('DELETE FROM crew_call_peers WHERE company_id=? AND room_id=? AND user_id=? AND peer_id=?').bind(co,roomId,me.id,peerId),database.prepare('DELETE FROM crew_call_signals WHERE company_id=? AND room_id=? AND (target=? OR sender=?)').bind(co,roomId,peerId,peerId)]);return response({ok:true});
 }
 const own=await database.prepare('SELECT * FROM crew_call_peers WHERE company_id=? AND room_id=? AND user_id=? AND peer_id=? AND auth_version=? AND seen_at>? AND joined_at>?').bind(co,roomId,me.id,peerId,me.auth_version,now-LEASE,now-MAX_DURATION).first<Peer>();if(!own)fail(409,'Your call ended. Join again to reconnect.');
 if(action==='heartbeat'){await database.prepare('UPDATE crew_call_peers SET seen_at=? WHERE company_id=? AND room_id=? AND user_id=? AND peer_id=?').bind(now,co,roomId,me.id,peerId).run();return response({ok:true});}
 if(action!=='signal')fail(400,'Unknown call action.');
 const target=required(data.target),peers=await visiblePeers(co,roomId,now);if(target===peerId||!peers.some(p=>p.peerId===target))fail(404,'That person left the call.');
 const payload=data.payload as Record<string,unknown>;if(!payload||typeof payload!=='object'||!['offer','answer','ice'].includes(String(payload.type)))fail(400,'Invalid call signal.');
 if(payload.type==='offer'||payload.type==='answer'){if(typeof payload.sdp!=='string'||!payload.sdp||payload.sdp.length>55000)fail(400,'Invalid call description.');}
 if(payload.type==='ice'){const c=payload.candidate as Record<string,unknown>;if(!c||typeof c!=='object'||typeof c.candidate!=='string'||c.candidate.length>4000)fail(400,'Invalid connection update.');}
 const encoded=JSON.stringify(payload);if(encoded.length>60000)fail(413,'Call signal too large.');
 const count=await database.prepare('SELECT COUNT(*) AS n FROM crew_call_signals WHERE company_id=? AND sender=? AND created_at>?').bind(co,peerId,now-60000).first<{n:number}>();if((count?.n||0)>=(limit>4?(limit-1)*80:240))fail(429,'Too many call updates. Leave and try again shortly.');
 await database.prepare('INSERT INTO crew_call_signals(company_id,room_id,sender,target,payload,created_at) VALUES(?,?,?,?,?,?)').bind(co,roomId,peerId,target,encoded,now).run();return response({ok:true});
 }catch(e){return handleError(e);}}

