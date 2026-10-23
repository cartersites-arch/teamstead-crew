import assert from 'node:assert/strict';
import {createHarness,hash,randomToken} from './independent-passkey-test-runtime.mjs';
const objects=new Map(),bucket={async put(key,bytes,options){if(objects.has(key))return null;objects.set(key,{bytes:new Uint8Array(bytes),options});return {size:bytes.length};},async get(key){const o=objects.get(key);return o?{size:o.bytes.length,customMetadata:o.options.customMetadata,arrayBuffer:async()=>o.bytes.buffer}:null;},async delete(key){objects.delete(key);}};
const h=await createHarness({environment:{CHAT_PHOTOS:bucket},routeFiles:{workspaces:'app/api/workspaces/route.ts'}});let checks=0;
const eq=(a,b)=>{checks++;assert.equal(a,b);};
function seed(co){const prefix=co==='main'?'':co+'_',token=randomToken();h.run('INSERT INTO '+prefix+'people(id,email,name,role,active,joined_at,passkey_enrolled) VALUES(?,?,?,\'owner\',1,?,1)','same-owner','',co+' owner',Date.now());h.run('INSERT INTO '+prefix+'workspace(id,name,owner_id,created_at,access_bootstrapped) VALUES(?,?,?, ?,1)','main',co+' company','same-owner',Date.now());h.run('INSERT INTO '+prefix+'sessions(session_hash,user_id,auth_version,expires_at,id,auth_level,verified_at) VALUES(?,?,1,?, ?,\'passkey\',?)',hash(token),'same-owner',Date.now()+3600000,'same-session',Date.now());h.run('INSERT INTO '+prefix+'rooms(id,name,description,kind,visibility,created_by,created_at) VALUES(?,?,?,\'channel\',\'shared\',?,?)','same-room',co,'','same-owner',Date.now());h.run('INSERT INTO '+prefix+'room_members(room_id,user_id,read_at) VALUES(?,?,0)','same-room','same-owner');return h.browser({id:'same-owner',cookies:[['__Host-project_room_session'+(co==='main'?'':'_'+co),token]]});}
const main=seed('main'),demo=seed('demo'),pilot=seed('pilot');
async function get(who,co){return h.request(who,'chat',{query:{company:co}});}
try{
 eq((await get(main,'demo')).status,401);eq((await get(demo,'main')).status,401);eq((await get(demo,'pilot')).status,401);eq((await get(pilot,'demo')).status,401);
 for(const [co,browser]of [['main',main],['demo',demo],['pilot',pilot]]){const r=await get(browser,co);eq(r.status,200);const data=await r.json();eq(data.me.name,co+' owner');eq(data.rooms[0].name,co);}
 eq((await h.request(demo,'chat',{query:{company:'demo'},headers:{'X-Company':'pilot'}})).status,400);
 eq((await get(main,'unknown')).status,404);
 const simultaneous=await Promise.all([get(demo,'demo'),get(pilot,'pilot'),get(main,'main')]);eq((await simultaneous[0].json()).me.name,'demo owner');eq((await simultaneous[1].json()).me.name,'pilot owner');eq((await simultaneous[2].json()).me.name,'main owner');
 async function scoped(co,fn){return h.routes.requestContext.withRequest(new Request(h.origin+'/?company='+co),fn);}
 const bytes=new TextEncoder().encode('photo fixture');await scoped('demo',()=>h.photoStore.put('same-key',bytes));await scoped('pilot',()=>h.photoStore.put('same-key',new TextEncoder().encode('pilot photo')));
 eq(objects.size,2);eq(objects.has('companies/demo/same-key'),true);eq(objects.has('companies/pilot/same-key'),true);
 await scoped('demo',()=>h.photoStore.put('same-key',bytes));eq(objects.size,2);
 eq(new TextDecoder().decode((await scoped('demo',()=>h.photoStore.get('same-key'))).body),'photo fixture');eq(new TextDecoder().decode((await scoped('pilot',()=>h.photoStore.get('same-key'))).body),'pilot photo');
 await scoped('demo',()=>h.photoStore.delete('same-key'));eq(objects.has('companies/demo/same-key'),false);eq(objects.has('companies/pilot/same-key'),true);eq(h.count('r2_objects'),1);
 eq((await h.request(demo,'workspaces',{query:{company:'demo'}})).status,200);
 h.run('UPDATE demo_workspace SET owner_id=?','another-owner');eq((await h.request(demo,'workspaces',{query:{company:'demo'}})).status,403);
 eq(h.row('SELECT name FROM people WHERE id=?','same-owner').name,'main owner');eq(h.row('SELECT name FROM demo_people WHERE id=?','same-owner').name,'demo owner');eq(h.row('SELECT name FROM pilot_people WHERE id=?','same-owner').name,'pilot owner');
 console.log(JSON.stringify({passed:true,checks,realNetwork:false,scope:'Actual Worker, independent cookies, simultaneous requests, R2 keys and owner authorization'}));
}finally{h.close();}
