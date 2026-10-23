import assert from 'node:assert/strict';
import {createHarness,hash,randomToken} from './independent-passkey-test-runtime.mjs';
const h=await createHarness({routeFiles:{orders:'app/api/work-orders/route.ts'}});
let assertions=0,calls=0,failPublish=true,redirect=false,deny=false;
const equal=(a,b)=>{assertions++;assert.equal(a,b);};
function person(id){const token=randomToken();h.run('INSERT INTO people (id,email,name,role,active,joined_at,passkey_enrolled) VALUES (?,?,?,?,1,?,1)',id,'',id,'member',Date.now());h.run('INSERT INTO sessions (session_hash,user_id,auth_version,expires_at,id,auth_level,verified_at) VALUES (?,?,1,?,?,?,?)',hash(token),id,Date.now()+3600000,'session-'+id,'passkey',Date.now());return h.browser({id,cookies:[['__Host-project_room_session',token]]});}
const alice=person('alice'),bob=person('bob'),visitor=h.browser(),credential=randomToken(),asset=crypto.randomUUID();
h.run("INSERT INTO rooms (id,kind,name,description,visibility,created_by,created_at) VALUES ('maintenance','channel','maintenance','','private','alice',?)",Date.now());
h.run("INSERT INTO rooms (id,kind,name,description,visibility,created_by,created_at) VALUES ('general','channel','general','','private','alice',?)",Date.now());
for(const room of ['maintenance','general'])h.run('INSERT INTO room_members (room_id,user_id) VALUES (?,?)',room,'alice');
const created=new Map(),uploaded=new Set(),published=new Set();
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{calls++;const url=String(input);equal(init.redirect,'manual');equal(new Headers(init.headers).get('Authorization'),'Bearer '+credential);assert(url.startsWith('https://fhqmnlpgqslllzrovxbp.supabase.co/functions/v1/'));if(redirect)return new Response(null,{status:302,headers:{Location:'https://untrusted.example/'}});if(deny)return Response.json({error:'private upstream error'}, {status:403});if(url.endsWith('/assets'))return Response.json([{id:asset,name:'Silver Street',number:'17',private_token:'must-not-return'}]);if(url.endsWith('/create')){const d=JSON.parse(init.body);equal(d.is_test,false);equal(d.kind,'requested');if(created.has(d.id))equal(created.get(d.id),JSON.stringify(d));else created.set(d.id,JSON.stringify(d));return Response.json({id:d.id,number:501});}if(url.endsWith('/list'))return Response.json({photos:[...uploaded].map(id=>({id}))});if(url.endsWith('/upload')){equal(new Headers(init.headers).get('content-type'),'image/jpeg');uploaded.add(new Headers(init.headers).get('x-photo-id'));return new Response('',{status:200});}if(url.endsWith('/publish')){const d=JSON.parse(init.body);if(failPublish){failPublish=false;return new Response('',{status:503});}published.add(d.operation_id);return Response.json({id:d.id,status:'approved'});}throw Error('Unexpected destination');};
function form(changes={}){const data=new FormData();for(const [k,v] of Object.entries({roomId:'maintenance',id:crypto.randomUUID(),photoId:crypto.randomUUID(),publishId:crypto.randomUUID(),asset,description:'Lightning bolt lamp is out; tried switching plugs.',safety:'false',...changes}))data.set(k,v);data.set('photo',new File([new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1,255,217])],'photo.jpg',{type:'image/jpeg'}));return data;}
async function get(who,status,roomId='maintenance'){const res=await h.request(who,'orders',{query:{roomId}});equal(res.status,status);return res.json();}
async function post(who,data,status,headers={}){const res=await h.request(who,'orders',{method:'POST',body:data,headers});equal(res.status,status);return res.json();}
try{
 await get(visitor,401);await get(bob,404);await get(alice,400);
 await h.request(alice,'maintenance',{method:'POST',body:{action:'connect',link:'https://pms-company-hub.pages.dev/#hub='+credential}});
 const assets=await get(alice,200);equal(assets.assets[0].name,'Silver Street');equal(JSON.stringify(assets).includes('must-not-return'),false);equal(JSON.stringify(assets).includes(credential),false);
 await get(alice,400,'general');const before=calls;await post(bob,form(),404);equal(calls,before);
 await post(alice,form(),403,{Origin:'https://evil.example'});
 await post(alice,form({description:'short'}),400);await post(alice,form({id:'bad-id'}),400);
 const badPhoto=form();badPhoto.set('photo',new File(['not a photo'],'bad.jpg',{type:'image/jpeg'}));await post(alice,badPhoto,400);equal(created.size,0);
 const retry=form();await post(alice,retry,503);equal(created.size,1);equal(uploaded.size,1);equal(published.size,0);
 const saved=await post(alice,retry,201);equal(saved.number,501);equal(saved.status,'approved');equal(created.size,1);equal(uploaded.size,1);equal(published.size,1);equal(h.count('messages'),0);
 await post(alice,retry,201);equal(created.size,1);equal(uploaded.size,1);equal(published.size,1);
 redirect=true;await get(alice,503);redirect=false;deny=true;const denied=await get(alice,403);equal(JSON.stringify(denied).includes('private upstream error'),false);deny=false;
 const messageId='issue-message-one';h.run("INSERT INTO messages (id,room_id,user_id,body,created_at) VALUES (?,'maintenance','alice',?,?)",messageId,'The lamp on Silver Street is out; tried switching plugs.',Date.now());
 const lookup=await h.request(alice,'orders',{query:{roomId:'maintenance',messageId}});equal(lookup.status,200);const match=await lookup.json();equal(match.matches.length,1);equal(match.matches[0].id,asset);equal(match.complete,true);equal(match.message.id,messageId);equal(JSON.stringify(match).includes(credential),false);
 const forbidden=await h.request(bob,'orders',{query:{roomId:'maintenance',messageId}});equal(forbidden.status,404);
 h.run('UPDATE messages SET body=? WHERE id=?','Silver Streetcar has a lamp issue',messageId);const partial=await (await h.request(alice,'orders',{query:{roomId:'maintenance',messageId}})).json();equal(partial.matches.length,0);
 const sourceRetry=form({sourceMessageId:messageId});await post(alice,sourceRetry,201);const oldSize=created.size;const sourceAgain=form({sourceMessageId:messageId});await post(alice,sourceAgain,201);equal(created.size,oldSize);
 const invalidSource=form({sourceMessageId:'unavailable'});await post(alice,invalidSource,404);equal(created.size,oldSize);
 h.run('UPDATE people SET auth_version=auth_version+1 WHERE id=?','alice');await get(alice,401);
 console.log(JSON.stringify({passed:true,assertions,calls,created:created.size,uploaded:uploaded.size,published:published.size,realNetwork:false,maxRequestSql:h.metrics.maxRequestSql}));
}finally{globalThis.fetch=realFetch;h.close();}
