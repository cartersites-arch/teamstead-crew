import {companyProducts} from '@/lib/company-products';
import { companyPath } from '@/lib/company-context';
import { companyId } from '@/lib/company-context';
import { member,handleError,ChatError,fail } from '@/lib/chat-server';
import { connectionUrl } from '@/lib/maintenance-links';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const me=await member(),params=new URL(request.url).searchParams,expected=params.get('viewer');if(expected&&expected!==me.id)fail(401,'Your account changed on this device. Open Maintenance again.');const url=await connectionUrl(me.id);let destination=url||companyPath('/?section=maintenance');if(url){const hub=new URL(url),fragment=new URLSearchParams(hub.hash.slice(1));if(params.get('form')==='problem')hub.pathname='/request';if((await companyProducts()).chat){fragment.set('entry','project-room');fragment.set('chatCompany',companyId());}else{fragment.delete('entry');fragment.delete('chatCompany');}hub.hash=fragment.toString();destination=hub.toString();}return new Response(null,{status:303,headers:{Location:destination,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});}catch(e){if(e instanceof ChatError&&e.status===401)return new Response(null,{status:303,headers:{Location:companyPath('/?section=maintenance'),'Cache-Control':'no-store'}});return handleError(e);}}

