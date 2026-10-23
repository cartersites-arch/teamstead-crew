(()=>{
  const params=new URLSearchParams(location.search),co=params.get('company');
  const valid=value=>typeof value==='string'&&/^(main|demo|pilot|c_[a-f0-9]{16})$/.test(value);
  const installed=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  // Remember only the workspace route, never credentials or account information.
  // An explicit company or private setup link always takes priority.
  if(installed){try{
    if(valid(co))localStorage.setItem('teamstead:installed-workspace',co);
    else if(co===null&&location.pathname==='/'&&!location.hash){
      const saved=localStorage.getItem('teamstead:installed-workspace');
      if(valid(saved)&&saved!=='main'){params.set('company',saved);location.replace('/?'+params.toString());return;}
    }
  }catch{}}
  if(valid(co)&&co!=='main'){
    const link=document.querySelector('link[rel="manifest"]');
    if(link)link.href='/manifest.webmanifest?company='+encodeURIComponent(co);
  }
})();
