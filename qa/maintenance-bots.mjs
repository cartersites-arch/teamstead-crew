import assert from 'node:assert/strict';
import {createECDH,randomBytes} from 'node:crypto';
import webpush from 'web-push';
import ece from 'http_ece';
import {createHarness,hash,randomToken} from './independent-passkey-test-runtime.mjs';
const keys=webpush.generateVAPIDKeys(),runner=randomToken();
const h=await createHarness({routeFiles:{bots:'app/api/bots/route.ts'},environment:{VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,BOT_RUNNER_TOKEN_HASH:hash(runner)}});
let assertions=0;function eq(a,b){assertions++;assert.equal(a,b);}function ok(a){assertions++;assert.ok(a);}
async function call(user,body,expected=200,extra={}){const res=await h.request(user,'bots',{...(body?{method:'POST',body}:{}),...extra});const data=await res.json();eq(res.status,expected);return data;}
function fixture(id){const token=randomToken();h.run('INSERT INTO people (id,email,name,role,active,joined_at,passkey_enrolled) VALUES (?,?,?,?,1,?,1)',id,'',id,'member',Date.now());h.run('INSERT INTO sessions (session_hash,user_id,auth_version,expires_at,id,auth_level,verified_at) VALUES (?,?,1,?,?,?,?)',hash(token),id,Date.now()+3600000,'session-'+id,'passkey',Date.now());return h.browser({id,cookies:[['__Host-project_room_session',token]]});}
const a=fixture('alice'),b=fixture('bob'),visitor=h.browser();let hubCalls=0,pushCalls=0;
const own={id:'job-a',work_order_number:'WO-A',description:'Private Alice job',status:'approved',version:1,assigned_to:'hub-alice',requester_id:'hub-alice',due_date:'2020-01-01',assignments:[]};
let jobs=[own,{id:'job-b',description:'Private Bob only',status:'approved',requester_id:'hub-bob',assigned_to:'hub-bob',version:1}];
let rejectHub=false,redirectHub=false,pushFailure=false;
const curve=createECDH('prime256v1'),publicKey=curve.generateKeys().toString('base64url'),auth=randomBytes(16).toString('base64url');
globalThis.fetch=async (input,init)=>{
 const url=typeof input==='string'?input:input.url;
 eq(init.redirect,'manual'); // Workers rejects redirect:error; manual prevents credential forwarding.
 if(url==='https://fhqmnlpgqslllzrovxbp.supabase.co/functions/v1/hub-read') {hubCalls++;if(redirectHub)return new Response(null,{status:302,headers:{Location:'https://unexpected.example/'}});if(rejectHub)return Response.json({error:'denied'},{status:401});return Response.json({employee:{id:'hub-alice'},work_requests:jobs,has_more:false});}
 if(url==='https://fcm.googleapis.com/fcm/send/fixture'){
  pushCalls++;if(pushFailure)return new Response('',{status:503});const plain=ece.decrypt(Buffer.from(init.body),{version:'aes128gcm',privateKey:curve,authSecret:auth});const payload=JSON.parse(plain.toString());eq(payload.title,'PMS Crew');ok(!plain.toString().includes('Private Alice'));ok(!plain.toString().includes('hub='));
  const header=new Headers(init.headers).get('authorization');ok(header.startsWith('vapid t='));const jwt=header.slice(8).split(',')[0],pieces=jwt.split('.');const claims=JSON.parse(Buffer.from(pieces[1],'base64url'));eq(claims.aud,'https://fcm.googleapis.com');const point=Buffer.from(keys.publicKey,'base64url');const verify=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:point.subarray(1,33).toString('base64url'),y:point.subarray(33).toString('base64url')},{name:'ECDSA',namedCurve:'P-256'},false,['verify']);ok(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},verify,Buffer.from(pieces[2],'base64url'),Buffer.from(pieces[0]+'.'+pieces[1])));return new Response('',{status:201});
 }
 throw new Error('Unexpected outbound destination in isolated test');
};
try{
 await call(visitor,null,401);await call(visitor,{},401,{query:{action:'tick'}});
 await call(a,{action:'enable',enabled:true,consent:false},400);await call(a,{action:'enable',enabled:true,consent:true},400);
 const link='https://pms-company-hub.pages.dev/#hub=00000000-0000-4000-8000-000000000001';
 const connected=await h.request(a,'maintenance',{method:'POST',body:{action:'connect',link}});eq(connected.status,200);
 const enabled=await call(a,{action:'enable',enabled:true,consent:true});ok(enabled.enabled);eq(hubCalls,0);
 await call(a,{action:'my_jobs'});eq(hubCalls,1);const room=enabled.roomId;ok(h.rows('SELECT body FROM messages WHERE room_id = ?',room).every(m=>!m.body.includes('Private Bob')));eq(h.count('room_members','room_id = ?',room),1);
 eq((await h.request(b,'chat',{query:{action:'messages',roomId:room}})).status,404);
 const count=h.count('messages','room_id = ?',room);await call(a,{action:'check'});eq(h.count('messages','room_id = ?',room),count);
 jobs=[{...own,version:2,status:'in_progress'},jobs[1],{...own,id:'job-new',work_order_number:'WO-NEW',description:'New assignment',version:1,due_date:null}];
 await call(a,{action:'check'});eq(h.count('messages','room_id = ?',room),count+2);await call(a,{action:'check'});eq(h.count('messages','room_id = ?',room),count+2);
 await call(a,{action:'subscribe',subscription:{endpoint:'https://127.0.0.1/private',keys:{p256dh:publicKey,auth}}},400);
 const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{p256dh:publicKey,auth}};
 await call(a,{action:'subscribe',subscription});await call(a,{action:'test_push'});eq(pushCalls,1);
 const tick=()=>call(visitor,{},200,{query:{action:'tick'},headers:{Authorization:'Bearer '+runner}});
 await tick();eq(pushCalls,1);eq(h.count('bot_events','push_done = 0'),0);
 h.run('UPDATE bot_preferences SET last_attempt = 0 WHERE user_id = ?',a.id);jobs=[{...jobs[0],version:3},...jobs.slice(1)];pushFailure=true;await tick();ok(h.count('bot_events','push_done = 0')>0);pushFailure=false;await tick();eq(h.count('bot_events','push_done = 0'),0);
 await h.request(b,'maintenance',{method:'POST',body:{action:'connect',link}});await call(b,{action:'enable',enabled:true,consent:true});await call(b,{action:'subscribe',subscription},409);
 const before=hubCalls;await h.request(a,'maintenance',{method:'POST',body:{action:'disconnect'}});eq((await call(a,null)).enabled,false);await call(a,{action:'my_jobs'},400);eq(hubCalls,before);
 await h.request(a,'maintenance',{method:'POST',body:{action:'connect',link}});eq((await call(a,null)).enabled,false);await call(a,{action:'enable',enabled:true,consent:true});eq(h.count('push_devices','user_id = ?',a.id),0);
 rejectHub=true;await call(a,{action:'my_jobs'},503);eq(h.row('SELECT lease_until FROM bot_preferences WHERE user_id = ?',a.id).lease_until,0);ok((await call(a,null)).error);rejectHub=false;
 redirectHub=true;const messagesBeforeRedirect=h.count('messages');await call(a,{action:'my_jobs'},503);eq(h.count('messages'),messagesBeforeRedirect);redirectHub=false;
 h.run('UPDATE people SET auth_version = auth_version + 1 WHERE id = ?',a.id);await call(a,null,401);
 ok(h.metrics.maxRequestSql<=50);
 console.log(JSON.stringify({passed:true,assertions,maxRequestSql:h.metrics.maxRequestSql,hubCalls,pushCalls,realNetwork:false,checks:['explicit consent','scoped jobs','private channel access','assignment and update alerts','daily overdue deduplication','revoked and changed connections','push SSRF rejection','device account ownership','encrypted generic payload','VAPID signature','retry after push failure','invalid runner secret']}));
}finally{h.close();}
