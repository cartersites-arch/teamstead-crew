export function quietNow(start:number,end:number,timezone:string,now=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const minute=Number(parts.find(p=>p.type==='hour')?.value)*60+Number(parts.find(p=>p.type==='minute')?.value);
 return start===end?true:start<end?minute>=start&&minute<end:minute>=start||minute<end;
}
export function mentions(body:string,name:string){
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return new RegExp('(^|[\\s(])@'+escaped+'(?=$|[\\s.,!?:;)])','iu').test(body);
}
