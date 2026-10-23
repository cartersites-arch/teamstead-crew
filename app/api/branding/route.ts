import {db} from '@/lib/chat-db';
import {currentPerson,requireRecent} from '@/lib/access';
import {companyPath} from '@/lib/company-context';
import {checkOrigin,fail,handleError,response} from '@/lib/chat-server';

export const dynamic='force-dynamic';
const MAX_LOGO_BYTES=512*1024;
const LOGO_TYPES=new Set(['image/jpeg','image/png','image/webp']);

function decodeLogo(value:unknown){
  if(typeof value!=='string'||value.length>750000)fail(413,'Choose a company logo smaller than 512 KB.');
  const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match||!LOGO_TYPES.has(match[1]))fail(415,'Choose a JPG, PNG, or WebP company logo.');
  let binary='';try{binary=atob(match[2]);}catch{fail(415,'This company logo could not be read. Choose another image.');}
  if(!binary.length||binary.length>MAX_LOGO_BYTES)fail(413,'Choose a company logo smaller than 512 KB.');
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const jpeg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const png=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n);
  const webp=bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if((match[1]==='image/jpeg'&&!jpeg)||(match[1]==='image/png'&&!png)||(match[1]==='image/webp'&&!webp))fail(415,'This company logo does not match its image type. Choose another image.');
  return {data:value,mime:match[1],bytes};
}

export async function GET(request:Request){
  try{
    const me=await currentPerson();
    const workspace=await db().prepare("SELECT name,owner_id,logo_data FROM workspace WHERE id='main'").first<{name:string;owner_id:string;logo_data:string|null}>();
    if(!workspace)fail(404,'Company branding is unavailable.');
    if(new URL(request.url).searchParams.get('image')==='1'){
      if(!workspace.logo_data)fail(404,'This company has not added a logo.');
      const logo=decodeLogo(workspace.logo_data);
      return new Response(logo.bytes,{headers:{'Content-Type':logo.mime,'Content-Length':String(logo.bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    return response({companyName:workspace.name,viewerName:me.name,hasLogo:!!workspace.logo_data,logoUrl:workspace.logo_data?companyPath('/api/branding?image=1'):null});
  }catch(error){return handleError(error);}
}

export async function POST(request:Request){
  try{
    checkOrigin(request);
    if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'Use a supported company-logo format.');
    const me=await requireRecent();
    const workspace=await db().prepare("SELECT owner_id FROM workspace WHERE id='main'").first<{owner_id:string}>();
    if(me.role!=='owner'||workspace?.owner_id!==me.id)fail(403,'Only the company owner can change its logo.');
    const data=await request.json() as Record<string,unknown>;
    if(data.action==='remove'){
      await db().prepare("UPDATE workspace SET logo_data=NULL WHERE id='main' AND owner_id=?").bind(me.id).run();
      return response({ok:true,hasLogo:false});
    }
    if(data.action!=='set')fail(400,'Choose a company-logo action.');
    const logo=decodeLogo(data.logoData);
    await db().prepare("UPDATE workspace SET logo_data=? WHERE id='main' AND owner_id=?").bind(logo.data,me.id).run();
    return response({ok:true,hasLogo:true,logoUrl:companyPath('/api/branding?image=1')});
  }catch(error){return handleError(error);}
}
