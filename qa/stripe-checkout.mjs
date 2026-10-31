import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {SoftwareAuthenticator} from './independent-software-authenticator.mjs';
import {createHarness,randomToken} from './independent-passkey-test-runtime.mjs';
const live=process.argv[3]==='live', mode=live?'live':'test';
const plan=process.argv[2]||'chat';assert.ok(['chat','hub','parts','combined','chat_parts','hub_parts','complete'].includes(plan));
const bridgePair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const bridgePublic=await crypto.subtle.exportKey('jwk',bridgePair.publicKey);
const h=await createHarness({origin:'https://teamstead-crew.pages.dev',sourceOverrides:{'lib/r2-bridge-public.ts':'export const BRIDGE_PUBLIC_KEY='+JSON.stringify(bridgePublic)+';'},routeFiles:{hubBilling:'lib/hub-billing-attestation.ts',signup:'app/api/signup/route.ts',checkout:'app/api/checkout/route.ts',webhook:'app/api/stripe-webhook/route.ts'},environment:{WEBAUTHN_RP_ID:'teamstead-crew.pages.dev',WEBAUTHN_ORIGIN:'https://teamstead-crew.pages.dev',STRIPE_MODE:mode,STRIPE_SECRET_KEY:live?'rk_live_fake':'sk_test_fake',STRIPE_WEBHOOK_SECRET:'whsec_fake',['STRIPE_PRICE_'+plan.toUpperCase()+'_MONTH']:'price_month',['STRIPE_PRICE_'+plan.toUpperCase()+'_YEAR']:'price_year'}});
const originalFetch=globalThis.fetch;let calls=[],subscription;let checks=0;const eq=(a,b)=>{checks++;assert.equal(a,b);};
globalThis.fetch=async(url,init)=>{calls.push({url,init});if(url.endsWith('/checkout/sessions'))return Response.json({id:live?'cs_live_example':'cs_test_example',url:'https://checkout.stripe.com/c/pay/cs_test_example',livemode:live,expires_at:Math.floor(Date.now()/1000)+86400});if(url.includes('/subscriptions/'))return Response.json(subscription);throw Error('Unexpected external call');};
try{
 const anon=h.browser(),token=randomToken();let r=await h.request(anon,'signup',{method:'POST',body:{action:'start',name:'QA Billing',ownerName:'QA Owner',setupToken:token,plan}});eq(r.status,200);const co=(await r.json()).company;let setup;
 for(let i=0;i<8;i++){r=await h.request(anon,'signup',{method:'POST',body:{action:'continue',company:co,ownerName:'QA Owner',setupToken:token}});eq(r.status,200);setup=await r.json();if(setup.url)break;}
 const owner=h.browser();r=await h.request(owner,'access',{method:'POST',query:{company:co},body:{action:'login',token:setup.url.split('#access=')[1]}});eq(r.status,200);const me=await (await h.request(owner,'access',{query:{company:co}})).json();owner.id=me.user.id;
 const options=await(await h.request(owner,'passkeys',{method:'POST',query:{company:co},body:{action:'register_options'}})).json();const device=new SoftwareAuthenticator({origin:h.origin});r=await h.request(owner,'passkeys',{method:'POST',query:{company:co},body:{action:'register_verify',challengeId:options.challengeId,response:device.register(options.options),name:'Billing QA'}});eq(r.status,200);
 const checkout=(browser=owner,body={interval:'month',price:'price_attacker'})=>h.request(browser,'checkout',{method:'POST',query:{company:co},body});
 eq((await checkout(anon)).status,401);eq((await checkout(owner,{interval:'bad'})).status,400);eq(calls.length,0);
 r=await checkout();eq(r.status,200);eq(calls.length,1);const params=calls[0].init.body;eq(params.get('mode'),'subscription');eq(params.get('subscription_data[trial_period_days]'),'30');eq(params.get('line_items[0][price]'),'price_month');eq(params.get('line_items[0][quantity]'),'1');eq(params.get('automatic_tax[enabled]'),'false');eq(params.get('ui_mode'),'hosted_page');eq(params.get('client_reference_id'),co);assert.ok(calls[0].init.headers['Idempotency-Key']);checks++;
 eq((await checkout()).status,200);eq(calls.length,1);eq((await checkout(owner,{interval:'year'})).status,409);
 const attempt=h.row('SELECT checkout_attempt FROM company_billing WHERE company_id=?',co).checkout_attempt;
 subscription={id:'sub_example',customer:'cus_example',livemode:live,status:'active',metadata:{company_id:co,attempt},items:{data:[{price:{id:'price_month',recurring:{interval:'month'}},quantity:1}]}};
 const stamp=Math.floor(Date.now()/1000);
 async function event(id,created=stamp,secret='whsec_fake',timestamp=stamp){const body=JSON.stringify({id,type:'checkout.session.completed',created,livemode:live,data:{object:{subscription:'sub_example'}}});const sig=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');return h.request(anon,'webhook',{method:'POST',raw:body,headers:{'stripe-signature':`t=${timestamp},v1=${sig}`}});}
 // Harness uses JSON bodies; request the route directly to retain signed raw bytes.
 async function deliver(id,created=stamp,secret='whsec_fake',timestamp=stamp){const body=JSON.stringify({id,type:'checkout.session.completed',created,livemode:live,data:{object:{subscription:'sub_example'}}});const sig=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');return h.request(anon,'webhook',{method:'POST',body:JSON.parse(body),headers:{'stripe-signature':`t=${timestamp},v1=${sig}`}});}
 eq((await deliver('evt_invalid',stamp,'wrong')).status,400);eq((await deliver('evt_oldsignature',stamp,'whsec_fake',stamp-600)).status,400);
 eq((await deliver('evt_success')).status,200);eq(h.row('SELECT status FROM company_billing WHERE company_id=?',co).status,'active');eq(h.count('stripe_billing_events'),1);
 const count=calls.length;eq((await deliver('evt_success')).status,200);eq(calls.length,count);eq((await checkout()).status,409);
 // Rotating a checkout price must not invalidate the previous subscription price.
 h.env['STRIPE_PRICE_'+plan.toUpperCase()+'_MONTH']='price_revised';
 h.env['STRIPE_PRICE_'+plan.toUpperCase()+'_MONTH_LEGACY']='price_month';
 eq((await deliver('evt_legacyprice',stamp+1)).status,200);
 subscription.items.data[0].price.id='price_unknown';
 eq((await deliver('evt_unknownprice',stamp+2)).status,409);
 subscription.items.data[0].price.id='price_revised';
 eq((await deliver('evt_revisedprice',stamp+3)).status,200);
 subscription.items.data[0].price.id='price_month';
 subscription.status='past_due';eq((await deliver('evt_failed',stamp+10)).status,200);eq(h.row('SELECT status FROM company_billing WHERE company_id=?',co).status,'past_due');
 eq(h.row('SELECT payment_failed_at FROM company_billing WHERE company_id=?',co).payment_failed_at,(stamp+10)*1000);
 subscription.status='active';eq((await deliver('evt_stale',stamp+5)).status,200);eq(h.row('SELECT status FROM company_billing WHERE company_id=?',co).status,'past_due');
 subscription.metadata.attempt='other';eq((await deliver('evt_unrelated',stamp+20)).status,200);eq(h.count('stripe_billing_events'),5);subscription.metadata.attempt=attempt;
 subscription.items.data[0].quantity=2;eq((await deliver('evt_quantity',stamp+20)).status,409);subscription.items.data[0].quantity=1;
 subscription.status='active';eq((await deliver('evt_recovered',stamp+25)).status,200);eq(h.row('SELECT payment_failed_at FROM company_billing WHERE company_id=?',co).payment_failed_at,null);
 subscription.status='canceled';eq((await deliver('evt_cancel',stamp+30)).status,200);eq(h.row('SELECT status FROM company_billing WHERE company_id=?',co).status,'canceled');
 eq((await checkout(owner,{interval:'year'})).status,200);eq(calls.at(-1).init.body.get('line_items[0][price]'),'price_year');eq(calls.at(-1).init.body.get('subscription_data[trial_period_days]'),null);
 async function hubPolicy(company=co,valid=true,offset=0){const body=JSON.stringify({company}),at=String(Date.now()+offset),sig=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},bridgePair.privateKey,new TextEncoder().encode(['pms-billing-v1',at,body].join('\n')))).toString('base64url');return h.request(anon,'hubBilling',{pathname:'/api/hub-billing-access',method:'POST',body,headers:{origin:null,'x-signed-at':at,'x-signature':valid?sig:'A'.repeat(86)}});}
 eq((await hubPolicy(co,false)).status,401);eq((await hubPolicy(co,true,-120000)).status,401);
 if(live){
  h.run('UPDATE company_registry SET billing_required=1 WHERE id=?',co);
  h.run("UPDATE company_billing SET billing_mode='test',status='active' WHERE company_id=?",co);
  let shell=await(await h.request(owner,'chat',{query:{company:co}})).json();eq(shell.billingRequired,true);eq(shell.rooms.length,0);eq((await(await hubPolicy()).json()).allowed,false);
  eq((await h.request(owner,'chat',{query:{company:co,action:'messages',roomId:'room-general'}})).status,402);
  eq((await checkout()).status,409);
  h.run("UPDATE company_billing SET billing_mode='live',status='trialing' WHERE company_id=?",co);
  shell=await(await h.request(owner,'chat',{query:{company:co}})).json();eq(shell.billingRequired,undefined);eq((await(await hubPolicy()).json()).allowed,['hub','combined','hub_parts','complete'].includes(plan));
  h.run("UPDATE company_billing SET status='past_due',payment_failed_at=? WHERE company_id=?",Date.now()-6*86400000,co);
  shell=await(await h.request(owner,'chat',{query:{company:co}})).json();eq(shell.billingRequired,undefined);
  h.run('UPDATE company_billing SET payment_failed_at=? WHERE company_id=?',Date.now()-8*86400000,co);
  shell=await(await h.request(owner,'chat',{query:{company:co}})).json();eq(shell.billingRequired,true);
  eq((await h.request(owner,'checkout',{query:{company:co}})).status,200);
  h.run("UPDATE company_billing SET status='active',payment_failed_at=NULL WHERE company_id=?",co);
  shell=await(await h.request(owner,'chat',{query:{company:co}})).json();eq(shell.billingRequired,undefined);
  h.run("UPDATE company_billing SET status='canceled' WHERE company_id=?",co);
  shell=await(await h.request(owner,'chat',{query:{company:co}})).json();eq(shell.billingRequired,true);
  eq(h.count(co+'_people'),1);
 }
 console.log(JSON.stringify({passed:true,plan,mode,intervals:['month','year'],checks,scope:'Actual auth/database routes: sandbox checkout, idempotent reuse, signed webhooks, replay/stale-event protection, company mapping, quantity validation and canceled subscription restart',realNetwork:false}));
}finally{globalThis.fetch=originalFetch;h.close();}


