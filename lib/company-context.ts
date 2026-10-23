import {request} from './request-context';import {fail} from './app-errors';
export function validCompany(id:unknown):id is string{return typeof id==='string'&&(/^(main|demo|pilot)$/.test(id)||/^c_[a-f0-9]{16}$/.test(id));}
export function companyId(){const r=request();if(!r)return 'main';const u=new URL(r.url),q=u.searchParams.get('company'),h=r.headers.get('X-Company');if(q&&h&&q!==h)fail(400,'Company selection changed. Reopen your workspace.');const id=h||q||'main';if(!validCompany(id))fail(404,'Company workspace not found.');return id;}
export function companyPath(value:string){const id=companyId();if(id==='main')return value;const u=new URL(value,'https://teamstead-crew.pages.dev');u.searchParams.set('company',id);return u.pathname+u.search+u.hash;}
