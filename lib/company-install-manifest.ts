export function companyInstallManifest(request:Request):Response{
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const co=new URL(request.url).searchParams.get('company')||'main';
  if(!/^(main|demo|pilot|c_[a-f0-9]{16})$/.test(co))return new Response('Company not found',{status:404});
  const start=co==='main'?'/':'/?company='+co;
  const manifest={id:start,name:'Teamstead Crew',short_name:'Teamstead Crew',description:'Your private team conversations and maintenance workspace.',start_url:start,scope:'/',display:'standalone',background_color:'#f7f9f5',theme_color:'#154e48',icons:[{src:'/app-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]};
  return new Response(request.method==='HEAD'?null:JSON.stringify(manifest),{headers:{'Content-Type':'application/manifest+json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
