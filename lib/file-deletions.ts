import { db,bucket } from './chat-db';
import { fail } from './app-errors';
import type { Person } from './chat-types';

export function queueDeletion(objectKey:string,userId:string,messageId:string|null){return db().prepare('INSERT OR IGNORE INTO file_deletions (object_key,message_id,requested_by,requested_at) VALUES (?,?,?,?)').bind(objectKey,messageId,userId,Date.now());}
export async function pendingDeletionCount(person:Person,messageId?:string){
  const where=(person.role==='owner'?'1 = 1':'requested_by = ?')+(messageId?' AND message_id = ?':'');
  const row=await db().prepare('SELECT COUNT(*) AS count FROM file_deletions WHERE '+where).bind(...(person.role==='owner'?[]:[person.id]),...(messageId?[messageId]:[])).first<{count:number}>();return row?.count||0;
}
export async function retryFileDeletions(person:Person,messageId?:string){
  const where=(person.role==='owner'?'1 = 1':'requested_by = ?')+(messageId?' AND message_id = ?':'');
  // Bounded retries leave room for auth and uncertain-send reconciliation under the free query limit.
  const jobs=await db().prepare('SELECT object_key FROM file_deletions WHERE '+where+' AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.object_key = file_deletions.object_key) ORDER BY requested_at LIMIT 8').bind(...(person.role==='owner'?[]:[person.id]),...(messageId?[messageId]:[])).all<{object_key:string}>();
  await Promise.allSettled(jobs.results.map(async job=>{
    try{await bucket().delete(job.object_key);await db().prepare('DELETE FROM file_deletions WHERE object_key = ?').bind(job.object_key).run();}
    catch{await db().prepare('UPDATE file_deletions SET attempts = attempts + 1 WHERE object_key = ?').bind(job.object_key).run();}
  }));
  return pendingDeletionCount(person,messageId);
}
export async function deleteMessage(id:string,person:Person){
  const now=Date.now();
  // Tombstone, metadata removal, and durable cleanup jobs commit together. Private photo-byte deletion follows that commit.
  const result=await db().batch([
    db().prepare('INSERT OR IGNORE INTO file_deletions (object_key,message_id,requested_by,requested_at) SELECT a.object_key,m.id,?,? FROM attachments a JOIN messages m ON m.id = a.message_id JOIN room_members rm ON rm.room_id = m.room_id WHERE m.id = ? AND m.user_id = ? AND rm.user_id = ?').bind(person.id,now,id,person.id,person.id),
    db().prepare('UPDATE messages SET deleted = 1,body = ?,pinned = 0 WHERE id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM room_members WHERE room_id = messages.room_id AND user_id = ?)').bind('',id,person.id,person.id),
    db().prepare('DELETE FROM attachments WHERE message_id = ? AND EXISTS (SELECT 1 FROM messages WHERE id = attachments.message_id AND deleted = 1 AND user_id = ?)').bind(id,person.id),
    db().prepare('DELETE FROM reactions WHERE message_id = ? AND EXISTS (SELECT 1 FROM messages WHERE id = reactions.message_id AND deleted = 1 AND user_id = ?)').bind(id,person.id),
  ]);
  if(!result[1].meta.changes)fail(404,'This message is no longer available to remove.');
  return {ok:true,id,photosPending:await retryFileDeletions(person,id)};
}
