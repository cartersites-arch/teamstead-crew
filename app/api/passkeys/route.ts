import { registrationOptions,registrationVerify,authenticationOptions,authenticationVerify } from '@/lib/passkeys';
import { response,handleError,checkOrigin,fail } from '@/lib/chat-server';
export const dynamic='force-dynamic';
const windows=new Map<string,{at:number;count:number}>();
function rateLimit(request:Request){const ip=request.headers.get('cf-connecting-ip')||'local',now=Date.now(),prior=windows.get(ip);if(prior&&now-prior.at<60000){if(++prior.count>120)fail(429,'Too many sign-in attempts. Wait a minute and try again.');}else{if(windows.size>2000)windows.clear();windows.set(ip,{at:now,count:1});}}
export async function POST(request:Request){try{
  checkOrigin(request);rateLimit(request);if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'Use a supported passkey format.');
  const raw=await request.text();if(raw.length>24000)fail(413,'This passkey request is too large.');let data:Record<string,unknown>;try{data=JSON.parse(raw);}catch{fail(400,'Please try again.');}if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'Please try again.');
  let result:{cookie?:string;[key:string]:unknown};
  if(data.action==='register_options')result=await registrationOptions();
  else if(data.action==='register_verify')result=await registrationVerify(data);
  else if(data.action==='auth_options')result=await authenticationOptions(data.purpose==='reauth');
  else if(data.action==='auth_verify')result=await authenticationVerify(data,data.purpose==='reauth');
  else fail(400,'Unknown passkey request.');
  const {cookie,...body}=result,res=response(body);if(cookie)res.headers.set('Set-Cookie',cookie);return res;
}catch(e){return handleError(e);}}
