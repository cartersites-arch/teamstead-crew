import {env} from 'cloudflare:workers';
import {fail} from './app-errors';
import {PRODUCT_PLANS} from './product-plans';
export function stripeLive(){return env.STRIPE_MODE==='live';}
export function requireStripeConfiguration(){
  const prefixes=stripeLive()?['sk_live_','rk_live_']:['sk_test_','rk_test_'];
  if(!prefixes.some(prefix=>env.STRIPE_SECRET_KEY?.startsWith(prefix)))fail(503,'Payments are not configured for this environment.');
}
export async function stripeCall<T>(path:string,params?:URLSearchParams,idempotencyKey?:string):Promise<T>{
  requireStripeConfiguration();
  const headers:Record<string,string>={Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`};
  if(params)headers['Content-Type']='application/x-www-form-urlencoded';
  if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
  const res=await fetch('https://api.stripe.com/v1/'+path,{method:params?'POST':'GET',headers,body:params,signal:AbortSignal.timeout(15000)});
  if(!res.ok)fail(502,'Stripe could not complete this request. Please try again.');
  return await res.json() as T;
}
export async function verifyStripeSignature(body:string,header:string|null,secret:string,now=Math.floor(Date.now()/1000)){
  const parts=(header||'').split(',').map(s=>s.split('='));
  const times=parts.filter(([key])=>key==='t').map(([,value])=>Number(value));
  const signatures=parts.filter(([key])=>key==='v1').map(([,value])=>value);
  if(times.length!==1||!Number.isSafeInteger(times[0])||Math.abs(now-times[0])>300)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const message=new TextEncoder().encode(`${times[0]}.${body}`);
  for(const signature of signatures){if(!/^[a-f0-9]{64}$/.test(signature||''))continue;const bytes=Uint8Array.from(signature.match(/../g)!,pair=>parseInt(pair,16));if(await crypto.subtle.verify('HMAC',key,bytes,message))return true;}
  return false;
}
export function configuredPrice(priceId:string){
  for(const plan of PRODUCT_PLANS)for(const interval of ['month','year'] as const){const key=`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}` as keyof Cloudflare.Env;if(env[key]===priceId)return {plan,interval};}
  return null;
}
