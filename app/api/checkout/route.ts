import {env} from 'cloudflare:workers';
import {requireRecent,currentPerson} from '@/lib/access';
import {checkOrigin,fail,response,handleError} from '@/lib/chat-server';
import {companyProducts} from '@/lib/company-products';
import {companyId,companyPath} from '@/lib/company-context';
import {rawDb} from '@/lib/chat-db';
import {checkoutParameters} from '@/lib/stripe-checkout';
import {BILLING_POLICY,billingAccess} from '@/lib/billing-policy';
import {stripeLive,requireStripeConfiguration,stripeCall} from '@/lib/stripe-billing';
export async function GET(){try{
  const me=await currentPerson();if(me.role!=='owner')fail(403,'Only the owner can view billing.');
  const billing=await rawDb().prepare('SELECT status,billing_interval,updated_at,payment_failed_at,trial_ends_at,cancel_at_period_end FROM company_billing WHERE company_id=?').bind(companyId()).first();
  return response({policy:BILLING_POLICY,access:billing?billingAccess(String(billing.status),Number(billing.payment_failed_at)||null):null,billing:billing||{status:'not_started'},testMode:!stripeLive(),eligible:/^c_/.test(companyId())});
}catch(error){return handleError(error);}}
// Explicit environment separation. PMS, demo and legacy pilot workspaces remain outside paid billing.
export async function POST(request:Request){try{
  checkOrigin(request);const owner=await requireRecent();if(owner.role!=='owner')fail(403,'Only the company owner can start billing.');
  const co=companyId();if(!/^c_/.test(co))fail(403,'Billing tests are for newly created company workspaces.');
  requireStripeConfiguration();
  if(!env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'))fail(503,'Verified payment notifications are not configured.');
  if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'Use JSON.');
  const data=await request.json() as {interval?:unknown;action?:unknown};if(!data)fail(400,'Choose billing options.');
  const db=rawDb(),now=Date.now(),mode=stripeLive()?'live':'test';
  const prior=await db.prepare('SELECT * FROM company_billing WHERE company_id=?').bind(co).first<{billing_mode:string;status:string;customer_id:string|null;subscription_id:string|null;checkout_attempt:string|null;checkout_id:string|null;checkout_url:string|null;checkout_expires_at:number;checkout_started_at:number;price_id:string|null}>();
  if(prior&&prior.billing_mode!==mode)fail(409,'This workspace has sandbox billing. Create a new company for live payments.');
  if(data.action==='portal'){
    if(!prior?.customer_id)fail(400,'Start a subscription first.');
    const portal=await stripeCall<{url:string}>('billing_portal/sessions',new URLSearchParams({customer:prior.customer_id,return_url:new URL(companyPath('/billing/'),request.url).href}));
    if(!portal.url.startsWith('https://billing.stripe.com/'))fail(502,'Unexpected billing portal.');return response({url:portal.url});
  }
  if(!['month','year'].includes(String(data.interval)))fail(400,'Choose monthly or yearly billing.');
  if(prior?.subscription_id&&!['canceled','incomplete_expired'].includes(prior.status))fail(409,'A subscription already exists. Manage it in the billing portal.');
  const {plan}=await companyProducts();const key=`STRIPE_PRICE_${plan.toUpperCase()}_${String(data.interval).toUpperCase()}` as keyof Cloudflare.Env;
  const price=env[key];if(typeof price!=='string'||!/^price_[A-Za-z0-9]+$/.test(price))fail(503,'This price is not configured.');
  if(prior?.checkout_url&&prior.checkout_expires_at>now&&prior.status==='checkout_pending'){
    if(prior.price_id!==price)fail(409,'A checkout is already open. Finish it or wait for it to expire before changing billing frequency.');return response({url:prior.checkout_url});
  }
  const reuse=prior?.checkout_attempt&&prior.checkout_started_at>now-23*3600000&&!prior.checkout_id;
  const attempt=reuse?prior.checkout_attempt!:crypto.randomUUID();
  if(reuse&&prior.price_id!==price)fail(409,'Retry the same billing frequency while checkout is being prepared.');
  if(!reuse){
    await db.prepare("INSERT INTO company_billing(company_id,checkout_attempt,checkout_started_at,price_id,status,updated_at,billing_mode) VALUES(?,?,?,?, 'checkout_pending',?,?) ON CONFLICT(company_id) DO UPDATE SET checkout_attempt=excluded.checkout_attempt,checkout_started_at=excluded.checkout_started_at,checkout_id=NULL,checkout_url=NULL,checkout_expires_at=0,subscription_id=NULL,status='checkout_pending',last_event_created=0,price_id=excluded.price_id,billing_mode=excluded.billing_mode,updated_at=excluded.updated_at WHERE (company_billing.checkout_id IS NOT NULL AND company_billing.checkout_expires_at<=? AND company_billing.status='checkout_pending') OR company_billing.checkout_started_at<=? OR company_billing.status IN ('canceled','incomplete_expired')").bind(co,attempt,now,price,now,mode,now,now-23*3600000).run();
    const claimed=await db.prepare('SELECT checkout_attempt FROM company_billing WHERE company_id=?').bind(co).first<{checkout_attempt:string}>();if(claimed?.checkout_attempt!==attempt)fail(409,'Checkout is being prepared. Please retry.');
  }
  const success=new URL(companyPath('/billing/?result=success'),request.url);success.searchParams.set('session_id','{CHECKOUT_SESSION_ID}');
  const cancel=new URL(companyPath('/billing/?result=cancel'),request.url);
  const params=checkoutParameters(price,success.href.replace('%7BCHECKOUT_SESSION_ID%7D','{CHECKOUT_SESSION_ID}'),cancel.href);
  if(prior?.customer_id){params.delete('subscription_data[trial_period_days]');params.set('customer',prior.customer_id);}
  params.set('client_reference_id',co);params.set('metadata[company_id]',co);params.set('metadata[attempt]',attempt);params.set('subscription_data[metadata][company_id]',co);params.set('subscription_data[metadata][attempt]',attempt);
  const session=await stripeCall<{id:string;url:string;livemode:boolean;expires_at:number}>('checkout/sessions',params,`company-checkout-${co}-${attempt}`);
  if(session.livemode!==stripeLive()||!session.id?.startsWith(stripeLive()?'cs_live_':'cs_test_')||!session.url?.startsWith('https://checkout.stripe.com/'))fail(502,'Stripe returned an unexpected checkout.');
  await db.prepare('UPDATE company_billing SET checkout_id=?,checkout_url=?,checkout_expires_at=?,billing_interval=?,updated_at=? WHERE company_id=? AND checkout_attempt=?').bind(session.id,session.url,session.expires_at*1000,data.interval,now,co,attempt).run();if(stripeLive())await db.prepare('UPDATE company_registry SET billing_required=1 WHERE id=?').bind(co).run();return response({url:session.url});
}catch(error){return handleError(error);}}
