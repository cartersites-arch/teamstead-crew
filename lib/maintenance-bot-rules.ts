export type Job={id:string;number:string;description:string;status:string;due:string|null;version:number;mine:boolean;assigned:boolean};
export function scopedJobs(snapshot:any):Job[]{
  const actor=snapshot?.employee?.id;if(typeof actor!=='string'||!Array.isArray(snapshot.work_requests))throw new Error('Invalid Hub response');
  return snapshot.work_requests.filter((j:any)=>j&&!j.is_test&&typeof j.id==='string'&&(j.requester_id===actor||j.assigned_to===actor||j.assignments?.some((a:any)=>a.employee_id===actor&&a.status==='active'))).map((j:any)=>({id:j.id,number:String(j.work_order_number||j.id.slice(0,8)).slice(0,80),description:String(j.description||'Maintenance job').slice(0,300),status:String(j.status||'unknown').slice(0,60),due:typeof j.due_date==='string'?j.due_date.slice(0,10):null,version:Number(j.version)||0,mine:true,assigned:j.assigned_to===actor||!!j.assignments?.some((a:any)=>a.employee_id===actor&&a.status==='active')}));
}
export function openJob(j:Job){return !['completed','denied','cancelled','canceled','rejected','closed'].includes(j.status.toLowerCase());}
export function jobLine(j:Job){return `${j.number}: ${j.description}\nStatus: ${j.status}${j.due?' · Due '+j.due:''}`;}
export function changes(j:Job,old:Job|undefined,day:string,baseline:boolean){
  const events:{key:string;body:string}[]=[];
  if(!baseline&&j.assigned&&!old?.assigned&&openJob(j))events.push({key:`assigned:${j.id}:${j.version}`,body:'Assigned to you\n'+jobLine(j)});
  else if(!baseline&&(!old||old.version!==j.version||old.status!==j.status||old.due!==j.due))events.push({key:`update:${j.id}:${j.version}:${j.status}:${j.due}`,body:'Maintenance update\n'+jobLine(j)});
  if(j.assigned&&openJob(j)&&j.due&&/^\d{4}-\d{2}-\d{2}$/.test(j.due)&&j.due<day)events.push({key:`overdue:${j.id}:${j.due}:${day}`,body:'Overdue reminder\n'+jobLine(j)});
  return events;
}
