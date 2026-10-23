import { companyId } from './company-context';
import { env } from 'cloudflare:workers';
import { r2Get,r2Put,r2Delete,R2_APP_LIMIT,companyObjectKey } from './r2-storage';
import { db } from './chat-db';
import { fail } from './app-errors';

export const MAX_PHOTO_BYTES = 512 * 1024;
export const PHOTO_BUDGET_BYTES = 64 * 1024 * 1024;

function bytesFromDb(value: unknown): Uint8Array<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new Error('Photo data is unavailable.');
}

// A deliberately small private store for the free pilot. The database checks
// its shared byte budget inside the same transaction as every insertion.
export const photoStore = {
  async put(key: string, bytes: Uint8Array, _options?: { httpMetadata?: { contentType?: string } }) {
    if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES) {
      fail(413, 'This file is too large for the free pilot. Photos can be resized; PDFs must fit 512 KB.');
    }
    if(env.CHAT_PHOTOS){await r2Put('chat',key,new Uint8Array(bytes),_options?.httpMetadata?.contentType||'application/octet-stream');return;}
    try {
      await db().prepare('INSERT INTO photo_objects (object_key,size,body,created_at) VALUES (?,?,?,?)')
        .bind(key, bytes.byteLength, new Uint8Array(bytes).buffer, Date.now()).run();
    } catch (error) {
      if (String(error).includes('PHOTO_BUDGET_FULL')) {
        fail(507, 'The shared 64 MB file space is full. Remove unneeded file messages and finish any pending photo deletions in Security. Text chat is still available.');
      }
      throw error;
    }
  },
  async get(key: string) {
    if(env.CHAT_PHOTOS){const alias=await db().prepare('SELECT object_key FROM r2_aliases WHERE legacy_key=?').bind(companyObjectKey(key)).first<{object_key:string}>();const object=await r2Get('chat',alias?.object_key||key);if(object)return {body:new Uint8Array(await object.arrayBuffer()),size:object.size};}
    const row = await db().prepare('SELECT size,body FROM photo_objects WHERE object_key = ?')
      .bind(key).first<{ size: number; body: unknown }>();
    if (!row) return null;
    const body = bytesFromDb(row.body);
    if (body.byteLength !== row.size || body.byteLength > MAX_PHOTO_BYTES) throw new Error('Photo data is incomplete.');
    return { body, size: row.size };
  },
  async delete(key: string) {
    const alias=await db().prepare('SELECT object_key FROM r2_aliases WHERE legacy_key=?').bind(companyObjectKey(key)).first<{object_key:string}>();
    const r2Key=alias?.object_key||key;
    const object=await db().prepare('SELECT size FROM r2_objects WHERE app=? AND object_key=?').bind('chat',companyObjectKey(r2Key)).first();
    if(object)await r2Delete('chat',r2Key);
    await db().prepare('DELETE FROM r2_aliases WHERE legacy_key=?').bind(companyObjectKey(key)).run();
    await db().prepare('DELETE FROM photo_objects WHERE object_key = ?').bind(key).run();
  },
};

export async function photoStorageUsage() {
  const row = await db().prepare('SELECT used_bytes,limit_bytes FROM photo_budget WHERE id = 1')
    .first<{ used_bytes: number; limit_bytes: number }>();
  if (!row) throw new Error('Photo storage is not configured.');
  const r2=env.CHAT_PHOTOS?await db().prepare("SELECT COALESCE(SUM(size),0) AS used FROM r2_objects WHERE app='chat' AND object_key LIKE ?").bind(companyId()==='main'?'%':'companies/'+companyId()+'/%').first<{used:number}>():null;
  return { usedBytes: row.used_bytes+(r2?.used||0), limitBytes: env.CHAT_PHOTOS?R2_APP_LIMIT:row.limit_bytes, maxPhotoBytes: MAX_PHOTO_BYTES };
}
