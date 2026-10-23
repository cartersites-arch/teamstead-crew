import {validCompany} from './company-context';
export const companyTables = new Set(['attachments','invitations','messages','people','reactions','room_members','rooms','workspace','maintenance_links','file_deletions','passkey_challenges','passkeys','security_events','access_tokens','sessions','photo_budget','photo_objects','bot_preferences','bot_events','push_devices','chat_notification_preferences','chat_push_receipts','employee_status','conversation_preferences','saved_messages','crew_profiles']);
// Only SQL identifiers are rewritten. String values, comments and bound values stay intact.
export function companySql(sql:string,company:string){
 if(company==='main')return sql;
 if(!validCompany(company))throw Error('Unknown company');
 return sql.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\/|`[^`]*`|"[^"]*"|[A-Za-z_][A-Za-z_0-9]*/g,token=>{
  if(token.startsWith("'")||token.startsWith('--')||token.startsWith('/*'))return token;
  const quoted=token[0]==='`'||token[0]==='"',name=quoted?token.slice(1,-1):token;
  if(!companyTables.has(name))return token;
  return quoted?token[0]+company+'_'+name+token[0]:company+'_'+name;
 });
}
