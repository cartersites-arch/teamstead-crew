import { env } from 'cloudflare:workers';
import { photoStore } from './photo-storage';
import { companyId } from './company-context';
import { companySql } from './company-sql';
export function rawDb():D1Database{if(!env.DB)throw Error('Database unavailable');return env.DB;}
export function db():D1Database{const database=rawDb(),id=companyId();if(id==='main')return database;return {prepare:(sql:string)=>database.prepare(companySql(sql,id)),batch:<T>(statements:D1PreparedStatement[])=>database.batch<T>(statements),exec:()=>{throw Error('Workspace SQL execution denied');},dump:()=>{throw Error('Workspace export denied');},withSession:()=>{throw Error('Workspace session unavailable');}} as unknown as D1Database;}
export function bucket(){return photoStore;}
