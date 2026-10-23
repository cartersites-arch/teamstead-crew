'use client';
import { startAuthentication,startRegistration,browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON,PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';

export class ApiError extends Error {constructor(message:string,public status:number){super(message);}}
// A browser document stays bound to one person. Changing accounts reloads it.
let viewerId:string|null=null;
let confirming:Promise<void>|null=null;
export function bindViewer(id:string|null){viewerId=id;}
async function rawRequest<T>(endpoint:string,init?:RequestInit):Promise<T>{
  const headers=new Headers(init?.headers);if(viewerId)headers.set('X-Project-User',viewerId);
  const res=await fetch(companyUrl(endpoint),{...init,headers,cache:'no-store',credentials:'same-origin'});
  const data=await res.json().catch(()=>({error:'Your connection was interrupted. Please try again.'}));
  if(!res.ok)throw new ApiError((data as {error?:string})?.error||'Please try again.',res.status);
  return data as T;
}
function json(data:Record<string,unknown>):RequestInit{return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)};}
export async function request<T=Record<string,unknown>>(endpoint:string,init?:RequestInit):Promise<T>{
  try{return await rawRequest<T>(endpoint,init);}catch(e){
    if(!(e instanceof ApiError)||e.status!==428)throw e;
    if(!confirming)confirming=signInWithPasskey(true).then(()=>{}).finally(()=>{confirming=null;});
    await confirming;return rawRequest<T>(endpoint,init);
  }
}
function supported(){if(!browserSupportsWebAuthn())throw new Error('Open this link in a current Safari, Chrome, Edge, or Firefox browser that supports passkeys.');}
export async function signInWithPasskey(reauth=false){
  supported();const purpose=reauth?'reauth':'login';
  const options=await rawRequest<{options:PublicKeyCredentialRequestOptionsJSON;challengeId:string}>('/api/passkeys',json({action:'auth_options',purpose}));
  let response;try{response=await startAuthentication({optionsJSON:options.options});}catch{throw new Error('Passkey sign-in was cancelled or unavailable. You can try again.');}
  return rawRequest<{ok:boolean;userId:string}>('/api/passkeys',json({action:'auth_verify',purpose,challengeId:options.challengeId,response}));
}
export async function addPasskey(name=''){
  supported();const options=await request<{options:PublicKeyCredentialCreationOptionsJSON;challengeId:string}>('/api/passkeys',json({action:'register_options'}));
  let response;try{response=await startRegistration({optionsJSON:options.options});}catch{throw new Error('Passkey creation was cancelled or unavailable. You can try again.');}
  return request<{ok:boolean;userId:string}>('/api/passkeys',json({action:'register_verify',challengeId:options.challengeId,response,name}));
}
export function api<T=Record<string,unknown>>(path:string,init?:RequestInit){return request<T>('/api/chat'+path,init);}
export function post<T=Record<string,unknown>>(data:Record<string,unknown>){return api<T>('',json(data));}
export function access<T=Record<string,unknown>>(data:Record<string,unknown>){return request<T>('/api/access',json(data));}
export function security<T=Record<string,unknown>>(data:Record<string,unknown>){return request<T>('/api/security',json(data));}
export function errorText(error:unknown){return error instanceof Error?error.message:'Please try again.';}

export function clientCompany(){return new URLSearchParams(window.location.search).get('company')||'main';}
export function companyUrl(value:string){const id=clientCompany();if(id==='main')return value;const u=new URL(value,window.location.origin);if(u.origin!==window.location.origin)return value;u.searchParams.set('company',id);return u.pathname+u.search+u.hash;}
