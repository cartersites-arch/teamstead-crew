export const PRODUCT_PLANS = ['chat','hub','parts','combined','chat_parts','hub_parts','complete'] as const;
export type ProductPlan = typeof PRODUCT_PLANS[number];
export function validPlan(value:unknown):value is ProductPlan {return typeof value==='string' && PRODUCT_PLANS.includes(value as ProductPlan);}
export function planProducts(plan:ProductPlan){return {
  chat:plan==='chat'||plan==='combined'||plan==='chat_parts'||plan==='complete',
  hub:plan==='hub'||plan==='combined'||plan==='hub_parts'||plan==='complete',
  parts:plan==='parts'||plan==='chat_parts'||plan==='hub_parts'||plan==='complete',
};}

export function planLabel(plan:ProductPlan){return {
  chat:'Chat Only',
  hub:'Maintenance Hub Only',
  parts:'Parts Finder Only',
  combined:'Chat + Maintenance Hub',
  chat_parts:'Chat + Parts Finder',
  hub_parts:'Maintenance Hub + Parts Finder',
  complete:'Chat + Maintenance Hub + Parts Finder',
}[plan];}

const PLAN_PRICES:Record<ProductPlan,readonly [number,number]>={
  chat:[15,150],
  hub:[29,290],
  parts:[19,190],
  combined:[39,390],
  chat_parts:[29,390],
  hub_parts:[39,590],
  complete:[49,790],
};
export function planPrice(plan:ProductPlan){return PLAN_PRICES[plan];}
