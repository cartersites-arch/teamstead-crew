'use client';
import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {post,errorText} from '@/lib/client-api';
import type {Person} from '@/lib/chat-types';
export const statusLabel=(status:Person['status'])=>status?status[0].toUpperCase()+status.slice(1):'No status set';
export default function StatusControl({person,onChanged}:{person:Person;onChanged:()=>Promise<unknown>}){
 const [open,setOpen]=useState(false);
 const [hours,setHours]=useState(4),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function change(status:string){setBusy(true);setError('');try{await post({action:'set_status',status,hours});await onChanged();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <section className="crew-status"><button type="button" className="status-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}>Your status: {statusLabel(person.status)} <span aria-hidden="true">{open?'▴':'▾'}</span></button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Your status</DialogTitle><DialogDescription>Choose what your crew sees beside your name.</DialogDescription></DialogHeader><div className="status-settings"><div className="crew-status-actions">{(['available','working','away','driving'] as const).map(status=><button key={status} className={'status-choice status-'+status} aria-pressed={person.status===status} disabled={busy} onClick={()=>void change(status)}><span aria-hidden="true">●</span>{statusLabel(status)}</button>)}<label>Clear after <select aria-label="Status duration" value={hours} disabled={busy} onChange={e=>setHours(Number(e.target.value))}><option value={1}>1 hour</option><option value={4}>4 hours</option><option value={8}>8 hours</option></select></label>{person.status&&<button disabled={busy} onClick={()=>void change('clear')}>Clear now</button>}</div><p>Chosen by you and visible to your crew. Driving pauses chat alerts while active; maintenance alerts follow their own settings.</p>{person.status_expires_at? <p>Clears at {new Date(person.status_expires_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}.</p>:null}{error&&<p className="form-error" role="alert">{error}</p>}</div></DialogContent></Dialog></section>;
}
