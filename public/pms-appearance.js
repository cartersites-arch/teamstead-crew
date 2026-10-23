(() => {
  'use strict';
  const modeKey='pms-appearance-v1', photoKey='pms-background-photo-v1';
  const system=matchMedia('(prefers-color-scheme: dark)');
  let mode='device',photo='';
  try {mode=localStorage.getItem(modeKey)||'device';photo=localStorage.getItem(photoKey)||'';}catch{}
  if(!['device','light','dark'].includes(mode))mode='device';
  if(!photo.startsWith('data:image/jpeg;base64,'))photo='';
  function apply(){
    const theme=mode==='device'?(system.matches?'dark':'light'):mode;
    const root=document.documentElement;
    root.dataset.appearance=theme;root.dataset.background=photo?'photo':'plain';
    root.style.setProperty('--pms-photo',photo?'url("'+photo+'")':'none');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#102334':'#e7eff5');
  }
  apply();system.addEventListener('change',()=>{if(mode==='device')apply();});
  function start(){
    const launch=document.createElement('button');launch.id='pms-appearance-launch';launch.type='button';launch.setAttribute('aria-label','Appearance: colours and photo background');launch.title='Appearance';launch.textContent='◐';
    const dialog=document.createElement('dialog');dialog.id='pms-appearance-dialog';dialog.setAttribute('aria-labelledby','pms-appearance-title');
    dialog.innerHTML='<form method="dialog"><div class="pms-appearance-heading"><h2 id="pms-appearance-title">Appearance</h2><button aria-label="Close appearance" value="close">✕</button></div></form><p>Choose your colours and background. Saved in this browser on this device.</p><label for="pms-appearance-mode">Colour scheme</label><select id="pms-appearance-mode" aria-label="Colour scheme"><option value="device">Device — automatic light / dark</option><option value="light">Light — daytime</option><option value="dark">Dark — nighttime</option></select><p class="pms-appearance-hint">Device follows your phone or computer settings. If your device switches at sunset, the apps follow it.</p><h3>Photo background</h3><p>Your photo stays on this device. It is not sent to the company or an AI service.</p><div class="pms-appearance-photo-actions"><button type="button" id="pms-choose-background">Choose a photo</button><button type="button" id="pms-remove-background">Remove photo</button></div><input type="file" id="pms-background-input" accept="image/*" hidden><p id="pms-appearance-status" role="status" aria-live="polite"></p>';
    document.body.append(launch,dialog);
    const select=dialog.querySelector('select'),status=dialog.querySelector('#pms-appearance-status'),input=dialog.querySelector('input');select.value=mode;
    const remove=dialog.querySelector('#pms-remove-background');remove.disabled=!photo;
    launch.addEventListener('click',()=>{select.value=mode;dialog.showModal();});
    select.addEventListener('change',()=>{mode=select.value;apply();try{localStorage.setItem(modeKey,mode);status.textContent='Colour scheme saved.';}catch{status.textContent='Applied for now. This browser cannot save preferences.';}});
    dialog.querySelector('#pms-choose-background').addEventListener('click',()=>input.click());
    remove.addEventListener('click',()=>{photo='';apply();remove.disabled=true;try{localStorage.removeItem(photoKey);}catch{}status.textContent='Photo background removed.';});
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];input.value='';if(!file)return;
      if(!file.type.startsWith('image/')||file.size>25*1024*1024){status.textContent='Choose a picture under 25 MB.';return;}
      status.textContent='Preparing your background…';
      const temporary=URL.createObjectURL(file);
      try{
        const image=new Image();image.src=temporary;await image.decode();
        const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
        const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
        const next=canvas.toDataURL('image/jpeg',.75);if(next.length>1500000)throw Error('large');
        localStorage.setItem(photoKey,next);photo=next;apply();remove.disabled=false;status.textContent='Photo background saved on this device.';
      }catch{status.textContent='This photo could not be saved. Try a smaller JPEG or PNG.';}
      finally{URL.revokeObjectURL(temporary);}
    });
    addEventListener('storage',event=>{if(event.key===modeKey){mode=['device','light','dark'].includes(event.newValue)?event.newValue:'device';select.value=mode;apply();}if(event.key===photoKey){photo=event.newValue?.startsWith('data:image/jpeg;base64,')?event.newValue:'';remove.disabled=!photo;apply();}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
