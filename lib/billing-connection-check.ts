import {env} from 'cloudflare:workers';
import {rawDb} from './chat-db';
import {stripeCall,stripeLive} from './stripe-billing';
import {fail} from './app-errors';
import {PRODUCT_PLANS} from './product-plans';

// Called only after the platform-owner authorization check. No Stripe or database writes.
export async function billingConnectionCheck(){
  const prices=[];
  for(const plan of PRODUCT_PLANS)for(const interval of ['month','year']){
    const name=`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}` as keyof Cloudflare.Env;
    const id=env[name];
    if(typeof id!=='string'||!/^price_[A-Za-z0-9]+$/.test(id))fail(503,'A billing price is not configured.');
    const p=await stripeCall<{id:string;object:string;active:boolean;livemode:boolean;recurring:{interval:string}|null}>(`prices/${id}`);
    prices.push({plan,interval,verified:p.object==='price'&&p.id===id&&p.active===true&&p.livemode===stripeLive()&&p.recurring?.interval===interval});
  }
  const rows=await rawDb().prepare("SELECT company_id,customer_id,subscription_id,price_id,checkout_attempt,status,cancel_at_period_end FROM company_billing WHERE billing_mode=? AND subscription_id IS NOT NULL LIMIT 21").bind(stripeLive()?'live':'test').all<{company_id:string;customer_id:string;subscription_id:string;price_id:string;checkout_attempt:string;status:string;cancel_at_period_end:number}>();
  if(rows.results.length>20)fail(503,'Review billing capacity before continuing.');
  const subscriptions=[];
  for(const row of rows.results){
    if(!/^sub_[A-Za-z0-9]+$/.test(row.subscription_id))fail(503,'A subscription mapping is invalid.');
    const s=await stripeCall<{id:string;object:string;livemode:boolean;customer:string;status:string;cancel_at_period_end:boolean;metadata:Record<string,string>;items:{data:{price:{id:string}}[]}}>(`subscriptions/${row.subscription_id}`);
    subscriptions.push({company:row.company_id,status:s.status,verified:s.object==='subscription'&&s.id===row.subscription_id&&s.livemode===stripeLive()&&s.customer===row.customer_id&&s.metadata?.company_id===row.company_id&&s.metadata?.attempt===row.checkout_attempt&&s.status===row.status&&s.cancel_at_period_end===!!row.cancel_at_period_end&&s.items?.data.some(i=>i.price.id===row.price_id)});
  }
  return {readOnly:true,stripeMode:stripeLive()?'live':'test',verified:prices.every(p=>p.verified)&&subscriptions.every(s=>s.verified),prices,subscriptions,webhookSecretConfigured:!!env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'),webhookSignatureDeliveryVerified:false};
}
