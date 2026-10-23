import { member,response,handleError,checkOrigin,fail } from '@/lib/chat-server';
import { connectionStatus,saveConnection,disconnect } from '@/lib/maintenance-links';
import { requireRecent } from '@/lib/access';
export const dynamic='force-dynamic';
export async function GET(){try{const me=await member();return response(await connectionStatus(me.id));}catch(e){return handleError(e);}}
export async function POST(request:Request){try{checkOrigin(request);const me=await requireRecent();if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'Use a supported connection format.');const raw=await request.text();if(raw.length>8192)fail(413,'That link is too long.');let data:{action?:unknown;link?:unknown};try{data=JSON.parse(raw);}catch{fail(400,'Please try connecting again.');}if(!data||typeof data!=='object')fail(400,'Please try connecting again.');if(data.action==='connect')return response(await saveConnection(me.id,data.link,me));if(data.action==='disconnect'){await disconnect(me.id,me);return response({connected:false});}fail(400,'Unknown connection change.');}catch(e){return handleError(e);}}
