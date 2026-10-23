type Asset={id:string;name:string;number:string};
export function assetWords(text:string){
 const stop=new Set('the a an and or on in at is it its to of for with this that has have was are out not tried still but issue problem please'.split(' '));
 const words=[...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(w=>w.length>=2&&!stop.has(w)))];
 return {queries:words.slice(0,16),complete:words.length<=16};
}
export function matchAssets(text:string,assets:Asset[]){
 const normalize=(s:string)=>' '+(s.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).join(' ')+' ';
 const body=normalize(text);
 // Full names with word boundaries only. Partial names and fuzzy spelling require a person.
 return [...new Map(assets.filter(a=>a.name.trim().length>=2&&body.includes(normalize(a.name))).map(a=>[a.id,a])).values()];
}
export async function sourceOperationId(scope:string,label:string){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(scope+':'+label))).slice(0,16);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}
