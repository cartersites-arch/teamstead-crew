'use client';
import {useState} from 'react';
import {ExternalLink,Search,LayoutGrid} from 'lucide-react';
import {Button} from '@/components/ui/button';
type App={name:string;category:string;url:string;account:string;use:string;limits:string;help:string};
const google='Your own Google account',microsoft='Your own Microsoft account';
const gHelp='https://www.google.com/drive/',mHelp='https://support.microsoft.com/en-au/microsoft-365-activation-licensing/manage-microsoft-365/what-s-the-difference-between-a-paid-microsoft-365-subscription-and-the-free-web-apps';
const apps:App[]=[
 ...[
 ['Google Drive','Files & documents','https://drive.google.com/','Store and share documents and files.'],
 ['Google Docs','Files & documents','https://docs.google.com/','Write procedures, handovers, and shared documents.'],
 ['Google Sheets','Files & documents','https://sheets.google.com/','Make spreadsheets, stock lists, and schedules.'],
 ['Google Slides','Files & documents','https://slides.google.com/','Create presentations and training slides.'],
 ['Google Forms','Forms & design','https://forms.google.com/','Create surveys, polls, checklists, and reports.'],
 ['Google Calendar','Calendar & calls','https://calendar.google.com/','Plan meetings and share calendars.'],
 ['Google Meet','Calendar & calls','https://meet.google.com/','Start video calls and share a meeting link.'],
 ['Google Keep','Notes & tasks','https://keep.google.com/','Save notes, shift handovers, and checklists.'],
 ['Gmail','Email','https://mail.google.com/','Open your own email.']
 ].map(([name,category,url,use])=>({name,category,url,use,account:google,limits:'Use the free personal account. Google storage is shared across its services; extra storage and paid Workspace features are optional.',help:gHelp})),
 ...[
 ['OneDrive','Files & documents','https://onedrive.live.com/','Store and share files.'],
 ['Word for the web','Files & documents','https://www.microsoft365.com/launch/word','Write documents and procedures in your browser.'],
 ['Excel for the web','Files & documents','https://www.microsoft365.com/launch/excel','Work with spreadsheets and lists in your browser.'],
 ['PowerPoint for the web','Files & documents','https://www.microsoft365.com/launch/powerpoint','Build presentations in your browser.'],
 ['OneNote','Notes & tasks','https://www.onenote.com/','Organize notebooks, notes, and handovers.'],
 ['Microsoft To Do','Notes & tasks','https://to-do.office.com/tasks/','Create tasks, reminders, and shared checklists.'],
 ['Outlook','Email','https://outlook.live.com/','Open your email and calendar.']
 ].map(([name,category,url,use])=>({name,category,url,use,account:microsoft,limits:'Use the free web apps. Microsoft accounts include 5 GB cloud storage shared with OneDrive and Outlook attachments. Desktop Office and premium features may require payment.',help:mHelp})),
 {name:'Trello',category:'Notes & tasks',url:'https://trello.com/',account:'Your own Atlassian / Trello account',use:'Organize task boards, assignments, and checklists.',limits:'Free: up to 10 collaborators and 10 boards per workspace. Some Power-Ups cost extra; choose free features.',help:'https://trello.com/pricing'},
 {name:'Notion',category:'Notes & tasks',url:'https://www.notion.com/',account:'Your own Notion account',use:'Create notes, a knowledge base, and personal task lists.',limits:'Free personal pages; team workspaces have content limits. Uploads are limited to 5 MB each. AI and larger team plans may cost extra.',help:'https://www.notion.com/pricing'},
 {name:'Canva',category:'Forms & design',url:'https://www.canva.com/',account:'Your own Canva account',use:'Design notices, safety posters, and presentations.',limits:'Choose Canva Free and free templates/assets. Pro content, printing, and upgrades can cost money.',help:'https://www.canva.com/pricing/'},
 {name:'Zoom',category:'Calendar & calls',url:'https://zoom.us/signin',account:'Your own Zoom account to host meetings',use:'Host video meetings and share your meeting link.',limits:'Zoom Basic: up to 100 participants and 40 minutes per meeting. Choose Basic instead of a paid trial.',help:'https://www.zoom.com/en/products/virtual-meetings/'},
 {name:'Dropbox',category:'Files & documents',url:'https://www.dropbox.com/basic',account:'Your own Dropbox account',use:'Store and share files and folders.',limits:'Dropbox Basic starts with 2 GB. Choose the Basic plan; additional storage and business plans cost extra.',help:'https://help.dropbox.com/plans/dropbox-basic-faq'}
];
export default function FreeAppsPanel(){
 const [search,setSearch]=useState(''),[category,setCategory]=useState('All apps');
 const shown=apps.filter(a=>(category==='All apps'||a.category===category)&&[a.name,a.use,a.account].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
 return <section className="maintenance-panel"><div className="maintenance-heading"><div className="maintenance-mark"><LayoutGrid size={25}/></div><div><span className="maintenance-eyebrow">Tools for your workday</span><h1>Free apps</h1></div></div><p className="maintenance-lead">Open useful apps from Teamstead Crew. Each employee uses their own account for each service.</p>
 <section className="security-card"><h2>Start with your own account</h2><ol><li>Choose an app and press Open app.</li><li>Sign in with your own account, or create one on that service’s website.</li><li>Choose its free plan. Skip paid trials, subscriptions, upgrades, and payment details.</li><li>Ask the document or workspace owner to share access with your own account when needed.</li></ol><p>Teamstead Crew sign-in stays separate. These buttons open external websites; their files and accounts stay with that service. Sharing happens only when you choose it there. Your Teamstead Crew chats, photos, and personal Hub link are not automatically sent to these apps.</p><p>Free plans have limits and can change. Each card links to the provider’s current information. Use company-approved accounts for company documents.</p></section>
 <div className="maintenance-connection-actions" style={{margin:'24px 0',gap:12}}><label style={{flex:1,minWidth:180}}><span className="field-label"><Search size={15}/> Search apps</span><input className="form-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search documents, tasks, calls…"/></label><label><span className="field-label">Category</span><select className="form-input" value={category} onChange={e=>setCategory(e.target.value)}>{['All apps','Files & documents','Notes & tasks','Calendar & calls','Forms & design','Email'].map(c=><option key={c}>{c}</option>)}</select></label></div>
 <p>{shown.length} of {apps.length} apps</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,280px),1fr))',gap:20}}>{shown.map(app=><article className="security-card" key={app.name}><span className="maintenance-eyebrow">{app.category}</span><h2>{app.name}</h2><p>{app.use}</p><p><strong>Account needed:</strong> {app.account}.</p><Button asChild><a href={app.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>Open app</a></Button><details style={{marginTop:16}}><summary>Setup & free-plan limits</summary><p>Open {app.name}, sign in using your own account, and choose its free option. To work together, the owner shares the file, list, meeting, or workspace with your account.</p><p>{app.limits}</p><a href={app.help} target="_blank" rel="noopener noreferrer">Provider’s plan information</a></details></article>)}</div>{!shown.length&&<p>No apps match your search. Try another name or category.</p>}
 </section>;
}
