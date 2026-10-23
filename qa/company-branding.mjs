import assert from 'node:assert/strict';
import {createHarness,hash,randomToken} from './independent-passkey-test-runtime.mjs';

const h=await createHarness({origin:'https://teamstead-crew.pages.dev',routeFiles:{branding:'app/api/branding/route.ts'}});
let checks=0;const eq=(actual,expected)=>{checks++;assert.equal(actual,expected);};
const now=Date.now(),ownerToken=randomToken(),memberToken=randomToken();

try{
  h.run("INSERT INTO people(id,email,name,role,active,joined_at,passkey_enrolled) VALUES('owner','','Company Owner','owner',1,?,1)",now);
  h.run("INSERT INTO people(id,email,name,role,active,joined_at,passkey_enrolled) VALUES('member','','Shop Employee','member',1,?,1)",now);
  h.run("INSERT INTO workspace(id,name,owner_id,created_at,access_bootstrapped) VALUES('main','QA Repair Company','owner',?,1)",now);
  h.run("INSERT INTO sessions(session_hash,user_id,auth_version,expires_at,id,auth_level,verified_at) VALUES(?,'owner',1,?,'owner-session','passkey',?)",hash(ownerToken),now+3600000,now);
  h.run("INSERT INTO sessions(session_hash,user_id,auth_version,expires_at,id,auth_level,verified_at) VALUES(?,'member',1,?,'member-session','passkey',?)",hash(memberToken),now+3600000,now);
  const owner=h.browser({id:'owner',cookies:[['__Host-project_room_session',ownerToken]]});
  const member=h.browser({id:'member',cookies:[['__Host-project_room_session',memberToken]]});
  const anonymous=h.browser();

  let result=await h.request(anonymous,'branding');eq(result.status,401);
  result=await h.request(member,'branding');eq(result.status,200);let data=await result.json();eq(data.companyName,'QA Repair Company');eq(data.viewerName,'Shop Employee');eq(data.hasLogo,false);
  result=await h.request(member,'branding',{method:'POST',body:{action:'remove'}});eq(result.status,403);
  result=await h.request(owner,'branding',{method:'POST',headers:{Origin:'https://evil.test'},body:{action:'remove'}});eq(result.status,403);
  result=await h.request(owner,'branding',{method:'POST',body:{action:'set',logoData:'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='}});eq(result.status,415);

  const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YK/a0YAAAAASUVORK5CYII=';
  result=await h.request(owner,'branding',{method:'POST',body:{action:'set',logoData:logo}});eq(result.status,200);data=await result.json();eq(data.hasLogo,true);eq(h.row("SELECT logo_data FROM workspace WHERE id='main'").logo_data,logo);
  result=await h.request(member,'branding');data=await result.json();eq(data.hasLogo,true);eq(data.logoUrl,'/api/branding?image=1');
  result=await h.request(member,'branding',{query:{image:'1'}});eq(result.status,200);eq(result.headers.get('content-type'),'image/png');assert.ok((await result.arrayBuffer()).byteLength>8);checks++;
  result=await h.request(owner,'branding',{method:'POST',body:{action:'remove'}});eq(result.status,200);eq(h.row("SELECT logo_data FROM workspace WHERE id='main'").logo_data,null);
  console.log(JSON.stringify({passed:true,checks,scope:'Authenticated shared company branding and owner-only logo changes',realNetwork:false}));
}finally{h.close();}
