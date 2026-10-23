import {companySql} from './company-sql';
import {db,rawDb} from './chat-db';
import {companyId} from './company-context';
import {revokeCombinedMember} from './company-members';
import {securityGate} from './security-events';
import {required,fail} from './chat-server';
import type {SessionPerson} from './access';
export async function removeCompanyPerson(me:SessionPerson,data:Record<string,unknown>){
 const database=db(),id=required(data.userId),self=id===me.id;
 if(!['owner','admin'].includes(me.role))fail(403,'Only an owner or admin can remove people.');
 const target=await database.prepare('SELECT role FROM people WHERE id=? AND active=1').bind(id).first<{role:string}>();
 if(!target)fail(404,'This person is no longer in the company.');
 let successor:string|null=null;
 if(target.role==='owner'){
  successor=self?required(data.successorId):me.id;
  const eligible=await database.prepare("SELECT id FROM people WHERE id=? AND id<>? AND role='admin' AND active=1 AND passkey_enrolled=1 AND joined_at>0").bind(successor,id).first();
  if(!eligible)fail(400,'Choose an active admin who has finished signing in to become owner.');
 }else if(self)fail(400,'Ask another admin to remove your account.');
 if(me.role==='admin'&&target.role==='admin')fail(403,'Only the owner can remove another admin.');
 const combined=await rawDb().prepare('SELECT user_id FROM company_member_links WHERE company=? AND user_id=?').bind(companyId(),id).first();
 if(combined&&me.role!=='owner')fail(403,'Ask the owner to remove this person’s connected Maintenance Hub access.');
 if(combined)await revokeCombinedMember(id);
 const guard=successor?{sql:"EXISTS (SELECT 1 FROM people target JOIN workspace w ON w.owner_id=target.id JOIN people successor ON successor.id=? WHERE target.id=? AND target.active=1 AND target.role='owner' AND w.id='main' AND successor.id<>target.id AND successor.active=1 AND successor.role='admin' AND successor.passkey_enrolled=1 AND successor.joined_at>0)",values:[successor,id]}:{sql:'EXISTS (SELECT 1 FROM people target WHERE target.id=? AND target.active=1 AND target.role=?)',values:[id,target.role]};
 const gate=securityGate(me,self?'owner_left_company':'member_removal_requested',id,guard);
 const changes=await database.batch([gate.statement,
  ...(successor?[rawDb().prepare('UPDATE company_registry SET owner_id=? WHERE id=? AND owner_id=? AND '+companySql(gate.condition,companyId())).bind(successor,companyId(),id),database.prepare("UPDATE workspace SET owner_id=? WHERE id='main' AND "+gate.condition).bind(successor),database.prepare("UPDATE people SET role='owner' WHERE id=? AND "+gate.condition).bind(successor)]:[]),
  ...['room_members','maintenance_links','sessions','access_tokens','passkeys','passkey_challenges'].map(table=>database.prepare('DELETE FROM '+table+' WHERE user_id=? AND '+gate.condition).bind(id)),
  database.prepare("UPDATE people SET active=0,role='member',auth_version=auth_version+1 WHERE id=? AND "+gate.condition).bind(id)
 ]);
 if(!changes[0].meta.changes)fail(409,'Access changed. Refresh People and confirm your passkey before trying again.');
 return {ok:true,leftCompany:self,newOwnerId:successor};
}
