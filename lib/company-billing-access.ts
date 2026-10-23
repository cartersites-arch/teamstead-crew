import {env} from 'cloudflare:workers';
import {rawDb} from './chat-db';
import {billingAccess} from './billing-policy';
export async function companyBillingAccess(company:string) {
  if(!/^c_[a-f0-9]{16}$/.test(company))return {allowed:true,required:false};
  const registry=await rawDb().prepare('SELECT status,billing_required FROM company_registry WHERE id=?').bind(company).first<{status:string;billing_required:number}>();
  if(!registry||['suspended','archived','deleting'].includes(registry.status))return {allowed:false,required:true};
  if(!registry.billing_required)return {allowed:true,required:false};
  // A live company never inherits access from a sandbox subscription.
  const billing=await rawDb().prepare("SELECT status,payment_failed_at FROM company_billing WHERE company_id=? AND billing_mode='live'").bind(company).first<{status:string;payment_failed_at:number|null}>();
  return {required:true,...(billing?billingAccess(billing.status,billing.payment_failed_at):{allowed:false,graceEndsAt:null})};
}
