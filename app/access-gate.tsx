import { clientCompany } from '@/lib/client-api';
'use client';
import { useEffect,useRef,useState,type FormEvent,type ReactNode } from 'react';
import { ArrowRight,Fingerprint,Link2,Loader2,Lock,MessageSquare,RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { access,api,request,bindViewer,errorText,signInWithPasskey,addPasskey,ApiError } from '@/lib/client-api';
import type { ChatState } from '@/lib/chat-types';

type Status={level:'signed_out'|'setup'|'passkey';user?:{id:string;name:string}};
type Target={id:string;name:string;mode:'enroll'|'passkey'};
type Pending={token:string;target:Target;current:Status};
type Entry={status:Status;target?:Target;pending?:Pending;error?:string};
function personalToken(value:string){let url:URL;try{url=new URL(value.trim());}catch{throw new Error('Paste the complete Teamstead Crew setup link you were given.');}const token=new URLSearchParams(url.hash.slice(1)).get('access')||'';if(url.origin!==window.location.origin||(url.searchParams.get('company')||'main')!==clientCompany()||url.username||url.password||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Use your personal setup link for this Teamstead Crew.');return token;}
function reloadWorkspace(){window.location.replace(window.location.pathname+window.location.search);}
export default function AccessGate({children}:{children:(initial:ChatState,onSignOut:()=>Promise<void>,onSessionLost:()=>void)=>ReactNode}){
  const [ready,setReady]=useState<ChatState|null>(null),[status,setStatus]=useState<Status>({level:'signed_out'}),[working,setWorking]=useState(true),[error,setError]=useState(''),[link,setLink]=useState(''),[pending,setPending]=useState<Pending|null>(null),[target,setTarget]=useState<Target|null>(null);
  const started=useRef<Promise<Entry>|null>(null),capturedToken=useRef<string|null|undefined>(undefined);
  async function enter(expectedId?:string){const state=await api<ChatState>('?action=state');if(expectedId&&state.me.id!==expectedId){setStatus({level:'passkey',user:{id:state.me.id,name:state.me.name}});setPending(null);setTarget(null);capturedToken.current=null;setWorking(false);throw new Error('This browser is now signed in as '+state.me.name+'. Use the correct passkey if you want to switch accounts.');}bindViewer(state.me.id);capturedToken.current=null;setReady(state);setError('');setWorking(false);}
  async function loadEntry():Promise<Entry>{
    if(capturedToken.current===undefined){capturedToken.current=new URLSearchParams(window.location.hash.slice(1)).get('access');if(capturedToken.current!==null)window.history.replaceState(null,'',window.location.pathname+window.location.search);}
    const current=await request<Status>('/api/access'),token=capturedToken.current;
    if(token){try{
      const destination=await access<Target>({action:'inspect_link',token});
      if(current.user&&current.user.id!==destination.id)return {status:current,pending:{token,target:destination,current}};
      if(current.level==='signed_out'&&destination.mode==='enroll'){await access({action:'login',token});return {status:await request<Status>('/api/access'),target:destination};}
      return {status:current,target:destination};
    }catch(e){return {status:current,error:errorText(e)};}}
    return {status:current};
  }
  async function loadEntryWithRetry():Promise<Entry>{
    try{return await loadEntry();}catch(error){
      if(!(error instanceof ApiError)||error.status<500)throw error;
      return loadEntry();
    }
  }
  async function applyEntry(result:Entry){setStatus(result.status);setTarget(result.target||null);setPending(result.pending||null);setError(result.error||'');if(!result.pending&&!result.error&&result.status.level==='passkey')await enter(result.status.user?.id);else setWorking(false);}
  async function retry(){setWorking(true);setError('');try{await applyEntry(await loadEntry());}catch(e){setError(errorText(e));setWorking(false);}}
  useEffect(()=>{const arrived=()=>{if(new URLSearchParams(window.location.hash.slice(1)).has('access'))window.location.reload();};window.addEventListener('hashchange',arrived);return()=>window.removeEventListener('hashchange',arrived);},[]);
  useEffect(()=>{if(!started.current)started.current=loadEntryWithRetry();let alive=true;void started.current.then(result=>{if(alive)void applyEntry(result).catch(e=>{setError(errorText(e));setWorking(false);});}).catch(e=>{if(alive){setError(errorText(e));setWorking(false);}});return()=>{alive=false;};},[]);
  async function useToken(token:string,destination:Target){
    setWorking(true);setError('');try{
      if(destination.mode==='enroll'){await access({action:'login',token});capturedToken.current=null;reloadWorkspace();}
      else{await signInWithPasskey();capturedToken.current=null;reloadWorkspace();}
    }catch(e){try{const fresh=await request<Status>('/api/access');setStatus(fresh);if(fresh.user&&fresh.user.id!==status.user?.id){setPending(null);setTarget(null);capturedToken.current=null;}}catch{}setError(errorText(e));setWorking(false);}
  }
  async function submit(event:FormEvent){event.preventDefault();setWorking(true);setError('');try{const token=personalToken(link),destination=await access<Target>({action:'inspect_link',token});capturedToken.current=token;if(status.user&&status.user.id!==destination.id){setPending({token,target:destination,current:status});setWorking(false);return;}await useToken(token,destination);}catch(e){setError(errorText(e));setWorking(false);}}
  async function passkey(enroll=false){setWorking(true);setError('');try{if(enroll)await addPasskey();else await signInWithPasskey();reloadWorkspace();}catch(e){
    // A lost response can follow successful enrollment. Recover the live cookie if it arrived.
    try{const fresh=await request<Status>('/api/access');if(fresh.level==='passkey'){reloadWorkspace();return;}setStatus(fresh);}catch{}
    setError(errorText(e)+(enroll?' If your device saved the passkey, try Sign in with passkey.':''));setWorking(false);
  }}
  async function signOut(){await access({action:'logout'});if(ready)try{const prefix='project-room:draft:'+ready.me.id+':';for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith(prefix))sessionStorage.removeItem(key);}}catch{}setReady(null);setWorking(true);reloadWorkspace();}
  if(ready)return children(ready,signOut,()=>{setReady(null);setWorking(true);reloadWorkspace();});
  return <main className="startup"><div className="startup-card access-card"><span className="brand-mark"><MessageSquare size={25}/></span><span className="access-eyebrow">A space for your team</span><h1>{clientCompany()==='main'?'Teamstead Crew':clientCompany()==='demo'?'Demo Company':clientCompany()==='pilot'?'Pilot Company':'Your company workspace'}</h1>
    {clientCompany()==='pilot'&&!working&&!pending&&status.level==='signed_out'&&<div className="teamstead-workspace-choice"><p>This is the separate Pilot Company test workspace.</p><a href="/">Back to Teamstead Crew</a></div>}
    {working?<div className="access-loading" role="status"><Loader2 className="animate-spin" size={20}/><p>Opening your workspace…</p></div>:pending?<><p>This browser is signed in as <strong>{pending.current.user?.name}</strong>. The link belongs to <strong>{pending.target.name}</strong>.</p><p>Switch accounts on this device?</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="access-actions"><Button onClick={()=>void useToken(pending.token,pending.target)}><ArrowRight size={16}/>Continue with {pending.target.name}’s {pending.target.mode==='enroll'?'setup':'passkey'}</Button><Button variant="outline" onClick={()=>{capturedToken.current=null;setPending(null);setTarget(null);setError('');if(status.level==='passkey')void enter(pending.current.user?.id).catch(e=>setError(errorText(e)));}}>Stay as {pending.current.user?.name}</Button></div></>:status.level==='setup'?<><h2 className="access-subtitle">Welcome, {status.user?.name}</h2><p>Create a passkey to open your workspace. Your device may offer face unlock, a fingerprint, a device PIN, or a security key.</p><Button className="w-full" onClick={()=>void passkey(true)}><Fingerprint size={18}/>Create my passkey</Button>{error&&<p className="form-error" role="alert">{error}</p>}<Button className="mt-3 w-full" variant="outline" onClick={()=>void passkey()}>Sign in with an existing passkey</Button><p className="access-help">Setup expires after 15 minutes. If it expires before you finish, reopen your invitation.</p><div className="access-private"><Lock size={14}/><span>No extra password or ChatGPT account. Your invitation stops granting setup access once your passkey is created.</span></div></>:<><p>{target?.mode==='passkey'?target.name+'’s account is ready. Use the passkey saved on your device.':'Sign in with your passkey to open your team’s workspace.'}</p><Button className="w-full" onClick={()=>void passkey()}><Fingerprint size={18}/>Sign in with passkey</Button>{error&&<p className="form-error mt-3" role="alert">{error}</p>}{status.level==='passkey'&&<Button className="mt-3 w-full" variant="outline" onClick={()=>void enter(status.user?.id).catch(e=>setError(errorText(e)))}>Continue as {status.user?.name}</Button>}<div className="form-divider"/><form className="dialog-form access-form" onSubmit={submit}><div><label className="field-label" htmlFor="project-access-link">First visit or account recovery?</label><input id="project-access-link" type="password" className="form-input" value={link} onChange={e=>setLink(e.target.value)} placeholder="Paste your private setup link" autoComplete="off" spellCheck={false} required maxLength={4096}/></div><Button variant="outline" type="submit" disabled={!link.trim()}><Link2 size={16}/>Use setup link</Button></form><p className="access-help">Need an invitation or recovery? Contact your workspace owner. If a passkey was just saved, try signing in above.</p>{error&&!link&&<button className="access-retry" onClick={()=>void retry()}><RefreshCw size={13}/>Check connection again</button>}<div className="access-private"><Lock size={14}/><span>Keep unused invitations private. Each link can set up only its assigned account.</span></div></>}
  </div><p className="access-caption">Conversations, projects, and maintenance. Together.</p></main>;
}
