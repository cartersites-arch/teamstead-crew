import assert from 'node:assert/strict';import {createHarness,hash,randomToken} from './independent-passkey-test-runtime.mjs';
const h=await createHarness({routeFiles:{workspaces:'app/api/workspaces/route.ts'}});const token=randomToken(),now=Date.now();let n=0,calls=0;
h.run("INSERT INTO people(id,email,name,role,active,joined_at,passkey_enrolled) VALUES('pms-owner','','PMS owner','owner',1,?,1)",now);h.run("INSERT INTO workspace(id,name,owner_id,created_at,access_bootstrapped) VALUES('main','PMS','pms-owner',?,1)",now);h.run("INSERT INTO sessions(session_hash,user_id,auth_version,expires_at,id,auth_level,verified_at) VALUES(?,'pms-owner',1,?,'owner-session','passkey',?)",hash(token),now+3600000,now);
const owner=h.browser({id:'pms-owner',cookies:[['__Host-project_room_session',token]]});
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://fhqmnlpgqslllzrovxbp.supabase.co/functions/v1/company-setup');calls++;const data=JSON.parse(options.body);assert.equal(data.scope,'main');assert.equal(data.action,'provision');return Response.json({name:data.name,url:'https://pms-company-hub.pages.dev/#hub=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});};
const eq=(a,b)=>{n++;assert.equal(a,b);};
try{
 let r=await h.request(owner,'workspaces',{method:'POST',body:{action:'activate',company:'pilot',name:'Pilot Company'}});eq(r.status,200);const data=await r.json();eq(data.needsPasskey,true);assert.match(data.url,/^\/\?company=pilot#access=[A-Za-z0-9_-]{43}$/);n++;
 const workspace=h.row("SELECT * FROM pilot_workspace WHERE id='main'");eq(workspace.name,'Pilot Company');eq(workspace.owner_id==='pms-owner',false);eq(h.row('SELECT passkey_enrolled FROM pilot_people WHERE id=?',workspace.owner_id).passkey_enrolled,0);eq(h.count('pilot_passkeys'),0);eq(h.count('pilot_sessions'),0);eq(h.count('pilot_rooms'),3);eq(h.count('pilot_maintenance_links'),1);
 eq(h.count('demo_workspace'),0);eq(h.row("SELECT name FROM workspace WHERE id='main'").name,'PMS');eq(calls,1);
 r=await h.request(owner,'workspaces',{method:'POST',body:{action:'activate',company:'pilot',name:'Pilot Company'}});eq(r.status,200);eq(h.row("SELECT owner_id FROM pilot_workspace WHERE id='main'").owner_id,workspace.owner_id);eq(h.count('pilot_rooms'),3);
 h.run("UPDATE sessions SET verified_at=0 WHERE user_id='pms-owner'");r=await h.request(owner,'workspaces',{method:'POST',body:{action:'activate',company:'demo',name:'Demo Company'}});eq(r.status,428);eq(h.count('demo_workspace'),0);
 console.log(JSON.stringify({passed:true,checks:n,scope:'Owner-only activation, separate invitation and passkeys, idempotent setup, encrypted Hub connection and recent-verification requirement',realNetwork:false}));
}finally{h.close();}
