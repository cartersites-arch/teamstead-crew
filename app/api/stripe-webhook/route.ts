import {env} from 'cloudflare:workers';
import {rawDb} from '@/lib/chat-db';
import {response,fail,handleError} from '@/lib/chat-server';
import {stripeLive,stripeCall,verifyStripeSignature,configuredPrice} from '@/lib/stripe-billing';
type Subscription={id:string;customer:string;livemode:boolean;status:string;trial_end?:number;cancel_at_period_end?:boolean;metadata:{company_id?:string;attempt?:string};items:{data:{price:{id:string;recurring:{interval:string}};quantity:number}[]}};
export async function POST(request:Request){try{
  if(!env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'))fail(503,'Payment notifications are not configured.');
  const body=await request.text();if(body.length>200000)fail(413,'Event too large.');
  if(!await verifyStripeSignature(body,request.headers.get('stripe-signature'),env.STRIPE_WEBHOOK_SECRET))fail(400,'Invalid Stripe signature.');
  const event=JSON.parse(body) as {id:string;type:string;created:number;livemode:boolean;data:{object:Record<string,any>}};
  if(event.livemode!==stripeLive()||!/^evt_[A-Za-z0-9]+$/.test(event.id)||!Number.isSafeInteger(event.created))fail(400,'Unexpected Stripe environment.');
  const db=rawDb();if(await db.prepare('SELECT id FROM stripe_billing_events WHERE id=?').bind(event.id).first())return response({received:true});
  const obj=event.data.object;let subId:string|undefined;
  if(event.type.startsWith('customer.subscription.'))subId=obj.id;
  else if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded')subId=obj.subscription;
  else if(['invoice.paid','invoice.payment_failed','invoice.payment_action_required'].includes(event.type))subId=obj.subscription||obj.parent?.subscription_details?.subscription;
  else return response({received:true,ignored:true});
  if(!subId||!/^sub_[A-Za-z0-9]+$/.test(subId))return response({received:true,ignored:true});
  // Read canonical state; browser redirects and invoice snapshots never grant access.
  const sub=await stripeCall<Subscription>('subscriptions/'+encodeURIComponent(subId));
  const co=sub.metadata?.company_id,attempt=sub.metadata?.attempt;
  if(sub.livemode!==stripeLive()||!co||!/^c_[a-f0-9]{16}$/.test(co)||!attempt)return response({received:true,ignored:true});
  const row=await db.prepare('SELECT billing_mode,checkout_attempt,subscription_id,last_event_created FROM company_billing WHERE company_id=?').bind(co).first<{billing_mode:string;checkout_attempt:string;subscription_id:string|null;last_event_created:number}>();
  if(!row||row.billing_mode!==(stripeLive()?'live':'test')||row.checkout_attempt!==attempt||(row.subscription_id&&row.subscription_id!==sub.id))return response({received:true,ignored:true});
  const item=sub.items.data[0],mapped=item&&configuredPrice(item.price.id);
  const company=await db.prepare('SELECT COALESCE(product_package,product_bundle) AS selected_plan FROM company_registry WHERE id=?').bind(co).first<{selected_plan:string}>();
  if(sub.items.data.length!==1||item.quantity!==1||!mapped||mapped.plan!==company?.selected_plan||mapped.interval!==item.price.recurring.interval)fail(409,'Subscription does not match the company plan.');
  const now=Date.now();
  await db.batch([
    db.prepare("UPDATE company_billing SET payment_failed_at=CASE WHEN ? IN ('past_due','unpaid') THEN COALESCE(payment_failed_at,?) ELSE NULL END,trial_ends_at=?,cancel_at_period_end=?,customer_id=?,subscription_id=?,status=?,price_id=?,billing_interval=?,last_event_created=?,updated_at=? WHERE company_id=? AND checkout_attempt=? AND last_event_created<=? AND NOT EXISTS(SELECT 1 FROM stripe_billing_events WHERE id=?)").bind(sub.status,event.created*1000,sub.trial_end?sub.trial_end*1000:null,sub.cancel_at_period_end?1:0,sub.customer,sub.id,sub.status,item.price.id,mapped.interval,event.created,now,co,attempt,event.created,event.id),
    db.prepare('INSERT OR IGNORE INTO stripe_billing_events(id,company_id,created,processed_at) VALUES(?,?,?,?)').bind(event.id,co,event.created,now),
  ]);return response({received:true});
}catch(error){return handleError(error);}}

