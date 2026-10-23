import assert from 'node:assert/strict';
import {createECDH,randomBytes} from 'node:crypto';
import webpush from 'web-push';
import ece from 'http_ece';
import {createHarness,hash,randomToken} from './independent-passkey-test-runtime.mjs';
const keys=webpush.generateVAPIDKeys(),runner=randomToken();
const h=await createHarness({routeFiles:{bots:'app/api/bots/route.ts'},environment:{VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,BOT_RUNNER_TOKEN_HASH:hash(runner)}});
let assertions=0,pushes=0,failure=false;const eq=(a,b)=>{assertions++;assert.equal(a,b);},ok=v=>{assertions++;assert.ok(v);};
function fixture(id){const token=randomToken();h.run('INSERT INTO people (id,email,name,role,active,joined_at,passkey_enrolled) VALUES (?,?,?,?,1,?,1)',id,'',id,'member',Date.now());h.run('INSERT INTO sessions (session_hash,user_id,auth_version,expires_at,id,auth_level,verified_at) VALUES (?,?,1,?,?,?,?)',hash(token),id,Date.now()+3600000,'session-'+id,'passkey',Date.now());return h.browser({id,cookies:[['__Host-project_room_session',token]]});}
const a=fixture('alice'),b=fixture('bob'),c=fixture('charlie'),visitor=h.browser();
async function call(user,body,expected=200,query={}){const response=await h.request(user,'chat',{...(body?{method:'POST',body}:{}),query});eq(response.status,expected);return response.json();}
const curve=createECDH('prime256v1'),key=curve.generateKeys().toString('base64url'),auth=randomBytes(16).toString('base64url');
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{p256dh:key,auth}};
globalThis.fetch=async(input,init)=>{eq(input,subscription.endpoint);eq(init.redirect,'manual');pushes++;if(failure)return new Response('',{status:503});const payload=JSON.parse(ece.decrypt(Buffer.from(init.body),{version:'aes128gcm',privateKey:curve,authSecret:auth}).toString());eq(payload.kind,'chat');eq(payload.body,'You have a new chat message.');ok(!JSON.stringify(payload).includes('private text'));ok(!JSON.stringify(payload).includes('alice'));return new Response('',{status:201});};
const settings={action:'notification_settings',enabled:true,quietEnabled:false,quietStart:1320,quietEnd:420,timezone:'America/Los_Angeles',mutedRooms:[]};
async function tick(){h.run('UPDATE chat_notification_preferences SET last_attempt=0');const response=await h.request(visitor,'bots',{method:'POST',body:{},query:{action:'tick'},headers:{Authorization:'Bearer '+runner}});eq(response.status,200);return response.json();}
let serial=0;function message(room,body,sender='bob'){const id='message-fixture-'+(++serial);h.run('INSERT INTO messages (id,room_id,user_id,body,created_at) VALUES (?,?,?,?,?)',id,room,sender,body,Date.now());return id;}
try{
 await call(visitor,null,401,{action:'notification_settings'});eq((await call(a,null,200,{action:'notification_settings'})).enabled,false);
 for(const [room,kind] of [['direct','dm'],['channel','channel'],['secret','channel']]){h.run('INSERT INTO rooms (id,name,description,kind,visibility,created_by,created_at) VALUES (?,?,?,?,?,?,?)',room,room,'',kind,'private','bob',Date.now());h.run('INSERT INTO room_members (room_id,user_id,read_at) VALUES (?,?,0)',room,'bob');if(room!=='secret')h.run('INSERT INTO room_members (room_id,user_id,read_at) VALUES (?,?,0)',room,'alice');}
 await call(a,{...settings,mutedRooms:['secret']},400);await call(a,{...settings,timezone:'invalid-zone'},400);await call(a,settings);h.run('UPDATE chat_notification_preferences SET enabled_at=0');
 await call(a,{action:'notification_subscribe',subscription});eq(h.count('bot_preferences'),0);await tick();eq(pushes,0);
 message('secret','@alice private text');await tick();eq(pushes,0);
 message('channel','ordinary private text');message('channel','@alice-extra private text');await tick();eq(pushes,0);
 const mentioned=message('channel','Hello @alice, private text');await tick();eq(pushes,1);eq(h.count('chat_push_receipts','message_id=?',mentioned),1);await tick();eq(pushes,1);
 const dm=message('direct','private text');failure=true;await tick();eq(pushes,2);eq(h.count('chat_push_receipts','message_id=?',dm),0);failure=false;await tick();eq(pushes,3);eq(h.count('chat_push_receipts','message_id=?',dm),1);
 await call(a,{...settings,mutedRooms:['direct']});message('direct','muted private text');await tick();eq(pushes,3);
 await call(a,{...settings,quietEnabled:true,quietStart:0,quietEnd:0});await tick();eq(pushes,3);
 await call(a,settings);await call(a,{action:'set_status',status:'driving',hours:1,userId:'bob'});eq(h.row('SELECT status FROM employee_status WHERE user_id=?','alice').status,'driving');eq(h.count('employee_status','user_id=?','bob'),0);
 const state=await call(a,null);eq(state.me.status,'driving');eq(state.members.find(p=>p.id==='alice').status,'driving');await tick();eq(pushes,3);
 h.run('UPDATE employee_status SET expires_at=? WHERE user_id=?',Date.now()-1,'alice');eq((await call(a,null)).me.status,null);await tick();eq(pushes,4);
 const read=message('direct','read private text');h.run('UPDATE room_members SET read_at=? WHERE room_id=? AND user_id=?',Date.now()+1,'direct','alice');await tick();eq(pushes,4);eq(h.count('chat_push_receipts','message_id=?',read),0);
 await call(b,settings);await call(b,{action:'notification_subscribe',subscription},409);
 await call(a,{action:'set_status',status:'working',hours:8});eq((await call(a,null)).me.status,'working');await call(a,{action:'set_status',status:'away',hours:4});eq((await call(a,null)).me.status,'away');await call(a,{action:'set_status',status:'available',hours:1});eq((await call(a,null)).me.status,'available');await call(a,{action:'set_status',status:'clear',hours:4});eq((await call(a,null)).me.status,null);await call(a,{action:'set_status',status:'unknown',hours:4},400);
 await call(a,{action:'conversation_preferences',roomId:'channel',favorite:false,section:'',notification:'all'});message('channel','ordinary all-messages alert');await tick();eq(pushes,5);
 await call(a,{action:'conversation_preferences',roomId:'channel',favorite:false,section:'',notification:'muted'});message('channel','@alice muted room alert');await tick();eq(pushes,5);
 await call(a,{...settings,enabled:false});message('channel','@alice private text');await tick();eq(pushes,5);
 h.run('UPDATE people SET auth_version=auth_version+1 WHERE id=?','alice');await call(a,null,401,{action:'notification_settings'});await tick();eq(pushes,5);
 ok(h.metrics.maxRequestSql<=50);console.log(JSON.stringify({passed:true,assertions,pushes,maxRequestSql:h.metrics.maxRequestSql,realNetwork:false}));
}finally{h.close();}
