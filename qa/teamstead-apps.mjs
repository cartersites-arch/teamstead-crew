import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/teamstead-apps.js',import.meta.url),'utf8');

class Element{
  constructor(tagName){this.tagName=tagName.toUpperCase();this.children=[];this.attributes={};this.dataset={};this.textContent='';this.id='';this.className='';}
  append(...children){this.children.push(...children);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  closest(){return null;}
}

function findById(node,id){
  if(node.id===id)return node;
  for(const child of node.children||[]){const match=findById(child,id);if(match)return match;}
  return null;
}

function descendants(node){return [node,...(node.children||[]).flatMap(descendants)];}

async function render({hostname='teamstead-crew.pages.dev',pathname='/',search='',products,hubCompany='main'}){
  const body=new Element('body'),signOut=new Element('button');signOut.textContent='Sign out';
  let fetchCalls=0;
  const document={
    body,
    readyState:'complete',
    createElement:tag=>new Element(tag),
    getElementById:id=>findById(body,id),
    querySelectorAll:selector=>selector==='button'?[signOut]:[],
    addEventListener(){},
  };
  const location={hostname,pathname,search,href:`https://${hostname}${pathname}${search}`};
  const context={
    URLSearchParams,
    document,
    location,
    sessionStorage:{getItem:key=>key==='hub-chat-return-company'?hubCompany:null},
    fetch:async()=>{fetchCalls++;return {ok:true,json:async()=>({products})};},
    MutationObserver:class{observe(){}},
    setTimeout,
  };
  vm.runInNewContext(source,context,{filename:'teamstead-apps.js'});
  await new Promise(resolve=>setTimeout(resolve,0));
  await new Promise(resolve=>setTimeout(resolve,0));
  const switcher=findById(body,'teamstead-app-switcher');
  const labels=switcher?descendants(switcher).filter(node=>node.tagName==='A'||node.tagName==='SPAN').map(node=>node.textContent):[];
  return {switcher,labels,fetchCalls};
}

const chatAndParts=await render({search:'?company=c_test',products:{chat:true,hub:false,parts:true}});
assert.deepEqual(chatAndParts.labels,['Chat','Parts Finder']);
assert.equal(chatAndParts.fetchCalls,1);

const chatOnly=await render({products:{chat:true,hub:false,parts:false}});
assert.equal(chatOnly.switcher,null);

const hubAndParts=await render({hostname:'pms-company-hub.pages.dev',search:'?teamsteadPlan=hub_parts'});
assert.deepEqual(hubAndParts.labels,['Maintenance Hub','Parts Finder']);
assert.equal(hubAndParts.fetchCalls,0);

const unknownHubPlan=await render({hostname:'pms-company-hub.pages.dev',search:'?teamsteadPlan=unknown'});
assert.equal(unknownHubPlan.switcher,null);
assert.equal(unknownHubPlan.fetchCalls,0);

console.log('Passed 8 entitlement-aware Teamstead Apps checks.');
