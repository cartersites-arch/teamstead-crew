export const BILLING_POLICY = { trialDays: 14, graceDays: 7, retention: 'until_owner_requests_deletion' } as const;
export function billingAccess(status:string,failedAt:number|null,now=Date.now()) {
  if(status==='active'||status==='trialing')return {allowed:true,graceEndsAt:null};
  const graceEndsAt=failedAt?failedAt+BILLING_POLICY.graceDays*86400000:null;
  return {allowed:status==='past_due'&&graceEndsAt!==null&&now<graceEndsAt,graceEndsAt};
}
