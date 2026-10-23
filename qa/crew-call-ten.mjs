import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createHarness,hash,randomToken} from './independent-passkey-test-runtime.mjs';
const h=await createHarness();let assertions=0;const eq=(a,b)=>{assertions++;assert.deepEqual(a,b);};
function employee(id){const token=randomToken();h.run('INSERT INTO people(id,email,name,role,active,joined_at,passkey_enrolled) VALUES(?,?,?,?,1,?,1)',id,'',id,'member',Date.now());h.run('INSERT INTO sessions(session_hash,user_id,auth_version,expires_at,id,auth_level,verified_at) VALUES(?,?,1,?,?,?,?)',hash(token),id,Date.now()+3600000,'session-'+id,'passkey',Date.now());return h.browser({id,cookies:[['__Host-project_room_session',token]]});}
const people=Object.fromEntries(['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','outside'].map(id=>[id,employee(id)])),ids=Object.fromEntries(Object.keys(people).map(id=>[id,randomUUID()]));
async function api(who,body,status=200,query={}){const r=await h.request(who,'crewCall',{pathname:'/api/crew-call',query,...(body?{method:'POST',body}:{})});eq(r.status,status);return r.json();}
const send=(user,action,extra={},status=200)=>api(people[user],{action,roomId:'crew',peerId:ids[user],...extra},status);
try{
 h.sqlite.exec(await readFile(new URL('../migrations/0014_crew_calls.sql',import.meta.url),'utf8'));
 for(const room of ['crew','other','bot']){h.run('INSERT INTO rooms(id,name,description,kind,visibility,created_by,created_at) VALUES(?,?,?, ?,\'private\',?,?)',room,room,'',room==='bot'?'bot':'channel','a',Date.now());for(const id of ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o'])h.run('INSERT INTO room_members(room_id,user_id,read_at) VALUES(?,?,0)',room,id);}
 await api(h.browser(),null,401,{roomId:'crew'});await api(people.outside,null,404,{roomId:'crew'});
 await send('a','join',{roomId:'bot'},400);await send('a','join');await send('a','join');eq(h.count('crew_call_peers'),1);
 await send('a','join',{peerId:randomUUID()},409);
 for(const user of ['b','c','d','f','g','h','i','j','k','l','m','n','o'])await send(user,'join');await send('e','join',{},409);
 eq((await api(people.a,null,200,{roomId:'crew'})).peers.length,14);
 await send('e','join',{roomId:'other'});eq((await api(people.e,null,200,{roomId:'other'})).peers.length,1);
 await send('a','signal',{target:ids.e,payload:{type:'offer',sdp:'fixture'}},404);
 await send('a','signal',{target:ids.b,payload:{type:'offer',sdp:'fixture'}});
 const inbox=await api(people.b,null,200,{roomId:'crew',peerId:ids.b,since:0});eq(inbox.signals.length,1);eq(inbox.signals[0].payload.sdp,'fixture');
 eq((await api(people.c,null,200,{roomId:'crew',peerId:ids.c,since:0})).signals.length,0);
 await api(people.a,null,409,{roomId:'crew',peerId:ids.b});await send('a','heartbeat',{peerId:ids.b},409);
 await send('a','signal',{target:ids.b,payload:{type:'invalid'}},400);
 await api(people.a,{action:'leave',roomId:'crew',peerId:ids.b});eq(h.count('crew_call_peers','peer_id=?',ids.b),1);
 const forged=await h.request(people.a,'crewCall',{pathname:'/api/crew-call',method:'POST',headers:{Origin:'https://evil.test'},body:{action:'join',roomId:'crew',peerId:ids.a}});eq(forged.status,403);
 h.run('DELETE FROM room_members WHERE room_id=? AND user_id=?','crew','b');eq((await api(people.a,null,200,{roomId:'crew'})).peers.some(p=>p.userId==='b'),false);await send('b','heartbeat',{},404);
 h.run('UPDATE people SET auth_version=2 WHERE id=?','c');eq((await api(people.a,null,200,{roomId:'crew'})).peers.some(p=>p.userId==='c'),false);await send('c','heartbeat',{},401);
 await send('d','leave');eq(h.count('crew_call_peers','peer_id=?',ids.d),0);
 h.run('UPDATE crew_call_peers SET seen_at=? WHERE peer_id=?',Date.now()-50000,ids.a);await send('a','heartbeat',{},409);await send('a','join');
 h.run('UPDATE crew_call_peers SET joined_at=? WHERE peer_id=?',Date.now()-2*3600000-1,ids.a);await send('a','heartbeat',{},409);
 await api(people.a,null,409,{roomId:'crew',peerId:ids.a});
 eq((await api(people.e,null,200,{roomId:'other'})).peers.length,1);
 await send('e','leave',{roomId:'other'});eq((await api(people.e,null,200,{roomId:'other'})).peers.length,0);

 const testIds=Object.fromEntries(Object.keys(people).map(id=>[id,randomUUID()]));
 for(const user of ['a','d','e','f','g','h','i','j','k','b']){if(user==='b')h.run('INSERT INTO room_members(room_id,user_id,read_at) VALUES(?,?,0)','crew','b');await api(people[user],{action:'join',roomId:'crew',peerId:testIds[user],test:'10'});}
 eq((await api(people.a,null,200,{roomId:'crew',test:'10'})).peers.length,10);
 eq((await api(people.a,null,200,{roomId:'crew'})).peers.length,11);
 await api(people.a,{action:'signal',roomId:'crew',peerId:testIds.a,target:ids.e,payload:{type:'offer',sdp:'cross-mode'},test:'10'},404);
 await api(people.a,{action:'heartbeat',roomId:'crew',peerId:testIds.a},409);
 await api(people.a,{action:'leave',roomId:'crew',peerId:testIds.a});eq((await api(people.a,null,200,{roomId:'crew',test:'10'})).peers.length,10);
 const extra=employee('extra');h.run('INSERT INTO room_members(room_id,user_id,read_at) VALUES(?,?,0)','crew','extra');await api(extra,{action:'join',roomId:'crew',peerId:randomUUID(),test:'10'},409);
 await api(people.a,{action:'leave',roomId:'crew',peerId:testIds.a,test:'10'});eq((await api(people.a,null,200,{roomId:'crew',test:'10'})).peers.length,9);
 await api(extra,{action:'join',roomId:'crew',peerId:randomUUID(),test:'10'});
 console.log(JSON.stringify({passed:true,assertions,scope:'Actual authenticated Worker route and SQLite; synthetic records only; no live writes',maxRequestSql:h.metrics.maxRequestSql}));
}finally{h.close();}

