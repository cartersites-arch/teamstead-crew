import assert from 'node:assert/strict';

// Called by the integration suite after three real passkey identities exist.
export async function workerCases({h,test,eq,ok,same,json,owner,derek,third,dmId,chat,security,post,sendPhoto,reached}) {
  await test('Worker API navigation, methods and unknown routes stay outside public SPA fallback', async () => {
    const visitor=h.browser(), start=h.metrics.assetsCalls;
    for(const route of ['chat','photo','security','maintenance']) {
      const response=await h.request(visitor,route,{query:route==='photo'?{id:'missing'}:{},headers:{'Sec-Fetch-Mode':'navigate','Accept':'text/html'}});
      await json(response,401); eq(response.headers.get('X-Frame-Options'),'DENY'); eq(response.headers.get('Referrer-Policy'),'no-referrer'); ok(response.headers.get('Cache-Control').includes('no-store'));
    }
    for(const pathname of ['/api','/api/unknown','/api/chat/','/api/photos','/api/photos/a/extra','/maintenance/open/extra']) await json(await h.request(visitor,'chat',{pathname,headers:{'Sec-Fetch-Mode':'navigate'}}),404);
    for(const method of ['PUT','DELETE','PATCH','HEAD','OPTIONS']) {
      const response=await h.request(visitor,'chat',{method}); eq(response.status,405); ok(response.headers.get('Allow').includes('GET')); ok(response.headers.get('Allow').includes('POST'));
    }
    const wrongPhoto=await h.request(visitor,'photo',{method:'POST',query:{id:'missing'}}); await json(wrongPhoto,405); eq(wrongPhoto.headers.get('Allow'),'GET');
    eq(h.metrics.assetsCalls,start);
    for(const pathname of ['/','/assets/test.js','/help']) {
      const response=await h.request(visitor,'chat',{pathname}); eq(response.status,200); ok((await response.text()).includes('Public app fixture'));
    }
    eq(h.metrics.assetsCalls,start+3);
    const syntaxError=await h.request(visitor,'photo',{pathname:'/api/photos/%ZZ'}); eq(syntaxError.status,500); const errorText=await syntaxError.text(); ok(!errorText.includes('URIError')); ok(!errorText.includes('sqlite'));
  });

  await test('Actual AsyncLocalStorage isolates interleaved cookie identities and scoped photos', async()=>{
    await assert.rejects(h.routes.requestContext.headers(),/request context/); ok(true);
    const gate=h.pause({pattern:/FROM sessions s JOIN people p/,kind:'first',phase:'after'});
    const pending=chat(owner); let second;
    try {await reached(gate); second=await json(await chat(derek)); eq(second.me.id,derek.id);}
    finally {gate.release();}
    const first=await json(await pending); eq(first.me.id,owner.id);
    const photo=await sendPhoto(owner,dmId,'Concurrent private photo');
    const jobs=[];
    for(let i=0;i<12;i++)for(const browser of [owner,derek,third])jobs.push((async()=>{
      const state=await json(await chat(browser)); eq(state.me.id,browser.id);
      const response=await h.request(browser,'photo',{query:{id:photo.attachment.id}}); eq(response.status,browser===third?404:200); await response.arrayBuffer();
    })());
    await Promise.all(jobs);
    await json(await chat(owner,{action:'delete',id:photo.id}));
    await assert.rejects(h.routes.requestContext.headers(),/request context/); ok(true);
  });

  await test('Worker bounds announced and streamed request bodies before parsing; Origin remains mandatory',async()=>{
    let pulls=0,cancelled=false;
    const stream=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(256*1024));},cancel(){cancelled=true;}});
    await json(await post(owner,'chat',stream,{headers:{'Content-Type':'application/json','Content-Length':'1'}}),413);
    ok(cancelled); ok(pulls<=11,'Stream must stop at cap plus one prefetch');
    await json(await post(owner,'chat','{}',{headers:{'Content-Type':'application/json','Content-Length':String(2*1024*1024+1)}}),413);
    await json(await post(owner,'chat','x'.repeat(2*1024*1024+1),{headers:{'Content-Type':'text/plain'}}),413);
    await json(await post(owner,'chat','x'.repeat(2*1024*1024),{headers:{'Content-Type':'text/plain'}}),415);
    await json(await post(owner,'chat',' '.repeat(32001),{headers:{'Content-Type':'application/json'}}),413);
    await json(await post(owner,'chat','{bad json',{headers:{'Content-Type':'application/json'}}),400);
    for(const headers of [{'Origin':'https://evil.test'},{'Origin':null,'Referer':null},{'Sec-Fetch-Site':'cross-site'}])await json(await chat(owner,{action:'profile',name:'No change'}, {headers}),403);
  });

  await test('D1 store enforces 512 KiB objects and an atomic 64 MiB budget with exact rollback accounting',async()=>{
    const limit=64*1024*1024,size=512*1024,keys=[];
    eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,0); eq(h.row('SELECT limit_bytes FROM photo_budget WHERE id=1').limit_bytes,limit);
    const data=new Uint8Array(size); data.set([137,80,78,71,13,10,26,10]);
    const reject=async(fn,needle)=>{await assert.rejects(fn,needle);ok(true);};
    await reject(()=>h.photoStore.put('invalid-empty',new Uint8Array()),/too large/);
    await reject(()=>h.photoStore.put('invalid-big',new Uint8Array(size+1)),/too large/);
    try {
      await h.photoStore.put('quota-exact',data); keys.push('quota-exact'); const stored=await h.photoStore.get('quota-exact');eq(stored.size,size);same(stored.body,data);
      await reject(()=>h.photoStore.put('quota-exact',data),/UNIQUE/);eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,size);
      assert.throws(()=>h.run('INSERT INTO photo_objects VALUES (?,?,?,?)','invalid-body',1,new Uint8Array(2),Date.now()),/PHOTO_SIZE_INVALID/);ok(true);
      assert.throws(()=>h.run('UPDATE photo_objects SET size = size WHERE object_key=?','quota-exact'),/PHOTO_REPLACEMENT_NOT_ALLOWED/);ok(true);
      for(let i=1;i<127;i++){const key='quota-fill-'+i; await h.photoStore.put(key,data);keys.push(key);}
      eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,limit-size);
      const race=await Promise.allSettled([h.photoStore.put('quota-race-a',data),h.photoStore.put('quota-race-b',data)]);keys.push('quota-race-a','quota-race-b');
      eq(race.filter(r=>r.status==='fulfilled').length,1);eq(race.filter(r=>r.status==='rejected').length,1);ok(String(race.find(r=>r.status==='rejected').reason).includes('64 MB'));eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,limit);
      const form=new FormData(),messageId=crypto.randomUUID();form.set('id',messageId);form.set('roomId',dmId);form.set('body','Quota rejection');form.append('files',new File([data],'full.png',{type:'image/png'}));
      await json(await post(owner,'chat',form),507);eq(h.count('messages','id = ?',messageId),0);eq(h.count('file_deletions'),0);eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,limit);
      const text=new FormData(),textId=crypto.randomUUID();text.set('id',textId);text.set('roomId',dmId);text.set('body','Text still works at photo quota');await json(await post(owner,'chat',text),201);await json(await chat(owner,{action:'delete',id:textId}));
    }finally{for(const key of keys)await h.photoStore.delete(key);}
    eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,0);eq(h.count('photo_objects'),0);
    await h.photoStore.delete('quota-exact');eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,0);
    const a=h.database.prepare('INSERT INTO photo_objects VALUES (?,?,?,?)').bind('quota-rollback',size,data,Date.now());
    const b=h.database.prepare('INSERT INTO photo_objects VALUES (?,?,?,?)').bind('quota-rollback-invalid',1,new Uint8Array(2),Date.now());
    await reject(()=>h.database.batch([a,b]),/PHOTO_SIZE_INVALID/);eq(h.count('photo_objects'),0);eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,0);
  });

  await test('D1 photo send retry and pre/post-commit failures preserve message bytes and quota',async()=>{
    const data=new Uint8Array(512*1024); data.set([137,80,78,71,13,10,26,10]);
    const form=id=>{const f=new FormData();f.set('id',id);f.set('roomId',dmId);f.set('body','retry boundary');f.append('files',new File([data],'fixture.png',{type:'image/png'}));return f;};
    for(const phase of ['beforeCommit','after']){
      const id=crypto.randomUUID();h.inject({phase,kind:'batch',pattern:/INSERT INTO messages/});
      await json(await post(owner,'chat',form(id)),phase==='after'?200:503);
      eq(h.count('messages','id = ?',id),phase==='after'?1:0);eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,phase==='after'?data.length:0);
      await json(await post(owner,'chat',form(id)),phase==='after'?200:201);await json(await post(owner,'chat',form(id)),200);
      eq(h.count('attachments','message_id = ?',id),1);eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,data.length);
      const attachment=h.row('SELECT id FROM attachments WHERE message_id=?',id),photo=await h.request(derek,'photo',{query:{id:attachment.id}});eq(photo.status,200);same(new Uint8Array(await photo.arrayBuffer()),data);
      await json(await chat(owner,{action:'delete',id}));eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,0);
    }
    const id=crypto.randomUUID();h.inject({kind:'run',phase:'after',pattern:/INSERT INTO photo_objects/});await json(await post(owner,'chat',form(id)),503);eq(h.count('messages','id = ?',id),0);eq(h.count('photo_objects'),0);eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,0);
  });

  await test('A large queued photo cleanup drains across bounded requests below 50 D1 statements',async()=>{
    for(let i=0;i<30;i++){
      const key='queued-fixture-'+i;await h.photoStore.put(key,new Uint8Array([1]));
      h.run('INSERT INTO file_deletions (object_key,message_id,requested_by,requested_at) VALUES (?,NULL,?,?)',key,owner.id,Date.now()+i);
    }
    let prior=30,requests=0;
    while(prior>0&&requests<8){const result=await json(await security(owner,{action:'retry_deletions'}));ok(result.photosPending<prior);ok(result.photosPending>=Math.max(0,prior-8));prior=result.photosPending;requests++;}
    eq(prior,0);eq(requests,4);eq(h.count('photo_objects'),0);eq(h.row('SELECT used_bytes FROM photo_budget WHERE id=1').used_bytes,0);
    same(h.metrics.requestSqlOver50,[]);
  });
}
