import assert from 'node:assert/strict';
import {createHarness,hash,randomToken} from './independent-passkey-test-runtime.mjs';
const h=await createHarness({routeFiles:{open:'app/maintenance/open/route.ts'}});
try{
 const session=randomToken(),token=randomToken();
 h.run("INSERT INTO people (id,email,name,role,active,joined_at,passkey_enrolled) VALUES ('owner','','Owner','owner',1,?,1)",Date.now());
 h.run("INSERT INTO sessions (session_hash,user_id,auth_version,expires_at,id,auth_level,verified_at) VALUES (?,'owner',1,?,'session-owner','passkey',?)",hash(session),Date.now()+3600000,Date.now());
 const owner=h.browser({id:'owner',cookies:[['__Host-project_room_session',session]]});
 const missing=await h.request(owner,'open',{query:{form:'problem',viewer:'owner'}});assert.equal(missing.status,303);assert.equal(missing.headers.get('location'),'/?section=maintenance');
 await h.request(owner,'maintenance',{method:'POST',body:{action:'connect',link:'https://pms-company-hub.pages.dev/#hub='+token}});
 const redirected=await h.request(owner,'open',{query:{form:'problem',viewer:'owner'}});assert.equal(redirected.status,303);
 const url=new URL(redirected.headers.get('location'));assert.equal(url.origin,'https://pms-company-hub.pages.dev');assert.equal(url.pathname,'/request');assert.equal(url.searchParams.get('teamsteadPlan'),'complete');assert.equal(new URLSearchParams(url.hash.slice(1)).get('hub'),token);assert.equal(redirected.headers.get('referrer-policy'),'no-referrer');assert.equal(redirected.headers.get('cache-control'),'private, no-store');
 const normal=await h.request(owner,'open',{query:{viewer:'owner'}});assert.equal(new URL(normal.headers.get('location')).pathname,'/');
 const changed=await h.request(owner,'open',{query:{form:'problem',viewer:'someone-else'}});assert.equal(changed.headers.get('location'),'/?section=maintenance');
 console.log('Passed 11 private Hub shortcut checks.');
}finally{h.close();}
