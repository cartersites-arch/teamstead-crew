import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
for(const mode of ['network-down','storage-denied','invalid-html','ready']){
 const handlers={};let claimed=0,skipped=0,writes=[];
 const context={URL,Response,AbortSignal,self:{location:{origin:'https://teamstead-crew.pages.dev'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{skipped++;},clients:{claim:async()=>{claimed++;}}},
  caches:{keys:async()=>{if(mode==='storage-denied')throw Error('Storage denied');return [];},open:async()=>({put:async(url,response)=>writes.push({url,html:await response.text()})})},
  fetch:async()=>{if(mode==='network-down')throw Error('Network down');return new Response(mode==='invalid-html'?'private app html':'<meta name="project-room-offline" content="generic-only">');}};
 vm.runInNewContext(source,context);
 let pending;handlers.install({waitUntil:p=>pending=p});await pending;
 assert.equal(skipped,1);assert.equal(writes.length,0);
 handlers.activate({waitUntil:p=>pending=p});await pending;
 assert.equal(claimed,1);assert.equal(writes.length,mode==='ready'?1:0);
 if(writes.length)assert.equal(writes[0].url,'/offline.html');
}
console.log(JSON.stringify({passed:true,cases:4,checks:['startup with no network','startup with browser storage denied','private HTML never cached','only generic offline page cached']}));
