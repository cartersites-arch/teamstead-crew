import {withRequest} from '@/lib/request-context';
import {companyId} from '@/lib/company-context';
import {db,rawDb} from '@/lib/chat-db';
import {env} from 'cloudflare:workers';
import {member,response,handleError,checkOrigin,fail} from '@/lib/chat-server';
import {requireRecent,tokenHash} from '@/lib/access';
import {botStatus,enableBot,subscribe,unsubscribe,checkJobs,sendPush,runBots} from '@/lib/maintenance-bots';
export async function GET(){try{const me=await member();return response(await botStatus(me.id));}catch(e){return handleError(e);}}
export async function POST(request:Request){try{
 if(new URL(request.url).searchParams.get('action')==='tick'){
  const expected=env.BOT_RUNNER_TOKEN_HASH||'',token=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)||!/^[a-f0-9]{64}$/.test(expected))fail(401,'Unavailable.');const actual=await tokenHash(token);let diff=0;for(let i=0;i<64;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);if(diff)fail(401,'Unavailable.');const result=await runBots();if(companyId()==='main'){const companies=await rawDb().prepare("SELECT id FROM company_registry WHERE id<>'main' AND status='active' AND hub_ready=1").all<{id:string}>();await Promise.allSettled(companies.results.map(async co=>{const url=new URL('https://teamstead-crew.pages.dev/api/bots?action=tick');url.searchParams.set('company',co.id);const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Company notification check could not finish');}));}return response(result);
 }
 checkOrigin(request);const me=await member();if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'Use Teamstead Crew to update your bots.');const raw=await request.text();if(raw.length>8192)fail(413,'Request too large.');let data:any;try{data=JSON.parse(raw);}catch{fail(400,'Please try again.');}
 if(data?.action==='enable'){if(data.enabled!==true&&data.enabled!==false)fail(400,'Choose on or off.');if(data.enabled&&data.consent!==true)fail(400,'Confirm that your personal Hub can be read by your Maintenance bots.');return response(await enableBot(await requireRecent(),data.enabled));}
 if(data?.action==='subscribe')return response(await subscribe(await requireRecent(),data.subscription));
 if(data?.action==='unsubscribe')return response(await unsubscribe(await requireRecent(),data.id));
 if(data?.action==='my_jobs'||data?.action==='check')return response(await checkJobs(me.id,data.action==='my_jobs'));
 if(data?.action==='test_push'){await requireRecent();await sendPush(me.id,true);return response({ok:true});}
 fail(400,'Unknown bot action.');
 }catch(e){return handleError(e);}}
