/** Best-effort filtering for the explicit AI copy flow. It is not a general secret detector. */
export function sanitizeForAi(input:string):{text:string;redactions:number}{
  let redactions=0;
  const privateParameter=/[?#&](?:access|hub|invite|invitation|recovery|setup|token|access_token|refresh_token|api_key|apikey|secret|password|code)[ \t]*=/i;
  let text=input.replace(/\S+/g,word=>{
    let decoded=word;
    // Decode valid escapes even when the pasted word contains an unrelated malformed percent sign.
    for(let i=0;i<4;i++){const next=decoded.replace(/(?:%[0-9a-f]{2})+/gi,chunk=>{try{return decodeURIComponent(chunk);}catch{return chunk.replace(/%([0-9a-f]{2})/gi,(_m,hex:string)=>String.fromCharCode(parseInt(hex,16)));}});if(next===decoded)break;decoded=next;}
    if(privateParameter.test(decoded)||/https?:\/\/[^/@\s]+:[^/@\s]+@/i.test(decoded)){redactions++;return '[private access link removed]';}
    return word;
  });
  text=text.replace(/\bBearer[ \t]+[A-Za-z0-9._~+/=-]{8,}/gi,()=>{redactions++;return 'Bearer [credential removed]';});
  text=text.replace(/(["']?)\b((?:[A-Z][A-Z0-9_]*_)?(?:api[ _-]?key|password|secret|(?:access|refresh)[ _-]?token))\1[ \t]*[:=][ \t]*(?:"[^"\n]+"|'[^'\n]+'|[^\s<>]+)/gi,(_all,quote:string,label:string)=>{redactions++;return quote+label+quote+': '+(quote?'"[credential removed]"':'[credential removed]');});
  text=text.replace(/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}\b/g,()=>{redactions++;return '[API credential removed]';});
  return {text,redactions};
}
