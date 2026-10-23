import type {ChatState} from '@/lib/chat-types';
import {companyUrl} from '@/lib/client-api';

export default function ProductOnlyHome({initial,onSignOut}:{initial:ChatState;onSignOut:()=>Promise<void>}){
  const parts=initial.products?.parts===true;
  return <main className="company-admin-page"><header className="company-admin-header"><strong>{initial.workspace.name}</strong><button onClick={()=>void onSignOut()}>Log out</button></header><section className="maintenance-panel"><h1>{parts?'Parts Finder':'Maintenance Hub'}</h1><p>{parts?'Search internet prices, check nearby stores and build a parts shopping list.':'Equipment, work orders, photos and manuals for your company.'}</p><a className="invite-button" href={parts?companyUrl('/parts/'):companyUrl('/maintenance/open?viewer='+encodeURIComponent(initial.me.id))}>{parts?'Open Parts Finder':'Open Maintenance Hub'}</a>{initial.me.role==='owner'&&<a className="invite-button" href={companyUrl('/company-admin')}>Company administration</a>}</section></main>;
}
